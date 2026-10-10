import type { SelectedReviewContext } from "../../application/review-context/index";
import { refreshCurrentContextDependents } from "../../application/review-context/projection-refresh";
import { reportActiveOperationFailure, type OperationFeedbackContext } from "../../application/operation-feedback/index";
import type { CurrentContextRefreshContext } from "../../ui/current-context/current-context-runtime-coordinator";
import type { PullRequestReviewRuntime } from "../pull-request/pull-request-review-runtime";

interface CurrentContextPullRequestViewsDependencies<Uri> {
  readonly selection: SelectedReviewContext | undefined;
  readonly runtime: PullRequestReviewRuntime<Uri>;
  readonly refreshProgress: (owner?: OperationFeedbackContext) => Promise<void>;
  readonly refreshList: (owner?: OperationFeedbackContext) => Promise<void>;
  readonly refreshDecorations: () => Promise<void>;
  readonly refreshGlobal: () => Promise<void>;
  readonly reportProgressError: (error: unknown) => void | Promise<void>;
}

/** Production Current Context dependency boundary and its safe lifecycle records. */
export const refreshCurrentContextPullRequestViews = async <Uri>(
  dependencies: CurrentContextPullRequestViewsDependencies<Uri>,
  refreshContext?: CurrentContextRefreshContext,
): Promise<void> => {
  const selected = dependencies.selection?.kind === "pull-request" ? { ...dependencies.selection } : undefined;
  const isCurrent = (): boolean => refreshContext?.isCurrent() ?? true;
  const matchesAcceptedIdentity = (snapshot: ReturnType<PullRequestReviewRuntime<Uri>["snapshotForContext"]>): boolean => {
    const accepted = refreshContext?.acceptedIdentity();
    return snapshot !== undefined && snapshot.contextId === selected?.contextId &&
      (selected.headRevision === undefined || selected.headRevision === snapshot.headSha) &&
      (accepted === undefined || (accepted.contextId === snapshot.contextId &&
        (accepted.baseSha === undefined || accepted.baseSha === snapshot.baseSha) &&
        (accepted.headSha === undefined || accepted.headSha === snapshot.headSha)));
  };
  let pullRequestRefreshFailure: unknown;
  await refreshCurrentContextDependents({
    shouldContinue: isCurrent,
    refreshReviewContexts: async () => {
      refreshContext?.report("review-contexts-list", "started");
      refreshContext?.report("diff-registration", "started");
      try {
        await dependencies.refreshList(refreshContext?.feedbackContext);
        if (!isCurrent()) {
          for (const stage of ["review-contexts-list", "diff-registration"] as const) {
            refreshContext?.report(stage, "superseded", { reasonCode: "superseded" });
          }
          return;
        }
        const snapshot = selected === undefined ? undefined : dependencies.runtime.snapshotForContext(selected.contextId);
        const matches = matchesAcceptedIdentity(snapshot);
        if (matches && snapshot !== undefined) refreshContext?.acceptRegisteredSnapshot(snapshot);
        refreshContext?.report("review-contexts-list", "succeeded");
        refreshContext?.report("diff-registration", selected !== undefined && !matches ? "failed" : "succeeded", {
          ...(selected !== undefined && !matches ? { reasonCode: "snapshot-unavailable" } : {}),
          counts: { registeredPullRequests: matches ? 1 : 0, selectedContextOrdinal: selected === undefined ? 0 : 1, snapshotOrdinal: matches ? 1 : 0 },
        });
      } catch (error) {
        const status = isCurrent() ? "failed" : "superseded";
        const reasonCode = isCurrent() ? "refresh-failed" : "superseded";
        refreshContext?.report("review-contexts-list", status, { reasonCode });
        refreshContext?.report("diff-registration", status, { reasonCode });
        throw error;
      }
    },
    refreshPullRequestProgress: async () => {
      const snapshot = selected === undefined ? undefined : dependencies.runtime.snapshotForContext(selected.contextId);
      const matches = matchesAcceptedIdentity(snapshot);
      const provenance = refreshContext?.selectionProvenance();
      const reasonCode = provenance?.reason ?? (selected === undefined ? "no-selected-pr" : undefined);
      const counts = {
        pullRequestCandidates: provenance?.candidateCount ?? 0,
        registeredPullRequests: matches ? 1 : 0,
        selectedContextOrdinal: selected === undefined ? 0 : 1,
        snapshotOrdinal: matches ? 1 : 0,
      };
      refreshContext?.setPublicationCounts({ ...counts, treeItems: 0 });
      refreshContext?.report("pr-selection", "started");
      refreshContext?.report("pr-selection", selected !== undefined && !matches ? "failed" : "succeeded", {
        ...(selected !== undefined && !matches ? { reasonCode: "snapshot-unavailable" } : reasonCode === undefined ? {} : { reasonCode }),
        counts,
      });
      refreshContext?.report("pr-progress", "started");
      try {
        if (selected !== undefined && !matches) {
          dependencies.runtime.clearProgress();
          throw new Error("Accepted PR snapshot is unavailable or changed.");
        }
        await dependencies.refreshProgress(refreshContext?.feedbackContext);
        if (!isCurrent()) {
          refreshContext?.report("pr-progress", "superseded", { reasonCode: "superseded" });
          return;
        }
        if (selected !== undefined && (!matches || dependencies.runtime.snapshotForContext(selected.contextId) !== snapshot)) {
          throw new Error("Accepted PR snapshot is unavailable or changed.");
        }
        const files = dependencies.runtime.progress.getChildren().flatMap((category) =>
          dependencies.runtime.progress.getChildren(category).filter((node) => node.kind === "file"));
        if (files.some((node) => snapshot === undefined || node.openTarget.contextId !== snapshot.contextId ||
          node.openTarget.baseSha !== snapshot.baseSha || node.openTarget.headSha !== snapshot.headSha ||
          node.openTarget.originalDiffId !== snapshot.originalDiffId)) {
          throw new Error("Accepted PR progress identity does not match the selected snapshot.");
        }
        const acceptedCounts = { ...counts, ...(snapshot === undefined ? {} : { snapshotFiles: snapshot.files.length }), treeItems: files.length, processedFiles: files.length };
        refreshContext?.setPublicationCounts(acceptedCounts);
        refreshContext?.report("pr-progress", "succeeded", {
          ...(selected === undefined ? { reasonCode: reasonCode ?? "no-selected-pr" } : snapshot?.files.length === 0 ? { reasonCode: "no-pr-files" } : {}),
          counts: acceptedCounts,
        });
      } catch (error) {
        refreshContext?.report("pr-progress", isCurrent() ? "failed" : "superseded", {
          reasonCode: isCurrent() ? (matches ? "refresh-failed" : "snapshot-unavailable") : "superseded",
          counts: { ...counts, treeItems: 0 },
        });
        throw error;
      }
    },
    refreshDecorations: dependencies.refreshDecorations,
    refreshGlobal: dependencies.refreshGlobal,
    reportPullRequestProgressError: async (error) => {
      if (!isCurrent()) return;
      pullRequestRefreshFailure = error;
      if (refreshContext?.feedbackContext !== undefined) {
        reportActiveOperationFailure("PR進捗を再計算", error, refreshContext.feedbackContext);
      }
      await dependencies.reportProgressError(error);
    },
  });
  if (pullRequestRefreshFailure !== undefined && isCurrent()) throw pullRequestRefreshFailure;
};

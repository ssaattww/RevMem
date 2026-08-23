import {
  reportActiveOperationProgress,
} from "./application/operation-feedback/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import {
  setCurrentPullRequestSelectionBranchScope,
} from "./ui/review-contexts/vscode-current-pull-request-selection-store";
import {
  registerT405ReviewContextsRuntime as registerBaseT405ReviewContextsRuntime,
  type T405ReviewContextsRuntimeOptions,
} from "./t405-review-contexts-runtime-base";

export * from "./t405-review-contexts-runtime-base";

const rememberBranchScope = (snapshot: CurrentContextUiSnapshot): string | undefined => {
  const selection = snapshot.context.selection;
  if (selection?.kind === "branch") {
    const headRevision = snapshot.context.headRevision;
    if (headRevision === undefined) return undefined;
    setCurrentPullRequestSelectionBranchScope(
      selection.repositoryId,
      headRevision,
      selection.branchRef,
    );
    return selection.repositoryId;
  }
  if (selection?.kind === "detached") {
    setCurrentPullRequestSelectionBranchScope(
      selection.repositoryId,
      selection.headRevision,
      undefined,
    );
    return selection.repositoryId;
  }
  return undefined;
};

/**
 * Issue #84 composition wrapper. It keeps branch identity available to the
 * persisted Current Context preference and publishes count-only progress while
 * the existing T405 implementation performs the actual acquisition.
 */
export const registerT405ReviewContextsRuntime = (
  options: T405ReviewContextsRuntimeOptions,
): ReturnType<typeof registerBaseT405ReviewContextsRuntime> => {
  let completedPullRequestContexts = 0;
  return registerBaseT405ReviewContextsRuntime({
    ...options,
    enumerateCurrentContexts: async (signal) => {
      const snapshots = await options.enumerateCurrentContexts(signal);
      completedPullRequestContexts = 0;
      const repositoryIds = new Set<string>();
      for (const snapshot of snapshots) {
        const repositoryId = rememberBranchScope(snapshot);
        if (repositoryId !== undefined) repositoryIds.add(repositoryId);
      }
      reportActiveOperationProgress({
        stage: "repositories",
        completed: repositoryIds.size,
        total: repositoryIds.size,
      });
      reportActiveOperationProgress({
        stage: "pull-request-contexts",
        completed: 0,
      });
      return snapshots;
    },
    getPullRequestReviewProgress: async (contextId, feedbackContext, signal) => {
      const progress = await options.getPullRequestReviewProgress(
        contextId,
        feedbackContext,
        signal,
      );
      completedPullRequestContexts += 1;
      reportActiveOperationProgress({
        stage: "pull-request-contexts",
        completed: completedPullRequestContexts,
      }, feedbackContext);
      return progress;
    },
  });
};

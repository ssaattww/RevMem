import { pathToFileURL } from "node:url";

import type { NormalEditorReviewedDecoration } from "./application/editor-decoration/index";
import {
  describePullRequestProgressFile,
  describePullRequestProgressSummary,
  queueOperationStartDetails,
  reportActiveOperationDetail,
  reportActiveOperationProgress,
} from "./application/operation-feedback/index";
import { normalizeLineIntervals } from "./core/intervals/index";
import { resolveWorkingTreeFilePath } from "./ui/pr-progress/working-tree-file-path";
import {
  PullRequestReviewRuntime as BasePullRequestReviewRuntime,
  type PullRequestReviewRuntimeOptions,
  type PullRequestReviewRuntimeRegistration,
} from "./t405-pull-request-review-runtime-base";

export type {
  PullRequestReviewCommandDependencies,
  PullRequestReviewRuntimeOptions,
  PullRequestReviewRuntimeRegistration,
  PullRequestReviewRuntimeRepository,
} from "./t405-pull-request-review-runtime-base";

const snapshotKey = (snapshot: PullRequestReviewRuntimeRegistration["snapshot"]): string =>
  `${snapshot.contextId}\0${snapshot.baseSha}\0${snapshot.headSha}\0${snapshot.originalDiffId}`;

interface ActiveFileProgress {
  readonly key: string;
  readonly total: number;
  readonly seen: Set<string>;
}

interface WorkingTreeOpenTarget {
  readonly repositoryRoot: string;
  readonly repositoryPath: string;
  readonly fileSystemPathSemantics: "posix" | "windows";
}

type WorkingTreeRuntimeOptions<Uri> = PullRequestReviewRuntimeOptions<Uri> & {
  readonly openWorkingTreeFile?: (target: WorkingTreeOpenTarget) => Promise<void>;
};

const reviewContextLabel = (
  contextState: Awaited<ReturnType<BasePullRequestReviewRuntime<unknown>["openSession"]>>["contextState"]
): string => {
  if (contextState.kind === "pull-request" && contextState.pullRequest !== undefined) {
    const title = contextState.pullRequest.title?.trim();
    return title === undefined || title.length === 0
      ? `PR #${contextState.pullRequest.number}`
      : `PR #${contextState.pullRequest.number}: ${title}`;
  }
  const displayName = contextState.displayName.trim();
  return displayName.length === 0 ? "Workspace review" : displayName;
};

/** Coordinates refreshes around the canonical PR review runtime. */
export class PullRequestReviewRuntime<Uri> extends BasePullRequestReviewRuntime<Uri> {
  private acceptedProgressKey: string | undefined;
  private inFlight: { readonly key: string; readonly promise: Promise<void> } | undefined;
  private suppressTreeClear = false;
  private activeFileProgress: ActiveFileProgress | undefined;
  private readonly clearAcceptedTree: () => void;
  private readonly getExclusionPolicy: PullRequestReviewRuntimeOptions<Uri>["getExclusionPolicy"];
  private readonly workingTreeRegistrations = new Map<string, PullRequestReviewRuntimeRegistration>();
  private readonly openWorkingTreeFileHost: WorkingTreeRuntimeOptions<Uri>["openWorkingTreeFile"];
  private readonly openFileHost: PullRequestReviewRuntimeOptions<Uri>["openFile"];
  private readonly parseUri: PullRequestReviewRuntimeOptions<Uri>["diffHost"]["parseUri"];

  public constructor(options: PullRequestReviewRuntimeOptions<Uri>) {
    super(options);
    this.getExclusionPolicy = options.getExclusionPolicy;
    this.openWorkingTreeFileHost = (options as WorkingTreeRuntimeOptions<Uri>).openWorkingTreeFile;
    this.openFileHost = options.openFile;
    this.parseUri = options.diffHost.parseUri;
    this.clearAcceptedTree = this.progress.clear.bind(this.progress);
    this.progress.clear = (): void => {
      if (!this.suppressTreeClear) this.clearAcceptedTree();
    };
    this.progress.openWorkingTreeFile = async (node): Promise<void> => {
      const target = node.openTarget;
      const registration = this.workingTreeRegistrations.get(target.contextId);
      if (registration === undefined) {
        throw new RangeError("PR Progress working-tree target is not registered.");
      }
      const { snapshot } = registration;
      const file = snapshot.files.find((candidate) => candidate.fileId === target.file.fileId);
      if (
        target.snapshotId !== `${snapshot.contextId}:${snapshot.baseSha}:${snapshot.headSha}` ||
        target.baseSha !== snapshot.baseSha ||
        target.headSha !== snapshot.headSha ||
        target.originalDiffId !== snapshot.originalDiffId ||
        file === undefined ||
        file.oldPath !== target.file.oldPath ||
        file.newPath !== target.file.newPath ||
        file.status !== target.file.status
      ) {
        throw new RangeError("PR Progress working-tree target is stale for the registered snapshot.");
      }
      if (file.status === "deleted" || file.newPath === undefined) {
        throw new RangeError("Deleted PR Progress file does not exist in the working tree.");
      }
      const openTarget = {
        repositoryRoot: registration.repositoryRoot,
        repositoryPath: file.newPath,
        fileSystemPathSemantics: registration.fileSystemPathSemantics,
      } satisfies WorkingTreeOpenTarget;
      if (this.openWorkingTreeFileHost !== undefined) {
        await this.openWorkingTreeFileHost(openTarget);
        return;
      }
      if (this.openFileHost === undefined) {
        throw new Error("Pull-request working-tree file host is unavailable.");
      }
      const filePath = resolveWorkingTreeFilePath(
        openTarget.repositoryRoot,
        openTarget.repositoryPath,
        openTarget.fileSystemPathSemantics
      );
      await this.openFileHost(this.parseUri(pathToFileURL(filePath).toString()));
    };
  }

  /** Loads reviewed decorations for one current immutable PR diff document. */
  public async loadReviewedDecorations(uri: string): Promise<readonly NormalEditorReviewedDecoration[]> {
    const session = await this.openSession(uri);
    const file = session.contextState.files[session.target.fileId];
    if (file === undefined) return [];
    const label = reviewContextLabel(session.contextState);
    const side = this.sideForDiffDocumentUri(uri);
    const intervals = side === "modified"
      ? normalizeLineIntervals(file.modifiedReviewed)
      : normalizeLineIntervals([
        ...file.modifiedReviewed.flatMap((reviewed) =>
          session.originalToModifiedLineMappings.flatMap((mapping) => {
            const modifiedStart = Math.max(reviewed.startLine, mapping.modifiedStartLine);
            const modifiedEnd = Math.min(
              reviewed.endLineExclusive,
              mapping.modifiedStartLine + mapping.lineCount
            );
            if (modifiedStart >= modifiedEnd) return [];
            const offset = modifiedStart - mapping.modifiedStartLine;
            return [{
              startLine: mapping.originalStartLine + offset,
              endLineExclusive: mapping.originalStartLine + offset + (modifiedEnd - modifiedStart)
            }];
          })
        ),
        ...(file.originalReviewedByDiff[session.diffId] ?? [])
      ]);
    return intervals.map((interval) => ({
      interval,
      source: "context",
      contextLabel: label,
      reviewedAt: file.updatedAt,
      globalActive: false
    }));
  }

  public override register(registration: PullRequestReviewRuntimeRegistration): void {
    const key = snapshotKey(registration.snapshot);
    const readTextContent = registration.readTextContent;
    super.register({
      ...registration,
      readTextContent: async (...args) => {
        const active = this.activeFileProgress;
        const feedbackContext = args[1];
        const descriptor = args[0];
        if (active?.key === key && feedbackContext !== undefined) {
          reportActiveOperationDetail({
            reason: "pull-request-file",
            target: descriptor.filePath,
            phase: "read-content",
          }, feedbackContext);
        }
        const result = await readTextContent(...args);
        if (active?.key === key && feedbackContext !== undefined) {
          const identity = `${descriptor.side}\0${descriptor.revision}\0${descriptor.filePath}`;
          if (!active.seen.has(identity)) {
            active.seen.add(identity);
            reportActiveOperationProgress({
              stage: "pull-request-files",
              completed: Math.min(active.seen.size, active.total),
              total: active.total,
            }, feedbackContext);
          }
        }
        return result;
      },
    });
    this.workingTreeRegistrations.set(registration.snapshot.contextId, registration);
  }

  public override unregister(contextId: string): void {
    this.workingTreeRegistrations.delete(contextId);
    super.unregister(contextId);
  }

  public override async getProgress(
    contextId: string,
    feedbackContext?: Parameters<BasePullRequestReviewRuntime<Uri>["getProgress"]>[1],
    signal?: AbortSignal,
  ): ReturnType<BasePullRequestReviewRuntime<Uri>["getProgress"]> {
    if (feedbackContext !== undefined) return super.getProgress(contextId, feedbackContext, signal);
    const total = this.snapshotForContext(contextId)?.files.length ?? 0;
    reportActiveOperationProgress({ stage: "pull-request-files", completed: 0, total });
    const progress = await super.getProgress(contextId, undefined, signal);
    reportActiveOperationProgress({ stage: "pull-request-files", completed: total, total });
    return progress;
  }

  public override async activateProgress(contextId: string): Promise<void> {
    const snapshot = this.snapshotForContext(contextId);
    if (snapshot === undefined) {
      queueOperationStartDetails("PR進捗を計算", [{ reason: "missing-pr-snapshot", phase: "progress-input" }]);
      await super.activateProgress(contextId);
      return;
    }
    const key = snapshotKey(snapshot);
    const existing = this.inFlight;
    if (existing?.key === key) return existing.promise;
    if (existing !== undefined) {
      this.acceptedProgressKey = undefined;
      this.suppressTreeClear = false;
    }

    const policy = this.getExclusionPolicy();
    const diagnosticFiles = snapshot.files.map((file) => {
      const path = file.newPath ?? file.oldPath ?? file.fileId;
      const exclusion = policy.evaluate({ path, isBinary: file.status === "binary" });
      return {
        path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        reviewedLineCount: 0,
        totalLineCount: exclusion.excluded ? 0 : file.additions + file.deletions,
        excluded: exclusion.excluded,
        ...(exclusion.excluded ? { exclusionReason: exclusion.reason } : {}),
      };
    });
    const totalLineCount = diagnosticFiles.reduce((sum, file) => sum + file.totalLineCount, 0);
    queueOperationStartDetails("PR進捗を計算", [
      {
        reason: snapshot.files.length === 0 ? "no-pr-files" : "pr-snapshot-loaded",
        target: `files=${snapshot.files.length}`,
        phase: "progress-input",
      },
      ...diagnosticFiles.map(describePullRequestProgressFile),
      describePullRequestProgressSummary({
        snapshotFileCount: snapshot.files.length,
        files: diagnosticFiles,
        reviewedLineCount: 0,
        totalLineCount,
      }),
    ]);

    const preserveAcceptedTree = this.acceptedProgressKey === key;
    const run = (async (): Promise<void> => {
      this.suppressTreeClear = preserveAcceptedTree;
      this.activeFileProgress = { key, total: snapshot.files.length, seen: new Set<string>() };
      try {
        await super.activateProgress(contextId);
        this.acceptedProgressKey = key;
      } catch (error) {
        if (preserveAcceptedTree && this.acceptedProgressKey === key) {
          this.suppressTreeClear = false;
          this.clearAcceptedTree();
          this.acceptedProgressKey = undefined;
        }
        throw error;
      }
    })();
    this.inFlight = { key, promise: run };
    try {
      await run;
    } finally {
      if (this.inFlight?.promise === run) {
        this.inFlight = undefined;
        this.suppressTreeClear = false;
        this.activeFileProgress = undefined;
      }
    }
  }

  public override clearProgress(): void {
    this.acceptedProgressKey = undefined;
    this.activeFileProgress = undefined;
    this.suppressTreeClear = false;
    super.clearProgress();
  }
}

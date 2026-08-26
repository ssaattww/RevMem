import {
  describePullRequestProgressFile,
  describePullRequestProgressSummary,
  queueOperationStartDetails,
  reportActiveOperationDetail,
  reportActiveOperationProgress,
} from "./application/operation-feedback/index";
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

/**
 * Coordinates refreshes around the canonical PR review runtime.
 *
 * The base runtime remains responsible for immutable diff acquisition, progress
 * calculation, reviewability, and stale-generation rejection. This layer only
 * serializes equivalent refreshes, preserves the last accepted tree while an
 * equivalent recalculation is running, and emits diagnostic file progress.
 */
export class PullRequestReviewRuntime<Uri> extends BasePullRequestReviewRuntime<Uri> {
  private acceptedProgressKey: string | undefined;
  private inFlight: { readonly key: string; readonly promise: Promise<void> } | undefined;
  private suppressTreeClear = false;
  private activeFileProgress: ActiveFileProgress | undefined;
  private readonly clearAcceptedTree: () => void;
  private readonly getExclusionPolicy: PullRequestReviewRuntimeOptions<Uri>["getExclusionPolicy"];

  public constructor(options: PullRequestReviewRuntimeOptions<Uri>) {
    super(options);
    this.getExclusionPolicy = options.getExclusionPolicy;
    this.clearAcceptedTree = this.progress.clear.bind(this.progress);
    this.progress.clear = (): void => {
      if (!this.suppressTreeClear) this.clearAcceptedTree();
    };
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
  }

  public override async getProgress(
    contextId: string,
    feedbackContext?: Parameters<BasePullRequestReviewRuntime<Uri>["getProgress"]>[1],
    signal?: AbortSignal,
  ): ReturnType<BasePullRequestReviewRuntime<Uri>["getProgress"]> {
    if (feedbackContext !== undefined) {
      return super.getProgress(contextId, feedbackContext, signal);
    }
    const total = this.snapshotForContext(contextId)?.files.length ?? 0;
    reportActiveOperationProgress({ stage: "pull-request-files", completed: 0, total });
    const progress = await super.getProgress(contextId, undefined, signal);
    reportActiveOperationProgress({ stage: "pull-request-files", completed: total, total });
    return progress;
  }

  public override async activateProgress(contextId: string): Promise<void> {
    const snapshot = this.snapshotForContext(contextId);
    if (snapshot === undefined) {
      queueOperationStartDetails("PR進捗を計算", [{
        reason: "missing-pr-snapshot",
        phase: "progress-input",
      }]);
      await super.activateProgress(contextId);
      return;
    }
    const key = snapshotKey(snapshot);
    const existing = this.inFlight;
    if (existing?.key === key) {
      return existing.promise;
    } else if (existing !== undefined) {
      this.acceptedProgressKey = undefined;
      this.suppressTreeClear = false;
    }

    const policy = this.getExclusionPolicy();
    const diagnosticFiles = snapshot.files.map((file) => {
      const path = file.newPath ?? file.oldPath ?? file.fileId;
      const binary = file.status === "binary";
      const exclusion = policy.evaluate({ path, isBinary: binary });
      return {
        path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        reviewedLineCount: 0,
        totalLineCount: exclusion.excluded ? 0 : file.additions + file.deletions,
        excluded: exclusion.excluded,
        ...(exclusion.reason === undefined ? {} : { exclusionReason: exclusion.reason }),
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
      this.activeFileProgress = {
        key,
        total: snapshot.files.length,
        seen: new Set<string>(),
      };
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

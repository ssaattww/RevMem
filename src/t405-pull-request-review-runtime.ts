import {
  reportActiveOperationProgress,
  type OperationFeedbackContext,
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
 * equivalent recalculation is running, and emits anonymous file-count progress.
 */
export class PullRequestReviewRuntime<Uri> extends BasePullRequestReviewRuntime<Uri> {
  private acceptedProgressKey: string | undefined;
  private inFlight: { readonly key: string; readonly promise: Promise<void> } | undefined;
  private suppressTreeClear = false;
  private activeFileProgress: ActiveFileProgress | undefined;
  private readonly clearAcceptedTree: () => void;

  public constructor(options: PullRequestReviewRuntimeOptions<Uri>) {
    super(options);
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
        const result = await readTextContent(...args);
        const active = this.activeFileProgress;
        const feedbackContext = args[1];
        if (active?.key === key && feedbackContext !== undefined) {
          const descriptor = args[0];
          const identity = `${descriptor.side}\0${descriptor.revision}\0${descriptor.filePath}`;
          if (!active.seen.has(identity)) {
            if (active.seen.size === 0) {
              reportActiveOperationProgress({
                stage: "pull-request-files",
                completed: 0,
                total: active.total,
              }, feedbackContext);
            }
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

  public override async activateProgress(contextId: string): Promise<void> {
    const snapshot = this.snapshotForContext(contextId);
    if (snapshot === undefined) {
      await super.activateProgress(contextId);
      return;
    }
    const key = snapshotKey(snapshot);
    const existing = this.inFlight;
    if (existing?.key === key) {
      try {
        await existing.promise;
      } catch {
        // The queued request is a fresh attempt after the previous result.
      }
    } else if (existing !== undefined) {
      this.acceptedProgressKey = undefined;
      this.suppressTreeClear = false;
    }

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

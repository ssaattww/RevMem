import {
  reportActiveOperationProgress,
} from "./application/operation-feedback/index";
import {
  PullRequestReviewRuntime as BasePullRequestReviewRuntime,
  type PullRequestReviewRuntimeOptions,
} from "./t405-pull-request-review-runtime-base";

export * from "./t405-pull-request-review-runtime-base";

/**
 * Issue #84 compatibility layer. Equivalent refreshes are serialized instead of
 * cancelling one another, and the last accepted PR Progress tree remains visible
 * while the same immutable PR snapshot is recalculated.
 */
export class PullRequestReviewRuntime<Uri> extends BasePullRequestReviewRuntime<Uri> {
  private activationTail: Promise<void> = Promise.resolve();
  private activationIdentity: string | undefined;

  public constructor(options: PullRequestReviewRuntimeOptions<Uri>) {
    super(options);
  }

  public override async activateProgress(contextId: string): Promise<void> {
    const snapshot = this.snapshotForContext(contextId);
    if (snapshot === undefined) {
      return super.activateProgress(contextId);
    }
    const identity = [
      snapshot.contextId,
      snapshot.baseSha,
      snapshot.headSha,
      snapshot.originalDiffId,
    ].join("\0");
    const equivalent = this.activationIdentity === identity;
    if (!equivalent) {
      this.activationIdentity = identity;
      this.activationTail = Promise.resolve();
    }
    const run = this.activationTail
      .catch(() => undefined)
      .then(() => this.runActivation(contextId, identity, equivalent));
    this.activationTail = run;
    return run;
  }

  public override clearProgress(): void {
    this.activationIdentity = undefined;
    this.activationTail = Promise.resolve();
    super.clearProgress();
  }

  private async runActivation(
    contextId: string,
    identity: string,
    preserveAcceptedSnapshot: boolean,
  ): Promise<void> {
    if (this.activationIdentity !== identity) return;
    const snapshot = this.snapshotForContext(contextId);
    const total = snapshot?.files.length ?? 0;
    reportActiveOperationProgress({
      stage: "pull-request-files",
      completed: 0,
      total,
    });

    if (!preserveAcceptedSnapshot) {
      await super.activateProgress(contextId);
    } else {
      const progress = this.progress as unknown as { clear(): void };
      const clear = progress.clear.bind(progress);
      progress.clear = () => undefined;
      try {
        await super.activateProgress(contextId);
      } finally {
        progress.clear = clear;
      }
    }

    if (this.activationIdentity === identity) {
      reportActiveOperationProgress({
        stage: "pull-request-files",
        completed: total,
        total,
      });
    }
  }
}

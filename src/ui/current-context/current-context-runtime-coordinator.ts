import type { CurrentContextUiController } from "./current-context-ui-controller";
import type { SelectedReviewContext } from "../../application/review-context/index";
import {
  reportActivePullRequestRefresh,
  type OperationFeedbackContext,
  type PullRequestRefreshDiagnostic,
  type PullRequestRefreshStage,
  type PullRequestRefreshStatus,
  type PullRequestRefreshTrigger,
  type PullRequestRefreshReasonCode,
} from "../../application/operation-feedback/index";
import type { CurrentContextRecomputeOptions } from "./current-context-runtime-composition";
import type { CurrentContextUiSnapshot } from "./current-context-ui-controller";

export interface CurrentContextDependentRefresher {
  /** Sets the identity that command and decoration consumers must use. */
  setSelectedContext?(selection: SelectedReviewContext | undefined): void;
  /** Arms a generation-scoped dependency preparation after Current Context accepts it. */
  acceptCurrentContextPreparation?(selection: SelectedReviewContext | undefined): void;
  refreshDependents(context?: CurrentContextRefreshContext): void | Promise<void>;
  /** Invalidates a previously selected PR when the current identity cannot be proven. */
  clearPullRequestProgress?(): void | Promise<void>;
}

export interface CurrentContextRefreshContext {
  readonly generation: number;
  readonly trigger: PullRequestRefreshTrigger;
  readonly feedbackContext?: OperationFeedbackContext;
  readonly selectionProvenance: () => Readonly<{
    readonly reason?: PullRequestRefreshReasonCode;
    readonly candidateCount?: number;
  }>;
  setSelectionProvenance(reason: PullRequestRefreshReasonCode | undefined, candidateCount: number | undefined): void;
  readonly report: (
    stage: PullRequestRefreshStage,
    status: PullRequestRefreshStatus,
    details?: Readonly<{
      readonly reasonCode?: PullRequestRefreshReasonCode;
      readonly durationMs?: number;
      readonly counts?: PullRequestRefreshDiagnostic["counts"];
    }>,
  ) => void;
}

/** Indicates PR-list refresh failed while a verified branch context remains safe to show. */
export class CurrentContextBranchRefreshError extends Error {
  public constructor() {
    super("PR context refresh failed; the verified branch context remains active.");
    this.name = "CurrentContextBranchRefreshError";
  }
}

/** Coordinates context commands so UI state is applied before dependent views refresh. */
export class CurrentContextRuntimeCoordinator {
  private generation = 0;

  public constructor(
    private readonly controller: CurrentContextUiController,
    private readonly dependentRefresher: CurrentContextDependentRefresher
  ) {}

  public async refresh(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    options?: CurrentContextRecomputeOptions,
    trigger: PullRequestRefreshTrigger = "current-context-refresh",
  ): Promise<void> {
    const context = this.createRefreshContext(trigger, feedbackContext);
    context.report("current-context", "started");
    let acceptedSnapshot: CurrentContextUiSnapshot | undefined;
    try {
      const result = await this.controller.refresh(signal, feedbackContext, options);
      if (signal?.aborted === true || context.generation !== this.generation || result.stale) {
        context.report("current-context", "superseded", { reasonCode: "superseded" });
        return;
      }
      if (result.nonDestructive) {
        context.report("current-context", "cancelled", { reasonCode: "identity-changed" });
        return;
      }
      acceptedSnapshot = result.snapshot;
      context.setSelectionProvenance(
        result.snapshot?.context.selectionReason,
        result.snapshot?.context.pullRequestCandidateCount,
      );
      context.report("repository-identity", result.snapshot?.context.selection === undefined ? "failed" : "succeeded", {
        ...(result.snapshot?.context.selection === undefined ? { reasonCode: "identity-changed" } : {}),
        counts: {
          repositories: result.snapshot?.context.selection?.kind === "workspace" ? 0 : 1,
          selectedContextOrdinal: result.snapshot?.context.selection === undefined ? 0 : 1,
        },
      });
      this.dependentRefresher.setSelectedContext?.(result.snapshot?.context.selection);
      this.dependentRefresher.acceptCurrentContextPreparation?.(result.snapshot?.context.selection);
      try {
        await this.dependentRefresher.refreshDependents(context);
      } catch (error) {
        if (context.generation === this.generation && !isSignalAborted(signal)) {
          context.report("tree-publication", "failed", { reasonCode: "refresh-failed" });
        }
        if (trigger === "review-contexts-refresh" && acceptedSnapshot?.context.kind === "branch") {
          if (context.generation === this.generation && !isSignalAborted(signal)) {
            await this.dependentRefresher.clearPullRequestProgress?.();
          }
          context.report("review-contexts-list", "failed", { reasonCode: "refresh-failed" });
          throw new CurrentContextBranchRefreshError();
        }
        throw error;
      }
      if (isSignalAborted(signal) || context.generation !== this.generation) {
        context.report("tree-publication", "superseded", { reasonCode: "superseded" });
        return;
      }
      context.report("tree-publication", "succeeded");
    } catch (error) {
      const superseded = signal?.aborted === true || context.generation !== this.generation;
      context.report("current-context", superseded ? "superseded" : "failed", {
        reasonCode: superseded ? "superseded" : "refresh-failed",
      });
      if (!superseded) throw error;
    }
  }

  /** Explicit Review Contexts refresh entry; it uses the same current-context and dependent refresh path. */
  public refreshFromReviewContexts(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<void> {
    return this.refresh(signal, feedbackContext, { allowInteraction: false }, "review-contexts-refresh");
  }

  public async selectContext(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<void> {
    const context = this.createRefreshContext("current-context-selection", feedbackContext);
    context.report("current-context", "started");
    const selection = await this.controller.selectContext(signal, feedbackContext);
    if (signal?.aborted === true || context.generation !== this.generation) {
      context.report("current-context", "superseded", { reasonCode: "superseded" });
      return;
    }
    if (selection === undefined) {
      context.report("current-context", "cancelled", { reasonCode: "identity-changed" });
      return;
    }
    context.setSelectionProvenance("explicit-selection-kept", undefined);
    this.dependentRefresher.setSelectedContext?.(selection.context.selection);
    this.dependentRefresher.acceptCurrentContextPreparation?.(selection.context.selection);
    await this.dependentRefresher.refreshDependents(context);
    context.report("tree-publication", "succeeded");
  }

  /** Clears Current Context and dependent PR state after an unprovable refresh. */
  public async failClosed(): Promise<void> {
    this.generation += 1;
    this.controller.failClosed();
    this.dependentRefresher.setSelectedContext?.(undefined);
    this.dependentRefresher.acceptCurrentContextPreparation?.(undefined);
    await this.dependentRefresher.clearPullRequestProgress?.();
  }

  public isPreservedBranchRefreshFailure(error: unknown): error is CurrentContextBranchRefreshError {
    return error instanceof CurrentContextBranchRefreshError;
  }

  /** Contains background refresh failures so activation and editor events cannot reject unobserved. */
  public async refreshWithErrorBoundary(
    report: (error: unknown) => void | Promise<void>
  ): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      await this.failClosed();
      await report(error);
    }
  }

  private createRefreshContext(
    trigger: PullRequestRefreshTrigger,
    feedbackContext?: OperationFeedbackContext,
  ): CurrentContextRefreshContext {
    const generation = ++this.generation;
    let selectionReason: PullRequestRefreshReasonCode | undefined;
    let candidateCount: number | undefined;
    const stageStartedAt = new Map<PullRequestRefreshStage, number>();
    return {
      generation,
      trigger,
      ...(feedbackContext === undefined ? {} : { feedbackContext }),
      selectionProvenance: () => ({
        ...(selectionReason === undefined ? {} : { reason: selectionReason }),
        ...(candidateCount === undefined ? {} : { candidateCount }),
      }),
      setSelectionProvenance: (reason, count) => {
        selectionReason = reason;
        candidateCount = count;
      },
      report: (stage, status, details = {}) => {
        if (generation !== this.generation && status !== "superseded" && status !== "cancelled") return;
        const now = Date.now();
        if (status === "started") stageStartedAt.set(stage, now);
        const startedAt = stageStartedAt.get(stage);
        reportActivePullRequestRefresh(feedbackContext, {
          generation,
          trigger,
          stage,
          status,
          ...(details.durationMs === undefined && startedAt !== undefined && status !== "started"
            ? { durationMs: Math.max(0, now - startedAt) }
            : {}),
          ...details,
        });
        if (status !== "started") stageStartedAt.delete(stage);
      },
    };
  }
}

const isSignalAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

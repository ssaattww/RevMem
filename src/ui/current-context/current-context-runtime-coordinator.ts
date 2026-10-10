import type { CurrentContextUiController } from "./current-context-ui-controller";
import type { SelectedReviewContext } from "../../application/review-context/index";
import {
  reportActivePullRequestRefresh,
  PullRequestRefreshAliasAllocator,
  type PullRequestRefreshAliases,
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

export interface CurrentContextRefreshRequestOptions {
  /** Opaque, in-memory identity used only to join duplicate requests. Never logged. */
  readonly coalescingKey?: string;
}

export interface CurrentContextRefreshContext {
  readonly generation: number;
  readonly trigger: PullRequestRefreshTrigger;
  readonly feedbackContext?: OperationFeedbackContext;
  readonly signal?: AbortSignal;
  /** True only while this refresh still owns the current context and has not been cancelled. */
  readonly isCurrent: () => boolean;
  readonly selectionProvenance: () => Readonly<{
    readonly reason?: PullRequestRefreshReasonCode;
    readonly candidateCount?: number;
  }>;
  setSelectionProvenance(reason: PullRequestRefreshReasonCode | undefined, candidateCount: number | undefined): void;
  setAcceptedSnapshot(snapshot: CurrentContextUiSnapshot | undefined): void;
  readonly acceptedIdentity: () => Readonly<{ contextId: string; baseSha?: string; headSha?: string }> | undefined;
  /** Bind only a registered immutable snapshot already checked against accepted selection. */
  acceptRegisteredSnapshot(snapshot: Readonly<{ contextId: string; baseSha: string; headSha: string; originalDiffId: string }>): void;
  disposeAliases(): void;
  setPublicationCounts(counts: NonNullable<PullRequestRefreshDiagnostic["counts"]>): void;
  readonly publicationCounts: () => NonNullable<PullRequestRefreshDiagnostic["counts"]>;
  /** Closes every started stage on a rejected or interrupted owner, once per stage. */
  finishPendingStages(
    status: "failed" | "cancelled" | "superseded",
    reasonCode: PullRequestRefreshReasonCode,
    supersededByGeneration?: number,
    causedByOperationId?: number,
  ): void;
  readonly report: (
    stage: PullRequestRefreshStage,
    status: PullRequestRefreshStatus,
    details?: Readonly<{
      readonly reasonCode?: PullRequestRefreshReasonCode;
      readonly durationMs?: number;
      readonly counts?: PullRequestRefreshDiagnostic["counts"];
      readonly relatedOperationId?: number;
      readonly relatedGeneration?: number;
      readonly supersededByGeneration?: number;
      readonly causedByOperationId?: number;
      readonly ordinal?: number;
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
  private refreshCancellation: AbortController | undefined;
  private currentRefreshContext: CurrentContextRefreshContext | undefined;
  private activeCoalescedRefresh: {
    readonly key: string;
    readonly context: CurrentContextRefreshContext;
    readonly promise: Promise<void>;
    inFlight: boolean;
  } | undefined;

  public constructor(
    private readonly controller: CurrentContextUiController,
    private readonly dependentRefresher: CurrentContextDependentRefresher
  ) {}

  public refresh(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    options?: CurrentContextRecomputeOptions,
    trigger: PullRequestRefreshTrigger = "current-context-refresh",
    request: CurrentContextRefreshRequestOptions = {},
  ): Promise<void> {
    const active = this.activeCoalescedRefresh;
    if (
      request.coalescingKey !== undefined &&
      active?.inFlight === true &&
      active.key === request.coalescingKey &&
      active.context.isCurrent()
    ) {
      reportActivePullRequestRefresh(feedbackContext, {
        generation: active.context.generation,
        trigger,
        stage: "refresh-request",
        status: "coalesced",
        reasonCode: "duplicate-trigger-coalesced",
        relatedOperationId: active.context.feedbackContext?.id,
        relatedGeneration: active.context.generation,
      });
      return active.promise;
    }
    const context = this.createRefreshContext(trigger, feedbackContext, signal);
    const promise = this.runRefresh(context, signal, feedbackContext, options);
    if (request.coalescingKey !== undefined) {
      const coalesced = { key: request.coalescingKey, context, promise, inFlight: true };
      this.activeCoalescedRefresh = coalesced;
      void promise.then(
        () => { coalesced.inFlight = false; },
        () => { coalesced.inFlight = false; },
      );
    } else {
      this.activeCoalescedRefresh = undefined;
    }
    return promise;
  }

  private async runRefresh(
    context: CurrentContextRefreshContext,
    signal: AbortSignal | undefined,
    feedbackContext: OperationFeedbackContext | undefined,
    options: CurrentContextRecomputeOptions | undefined,
  ): Promise<void> {
    context.report("current-context", "started");
    context.report("repository-identity", "started");
    context.report("pr-acquisition", "started");
    let acceptedSnapshot: CurrentContextUiSnapshot | undefined;
    try {
      const result = await this.controller.refresh(context.signal, feedbackContext, options);
      if (signal?.aborted === true || context.generation !== this.generation || result.stale) {
        context.report("current-context", "superseded", { reasonCode: "superseded" });
        context.report("repository-identity", "superseded", { reasonCode: "superseded" });
        context.report("pr-acquisition", "superseded", { reasonCode: "superseded" });
        return;
      }
      if (result.nonDestructive) {
        context.report("current-context", "cancelled", { reasonCode: "identity-changed" });
        context.report("repository-identity", "cancelled", { reasonCode: "identity-changed" });
        context.report("pr-acquisition", "cancelled", { reasonCode: "identity-changed" });
        return;
      }
      acceptedSnapshot = result.snapshot;
      this.reportAcquisitionOutcome(context, acceptedSnapshot);
      context.setAcceptedSnapshot(acceptedSnapshot);
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
      context.report("current-context", "succeeded", {
        ...(acceptedSnapshot?.context.selectionReason === undefined ? {} : { reasonCode: acceptedSnapshot.context.selectionReason }),
        counts: { pullRequestCandidates: acceptedSnapshot?.context.pullRequestCandidateCount ?? 0 },
      });
      context.report("tree-publication", "started");
      try {
        await this.dependentRefresher.refreshDependents(context);
      } catch (error) {
        if (context.generation === this.generation && !isSignalAborted(signal)) {
          context.report("tree-publication", "failed", { reasonCode: "refresh-failed", counts: context.publicationCounts() });
        }
        if (acceptedSnapshot?.context.kind === "branch") {
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
      context.report("tree-publication", "succeeded", { counts: context.publicationCounts() });
    } catch (error) {
      const superseded = signal?.aborted === true || context.generation !== this.generation;
      context.finishPendingStages(superseded ? (signal?.aborted ? "cancelled" : "superseded") : "failed",
        superseded ? "superseded" : "refresh-failed");
      if (!superseded) throw error;
    } finally {
      context.disposeAliases();
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
    const context = this.createRefreshContext("current-context-selection", feedbackContext, signal);
    context.report("current-context", "started");
    context.report("repository-identity", "started");
    context.report("pr-acquisition", "started");
    try {
      const selection = await this.controller.selectContext(context.signal, feedbackContext);
      if (signal?.aborted === true || context.generation !== this.generation) {
        context.report("current-context", "superseded", { reasonCode: "superseded" });
        context.report("repository-identity", "superseded", { reasonCode: "superseded" });
        context.report("pr-acquisition", "superseded", { reasonCode: "superseded" });
        return;
      }
      if (selection === undefined) {
        context.report("current-context", "cancelled", { reasonCode: "identity-changed" });
        context.report("repository-identity", "cancelled", { reasonCode: "no-selected-pr" });
        context.report("pr-acquisition", "cancelled", { reasonCode: "no-selected-pr" });
        return;
      }
      this.reportAcquisitionOutcome(context, selection);
      const descriptor = selection.context;
      context.setAcceptedSnapshot(selection);
      context.setSelectionProvenance(
        descriptor.selectionReason ?? "explicit-selection-kept",
        descriptor.pullRequestCandidateCount,
      );
      context.report("repository-identity", descriptor.selection === undefined ? "failed" : "succeeded", {
        ...(descriptor.selection === undefined ? { reasonCode: "identity-changed" } : {}),
        counts: {
          repositories: descriptor.selection?.kind === "workspace" ? 0 : 1,
          selectedContextOrdinal: descriptor.selection === undefined ? 0 : 1,
        },
      });
      context.report("current-context", "succeeded", {
        ...(descriptor.selectionReason === undefined ? {} : { reasonCode: descriptor.selectionReason }),
        counts: {
          ...(descriptor.pullRequestCandidateCount === undefined
            ? {}
            : { pullRequestCandidates: descriptor.pullRequestCandidateCount }),
        },
      });
      this.dependentRefresher.setSelectedContext?.(selection.context.selection);
      this.dependentRefresher.acceptCurrentContextPreparation?.(selection.context.selection);
      context.report("tree-publication", "started");
      await this.dependentRefresher.refreshDependents(context);
      if (!context.isCurrent()) {
        context.report("tree-publication", "superseded", { reasonCode: "superseded" });
        return;
      }
      context.report("tree-publication", "succeeded", { counts: context.publicationCounts() });
    } catch (error) {
      const superseded = signal?.aborted === true || context.generation !== this.generation;
      context.finishPendingStages(superseded ? (signal?.aborted ? "cancelled" : "superseded") : "failed",
        superseded ? "superseded" : "refresh-failed");
      if (!superseded) throw error;
    } finally {
      context.disposeAliases();
    }
  }

  /** Clears Current Context and dependent PR state after an unprovable refresh. */
  public async failClosed(): Promise<void> {
    this.refreshCancellation?.abort();
    this.currentRefreshContext?.finishPendingStages("cancelled", "identity-changed");
    this.currentRefreshContext = undefined;
    this.activeCoalescedRefresh = undefined;
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
      if (!this.isPreservedBranchRefreshFailure(error)) await this.failClosed();
      await report(error);
    }
  }

  private reportAcquisitionOutcome(context: CurrentContextRefreshContext, snapshot: CurrentContextUiSnapshot | undefined): void {
    const preservedBranch = snapshot?.context.pullRequestAcquisition === "failed-branch-preserved";
    context.report("pr-acquisition", preservedBranch ? "failed" : "succeeded", {
      ...(preservedBranch ? { reasonCode: "verified-branch-preserved" } : {}),
    });
  }

  private createRefreshContext(
    trigger: PullRequestRefreshTrigger,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): CurrentContextRefreshContext {
    const replaced = this.currentRefreshContext;
    this.refreshCancellation?.abort();
    const cancellation = new AbortController();
    this.refreshCancellation = cancellation;
    const abort = (): void => cancellation.abort();
    signal?.addEventListener("abort", abort, { once: true });
    cancellation.signal.addEventListener("abort", () => signal?.removeEventListener("abort", abort), { once: true });
    if (signal?.aborted) abort();
    const generation = ++this.generation;
    replaced?.finishPendingStages(
      "superseded",
      "superseded-by-newer-generation",
      generation,
      feedbackContext?.id,
    );
    let selectionReason: PullRequestRefreshReasonCode | undefined;
    let candidateCount: number | undefined;
    let acceptedIdentity: Readonly<{ contextId: string; baseSha?: string; headSha?: string }> | undefined;
    let publicationCounts: NonNullable<PullRequestRefreshDiagnostic["counts"]> = {};
    const allocator = new PullRequestRefreshAliasAllocator(generation, feedbackContext);
    let aliases: PullRequestRefreshAliases = {};
    let acceptedSelection: SelectedReviewContext | undefined;
    const disposeAliases = (): void => {
      allocator.dispose();
      aliases = {};
      acceptedSelection = undefined;
    };
    cancellation.signal.addEventListener("abort", disposeAliases, { once: true });
    feedbackContext?.owner.onOperationFinished(feedbackContext, disposeAliases);
    const stageStartedAt = new Map<PullRequestRefreshStage, number>();
    const completedStages = new Set<PullRequestRefreshStage>();
    const context: CurrentContextRefreshContext = {
      generation,
      trigger,
      isCurrent: () => generation === this.generation && !cancellation.signal.aborted,
      ...(feedbackContext === undefined ? {} : { feedbackContext }),
      signal: cancellation.signal,
      selectionProvenance: () => ({
        ...(selectionReason === undefined ? {} : { reason: selectionReason }),
        ...(candidateCount === undefined ? {} : { candidateCount }),
      }),
      setSelectionProvenance: (reason, count) => {
        selectionReason = reason;
        candidateCount = count;
      },
      setAcceptedSnapshot: (snapshot) => {
        if (!context.isCurrent()) return;
        const descriptor = snapshot?.context;
        const selection = descriptor?.selection;
        acceptedSelection = selection;
        aliases = {};
        if (feedbackContext !== undefined && selection !== undefined && selection.kind !== "workspace") {
          const repositoryKey = [selection.repositoryId, selection.repositoryRoot];
          const branchRef = selection.kind === "branch" ? selection.branchRef : descriptor?.verifiedBranchRef;
          aliases = {
            repository: allocator.allocate("repo", repositoryKey),
            ...(branchRef === undefined ? {} : { branch: allocator.allocate("branch", [...repositoryKey, branchRef]) }),
            ...(selection.kind !== "pull-request" ? {} : { pullRequest: allocator.allocate("pr", [...repositoryKey, selection.pullRequestNumber]) }),
            context: allocator.allocate("context", [...repositoryKey, selection.kind,
              selection.kind === "pull-request" ? selection.contextId : selection.kind === "branch" ? selection.branchRef : selection.headRevision]),
          };
        }
        acceptedIdentity = selection?.kind !== "pull-request" ? undefined : {
          contextId: selection.contextId,
          ...(descriptor?.baseRevision === undefined ? {} : { baseSha: descriptor.baseRevision }),
          ...(descriptor?.headRevision === undefined ? {} : { headSha: descriptor.headRevision }),
        };
      },
      acceptedIdentity: () => acceptedIdentity,
      acceptRegisteredSnapshot: (snapshot) => {
        if (feedbackContext === undefined || !context.isCurrent() || acceptedSelection?.kind !== "pull-request" ||
          snapshot.contextId !== acceptedSelection.contextId || snapshot.headSha !== acceptedSelection.headRevision ||
          (acceptedIdentity?.baseSha !== undefined && snapshot.baseSha !== acceptedIdentity.baseSha) ||
          (acceptedIdentity?.headSha !== undefined && snapshot.headSha !== acceptedIdentity.headSha)) return;
        aliases = { ...aliases, snapshot: allocator.allocate("snapshot", [acceptedSelection.repositoryId,
          acceptedSelection.repositoryRoot, snapshot.contextId, snapshot.baseSha, snapshot.headSha, snapshot.originalDiffId]) };
      },
      disposeAliases,
      setPublicationCounts: (counts) => { publicationCounts = { ...counts }; },
      publicationCounts: () => ({ ...publicationCounts }),
      finishPendingStages: (status, reasonCode, supersededByGeneration, causedByOperationId) => {
        for (const stage of [...stageStartedAt.keys()]) {
          context.report(stage, status, {
            reasonCode,
            ...(supersededByGeneration === undefined ? {} : { supersededByGeneration }),
            ...(causedByOperationId === undefined ? {} : { causedByOperationId }),
            ...(stage === "tree-publication" ? { counts: context.publicationCounts() } : {}),
          });
        }
        disposeAliases();
      },
      report: (stage, status, details = {}) => {
        if (completedStages.has(stage)) return;
        if (generation !== this.generation && status !== "superseded" && status !== "cancelled") return;
        const now = Date.now();
        if (status === "started") {
          if (stageStartedAt.has(stage)) return;
          stageStartedAt.set(stage, now);
        }
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
          ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
        });
        if (status !== "started" && status !== "progress") {
          stageStartedAt.delete(stage);
          completedStages.add(stage);
        }
      },
    };
    this.currentRefreshContext = context;
    return context;
  }
}

const isSignalAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

import { CurrentContextCandidateSelection } from "./current-context-candidate-selection";
import {
  OperationCancelledError,
  type OperationFeedbackContext,
} from "../../application/operation-feedback/index";
import {
  currentContextSelectionKey,
  type CurrentContextUiSnapshot
} from "./current-context-ui-controller";

/** A user cancellation or a post-picker identity mismatch must not clear accepted UI state. */
export interface CurrentContextNonDestructiveOutcome {
  readonly kind: "cancelled" | "stale" | "unresolved";
}

export type CurrentContextResolution = CurrentContextUiSnapshot | CurrentContextNonDestructiveOutcome | undefined;

/** Preserves a verified local branch when only optional T405 PR enrichment fails. */
export const augmentCurrentContextCandidatesWithBranchFallback = async (
  localCandidates: readonly CurrentContextUiSnapshot[],
  augment: () => Promise<readonly CurrentContextUiSnapshot[]>,
  signal?: AbortSignal,
): Promise<readonly CurrentContextUiSnapshot[]> => {
  try {
    return await augment();
  } catch (error) {
    if (signal?.aborted === true || !localCandidates.some((candidate) => candidate.context.kind === "branch")) {
      throw error;
    }
    return localCandidates.map((candidate) => candidate.context.kind === "branch" ? {
      ...candidate, context: { ...candidate.context, pullRequestAcquisition: "failed-branch-preserved" as const },
    } : candidate);
  }
};

/** Controls whether a recompute was explicitly requested by the user. */
export interface CurrentContextRecomputeOptions {
  readonly allowInteraction?: boolean;
}

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const isNonDestructiveOutcome = (value: CurrentContextResolution): value is CurrentContextNonDestructiveOutcome =>
  value !== undefined && "kind" in value &&
  (value.kind === "cancelled" || value.kind === "stale" || value.kind === "unresolved");

/** Ports supplied by the T305 composition root without coupling this state machine to VS Code. */
export interface CurrentContextRuntimeCompositionPort {
  /** Prepares interactive PR candidates only for the user-explicit selection command. */
  prepareExplicitSelection?(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<void>;
  enumerateCandidates(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<readonly CurrentContextUiSnapshot[]>;
  resolveFallback(
    candidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
  ): Promise<CurrentContextUiSnapshot | CurrentContextNonDestructiveOutcome | undefined>;
  requestSelection(
    candidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
  ): Promise<CurrentContextUiSnapshot | undefined>;
}

/**
 * The production composition seam for Current Context candidate selection.
 * It keeps Quick Pick requests pure until the UI controller accepts their generation.
 */
export class CurrentContextRuntimeComposition {
  public constructor(
    private readonly selection: CurrentContextCandidateSelection,
    private readonly port: CurrentContextRuntimeCompositionPort
  ) {}

  public async recompute(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    options?: CurrentContextRecomputeOptions
  ): Promise<CurrentContextResolution> {
    const candidates = await this.port.enumerateCandidates(signal, feedbackContext);
    if (isAborted(signal)) throw new OperationCancelledError();
    if (candidates.length === 0) {
      return undefined;
    }
    const fallback = await this.port.resolveFallback(candidates, signal);
    if (isAborted(signal)) throw new OperationCancelledError();
    if (isNonDestructiveOutcome(fallback)) return fallback;
    if (fallback === undefined && candidates.length > 1) {
      if (options?.allowInteraction === false) return { kind: "unresolved" };
      const selected = await this.selection.select(
        candidates,
        (available) => this.port.requestSelection(available, signal)
      );
      if (selected === undefined) return { kind: "cancelled" };
      return this.revalidateSelection(selected, signal, feedbackContext);
    }
    return this.selection.resolve(candidates, fallback);
  }

  public async selectContext(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextResolution> {
    await this.port.prepareExplicitSelection?.(signal, feedbackContext);
    if (isAborted(signal)) throw new OperationCancelledError();
    const candidates = await this.port.enumerateCandidates(signal, feedbackContext);
    if (isAborted(signal)) throw new OperationCancelledError();
    const selected = await this.selection.select(
      candidates,
      (available) => this.port.requestSelection(available, signal)
    );
    if (isAborted(signal)) {
      throw new OperationCancelledError();
    }
    if (selected === undefined) return { kind: "cancelled" };
    return this.revalidateSelection(selected, signal, feedbackContext);
  }

  private async revalidateSelection(
    selected: CurrentContextUiSnapshot,
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext
  ): Promise<CurrentContextResolution> {
    const currentCandidates = await this.port.enumerateCandidates(signal, feedbackContext);
    if (isAborted(signal)) throw new OperationCancelledError();
    return currentCandidates.find((candidate) =>
      currentContextSelectionKey(candidate) === currentContextSelectionKey(selected)
    ) ?? { kind: "stale" };
  }

  public acceptRecomputed(snapshot: CurrentContextUiSnapshot | undefined): void {
    this.selection.acceptRecomputed(snapshot);
  }

  public acceptExplicit(snapshot: CurrentContextUiSnapshot): void {
    this.selection.acceptExplicit(snapshot);
  }
}

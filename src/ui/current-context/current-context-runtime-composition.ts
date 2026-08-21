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
  readonly kind: "cancelled" | "stale";
}

export type CurrentContextResolution = CurrentContextUiSnapshot | CurrentContextNonDestructiveOutcome | undefined;

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/** Ports supplied by the T305 composition root without coupling this state machine to VS Code. */
export interface CurrentContextRuntimeCompositionPort {
  enumerateCandidates(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<readonly CurrentContextUiSnapshot[]>;
  resolveFallback(
    candidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
  ): Promise<CurrentContextUiSnapshot | undefined>;
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

  public async recompute(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextResolution> {
    const candidates = await this.port.enumerateCandidates(signal, feedbackContext);
    if (isAborted(signal)) throw new OperationCancelledError();
    if (candidates.length === 0) {
      return undefined;
    }
    const fallback = await this.port.resolveFallback(candidates, signal);
    if (isAborted(signal)) throw new OperationCancelledError();
    if (fallback === undefined && candidates.length > 1) {
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

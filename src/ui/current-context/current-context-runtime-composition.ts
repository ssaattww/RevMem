import { CurrentContextCandidateSelection } from "./current-context-candidate-selection";
import {
  currentContextSelectionKey,
  type CurrentContextUiSnapshot
} from "./current-context-ui-controller";

/** Ports supplied by the T305 composition root without coupling this state machine to VS Code. */
export interface CurrentContextRuntimeCompositionPort {
  enumerateCandidates(): Promise<readonly CurrentContextUiSnapshot[]>;
  resolveFallback(
    candidates: readonly CurrentContextUiSnapshot[]
  ): Promise<CurrentContextUiSnapshot | undefined>;
  requestSelection(
    candidates: readonly CurrentContextUiSnapshot[]
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

  public async recompute(): Promise<CurrentContextUiSnapshot | undefined> {
    const candidates = await this.port.enumerateCandidates();
    if (candidates.length === 0) {
      return undefined;
    }
    const fallback = await this.port.resolveFallback(candidates);
    return this.selection.resolve(candidates, fallback);
  }

  public async selectContext(): Promise<CurrentContextUiSnapshot | undefined> {
    const candidates = await this.port.enumerateCandidates();
    const selected = await this.selection.select(
      candidates,
      (available) => this.port.requestSelection(available)
    );
    if (selected === undefined) {
      return undefined;
    }
    const currentCandidates = await this.port.enumerateCandidates();
    return currentCandidates.find((candidate) =>
      currentContextSelectionKey(candidate) === currentContextSelectionKey(selected)
    );
  }

  public acceptRecomputed(snapshot: CurrentContextUiSnapshot | undefined): void {
    this.selection.acceptRecomputed(snapshot);
  }

  public acceptExplicit(snapshot: CurrentContextUiSnapshot): void {
    this.selection.acceptExplicit(snapshot);
  }
}

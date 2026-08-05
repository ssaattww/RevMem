import {
  currentContextSelectionKey,
  type CurrentContextUiSnapshot
} from "./current-context-ui-controller";

/** Maintains an explicit selection only while its identity remains a current candidate. */
export class CurrentContextCandidateSelection {
  private selectedKey: string | undefined;

  /** Applies a completed Quick Pick choice as the explicit Current Context selection. */
  public async select(
    candidates: readonly CurrentContextUiSnapshot[],
    requestSelection: (
      candidates: readonly CurrentContextUiSnapshot[]
    ) => Promise<CurrentContextUiSnapshot | undefined>
  ): Promise<CurrentContextUiSnapshot | undefined> {
    const selected = await requestSelection(candidates);
    if (selected !== undefined) {
      this.selectedKey = currentContextSelectionKey(selected);
    }
    return selected;
  }

  /**
   * Returns the still-present explicit selection, otherwise computes an
   * uncommitted fallback. The controller commits a disappeared selection only
   * after it accepts the corresponding snapshot.
   */
  public resolve(
    candidates: readonly CurrentContextUiSnapshot[],
    fallback: CurrentContextUiSnapshot | undefined
  ): CurrentContextUiSnapshot | undefined {
    if (this.selectedKey !== undefined) {
      const selected = candidates.find((candidate) =>
        currentContextSelectionKey(candidate) === this.selectedKey
      );
      if (selected !== undefined) {
        return selected;
      }
    }
    return fallback ?? candidates[0];
  }

  /** Commits that an accepted recomputation no longer represents the explicit selection. */
  public acceptRecomputed(snapshot: CurrentContextUiSnapshot | undefined): void {
    if (snapshot === undefined || this.selectedKey === undefined) {
      return;
    }
    if (currentContextSelectionKey(snapshot) !== this.selectedKey) {
      this.selectedKey = undefined;
    }
  }

  /** Commits an accepted explicit Quick Pick selection. */
  public acceptExplicit(snapshot: CurrentContextUiSnapshot): void {
    this.selectedKey = currentContextSelectionKey(snapshot);
  }
}

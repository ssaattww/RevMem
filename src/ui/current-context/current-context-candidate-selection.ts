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
   * Returns the still-present explicit selection, otherwise clears its stale
   * identity before accepting the active-editor or first-candidate fallback.
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
      this.selectedKey = undefined;
    }
    return fallback ?? candidates[0];
  }
}

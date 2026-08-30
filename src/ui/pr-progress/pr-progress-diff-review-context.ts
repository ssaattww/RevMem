/** Context key used to expose whole-file review commands only for PR Progress diff tabs. */
export const PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY = "reviewRange.prProgressDiffReviewActions";

/** Minimal editor-tab boundary used to keep PR Progress provenance out of unrelated diffs. */
export interface PrProgressDiffReviewContextHost<Tab extends object> {
  /** Returns the tab that currently owns editor focus. */
  getActiveTab(): Tab | undefined;
  /** Returns whether the supplied tab is a text diff tab. */
  isDiffTab(tab: Tab): boolean;
  /** Updates one VS Code-compatible context key. */
  setContext(key: string, value: boolean): void | PromiseLike<unknown>;
}

/**
 * Tracks exact diff-tab instances opened from PR Progress and projects that provenance
 * into a context key used by editor/context menu contributions.
 *
 * Object identity is intentional: a separately opened diff for the same resources must
 * not inherit PR Progress-only review actions.
 */
export class PrProgressDiffReviewContextController<Tab extends object> {
  private readonly ownedTabs = new WeakSet<Tab>();
  private lastContextValue: boolean | undefined;

  public constructor(private readonly host: PrProgressDiffReviewContextHost<Tab>) {}

  /** Records the currently active diff tab as having been opened by PR Progress. */
  public async recordActiveDiff(): Promise<boolean> {
    const tab = this.host.getActiveTab();
    if (tab === undefined || !this.host.isDiffTab(tab)) {
      await this.refresh();
      return false;
    }

    this.ownedTabs.add(tab);
    await this.refresh();
    return true;
  }

  /** Synchronizes the context key with the active tab's exact recorded provenance. */
  public async refresh(): Promise<void> {
    const tab = this.host.getActiveTab();
    const enabled = tab !== undefined
      && this.host.isDiffTab(tab)
      && this.ownedTabs.has(tab);
    if (enabled === this.lastContextValue) return;

    this.lastContextValue = enabled;
    await this.host.setContext(PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY, enabled);
  }

  /** Clears the projected context during extension teardown. */
  public async clear(): Promise<void> {
    if (this.lastContextValue === false) return;
    this.lastContextValue = false;
    await this.host.setContext(PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY, false);
  }
}

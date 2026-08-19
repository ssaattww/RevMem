export interface SelectedPullRequestProgressRefreshDependencies<Source> {
  readonly contextId: string | undefined;
  readonly source: Source;
  readonly activateProgress: (contextId: string) => Promise<void>;
  readonly clearProgress: () => void;
  readonly setSource: (source: Source | undefined) => void;
  readonly refreshTree: () => void;
}

export interface CurrentContextDependentRefreshDependencies {
  readonly refreshPullRequestProgress: () => Promise<void>;
  readonly refreshDecorations: () => Promise<void>;
  readonly refreshGlobal: () => Promise<void>;
  readonly refreshReviewContexts: () => Promise<void>;
  readonly reportPullRequestProgressError: (error: unknown) => void | Promise<void>;
}

export interface DocumentEditDependentRefreshDependencies {
  readonly refreshPullRequestProgress: () => Promise<void>;
  readonly refreshDecorations: () => Promise<void>;
  readonly refreshGlobal: () => Promise<void>;
  readonly reportPullRequestProgressError: (error: unknown) => void | Promise<void>;
}

interface SettledProjectionRefresh {
  readonly error?: unknown;
}

const settleProjectionRefresh = async (
  operation: () => Promise<void>
): Promise<SettledProjectionRefresh> => {
  try {
    await operation();
    return {};
  } catch (error) {
    return { error };
  }
};

/**
 * Switches the contributed PR Progress tree only after the target runtime has
 * synchronously invalidated its previous snapshot. The final refresh happens
 * after the selected PR calculation settles so stale content is never redrawn
 * under a new source identity.
 */
export const refreshSelectedPullRequestProgress = async <Source>(
  dependencies: SelectedPullRequestProgressRefreshDependencies<Source>
): Promise<void> => {
  if (dependencies.contextId === undefined) {
    dependencies.clearProgress();
    dependencies.setSource(undefined);
    dependencies.refreshTree();
    return;
  }

  const activation = dependencies.activateProgress(dependencies.contextId);
  dependencies.setSource(dependencies.source);
  dependencies.refreshTree();
  try {
    await activation;
  } finally {
    dependencies.refreshTree();
  }
};

/**
 * Refreshes owner-bound projections after Current Context changes. PR Progress
 * is fail-closed and independently reported; it must not prevent decorations,
 * Global Understanding, or Review Contexts from adopting the new owner.
 */
export const refreshCurrentContextDependents = async (
  dependencies: CurrentContextDependentRefreshDependencies
): Promise<void> => {
  const progress = settleProjectionRefresh(
    dependencies.refreshPullRequestProgress
  );
  await dependencies.refreshDecorations();
  await dependencies.refreshGlobal();
  await dependencies.refreshReviewContexts();
  const outcome = await progress;
  if (outcome.error !== undefined) {
    await dependencies.reportPullRequestProgressError(outcome.error);
  }
};

/**
 * Keeps a successful document-state mutation successful when only the derived
 * PR Progress projection fails. The projection failure is reported separately
 * after decorations and Global Understanding have been refreshed.
 */
export const refreshAfterDocumentEdit = async (
  dependencies: DocumentEditDependentRefreshDependencies
): Promise<void> => {
  const progress = settleProjectionRefresh(
    dependencies.refreshPullRequestProgress
  );
  await dependencies.refreshDecorations();
  await dependencies.refreshGlobal();
  const outcome = await progress;
  if (outcome.error !== undefined) {
    await dependencies.reportPullRequestProgressError(outcome.error);
  }
};
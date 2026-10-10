import type { OperationFeedbackContext } from "../operation-feedback/index";

export interface SelectedPullRequestProgressRefreshDependencies<Source> {
  readonly shouldContinue?: () => boolean;
  readonly contextId: string | undefined;
  readonly source: Source;
  readonly feedbackContext?: OperationFeedbackContext;
  readonly activateProgress: (contextId: string, feedbackContext?: OperationFeedbackContext) => Promise<void>;
  readonly clearProgress: () => void;
  readonly setSource: (source: Source | undefined) => void;
  readonly refreshTree: () => void;
}

export interface CurrentContextDependentRefreshDependencies {
  /** Stops stale owner work after an awaited Review Contexts acquisition. */
  readonly shouldContinue?: () => boolean;
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
  if (dependencies.shouldContinue?.() === false) return;
  if (dependencies.contextId === undefined) {
    dependencies.clearProgress();
    dependencies.setSource(undefined);
    dependencies.refreshTree();
    return;
  }

  const activation = dependencies.activateProgress(dependencies.contextId, dependencies.feedbackContext);
  dependencies.setSource(dependencies.source);
  dependencies.refreshTree();
  try {
    await activation;
  } finally {
    if (dependencies.shouldContinue?.() !== false) dependencies.refreshTree();
  }
};

/**
 * Refreshes owner-bound projections after Current Context changes. Review
 * Contexts must settle first because it acquires and registers the selected PR
 * diff runtime consumed by PR Progress. If that prerequisite fails, PR Progress
 * is skipped rather than calculating against a missing or stale runtime.
 * Decorations and Global retain their independent failure isolation.
 */
export const refreshCurrentContextDependents = async (
  dependencies: CurrentContextDependentRefreshDependencies
): Promise<void> => {
  let dependentError: unknown;
  let reviewContextsReady = true;
  try {
    await dependencies.refreshReviewContexts();
  } catch (error) {
    dependentError = error;
    reviewContextsReady = false;
  }

  // A Review Contexts provider may suppress an obsolete list publication and
  // resolve successfully. Do not let that stale continuation activate PR
  // Progress or publish any dependent tree for the newer selected context.
  if (dependencies.shouldContinue?.() === false) return;

  const progress = reviewContextsReady
    ? settleProjectionRefresh(dependencies.refreshPullRequestProgress)
    : undefined;
  for (const refresh of [
    dependencies.refreshDecorations,
    dependencies.refreshGlobal,
  ]) {
    if (dependencies.shouldContinue?.() === false) break;
    try {
      await refresh();
    } catch (error) {
      dependentError ??= error;
    }
  }
  if (progress !== undefined) {
    const outcome = await progress;
    if (dependencies.shouldContinue?.() === false) return;
    if (outcome.error !== undefined) {
      await dependencies.reportPullRequestProgressError(outcome.error);
    }
  }
  if (dependentError !== undefined) throw dependentError;
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

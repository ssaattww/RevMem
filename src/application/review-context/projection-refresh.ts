import { classifyOperationFailure, reportActiveOperationFailure, type OperationFeedbackContext } from "../operation-feedback/index";

export const reportDocumentEditFailure = async (
  label: string,
  error: unknown,
  notify: () => void | Promise<void>,
): Promise<void> => {
  if (classifyOperationFailure(error).kind === "stale") return;
  reportActiveOperationFailure(label, error);
  try {
    await notify();
  } catch (notificationError) {
    reportActiveOperationFailure(`${label} notification`, notificationError);
  }
};

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
  let primaryFailure: unknown;
  let activation: Promise<void> | undefined;
  let activationSettled = false;
  try {
    if (dependencies.shouldContinue?.() === false) return;
    if (dependencies.contextId === undefined) {
      dependencies.clearProgress();
      dependencies.setSource(undefined);
      dependencies.refreshTree();
      return;
    }

    activation = dependencies.activateProgress(dependencies.contextId, dependencies.feedbackContext);
    dependencies.setSource(dependencies.source);
    dependencies.refreshTree();
    try { await activation; }
    finally { activationSettled = true; }
  } catch (error) {
    let failure = error;
    if (activation !== undefined && !activationSettled) {
      const activationOutcome = await settleProjectionRefresh(() => activation!);
      if (activationOutcome.error !== undefined && activationOutcome.error !== error) {
        failure = new AggregateError([error, activationOutcome.error], "PR Progress setup and activation failed.");
      }
    }
    primaryFailure = failure;
    dependencies.feedbackContext?.owner.reportFailure("PR Progress projection", failure, dependencies.feedbackContext);
  } finally {
    if (dependencies.contextId !== undefined && dependencies.shouldContinue?.() !== false) {
      try {
        dependencies.refreshTree();
      } catch (treeError) {
        const failure = primaryFailure === undefined
          ? treeError
          : new AggregateError([primaryFailure, treeError], "PR Progress activation and final tree publication failed.");
        primaryFailure = failure;
        dependencies.feedbackContext?.owner.reportFailure("PR Progress tree publication", failure, dependencies.feedbackContext);
      }
    }
  }
  if (primaryFailure !== undefined) throw primaryFailure;
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
  const dependentErrors: unknown[] = [];
  let reviewContextsReady = true;
  try {
    await dependencies.refreshReviewContexts();
  } catch (error) {
    dependentErrors.push(error);
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
      dependentErrors.push(error);
    }
  }
  if (progress !== undefined) {
    const outcome = await progress;
    if (dependencies.shouldContinue?.() === false) return;
    if (outcome.error !== undefined) {
      try {
        await dependencies.reportPullRequestProgressError(outcome.error);
      } catch (reportError) {
        dependentErrors.push(new AggregateError([outcome.error, reportError], "PR Progress calculation and error reporting failed."));
      }
    }
  }
  if (dependentErrors.length === 1) throw dependentErrors[0];
  if (dependentErrors.length > 1) throw new AggregateError(dependentErrors, "Multiple Current Context dependent refreshes failed.");
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
  const decorations = await settleProjectionRefresh(dependencies.refreshDecorations);
  const global = await settleProjectionRefresh(dependencies.refreshGlobal);
  const outcome = await progress;
  const failures: unknown[] = [];
  if (decorations.error !== undefined) failures.push(decorations.error);
  if (global.error !== undefined) failures.push(global.error);
  if (outcome.error !== undefined) {
    try {
      await dependencies.reportPullRequestProgressError(outcome.error);
    } catch (error) {
      failures.push(new AggregateError(
        [outcome.error, error],
        "PR Progress calculation and error reporting failed.",
      ));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Multiple document edit projection refreshes failed.");
  }
};

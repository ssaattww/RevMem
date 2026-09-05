import type { DiffEditorReviewCommandResult } from "./application/review-commands/diff-editor-review-command-service";

/** Completes every PR review projection refresh before an applied command returns. */
export const synchronizeAppliedPullRequestReview = async (
  result: DiffEditorReviewCommandResult,
  refreshProgress: () => void | Promise<void>,
  refreshOwnedProjection: () => void | Promise<void>,
  reportProjectionError: (error: unknown) => void | Promise<void> = () => undefined
): Promise<DiffEditorReviewCommandResult> => {
  if (result !== "applied") return result;
  for (const refresh of [refreshProgress, refreshOwnedProjection]) {
    try {
      await refresh();
    } catch (error) {
      await Promise.resolve(reportProjectionError(error)).catch(() => undefined);
    }
  }
  return result;
};

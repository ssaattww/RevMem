import type { DiffEditorReviewCommandResult } from "./application/review-commands/diff-editor-review-command-service";

/** Completes every PR review projection refresh before an applied command returns. */
export const synchronizeAppliedPullRequestReview = async (
  result: DiffEditorReviewCommandResult,
  refreshProgress: () => void | Promise<void>,
  refreshOwnedProjection: () => void | Promise<void>
): Promise<DiffEditorReviewCommandResult> => {
  if (result !== "applied") return result;
  await refreshProgress();
  await refreshOwnedProjection();
  return result;
};

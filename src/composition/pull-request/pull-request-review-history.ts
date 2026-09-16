import type { ReviewHistoryRecorder } from "../../application/review-history/index";
import type { ReviewStateTransaction } from "../../core/review-state/index";

const reasonFor = (transaction: Readonly<ReviewStateTransaction>): string => {
  if (
    transaction.operation === "mark-diff-block-reviewed" ||
    transaction.operation === "unmark-diff-block-reviewed"
  ) return "user-block-selection";
  if (
    transaction.operation === "mark-ranges-reviewed" ||
    transaction.operation === "unmark-ranges-reviewed"
  ) return "user-selection";
  return "user-file";
};

/** Records one PR review transaction while preserving its user-visible operation unit in history. */
export const recordPullRequestReviewHistory = (
  recorder: Pick<ReviewHistoryRecorder, "recordTransaction">,
  transaction: Readonly<ReviewStateTransaction>,
): Promise<void> => recorder.recordTransaction(transaction, reasonFor(transaction));

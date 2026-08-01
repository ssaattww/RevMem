/** Public Review State Service operations and atomic transaction contracts. */
export {
  commitReviewStateTransaction,
  markFileReviewed,
  markOriginalReviewedRanges,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkOriginalReviewedRanges,
  unmarkReviewedRanges,
  type DeepReadonly,
  type OriginalReviewRangeMutationInput,
  type ReviewRangeMutationInput,
  type ReviewStateFileTarget,
  type ReviewStateMutationInput,
  type ReviewStateOperation,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter,
  type ReviewStateTransactionExpectation,
  type ReviewStateTransactionNext
} from "./review-state-service";

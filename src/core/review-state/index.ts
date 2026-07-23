/** Public Review State Service operations and atomic transaction contracts. */
export {
  commitReviewStateTransaction,
  markFileReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkReviewedRanges,
  type DeepReadonly,
  type ReviewRangeMutationInput,
  type ReviewStateFileTarget,
  type ReviewStateMutationInput,
  type ReviewStateOperation,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter,
  type ReviewStateTransactionExpectation,
  type ReviewStateTransactionNext
} from "./review-state-service";

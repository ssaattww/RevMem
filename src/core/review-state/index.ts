/** Public Review State Service operations and atomic transaction contracts. */
export {
  commitReviewStateTransaction,
  markFileReviewed,
  markOriginalReviewedRanges,
  markOriginalSelectionReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkOriginalReviewedRanges,
  unmarkOriginalSelectionReviewed,
  unmarkReviewedRanges,
  type DeepReadonly,
  type OriginalReviewRangeMutationInput,
  type OriginalSelectionReviewRangeMutationInput,
  type OriginalReviewStateOperation,
  type OriginalReviewStateTransaction,
  type ModifiedReviewStateOperation,
  type ModifiedReviewStateTransaction,
  type ReviewRangeMutationInput,
  type ReviewStateFileTarget,
  type ReviewStateMutationInput,
  type ReviewStateOperation,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter,
  type ReviewStateTransactionExpectation,
  type ReviewStateTransactionNext
} from "./review-state-service";

/** Immutable revision snapshot capture, validation, and independent restore contracts. */
export {
  captureImmutableRevisionSnapshots,
  restoreImmutableRevisionSnapshots,
  validateContextRevisionSnapshots,
  validateGlobalRevisionSnapshots,
  validateImmutableRevisionSnapshots,
  type CaptureImmutableRevisionSnapshotsInput,
  type ImmutableRevisionSnapshotEvidence,
  type ImmutableRevisionSnapshotFileEvidence,
  type ImmutableRevisionSnapshotLayerResult,
  type ImmutableRevisionSnapshotRestoreResult,
  type RestoreImmutableRevisionSnapshotsInput,
  type ValidateImmutableRevisionSnapshotsInput
} from "./revision-snapshot-service";

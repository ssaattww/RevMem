import type { RepositoryGlobalState } from "../contracts/index";
import {
  commitReviewStateTransaction,
  markFileReviewed as markFileReviewedBase,
  markOriginalReviewedRanges as markOriginalReviewedRangesBase,
  markOriginalSelectionReviewed as markOriginalSelectionReviewedBase,
  markReviewedRanges as markReviewedRangesBase,
  unmarkFileReviewed as unmarkFileReviewedBase,
  unmarkOriginalReviewedRanges as unmarkOriginalReviewedRangesBase,
  unmarkOriginalSelectionReviewed as unmarkOriginalSelectionReviewedBase,
  unmarkReviewedRanges as unmarkReviewedRangesBase,
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
  type ReviewStateTransactionNext,
} from "./review-state-service";

export {
  commitReviewStateTransaction,
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
  type ReviewStateTransactionNext,
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type SupportedInput = ReviewStateMutationInput | ReviewRangeMutationInput |
  OriginalReviewRangeMutationInput | OriginalSelectionReviewRangeMutationInput;

const projectPullRequestGlobal = <T extends SupportedInput>(input: T): T => {
  if (input.globalState.currentRevisionId === input.target.revisionId) return input;
  if (input.contextState.kind !== "pull-request") return input;
  const snapshot = input.globalState.revisionSnapshots?.[input.target.revisionId];
  return {
    ...input,
    globalState: {
      ...clone(input.globalState),
      currentRevisionId: input.target.revisionId,
      files: snapshot === undefined ? {} : clone(snapshot.files),
      updatedAt: snapshot?.updatedAt ?? input.globalState.updatedAt,
    },
  } as T;
};

const rebasePullRequestGlobal = <T extends ReviewStateTransaction>(
  input: SupportedInput,
  transaction: T,
): T => {
  if (input.globalState.currentRevisionId === input.target.revisionId || input.contextState.kind !== "pull-request") {
    return transaction;
  }
  const mappedGlobal = transaction.next.globalState;
  const nextGlobal: RepositoryGlobalState = {
    ...(clone(input.globalState) as unknown as RepositoryGlobalState),
    revisionSnapshots: {
      ...(clone(input.globalState.revisionSnapshots ?? {}) as unknown as NonNullable<RepositoryGlobalState["revisionSnapshots"]>),
      [input.target.revisionId]: {
        schemaVersion: mappedGlobal.schemaVersion,
        revisionId: input.target.revisionId,
        files: clone(mappedGlobal.files) as unknown as RepositoryGlobalState["files"],
        updatedAt: mappedGlobal.updatedAt,
      },
    },
  };
  return {
    ...transaction,
    expected: {
      contextState: transaction.expected.contextState,
      globalState: clone(input.globalState),
    },
    next: {
      contextState: transaction.next.contextState,
      globalState: nextGlobal,
    },
  } as T;
};

const run = <I extends SupportedInput, T extends ReviewStateTransaction>(
  input: I,
  operation: (projected: I) => T,
): T => rebasePullRequestGlobal(input, operation(projectPullRequestGlobal(input)));

export const markReviewedRanges = (input: ReviewRangeMutationInput): ModifiedReviewStateTransaction =>
  run(input, markReviewedRangesBase);
export const unmarkReviewedRanges = (input: ReviewRangeMutationInput): ModifiedReviewStateTransaction =>
  run(input, unmarkReviewedRangesBase);
export const markFileReviewed = (input: ReviewStateMutationInput): ModifiedReviewStateTransaction =>
  run(input, markFileReviewedBase);
export const unmarkFileReviewed = (input: ReviewStateMutationInput): ModifiedReviewStateTransaction =>
  run(input, unmarkFileReviewedBase);
export const markOriginalReviewedRanges = (input: OriginalReviewRangeMutationInput): OriginalReviewStateTransaction =>
  run(input, markOriginalReviewedRangesBase);
export const unmarkOriginalReviewedRanges = (input: OriginalReviewRangeMutationInput): OriginalReviewStateTransaction =>
  run(input, unmarkOriginalReviewedRangesBase);
export const markOriginalSelectionReviewed = (input: OriginalSelectionReviewRangeMutationInput): OriginalReviewStateTransaction =>
  run(input, markOriginalSelectionReviewedBase);
export const unmarkOriginalSelectionReviewed = (input: OriginalSelectionReviewRangeMutationInput): OriginalReviewStateTransaction =>
  run(input, unmarkOriginalSelectionReviewedBase);

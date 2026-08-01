import type { LineInterval } from "../../core/contracts/index";
import {
  commitReviewStateTransaction,
  markFileReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkReviewedRanges,
  type ReviewStateMutationInput,
  type ReviewStateOperation,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter
} from "../../core/review-state/index";

/** Dependencies used after a context/Global transaction has committed. */
export interface RepositoryGlobalStateRepositoryDependencies {
  /**
   * Appends audit history for a committed transaction.
   *
   * A rejection is propagated as observable partial success. The already committed
   * context and Global state are not rolled back.
   */
  readonly requestHistory: (
    transaction: Readonly<ReviewStateTransaction>
  ) => void | Promise<void>;
}

/** Complete mapped state and persistence input shared by every Global operation. */
export interface RepositoryGlobalStateMutationInput
extends ReviewStateMutationInput {
  /** Operation applied to the current context and owner-wide Global state together. */
  readonly operation: ReviewStateOperation;
  /** Atomic full-snapshot compare-and-replace boundary. */
  readonly committer: ReviewStateTransactionCommitter;
  /** Required only for range-scoped operations. */
  readonly intervals?: readonly LineInterval[];
}

/** Result of applying one Repository Global State mutation. */
export type RepositoryGlobalStateMutationResult =
  | {
      /** Both snapshots committed and history was requested. */
      readonly status: "applied";
      /** Detached transaction that was committed. */
      readonly transaction: ReviewStateTransaction;
    }
  | {
      /** The requested operation did not change persisted file state. */
      readonly status: "no-op";
      /** Detached transaction used to prove semantic equality. */
      readonly transaction: ReviewStateTransaction;
    };

type ContextFileSnapshot =
  ReviewStateTransaction["expected"]["contextState"]["files"][string];
type GlobalFileSnapshot =
  ReviewStateTransaction["expected"]["globalState"]["files"][string];

const sameRanges = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): boolean => left.length === right.length && left.every((range, index) =>
  range.startLine === right[index]?.startLine &&
  range.endLineExclusive === right[index]?.endLineExclusive
);

const sameOriginalRanges = (
  left: Readonly<Record<string, readonly LineInterval[]>>,
  right: Readonly<Record<string, readonly LineInterval[]>>
): boolean => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && sameRanges(left[key] ?? [], right[key] ?? [])
  );
};

const sameStrings = (
  left: readonly string[],
  right: readonly string[]
): boolean => left.length === right.length && left.every(
  (value, index) => value === right[index]
);

const sameContextFileState = (
  left: ContextFileSnapshot | undefined,
  right: ContextFileSnapshot | undefined
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.schemaVersion === right.schemaVersion &&
    left.fileId === right.fileId &&
    left.currentPath === right.currentPath &&
    sameStrings(left.previousPaths, right.previousPaths) &&
    left.revisionId === right.revisionId &&
    sameRanges(left.modifiedReviewed, right.modifiedReviewed) &&
    sameOriginalRanges(left.originalReviewedByDiff, right.originalReviewedByDiff) &&
    left.contentHash === right.contentHash &&
    left.lineCount === right.lineCount;
};

const sameGlobalFileState = (
  left: GlobalFileSnapshot | undefined,
  right: GlobalFileSnapshot | undefined
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.fileId === right.fileId &&
    left.currentPath === right.currentPath &&
    left.revisionId === right.revisionId &&
    sameRanges(left.reviewed, right.reviewed) &&
    left.contentHash === right.contentHash;
};

const hasSemanticChange = (
  transaction: Readonly<ReviewStateTransaction>
): boolean => {
  const expectedContext = transaction.expected.contextState.files[transaction.fileId];
  const nextContext = transaction.next.contextState.files[transaction.fileId];
  const expectedGlobal = transaction.expected.globalState.files[transaction.fileId];
  const nextGlobal = transaction.next.globalState.files[transaction.fileId];

  return !sameContextFileState(expectedContext, nextContext) ||
    !sameGlobalFileState(expectedGlobal, nextGlobal);
};

const requireIntervals = (
  input: RepositoryGlobalStateMutationInput
): readonly LineInterval[] => {
  if (input.intervals === undefined) {
    throw new TypeError(`${input.operation} requires intervals.`);
  }
  return input.intervals;
};

const createTransaction = (
  input: RepositoryGlobalStateMutationInput
): ReviewStateTransaction => {
  const common = {
    contextState: input.contextState,
    globalState: input.globalState,
    target: input.target,
    occurredAt: input.occurredAt
  } satisfies ReviewStateMutationInput;

  switch (input.operation) {
    case "mark-ranges-reviewed":
      return markReviewedRanges({
        ...common,
        intervals: requireIntervals(input)
      });
    case "unmark-ranges-reviewed":
      return unmarkReviewedRanges({
        ...common,
        intervals: requireIntervals(input)
      });
    case "mark-file-reviewed":
      return markFileReviewed(common);
    case "unmark-file-reviewed":
      return unmarkFileReviewed(common);
  }
};

/**
 * Application boundary for repository-wide Global review-state mutations.
 *
 * It creates one full context/Global transaction, suppresses operations whose
 * complete persisted target-file state differs only by timestamps, commits both
 * snapshots through the supplied atomic boundary, and requests append-only
 * history only after the commit succeeds.
 */
export class RepositoryGlobalStateRepository {
  public constructor(
    private readonly dependencies: RepositoryGlobalStateRepositoryDependencies
  ) {}

  /**
   * Applies a range or whole-file mutation to the current context and Global state.
   *
   * @returns The detached transaction and whether it was committed.
   * @throws Propagates validation, stale commit, persistence, and post-commit history failures.
   */
  public async apply(
    input: RepositoryGlobalStateMutationInput
  ): Promise<RepositoryGlobalStateMutationResult> {
    const transaction = createTransaction(input);
    if (!hasSemanticChange(transaction)) {
      return { status: "no-op", transaction };
    }

    await commitReviewStateTransaction(transaction, input.committer);
    await this.dependencies.requestHistory(transaction);
    return { status: "applied", transaction };
  }
}

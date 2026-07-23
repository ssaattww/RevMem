import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../contracts/index";
import {
  normalizeLineIntervals,
  subtractLineIntervals
} from "../intervals/index";

/** Review-state operations that update context and Global state together. */
export type ReviewStateOperation =
  | "mark-ranges-reviewed"
  | "unmark-ranges-reviewed"
  | "mark-file-reviewed"
  | "unmark-file-reviewed";

/** Current file metadata required to evaluate a review-state operation. */
export interface ReviewStateFileTarget {
  /** Stable identity shared by context and Global file state. */
  fileId: string;
  /** Current repository-relative path. */
  currentPath: string;
  /** Revision against which the operation is valid. */
  revisionId: string;
  /** Current number of lines in the modified/current file. */
  lineCount: number;
  /** Optional current content hash used by later certainty checks. */
  contentHash?: string;
}

/** Common immutable input for a context and Global state transition. */
export interface ReviewStateMutationInput {
  /** Current isolated review-context state. */
  contextState: ReviewContextState;
  /** Current repository-wide Global state. */
  globalState: RepositoryGlobalState;
  /** Current file metadata to write into both state layers. */
  target: ReviewStateFileTarget;
  /** ISO 8601 timestamp supplied by the caller for deterministic updates. */
  occurredAt: string;
}

/** Input for a range-scoped review-state transition. */
export interface ReviewRangeMutationInput extends ReviewStateMutationInput {
  /** Ranges to mark or unmark; reversed, empty, overlapping, and adjacent input is accepted. */
  intervals: readonly LineInterval[];
}

/** Optimistic concurrency values checked by an atomic persistence adapter. */
export interface ReviewStateTransactionExpectation {
  /** Context timestamp observed before calculating the transaction. */
  contextUpdatedAt: string;
  /** Global timestamp observed before calculating the transaction. */
  globalUpdatedAt: string;
}

/** The two next-state documents that must be committed as one unit. */
export interface ReviewStateTransactionNext {
  /** Complete next context state. */
  contextState: ReviewContextState;
  /** Complete next Global state. */
  globalState: RepositoryGlobalState;
}

/**
 * Composite transaction produced by Review State Service.
 *
 * A persistence adapter must compare `expected` and replace both documents in one
 * atomic commit. It must not expose context-only or Global-only write operations.
 */
export interface ReviewStateTransaction {
  /** User operation represented by this transition. */
  operation: ReviewStateOperation;
  /** Repository affected by both state documents. */
  repositoryId: string;
  /** Review context affected by the context state document. */
  contextId: string;
  /** File affected by the transition. */
  fileId: string;
  /** Values against which an atomic adapter detects stale writes. */
  expected: ReviewStateTransactionExpectation;
  /** Complete normalized states to replace atomically. */
  next: ReviewStateTransactionNext;
}

/** Atomic persistence boundary used by T104 and later adapters. */
export interface ReviewStateTransactionCommitter {
  /**
   * Commits both states or neither. Implementations must reject stale expectations
   * and must never persist only one member of `transaction.next`.
   */
  commit(transaction: ReviewStateTransaction): Promise<void>;
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function assertLineCount(lineCount: number): void {
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) {
    throw new RangeError("lineCount must be a non-negative safe integer.");
  }
}

function validateCommonInput(input: ReviewStateMutationInput): void {
  if (input.contextState.repositoryId !== input.globalState.repositoryId) {
    throw new Error("Context and Global state must belong to the same repository.");
  }

  if (input.contextState.schemaVersion !== input.globalState.schemaVersion) {
    throw new Error("Context and Global state must use the same schema version.");
  }

  assertNonEmptyString(input.contextState.contextId, "contextState.contextId");
  assertNonEmptyString(input.contextState.repositoryId, "contextState.repositoryId");
  assertNonEmptyString(input.target.fileId, "target.fileId");
  assertNonEmptyString(input.target.currentPath, "target.currentPath");
  assertNonEmptyString(input.target.revisionId, "target.revisionId");
  assertNonEmptyString(input.occurredAt, "occurredAt");
  assertLineCount(input.target.lineCount);

  const contextFile = input.contextState.files[input.target.fileId];
  if (contextFile !== undefined && contextFile.fileId !== input.target.fileId) {
    throw new Error("Context file key and fileId must match.");
  }

  const globalFile = input.globalState.files[input.target.fileId];
  if (globalFile !== undefined && globalFile.fileId !== input.target.fileId) {
    throw new Error("Global file key and fileId must match.");
  }
}

function normalizeWithinFile(
  intervals: readonly LineInterval[],
  lineCount: number,
  name: string
): LineInterval[] {
  const normalized = normalizeLineIntervals(intervals);

  for (const interval of normalized) {
    if (interval.endLineExclusive > lineCount) {
      throw new RangeError(`${name} must stay within the current file line count.`);
    }
  }

  return normalized;
}

function normalizeOriginalReviewedByDiff(
  originalReviewedByDiff: Readonly<Record<string, readonly LineInterval[]>> | undefined
): Record<string, LineInterval[]> {
  if (originalReviewedByDiff === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(originalReviewedByDiff).map(([diffId, intervals]) => [
      diffId,
      normalizeLineIntervals(intervals)
    ])
  );
}

function createContextFileState(
  input: ReviewStateMutationInput,
  modifiedReviewed: readonly LineInterval[]
): FileReviewState {
  const previous = input.contextState.files[input.target.fileId];
  const next: FileReviewState = {
    schemaVersion: input.contextState.schemaVersion,
    fileId: input.target.fileId,
    currentPath: input.target.currentPath,
    previousPaths: previous === undefined ? [] : [...previous.previousPaths],
    revisionId: input.target.revisionId,
    modifiedReviewed: normalizeWithinFile(
      modifiedReviewed,
      input.target.lineCount,
      "modifiedReviewed"
    ),
    originalReviewedByDiff: normalizeOriginalReviewedByDiff(
      previous?.originalReviewedByDiff
    ),
    lineCount: input.target.lineCount,
    updatedAt: input.occurredAt
  };

  const contentHash = input.target.contentHash ?? previous?.contentHash;
  if (contentHash !== undefined) {
    next.contentHash = contentHash;
  }

  return next;
}

function createGlobalFileState(
  input: ReviewStateMutationInput,
  reviewed: readonly LineInterval[]
): GlobalFileReviewState {
  const previous = input.globalState.files[input.target.fileId];
  const next: GlobalFileReviewState = {
    fileId: input.target.fileId,
    currentPath: input.target.currentPath,
    revisionId: input.target.revisionId,
    reviewed: normalizeWithinFile(reviewed, input.target.lineCount, "reviewed"),
    updatedAt: input.occurredAt
  };

  const contentHash = input.target.contentHash ?? previous?.contentHash;
  if (contentHash !== undefined) {
    next.contentHash = contentHash;
  }

  return next;
}

function createTransaction(
  operation: ReviewStateOperation,
  input: ReviewStateMutationInput,
  modifiedReviewed: readonly LineInterval[],
  globalReviewed: readonly LineInterval[]
): ReviewStateTransaction {
  validateCommonInput(input);

  const contextFile = createContextFileState(input, modifiedReviewed);
  const globalFile = createGlobalFileState(input, globalReviewed);

  return {
    operation,
    repositoryId: input.contextState.repositoryId,
    contextId: input.contextState.contextId,
    fileId: input.target.fileId,
    expected: {
      contextUpdatedAt: input.contextState.updatedAt,
      globalUpdatedAt: input.globalState.updatedAt
    },
    next: {
      contextState: {
        ...input.contextState,
        files: {
          ...input.contextState.files,
          [input.target.fileId]: contextFile
        },
        updatedAt: input.occurredAt
      },
      globalState: {
        ...input.globalState,
        currentRevisionId: input.target.revisionId,
        files: {
          ...input.globalState.files,
          [input.target.fileId]: globalFile
        },
        updatedAt: input.occurredAt
      }
    }
  };
}

function currentContextRanges(input: ReviewStateMutationInput): LineInterval[] {
  return normalizeWithinFile(
    input.contextState.files[input.target.fileId]?.modifiedReviewed ?? [],
    input.target.lineCount,
    "context modifiedReviewed"
  );
}

function currentGlobalRanges(input: ReviewStateMutationInput): LineInterval[] {
  return normalizeWithinFile(
    input.globalState.files[input.target.fileId]?.reviewed ?? [],
    input.target.lineCount,
    "Global reviewed"
  );
}

/** Adds ranges to the current context and Global state in one transaction. */
export function markReviewedRanges(
  input: ReviewRangeMutationInput
): ReviewStateTransaction {
  validateCommonInput(input);
  const additions = normalizeWithinFile(
    input.intervals,
    input.target.lineCount,
    "intervals"
  );

  return createTransaction(
    "mark-ranges-reviewed",
    input,
    [...currentContextRanges(input), ...additions],
    [...currentGlobalRanges(input), ...additions]
  );
}

/** Removes ranges from the current context and Global state in one transaction. */
export function unmarkReviewedRanges(
  input: ReviewRangeMutationInput
): ReviewStateTransaction {
  validateCommonInput(input);
  const removals = normalizeWithinFile(
    input.intervals,
    input.target.lineCount,
    "intervals"
  );

  return createTransaction(
    "unmark-ranges-reviewed",
    input,
    subtractLineIntervals(currentContextRanges(input), removals),
    subtractLineIntervals(currentGlobalRanges(input), removals)
  );
}

/** Marks every current line in the file in both state layers. */
export function markFileReviewed(
  input: ReviewStateMutationInput
): ReviewStateTransaction {
  validateCommonInput(input);
  const wholeFile =
    input.target.lineCount === 0
      ? []
      : [{ startLine: 0, endLineExclusive: input.target.lineCount }];

  return createTransaction("mark-file-reviewed", input, wholeFile, wholeFile);
}

/** Clears all modified/current reviewed ranges from both state layers. */
export function unmarkFileReviewed(
  input: ReviewStateMutationInput
): ReviewStateTransaction {
  validateCommonInput(input);
  return createTransaction("unmark-file-reviewed", input, [], []);
}

/** Delegates a transaction to the single atomic persistence boundary. */
export async function commitReviewStateTransaction(
  transaction: ReviewStateTransaction,
  committer: ReviewStateTransactionCommitter
): Promise<void> {
  await committer.commit(transaction);
}

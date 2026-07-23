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

/** Recursively readonly view of a public transaction value. */
export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** Review-state operations that update context and Global state together. */
export type ReviewStateOperation =
  | "mark-ranges-reviewed"
  | "unmark-ranges-reviewed"
  | "mark-file-reviewed"
  | "unmark-file-reviewed";

/** Current file metadata required to evaluate a review-state operation. */
export interface ReviewStateFileTarget {
  /** Stable identity shared by context and Global file state. */
  readonly fileId: string;
  /** Current repository-relative path. */
  readonly currentPath: string;
  /** Revision against which the operation is valid. */
  readonly revisionId: string;
  /** Current number of lines in the modified/current file. */
  readonly lineCount: number;
  /** Optional current content hash used by later certainty checks. */
  readonly contentHash?: string;
}

/** Common immutable input for a context and Global state transition. */
export interface ReviewStateMutationInput {
  /** Current isolated review-context state. */
  readonly contextState: DeepReadonly<ReviewContextState>;
  /** Current repository-wide Global state. */
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
  /** Current file metadata to write into both state layers. */
  readonly target: ReviewStateFileTarget;
  /** ISO 8601 timestamp supplied by the caller for deterministic updates. */
  readonly occurredAt: string;
}

/** Input for a range-scoped review-state transition. */
export interface ReviewRangeMutationInput extends ReviewStateMutationInput {
  /** Ranges to mark or unmark; reversed, empty, overlapping, and adjacent input is accepted. */
  readonly intervals: readonly DeepReadonly<LineInterval>[];
}

/** Complete observed states checked by an atomic persistence adapter. */
export interface ReviewStateTransactionExpectation {
  /** Complete context-state snapshot observed before calculating the transaction. */
  readonly contextState: DeepReadonly<ReviewContextState>;
  /** Complete Global-state snapshot observed before calculating the transaction. */
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}

/** The two next-state documents that must be committed as one unit. */
export interface ReviewStateTransactionNext {
  /** Complete next context state. */
  readonly contextState: DeepReadonly<ReviewContextState>;
  /** Complete next Global state. */
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}

/**
 * Composite transaction produced by Review State Service.
 *
 * A persistence adapter must compare `expected` and replace both documents in one
 * atomic commit. It must not expose context-only or Global-only write operations.
 */
export interface ReviewStateTransaction {
  /** User operation represented by this transition. */
  readonly operation: ReviewStateOperation;
  /** Repository affected by both state documents. */
  readonly repositoryId: string;
  /** Review context affected by the context state document. */
  readonly contextId: string;
  /** File affected by the transition. */
  readonly fileId: string;
  /** Values against which an atomic adapter detects stale writes. */
  readonly expected: ReviewStateTransactionExpectation;
  /** Complete normalized states to replace atomically. */
  readonly next: ReviewStateTransactionNext;
}

/** Atomic persistence boundary used by T104 and later adapters. */
export interface ReviewStateTransactionCommitter {
  /**
   * Commits both states or neither. Implementations must reject stale expectations
   * and must never persist only one member of `transaction.next`.
   *
   * @param transaction Detached expected and next full-state snapshots to compare
   * and replace atomically.
   * @returns A promise fulfilled only after both replacements succeed.
   * @throws Propagates an atomic-store rejection, including a stale expectation.
   */
  commit(transaction: Readonly<ReviewStateTransaction>): Promise<void>;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneValue(nestedValue);
    }
    return clone as T;
  }

  return value;
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
  if (input.target.contentHash !== undefined) {
    assertNonEmptyString(input.target.contentHash, "target.contentHash");
  }
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

function validateMappedCurrentInput(input: ReviewStateMutationInput): void {
  validateCommonInput(input);

  const descriptorRevision =
    input.contextState.kind === "pull-request"
      ? input.contextState.pullRequest?.headSha
      : input.contextState.kind === "branch"
        ? input.contextState.branch?.headRevision
        : input.contextState.workspace?.snapshotRevision;
  if (descriptorRevision !== input.target.revisionId) {
    throw new Error("Context descriptor must be mapped to the target revision.");
  }

  const contextFile = input.contextState.files[input.target.fileId];
  if (
    contextFile !== undefined &&
    contextFile.revisionId !== input.target.revisionId
  ) {
    throw new Error("Context file revision must match the target revision.");
  }

  if (input.globalState.currentRevisionId !== input.target.revisionId) {
    throw new Error("Global current revision must match the target revision.");
  }

  const globalFile = input.globalState.files[input.target.fileId];
  if (
    globalFile !== undefined &&
    globalFile.revisionId !== input.target.revisionId
  ) {
    throw new Error("Global file revision must match the target revision.");
  }

  if (input.target.contentHash !== undefined) {
    for (const existingHash of [contextFile?.contentHash, globalFile?.contentHash]) {
      if (existingHash !== undefined && existingHash !== input.target.contentHash) {
        throw new Error("Existing file content hash must match the target content hash.");
      }
    }
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
  modifiedReviewed: readonly LineInterval[],
  originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>
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
      originalReviewedByDiff ?? previous?.originalReviewedByDiff
    ),
    lineCount: input.target.lineCount,
    updatedAt: input.occurredAt
  };

  const contentHash = input.target.contentHash;
  if (contentHash !== undefined) {
    next.contentHash = contentHash;
  }

  return next;
}

function createGlobalFileState(
  input: ReviewStateMutationInput,
  reviewed: readonly LineInterval[]
): GlobalFileReviewState {
  const next: GlobalFileReviewState = {
    fileId: input.target.fileId,
    currentPath: input.target.currentPath,
    revisionId: input.target.revisionId,
    reviewed: normalizeWithinFile(reviewed, input.target.lineCount, "reviewed"),
    updatedAt: input.occurredAt
  };

  const contentHash = input.target.contentHash;
  if (contentHash !== undefined) {
    next.contentHash = contentHash;
  }

  return next;
}

function createTransaction(
  operation: ReviewStateOperation,
  input: ReviewStateMutationInput,
  modifiedReviewed: readonly LineInterval[],
  globalReviewed: readonly LineInterval[],
  originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>
): ReviewStateTransaction {
  validateMappedCurrentInput(input);

  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const nextInput: ReviewStateMutationInput = {
    ...input,
    contextState: cloneValue(input.contextState),
    globalState: cloneValue(input.globalState),
    target: cloneValue(input.target)
  };

  const contextFile = createContextFileState(
    nextInput,
    modifiedReviewed,
    originalReviewedByDiff
  );
  const globalFile = createGlobalFileState(nextInput, globalReviewed);

  return {
    operation,
    repositoryId: nextInput.contextState.repositoryId,
    contextId: nextInput.contextState.contextId,
    fileId: nextInput.target.fileId,
    expected: {
      contextState: expectedContextState,
      globalState: expectedGlobalState
    },
    next: {
      contextState: {
        ...nextInput.contextState,
        files: {
          ...nextInput.contextState.files,
          [nextInput.target.fileId]: contextFile
        },
        updatedAt: nextInput.occurredAt
      },
      globalState: {
        ...nextInput.globalState,
        currentRevisionId: nextInput.target.revisionId,
        files: {
          ...nextInput.globalState.files,
          [nextInput.target.fileId]: globalFile
        },
        updatedAt: nextInput.occurredAt
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

/**
 * Adds ranges to the mapped/current context and Global state in one transaction.
 *
 * @param input Immutable operation input; its context descriptor, existing target
 * files, and Global revision must match `target.revisionId` before this call.
 * @returns Detached full-state compare-and-replace transaction with normalized ranges.
 * @throws When common input, range bounds, mapped/current revision, or content-hash
 * certainty checks fail. The transaction is not committed by this function.
 */
export function markReviewedRanges(
  input: ReviewRangeMutationInput
): ReviewStateTransaction {
  validateMappedCurrentInput(input);
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

/**
 * Removes ranges from the mapped/current context and Global state in one transaction.
 *
 * @param input Immutable operation input whose mapped/current state must match the target.
 * @returns Detached full-state compare-and-replace transaction with split remnants.
 * @throws When input, revision, hash, or range certainty checks fail.
 */
export function unmarkReviewedRanges(
  input: ReviewRangeMutationInput
): ReviewStateTransaction {
  validateMappedCurrentInput(input);
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

/**
 * Marks every current line in the mapped/current file in both state layers.
 *
 * @param input Immutable operation input whose mapped/current state must match the target.
 * @returns Detached full-state compare-and-replace transaction.
 * @throws When input, revision, or content-hash certainty checks fail.
 */
export function markFileReviewed(
  input: ReviewStateMutationInput
): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  const wholeFile =
    input.target.lineCount === 0
      ? []
      : [{ startLine: 0, endLineExclusive: input.target.lineCount }];

  return createTransaction("mark-file-reviewed", input, wholeFile, wholeFile);
}

/**
 * Clears every modified/current and original-side reviewed range for the mapped/current file.
 *
 * @param input Immutable operation input whose mapped/current state must match the target.
 * @returns Detached full-state compare-and-replace transaction with empty file review state.
 * @throws When input, revision, or content-hash certainty checks fail.
 */
export function unmarkFileReviewed(
  input: ReviewStateMutationInput
): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  return createTransaction("unmark-file-reviewed", input, [], [], {});
}

/**
 * Delegates an immutable transaction to the single atomic persistence boundary.
 *
 * @param transaction Detached expected and next snapshots; this function does not mutate either.
 * @param committer Atomic compare-and-replace boundary for both state documents.
 * @returns A promise fulfilled after the committer accepts the transaction.
 * @throws Propagates the committer rejection unchanged, including stale snapshots.
 */
export async function commitReviewStateTransaction(
  transaction: Readonly<ReviewStateTransaction>,
  committer: ReviewStateTransactionCommitter
): Promise<void> {
  await committer.commit(transaction);
}

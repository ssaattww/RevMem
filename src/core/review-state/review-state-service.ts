import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../contracts/index";
import { normalizeLineIntervals, subtractLineIntervals } from "../intervals/index";

/** Recursively readonly view used to prevent mutation of caller-owned snapshots. */
export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

/** Atomic mutation operations that never carry an original-side comparison identity. */
export type ModifiedReviewStateOperation =
  | "mark-ranges-reviewed" | "unmark-ranges-reviewed"
  | "mark-file-reviewed" | "unmark-file-reviewed";

/** Atomic mutation operations that require an original-side comparison identity. */
export type OriginalReviewStateOperation =
  | "mark-original-ranges-reviewed" | "unmark-original-ranges-reviewed"
  | "mark-original-selection-reviewed" | "unmark-original-selection-reviewed";

/** Supported atomic review-state mutation operations. */
export type ReviewStateOperation =
  | ModifiedReviewStateOperation
  | OriginalReviewStateOperation;

/** Immutable current-side file identity used to validate a state mutation. */
export interface ReviewStateFileTarget {
  /** Stable repository file identity. */
  readonly fileId: string;
  /** Canonical current repository-relative path. */
  readonly currentPath: string;
  /** Immutable current revision that the ranges belong to. */
  readonly revisionId: string;
  /** Current modified-side line count. */
  readonly lineCount: number;
  /** Optional content identity that must agree with an existing state entry. */
  readonly contentHash?: string;
}
/** Common immutable snapshot and timestamp input for every mutation. */
export interface ReviewStateMutationInput {
  /** Context-local state to compare and replace atomically. */
  readonly contextState: DeepReadonly<ReviewContextState>;
  /** Repository-global state to compare and replace atomically. */
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
  /** File identity and bounds for the mutation. */
  readonly target: ReviewStateFileTarget;
  /** Canonical timestamp used only when an effective mutation is committed. */
  readonly occurredAt: string;
}
/** Input for a mutable modified-side interval mutation. */
export interface ReviewRangeMutationInput extends ReviewStateMutationInput {
  /** Modified-side intervals to mark or unmark. */
  readonly intervals: readonly DeepReadonly<LineInterval>[];
}
/** Input for an immutable original-side deletion interval mutation. */
export interface OriginalReviewRangeMutationInput extends ReviewStateMutationInput {
  /** Discriminates this as an original-side operation. */
  readonly side: "original";
  /** Canonical non-empty `${baseSha}..${headSha}` identity for the original ranges. */
  readonly diffId: string;
  /** Immutable original-side line-count bound. */
  readonly originalLineCount: number;
  /** Original-side deletion intervals to mark or unmark. */
  readonly intervals: readonly DeepReadonly<LineInterval>[];
}
/** Input for one original-side selection that can affect mapped current and original-only ranges. */
export interface OriginalSelectionReviewRangeMutationInput extends ReviewStateMutationInput {
  /** Discriminates this as an original-side operation. */
  readonly side: "original";
  /** Canonical non-empty `${baseSha}..${headSha}` identity for the original ranges. */
  readonly diffId: string;
  /** Immutable original-side line-count bound. */
  readonly originalLineCount: number;
  /** Original intervals already proven to map to current modified lines. */
  readonly modifiedIntervals: readonly DeepReadonly<LineInterval>[];
  /** Original-only deletion or replacement intervals. */
  readonly originalIntervals: readonly DeepReadonly<LineInterval>[];
}
/** Expected snapshot used by the atomic compare-and-swap boundary. */
export interface ReviewStateTransactionExpectation {
  readonly contextState: DeepReadonly<ReviewContextState>;
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}
/** Replacement snapshot used by the atomic compare-and-swap boundary. */
export interface ReviewStateTransactionNext {
  readonly contextState: DeepReadonly<ReviewContextState>;
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}
/** Fields shared by all atomic state transactions. */
interface ReviewStateTransactionBase {
  readonly repositoryId: string;
  readonly contextId: string;
  readonly fileId: string;
  readonly expected: ReviewStateTransactionExpectation;
  readonly next: ReviewStateTransactionNext;
}
/** Atomic transaction for modified-side or whole-file state, which has no original diff identity. */
export interface ModifiedReviewStateTransaction extends ReviewStateTransactionBase {
  /** Operation that changes modified or whole-file state. */
  readonly operation: ModifiedReviewStateOperation;
  /** Optional explicit modified-side marker. */
  readonly side?: "modified";
  /** Forbidden because modified and whole-file operations are not keyed by a single original diff. */
  readonly diffId?: never;
}
/** Atomic transaction for one immutable original-side diff identity. */
export interface OriginalReviewStateTransaction extends ReviewStateTransactionBase {
  /** Operation that changes original-side ranges, optionally with mapped current ranges. */
  readonly operation: OriginalReviewStateOperation;
  /** Discriminates the original-side transaction. */
  readonly side: "original";
  /** Canonical non-empty comparison identity required for the affected original ranges. */
  readonly diffId: string;
}
/** Discriminated atomic review-state transaction with side-specific diff identity requirements. */
export type ReviewStateTransaction = ModifiedReviewStateTransaction | OriginalReviewStateTransaction;
/** Persistence port for a complete compare-and-swap transaction. */
export interface ReviewStateTransactionCommitter {
  /** Persists the expected and next snapshots atomically or reports a conflict. */
  commit(transaction: Readonly<ReviewStateTransaction>): Promise<void>;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) clone[key] = cloneValue(nestedValue);
    return clone as T;
  }
  return value;
}
function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string.`);
}
function assertLineCount(lineCount: number): void {
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) throw new RangeError("lineCount must be a non-negative safe integer.");
}
function validateCommonInput(input: ReviewStateMutationInput): void {
  if (input.contextState.repositoryId !== input.globalState.repositoryId) throw new Error("Context and Global state must belong to the same repository.");
  if (input.contextState.schemaVersion !== input.globalState.schemaVersion) throw new Error("Context and Global state must use the same schema version.");
  assertNonEmptyString(input.contextState.contextId, "contextState.contextId");
  assertNonEmptyString(input.contextState.repositoryId, "contextState.repositoryId");
  assertNonEmptyString(input.target.fileId, "target.fileId");
  assertNonEmptyString(input.target.currentPath, "target.currentPath");
  assertNonEmptyString(input.target.revisionId, "target.revisionId");
  assertNonEmptyString(input.occurredAt, "occurredAt");
  if (input.target.contentHash !== undefined) assertNonEmptyString(input.target.contentHash, "target.contentHash");
  assertLineCount(input.target.lineCount);
  const contextFile = input.contextState.files[input.target.fileId];
  if (contextFile !== undefined && contextFile.fileId !== input.target.fileId) throw new Error("Context file key and fileId must match.");
  const globalFile = input.globalState.files[input.target.fileId];
  if (globalFile !== undefined && globalFile.fileId !== input.target.fileId) throw new Error("Global file key and fileId must match.");
}
function validateMappedCurrentInput(input: ReviewStateMutationInput): void {
  validateCommonInput(input);
  const descriptorRevision = input.contextState.kind === "pull-request"
    ? input.contextState.pullRequest?.headSha
    : input.contextState.kind === "branch" ? input.contextState.branch?.headRevision
      : input.contextState.kind === "workspace" ? input.contextState.workspace?.snapshotRevision
        : input.contextState.externalFile?.snapshotRevision;
  if (descriptorRevision !== input.target.revisionId) throw new Error("Context descriptor must be mapped to the target revision.");
  const contextFile = input.contextState.files[input.target.fileId];
  if (contextFile !== undefined && contextFile.revisionId !== input.target.revisionId) throw new Error("Context file revision must match the target revision.");
  if (input.globalState.currentRevisionId !== input.target.revisionId) throw new Error("Global current revision must match the target revision.");
  const globalFile = input.globalState.files[input.target.fileId];
  if (globalFile !== undefined && globalFile.revisionId !== input.target.revisionId) throw new Error("Global file revision must match the target revision.");
  if (input.target.contentHash !== undefined) {
    for (const existingHash of [contextFile?.contentHash, globalFile?.contentHash]) {
      if (existingHash !== undefined && existingHash !== input.target.contentHash) throw new Error("Existing file content hash must match the target content hash.");
    }
  }
}
function normalizeWithinFile(intervals: readonly LineInterval[], lineCount: number, name: string): LineInterval[] {
  const normalized = normalizeLineIntervals(intervals);
  for (const value of normalized) if (value.endLineExclusive > lineCount) throw new RangeError(`${name} must stay within the current file line count.`);
  return normalized;
}
function normalizeOriginalReviewedByDiff(originalReviewedByDiff: Readonly<Record<string, readonly LineInterval[]>> | undefined): Record<string, LineInterval[]> {
  if (originalReviewedByDiff === undefined) return {};
  return Object.fromEntries(Object.entries(originalReviewedByDiff).map(([diffId, intervals]) => [diffId, normalizeLineIntervals(intervals)]));
}
function createContextFileState(input: ReviewStateMutationInput, modifiedReviewed: readonly LineInterval[], originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>): FileReviewState {
  const previous = input.contextState.files[input.target.fileId];
  const next: FileReviewState = {
    schemaVersion: input.contextState.schemaVersion,
    fileId: input.target.fileId,
    currentPath: input.target.currentPath,
    previousPaths: previous === undefined ? [] : [...previous.previousPaths],
    revisionId: input.target.revisionId,
    modifiedReviewed: normalizeWithinFile(modifiedReviewed, input.target.lineCount, "modifiedReviewed"),
    originalReviewedByDiff: normalizeOriginalReviewedByDiff(originalReviewedByDiff ?? previous?.originalReviewedByDiff),
    lineCount: input.target.lineCount,
    updatedAt: input.occurredAt
  };
  if (input.target.contentHash !== undefined) next.contentHash = input.target.contentHash;
  return next;
}
function createGlobalFileState(input: ReviewStateMutationInput, reviewed: readonly LineInterval[]): GlobalFileReviewState {
  const next: GlobalFileReviewState = {
    fileId: input.target.fileId,
    currentPath: input.target.currentPath,
    revisionId: input.target.revisionId,
    reviewed: normalizeWithinFile(reviewed, input.target.lineCount, "reviewed"),
    updatedAt: input.occurredAt
  };
  if (input.target.contentHash !== undefined) next.contentHash = input.target.contentHash;
  return next;
}
function createTransaction(operation: ModifiedReviewStateTransaction["operation"], input: ReviewStateMutationInput, modifiedReviewed: readonly LineInterval[], globalReviewed: readonly LineInterval[], originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const nextInput: ReviewStateMutationInput = { ...input, contextState: cloneValue(input.contextState), globalState: cloneValue(input.globalState), target: cloneValue(input.target) };
  const contextFile = createContextFileState(nextInput, modifiedReviewed, originalReviewedByDiff);
  const globalFile = createGlobalFileState(nextInput, globalReviewed);
  return {
    operation,
    repositoryId: nextInput.contextState.repositoryId,
    contextId: nextInput.contextState.contextId,
    fileId: nextInput.target.fileId,
    expected: { contextState: expectedContextState, globalState: expectedGlobalState },
    next: {
      contextState: { ...nextInput.contextState, files: { ...nextInput.contextState.files, [nextInput.target.fileId]: contextFile }, updatedAt: nextInput.occurredAt },
      globalState: { ...nextInput.globalState, currentRevisionId: nextInput.target.revisionId, files: { ...nextInput.globalState.files, [nextInput.target.fileId]: globalFile }, updatedAt: nextInput.occurredAt }
    }
  };
}
function currentContextRanges(input: ReviewStateMutationInput): LineInterval[] {
  return normalizeWithinFile(input.contextState.files[input.target.fileId]?.modifiedReviewed ?? [], input.target.lineCount, "context modifiedReviewed");
}
function currentGlobalRanges(input: ReviewStateMutationInput): LineInterval[] {
  return normalizeWithinFile(input.globalState.files[input.target.fileId]?.reviewed ?? [], input.target.lineCount, "Global reviewed");
}
/** Marks normalized modified-side and Global intervals in one transaction. */
export function markReviewedRanges(input: ReviewRangeMutationInput): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  const additions = normalizeWithinFile(input.intervals, input.target.lineCount, "intervals");
  return createTransaction("mark-ranges-reviewed", input, [...currentContextRanges(input), ...additions], [...currentGlobalRanges(input), ...additions]);
}
/** Removes normalized modified-side and Global intervals in one transaction. */
export function unmarkReviewedRanges(input: ReviewRangeMutationInput): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  const removals = normalizeWithinFile(input.intervals, input.target.lineCount, "intervals");
  return createTransaction("unmark-ranges-reviewed", input, subtractLineIntervals(currentContextRanges(input), removals), subtractLineIntervals(currentGlobalRanges(input), removals));
}
/** Marks every modified-side line and Global line for the target file. */
export function markFileReviewed(input: ReviewStateMutationInput): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  const wholeFile = input.target.lineCount === 0 ? [] : [{ startLine: 0, endLineExclusive: input.target.lineCount }];
  return createTransaction("mark-file-reviewed", input, wholeFile, wholeFile);
}
/** Clears modified-side, Global, and original-by-diff ranges for the target file. */
export function unmarkFileReviewed(input: ReviewStateMutationInput): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  return createTransaction("unmark-file-reviewed", input, [], [], {});
}
function validateOriginalInput(input: OriginalReviewRangeMutationInput): LineInterval[] {
  validateMappedCurrentInput(input);
  assertNonEmptyString(input.diffId, "diffId");
  assertLineCount(input.originalLineCount);
  return normalizeWithinFile(input.intervals, input.originalLineCount, "intervals");
}
function validateOriginalSelectionInput(input: OriginalSelectionReviewRangeMutationInput): {
  readonly modifiedIntervals: LineInterval[];
  readonly originalIntervals: LineInterval[];
} {
  validateMappedCurrentInput(input);
  assertNonEmptyString(input.diffId, "diffId");
  assertLineCount(input.originalLineCount);
  return {
    modifiedIntervals: normalizeWithinFile(input.modifiedIntervals, input.target.lineCount, "modifiedIntervals"),
    originalIntervals: normalizeWithinFile(input.originalIntervals, input.originalLineCount, "originalIntervals")
  };
}
function createOriginalTransaction(operation: OriginalReviewStateTransaction["operation"], input: OriginalReviewRangeMutationInput, reviewed: readonly LineInterval[]): OriginalReviewStateTransaction {
  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const previous = input.contextState.files[input.target.fileId];
  const originalReviewedByDiff = normalizeOriginalReviewedByDiff(previous?.originalReviewedByDiff);
  originalReviewedByDiff[input.diffId] = normalizeWithinFile(reviewed, input.originalLineCount, "originalReviewedByDiff");
  const nextInput: ReviewStateMutationInput = { ...input, contextState: cloneValue(input.contextState), globalState: cloneValue(input.globalState), target: cloneValue(input.target) };
  const contextFile = createContextFileState(nextInput, currentContextRanges(input), originalReviewedByDiff);
  return {
    operation,
    repositoryId: input.contextState.repositoryId,
    contextId: input.contextState.contextId,
    fileId: input.target.fileId,
    side: "original",
    diffId: input.diffId,
    expected: { contextState: expectedContextState, globalState: expectedGlobalState },
    next: {
      contextState: { ...nextInput.contextState, files: { ...nextInput.contextState.files, [input.target.fileId]: contextFile }, updatedAt: input.occurredAt },
      globalState: expectedGlobalState
    }
  };
}
/** Marks immutable original-side deletion intervals for one canonical diff identity. */
export function markOriginalReviewedRanges(input: OriginalReviewRangeMutationInput): OriginalReviewStateTransaction {
  const additions = validateOriginalInput(input);
  const current = normalizeWithinFile(input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [], input.originalLineCount, "originalReviewedByDiff");
  return createOriginalTransaction("mark-original-ranges-reviewed", input, [...current, ...additions]);
}
/** Removes immutable original-side deletion intervals for one canonical diff identity. */
export function unmarkOriginalReviewedRanges(input: OriginalReviewRangeMutationInput): OriginalReviewStateTransaction {
  const removals = validateOriginalInput(input);
  const current = normalizeWithinFile(input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [], input.originalLineCount, "originalReviewedByDiff");
  return createOriginalTransaction("unmark-original-ranges-reviewed", input, subtractLineIntervals(current, removals));
}
function createOriginalSelectionTransaction(
  operation: "mark-original-selection-reviewed" | "unmark-original-selection-reviewed",
  input: OriginalSelectionReviewRangeMutationInput,
  modifiedReviewed: readonly LineInterval[],
  globalReviewed: readonly LineInterval[],
  originalReviewed: readonly LineInterval[]
): OriginalReviewStateTransaction {
  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const originalReviewedByDiff = normalizeOriginalReviewedByDiff(
    input.contextState.files[input.target.fileId]?.originalReviewedByDiff
  );
  originalReviewedByDiff[input.diffId] = normalizeWithinFile(
    originalReviewed,
    input.originalLineCount,
    "originalReviewedByDiff"
  );
  const nextInput: ReviewStateMutationInput = {
    ...input,
    contextState: cloneValue(input.contextState),
    globalState: cloneValue(input.globalState),
    target: cloneValue(input.target)
  };
  const contextFile = createContextFileState(nextInput, modifiedReviewed, originalReviewedByDiff);
  const globalFile = createGlobalFileState(nextInput, globalReviewed);
  return {
    operation,
    repositoryId: nextInput.contextState.repositoryId,
    contextId: nextInput.contextState.contextId,
    fileId: nextInput.target.fileId,
    side: "original",
    diffId: input.diffId,
    expected: { contextState: expectedContextState, globalState: expectedGlobalState },
    next: {
      contextState: {
        ...nextInput.contextState,
        files: { ...nextInput.contextState.files, [nextInput.target.fileId]: contextFile },
        updatedAt: nextInput.occurredAt
      },
      globalState: {
        ...nextInput.globalState,
        currentRevisionId: nextInput.target.revisionId,
        files: { ...nextInput.globalState.files, [nextInput.target.fileId]: globalFile },
        updatedAt: nextInput.occurredAt
      }
    }
  };
}
/** Marks mapped current ranges and original-only ranges in one atomic transaction. */
export function markOriginalSelectionReviewed(input: OriginalSelectionReviewRangeMutationInput): OriginalReviewStateTransaction {
  const intervals = validateOriginalSelectionInput(input);
  const currentModified = currentContextRanges(input);
  const currentGlobal = currentGlobalRanges(input);
  const currentOriginal = normalizeWithinFile(
    input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [],
    input.originalLineCount,
    "originalReviewedByDiff"
  );
  return createOriginalSelectionTransaction(
    "mark-original-selection-reviewed",
    input,
    [...currentModified, ...intervals.modifiedIntervals],
    [...currentGlobal, ...intervals.modifiedIntervals],
    [...currentOriginal, ...intervals.originalIntervals]
  );
}
/** Removes mapped current ranges and original-only ranges in one atomic transaction. */
export function unmarkOriginalSelectionReviewed(input: OriginalSelectionReviewRangeMutationInput): OriginalReviewStateTransaction {
  const intervals = validateOriginalSelectionInput(input);
  const currentModified = currentContextRanges(input);
  const currentGlobal = currentGlobalRanges(input);
  const currentOriginal = normalizeWithinFile(
    input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [],
    input.originalLineCount,
    "originalReviewedByDiff"
  );
  return createOriginalSelectionTransaction(
    "unmark-original-selection-reviewed",
    input,
    subtractLineIntervals(currentModified, intervals.modifiedIntervals),
    subtractLineIntervals(currentGlobal, intervals.modifiedIntervals),
    subtractLineIntervals(currentOriginal, intervals.originalIntervals)
  );
}
/** Commits a complete atomic transaction through the caller-provided persistence boundary. */
export async function commitReviewStateTransaction(transaction: Readonly<ReviewStateTransaction>, committer: ReviewStateTransactionCommitter): Promise<void> {
  await committer.commit(transaction);
}

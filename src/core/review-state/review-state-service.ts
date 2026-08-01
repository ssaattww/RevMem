import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../contracts/index";
import { normalizeLineIntervals, subtractLineIntervals } from "../intervals/index";

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

export type ReviewStateOperation =
  | "mark-ranges-reviewed" | "unmark-ranges-reviewed"
  | "mark-file-reviewed" | "unmark-file-reviewed"
  | "mark-original-ranges-reviewed" | "unmark-original-ranges-reviewed";

export interface ReviewStateFileTarget {
  readonly fileId: string;
  readonly currentPath: string;
  readonly revisionId: string;
  readonly lineCount: number;
  readonly contentHash?: string;
}
export interface ReviewStateMutationInput {
  readonly contextState: DeepReadonly<ReviewContextState>;
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
  readonly target: ReviewStateFileTarget;
  readonly occurredAt: string;
}
export interface ReviewRangeMutationInput extends ReviewStateMutationInput {
  readonly intervals: readonly DeepReadonly<LineInterval>[];
}
export interface OriginalReviewRangeMutationInput extends ReviewStateMutationInput {
  readonly side: "original";
  readonly diffId: string;
  readonly originalLineCount: number;
  readonly intervals: readonly DeepReadonly<LineInterval>[];
}
export interface ReviewStateTransactionExpectation {
  readonly contextState: DeepReadonly<ReviewContextState>;
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}
export interface ReviewStateTransactionNext {
  readonly contextState: DeepReadonly<ReviewContextState>;
  readonly globalState: DeepReadonly<RepositoryGlobalState>;
}
export interface ReviewStateTransaction {
  readonly operation: ReviewStateOperation;
  readonly repositoryId: string;
  readonly contextId: string;
  readonly fileId: string;
  readonly side?: "modified" | "original";
  readonly diffId?: string;
  readonly expected: ReviewStateTransactionExpectation;
  readonly next: ReviewStateTransactionNext;
}
export interface ReviewStateTransactionCommitter {
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
function createTransaction(operation: ReviewStateOperation, input: ReviewStateMutationInput, modifiedReviewed: readonly LineInterval[], globalReviewed: readonly LineInterval[], originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>): ReviewStateTransaction {
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
export function markReviewedRanges(input: ReviewRangeMutationInput): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  const additions = normalizeWithinFile(input.intervals, input.target.lineCount, "intervals");
  return createTransaction("mark-ranges-reviewed", input, [...currentContextRanges(input), ...additions], [...currentGlobalRanges(input), ...additions]);
}
export function unmarkReviewedRanges(input: ReviewRangeMutationInput): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  const removals = normalizeWithinFile(input.intervals, input.target.lineCount, "intervals");
  return createTransaction("unmark-ranges-reviewed", input, subtractLineIntervals(currentContextRanges(input), removals), subtractLineIntervals(currentGlobalRanges(input), removals));
}
export function markFileReviewed(input: ReviewStateMutationInput): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  const wholeFile = input.target.lineCount === 0 ? [] : [{ startLine: 0, endLineExclusive: input.target.lineCount }];
  return createTransaction("mark-file-reviewed", input, wholeFile, wholeFile);
}
export function unmarkFileReviewed(input: ReviewStateMutationInput): ReviewStateTransaction {
  validateMappedCurrentInput(input);
  return createTransaction("unmark-file-reviewed", input, [], [], {});
}
function validateOriginalInput(input: OriginalReviewRangeMutationInput): LineInterval[] {
  validateMappedCurrentInput(input);
  assertNonEmptyString(input.diffId, "diffId");
  assertLineCount(input.originalLineCount);
  return normalizeWithinFile(input.intervals, input.originalLineCount, "intervals");
}
function createOriginalTransaction(operation: "mark-original-ranges-reviewed" | "unmark-original-ranges-reviewed", input: OriginalReviewRangeMutationInput, reviewed: readonly LineInterval[]): ReviewStateTransaction {
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
export function markOriginalReviewedRanges(input: OriginalReviewRangeMutationInput): ReviewStateTransaction {
  const additions = validateOriginalInput(input);
  const current = normalizeWithinFile(input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [], input.originalLineCount, "originalReviewedByDiff");
  return createOriginalTransaction("mark-original-ranges-reviewed", input, [...current, ...additions]);
}
export function unmarkOriginalReviewedRanges(input: OriginalReviewRangeMutationInput): ReviewStateTransaction {
  const removals = validateOriginalInput(input);
  const current = normalizeWithinFile(input.contextState.files[input.target.fileId]?.originalReviewedByDiff[input.diffId] ?? [], input.originalLineCount, "originalReviewedByDiff");
  return createOriginalTransaction("unmark-original-ranges-reviewed", input, subtractLineIntervals(current, removals));
}
export async function commitReviewStateTransaction(transaction: Readonly<ReviewStateTransaction>, committer: ReviewStateTransactionCommitter): Promise<void> {
  await committer.commit(transaction);
}

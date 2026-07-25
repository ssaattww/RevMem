import type { LineInterval, PullRequestFileChange, ReviewContextState } from "../contracts/index";
import {
  type ReviewFileExclusionPolicy,
  type ReviewFileExclusionReason
} from "../file-exclusion/index";

/** Identity of the exact PR comparison represented by the supplied review state and diff. */
export interface PullRequestDiffContextIdentity {
  readonly contextId: string;
  readonly baseSha: string;
  readonly headSha: string;
  /** Key used by FileReviewState.originalReviewedByDiff for the original/base side. */
  readonly originalDiffId: string;
}

/** Progress result for one PR changed file, retaining source statistics and classification for later UI tasks. */
export interface PullRequestDiffFileProgress {
  readonly fileId: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly status: PullRequestFileChange["status"];
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly excluded: boolean;
  readonly exclusionReason?: ReviewFileExclusionReason;
}

export interface PullRequestDiffProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly files: readonly PullRequestDiffFileProgress[];
}

export interface CalculatePullRequestDiffProgressInput {
  readonly files: readonly PullRequestFileChange[];
  /** Persisted state for the exact pull-request context; Global/branch/workspace state is not accepted. */
  readonly reviewContext: ReviewContextState;
  readonly expectedContext: PullRequestDiffContextIdentity;
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer.`);
};
const validateCoordinate = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} coordinates must be positive integers.`);
};
const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;

const validateContext = (state: ReviewContextState, expected: PullRequestDiffContextIdentity): void => {
  if (state.kind !== "pull-request" || state.pullRequest === undefined) throw new RangeError("Progress requires a pull-request context.");
  if (state.contextId !== expected.contextId) throw new RangeError("PR contextId mismatch.");
  if (state.pullRequest.baseSha !== expected.baseSha || state.pullRequest.headSha !== expected.headSha) {
    throw new RangeError("PR context revision mismatch.");
  }
  if (expected.originalDiffId.length === 0) throw new RangeError("originalDiffId must not be empty.");
};

const intervalCoordinates = (intervals: readonly LineInterval[], label: string): ReadonlySet<number> => {
  const result = new Set<number>();
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive)
      || interval.startLine < 0 || interval.endLineExclusive < interval.startLine) {
      throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
    }
    for (let line = interval.startLine; line < interval.endLineExclusive; line += 1) result.add(line + 1);
  }
  return result;
};

const changedCoordinates = (file: PullRequestFileChange): { additions: ReadonlySet<number>; deletions: ReadonlySet<number> } => {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  for (const hunk of file.hunks) {
    validateCount(hunk.oldStart, "Diff hunk oldStart");
    validateCount(hunk.newStart, "Diff hunk newStart");
    validateCount(hunk.oldCount, "Diff hunk oldCount");
    validateCount(hunk.newCount, "Diff hunk newCount");
    const oldBodyCount = hunk.lines.filter(({ kind }) => kind !== "addition").length;
    const newBodyCount = hunk.lines.filter(({ kind }) => kind !== "deletion").length;
    if (oldBodyCount !== hunk.oldCount || newBodyCount !== hunk.newCount) throw new RangeError(`Diff hunk header/body mismatch for ${file.fileId}.`);
    for (const line of hunk.lines) {
      if (line.kind === "addition") {
        if (line.newLine === undefined) throw new RangeError(`Addition is missing newLine for ${file.fileId}.`);
        validateCoordinate(line.newLine, "Diff addition");
        if (additions.has(line.newLine)) throw new RangeError(`Duplicate addition coordinate for ${file.fileId}: ${line.newLine}`);
        additions.add(line.newLine);
      } else if (line.kind === "deletion") {
        if (line.oldLine === undefined) throw new RangeError(`Deletion is missing oldLine for ${file.fileId}.`);
        validateCoordinate(line.oldLine, "Diff deletion");
        if (deletions.has(line.oldLine)) throw new RangeError(`Duplicate deletion coordinate for ${file.fileId}: ${line.oldLine}`);
        deletions.add(line.oldLine);
      }
    }
  }
  if (additions.size !== file.additions) throw new RangeError(`PR diff addition statistics mismatch for ${file.fileId}.`);
  if (deletions.size !== file.deletions) throw new RangeError(`PR diff deletion statistics mismatch for ${file.fileId}.`);
  return { additions, deletions };
};

const countIntersection = (reviewed: ReadonlySet<number>, changed: ReadonlySet<number>): number => {
  let count = 0;
  for (const coordinate of reviewed) if (changed.has(coordinate)) count += 1;
  return count;
};
const displayPath = (file: PullRequestFileChange): string => {
  const path = file.newPath ?? file.oldPath;
  if (path === undefined) throw new RangeError(`PR diff file ${file.fileId} has no path.`);
  return path;
};

/** Calculates progress only for actual changed lines in one validated PR comparison. */
export const calculatePullRequestDiffProgress = (
  input: Readonly<CalculatePullRequestDiffProgressInput>
): PullRequestDiffProgress => {
  validateContext(input.reviewContext, input.expectedContext);
  const seenFileIds = new Set<string>();
  let aggregateReviewed = 0;
  let aggregateTotal = 0;
  const files: PullRequestDiffFileProgress[] = [];

  for (const file of input.files) {
    validateCount(file.additions, "PR diff additions");
    validateCount(file.deletions, "PR diff deletions");
    if (seenFileIds.has(file.fileId)) throw new RangeError(`Duplicate PR diff file: ${file.fileId}`);
    seenFileIds.add(file.fileId);
    const decision = input.exclusionPolicy.evaluate({ path: displayPath(file), isBinary: file.status === "binary" });
    const base = { fileId: file.fileId, oldPath: file.oldPath, newPath: file.newPath, status: file.status, path: decision.normalizedPath, additions: file.additions, deletions: file.deletions };
    if (decision.excluded) {
      files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason });
      continue;
    }

    const actual = changedCoordinates(file);
    const state = input.reviewContext.files[file.fileId];
    if (state !== undefined && state.revisionId !== input.expectedContext.headSha) throw new RangeError(`File review revision mismatch for ${file.fileId}.`);
    const reviewedAdditions = intervalCoordinates(state?.modifiedReviewed ?? [], "Modified reviewed");
    const reviewedDeletions = intervalCoordinates(state?.originalReviewedByDiff[input.expectedContext.originalDiffId] ?? [], "Original reviewed");
    const reviewedLineCount = countIntersection(reviewedAdditions, actual.additions) + countIntersection(reviewedDeletions, actual.deletions);
    const totalLineCount = file.additions + file.deletions;
    aggregateReviewed += reviewedLineCount;
    aggregateTotal += totalLineCount;
    files.push({ ...base, reviewedLineCount, totalLineCount, progress: ratio(reviewedLineCount, totalLineCount), excluded: false });
  }

  return { reviewedLineCount: aggregateReviewed, totalLineCount: aggregateTotal, progress: ratio(aggregateReviewed, aggregateTotal), files };
};
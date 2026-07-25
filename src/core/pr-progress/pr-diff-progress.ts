import type { DiffHunk, LineInterval, PullRequestFileChange, ReviewContextState } from "../contracts/index";
import { type ReviewFileExclusionPolicy, type ReviewFileExclusionReason } from "../file-exclusion/index";

export interface PullRequestDiffSnapshot {
  readonly contextId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly originalDiffId: string;
  readonly files: readonly PullRequestFileChange[];
}

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
  readonly diff: PullRequestDiffSnapshot;
  readonly reviewContext: ReviewContextState;
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer.`);
};

const validateCoordinate = (value: number | undefined, label: string): number => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive one-based coordinate.`);
  }
  return value;
};

const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;

const validateContext = (state: ReviewContextState, diff: PullRequestDiffSnapshot): void => {
  if (state.kind !== "pull-request" || state.pullRequest === undefined) throw new RangeError("Progress requires a pull-request context.");
  if (state.contextId !== diff.contextId) throw new RangeError("PR contextId mismatch.");
  if (state.pullRequest.baseSha !== diff.baseSha || state.pullRequest.headSha !== diff.headSha) throw new RangeError("PR context revision mismatch.");
  const expected = `${diff.baseSha}..${diff.headSha}`;
  if (diff.originalDiffId !== expected) throw new RangeError(`originalDiffId must equal ${expected}.`);
};

const intervalCoordinates = (intervals: readonly LineInterval[], label: string, upperBound?: number): ReadonlySet<number> => {
  const result = new Set<number>();
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive)
      || interval.startLine < 0 || interval.endLineExclusive < interval.startLine) {
      throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
    }
    if (upperBound !== undefined && interval.endLineExclusive > upperBound) {
      throw new RangeError(`${label} interval exceeds lineCount ${upperBound}.`);
    }
    for (let index = interval.startLine; index < interval.endLineExclusive; index += 1) result.add(index + 1);
  }
  return result;
};

interface HunkPosition {
  readonly oldAnchor: number;
  readonly newAnchor: number;
  readonly oldEndAnchor: number;
  readonly newEndAnchor: number;
}

const hunkAnchor = (start: number, count: number): number => count === 0 ? start : start - 1;

const validateHunkLines = (fileId: string, hunk: DiffHunk, additions: Set<number>, deletions: Set<number>): HunkPosition => {
  validateCount(hunk.oldStart, "Diff hunk oldStart");
  validateCount(hunk.newStart, "Diff hunk newStart");
  validateCount(hunk.oldCount, "Diff hunk oldCount");
  validateCount(hunk.newCount, "Diff hunk newCount");

  let oldCursor = hunk.oldStart;
  let newCursor = hunk.newStart;
  let changedLineCount = 0;

  for (const line of hunk.lines) {
    switch ((line as { kind: unknown }).kind) {
      case "context": {
        const oldLine = validateCoordinate(line.oldLine, `Context oldLine for ${fileId}`);
        const newLine = validateCoordinate(line.newLine, `Context newLine for ${fileId}`);
        if (oldLine !== oldCursor || newLine !== newCursor) throw new RangeError(`Diff context coordinate mismatch for ${fileId}.`);
        oldCursor += 1;
        newCursor += 1;
        break;
      }
      case "deletion": {
        if (line.newLine !== undefined) throw new RangeError(`Deletion must not have newLine for ${fileId}.`);
        const oldLine = validateCoordinate(line.oldLine, `Deletion oldLine for ${fileId}`);
        if (oldLine !== oldCursor) throw new RangeError(`Diff deletion coordinate mismatch for ${fileId}.`);
        if (deletions.has(oldLine)) throw new RangeError(`Duplicate deletion coordinate for ${fileId}: ${oldLine}`);
        deletions.add(oldLine);
        changedLineCount += 1;
        oldCursor += 1;
        break;
      }
      case "addition": {
        if (line.oldLine !== undefined) throw new RangeError(`Addition must not have oldLine for ${fileId}.`);
        const newLine = validateCoordinate(line.newLine, `Addition newLine for ${fileId}`);
        if (newLine !== newCursor) throw new RangeError(`Diff addition coordinate mismatch for ${fileId}.`);
        if (additions.has(newLine)) throw new RangeError(`Duplicate addition coordinate for ${fileId}: ${newLine}`);
        additions.add(newLine);
        changedLineCount += 1;
        newCursor += 1;
        break;
      }
      default:
        throw new RangeError(`Unknown diff line kind for ${fileId}.`);
    }
  }

  if (changedLineCount === 0) throw new RangeError(`Diff hunk must contain at least one changed line for ${fileId}.`);
  if (oldCursor !== hunk.oldStart + hunk.oldCount || newCursor !== hunk.newStart + hunk.newCount) {
    throw new RangeError(`Diff hunk header/body mismatch for ${fileId}.`);
  }

  const oldAnchor = hunkAnchor(hunk.oldStart, hunk.oldCount);
  const newAnchor = hunkAnchor(hunk.newStart, hunk.newCount);
  return { oldAnchor, newAnchor, oldEndAnchor: oldAnchor + hunk.oldCount, newEndAnchor: newAnchor + hunk.newCount };
};

const changedCoordinates = (file: PullRequestFileChange): { readonly additions: ReadonlySet<number>; readonly deletions: ReadonlySet<number> } => {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  let previous: HunkPosition | undefined;
  let cumulativeDelta = 0;

  for (const hunk of file.hunks) {
    const position = validateHunkLines(file.fileId, hunk, additions, deletions);
    if (position.newAnchor - position.oldAnchor !== cumulativeDelta) throw new RangeError(`Diff hunk delta mismatch for ${file.fileId}.`);
    if (previous !== undefined) {
      const oldGap = position.oldAnchor - previous.oldEndAnchor;
      const newGap = position.newAnchor - previous.newEndAnchor;
      if (oldGap < 0 || newGap < 0) throw new RangeError(`Diff hunk order mismatch for ${file.fileId}.`);
      if (oldGap !== newGap) throw new RangeError(`Diff hunk gap mismatch for ${file.fileId}.`);
    }
    cumulativeDelta += hunk.newCount - hunk.oldCount;
    previous = position;
  }

  if (additions.size !== file.additions) throw new RangeError(`PR diff addition statistics mismatch for ${file.fileId}.`);
  if (deletions.size !== file.deletions) throw new RangeError(`PR diff deletion statistics mismatch for ${file.fileId}.`);
  return { additions, deletions };
};

const validateStatusMatrix = (file: PullRequestFileChange): string => {
  const status = (file as { status: unknown }).status;
  switch (status) {
    case "added":
      if (file.oldPath !== undefined || file.newPath === undefined || file.deletions !== 0) break;
      return file.newPath;
    case "deleted":
      if (file.oldPath === undefined || file.newPath !== undefined || file.additions !== 0) break;
      return file.oldPath;
    case "modified":
      if (file.oldPath === undefined || file.newPath === undefined) break;
      return file.newPath;
    case "renamed":
    case "copied":
      if (file.oldPath === undefined || file.newPath === undefined) break;
      return file.newPath;
    case "binary":
      if ((file.oldPath === undefined && file.newPath === undefined) || file.hunks.length !== 0) break;
      return file.newPath ?? file.oldPath!;
    default:
      throw new RangeError(`Unknown PR file status for ${file.fileId}.`);
  }
  throw new RangeError(`PR file status matrix mismatch for ${file.fileId}.`);
};

const countIntersection = (reviewed: ReadonlySet<number>, changed: ReadonlySet<number>): number => {
  let count = 0;
  for (const coordinate of reviewed) if (changed.has(coordinate)) count += 1;
  return count;
};

/**
 * Calculates review progress for validated addition/deletion coordinates in one identity-bound PR diff snapshot.
 *
 * @param input Exact diff snapshot, matching PR review context, and exclusion policy.
 * @returns Aggregate and ordered per-file progress. A zero included denominator returns progress `1`.
 * @throws {RangeError} For malformed runtime unions, status/path/count matrices, duplicate IDs or canonical paths,
 * invalid hunk structure, inconsistent statistics, stale context or file state, and out-of-bounds review intervals.
 */
export const calculatePullRequestDiffProgress = (input: Readonly<CalculatePullRequestDiffProgressInput>): PullRequestDiffProgress => {
  validateContext(input.reviewContext, input.diff);
  const seenFileIds = new Set<string>();
  const seenPaths = new Set<string>();
  let aggregateReviewed = 0;
  let aggregateTotal = 0;
  const files: PullRequestDiffFileProgress[] = [];

  for (const file of input.diff.files) {
    validateCount(file.additions, "PR diff additions");
    validateCount(file.deletions, "PR diff deletions");
    if (seenFileIds.has(file.fileId)) throw new RangeError(`Duplicate PR diff file: ${file.fileId}`);
    seenFileIds.add(file.fileId);

    const sourcePath = validateStatusMatrix(file);
    const decision = input.exclusionPolicy.evaluate({ path: sourcePath, isBinary: file.status === "binary" });
    if (seenPaths.has(decision.normalizedPath)) throw new RangeError(`Duplicate PR diff path: ${decision.normalizedPath}`);
    seenPaths.add(decision.normalizedPath);

    const base = { fileId: file.fileId, oldPath: file.oldPath, newPath: file.newPath, status: file.status, path: decision.normalizedPath, additions: file.additions, deletions: file.deletions };
    if (decision.excluded) {
      files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason });
      continue;
    }

    const actual = changedCoordinates(file);
    const state = input.reviewContext.files[file.fileId];
    if (state !== undefined && state.fileId !== file.fileId) throw new RangeError(`File review identity mismatch for ${file.fileId}.`);
    if (state !== undefined && state.revisionId !== input.diff.headSha) throw new RangeError(`File review revision mismatch for ${file.fileId}.`);
    if (state !== undefined) validateCount(state.lineCount, `File review lineCount for ${file.fileId}`);

    const reviewedAdditions = intervalCoordinates(state?.modifiedReviewed ?? [], "Modified reviewed", state?.lineCount);
    const reviewedDeletions = intervalCoordinates(state?.originalReviewedByDiff[input.diff.originalDiffId] ?? [], "Original reviewed");
    const reviewedLineCount = countIntersection(reviewedAdditions, actual.additions) + countIntersection(reviewedDeletions, actual.deletions);
    const totalLineCount = file.additions + file.deletions;
    aggregateReviewed += reviewedLineCount;
    aggregateTotal += totalLineCount;
    files.push({ ...base, reviewedLineCount, totalLineCount, progress: ratio(reviewedLineCount, totalLineCount), excluded: false });
  }

  return { reviewedLineCount: aggregateReviewed, totalLineCount: aggregateTotal, progress: ratio(aggregateReviewed, aggregateTotal), files };
};
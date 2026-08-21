import type { DiffHunk, LineInterval, PullRequestFileChange, ReviewContextState } from "../contracts/index";
import { type ReviewFileExclusionPolicy, type ReviewFileExclusionReason } from "../file-exclusion/index";

/** Identity-bound changed-file snapshot for one exact pull-request comparison. */
export interface PullRequestDiffSnapshot {
  /** Stable PR review-context ID. */
  readonly contextId: string;
  /** Base revision used to parse every file and hunk. */
  readonly baseSha: string;
  /** Head revision used to parse every file and hunk. */
  readonly headSha: string;
  /** Canonical original-side state key, exactly `${baseSha}..${headSha}`. */
  readonly originalDiffId: string;
  /** Changed files in source/API order. */
  readonly files: readonly PullRequestFileChange[];
}

/** Progress result for one changed file. */
export interface PullRequestDiffFileProgress {
  /** Stable changed-file identity. */
  readonly fileId: string;
  /** Validated repository-relative base-side path, when present. */
  readonly oldPath?: string;
  /** Validated repository-relative head-side path, when present. */
  readonly newPath?: string;
  /** Validated runtime change classification. */
  readonly status: PullRequestFileChange["status"];
  /** Canonical normalized display path. */
  readonly path: string;
  /** Raw source addition statistic, retained for excluded files. */
  readonly additions: number;
  /** Raw source deletion statistic, retained for excluded files. */
  readonly deletions: number;
  /** Reviewed changed lines; excluded files report zero. */
  readonly reviewedLineCount: number;
  /** Reviewable changed lines; excluded files report zero. */
  readonly totalLineCount: number;
  /** Ratio in `0..1`; a zero denominator is defined as `1`. */
  readonly progress: number;
  /** Whether the shared exclusion policy removed this file from aggregation. */
  readonly excluded: boolean;
  /** Stable exclusion reason when excluded. */
  readonly exclusionReason?: ReviewFileExclusionReason;
}

/** Aggregate PR progress with per-file results in snapshot order. */
export interface PullRequestDiffProgress {
  /** Reviewed changed lines across included files. */
  readonly reviewedLineCount: number;
  /** Added plus deleted lines across included files. */
  readonly totalLineCount: number;
  /** Aggregate ratio; a zero denominator is defined as `1`. */
  readonly progress: number;
  /** Per-file results in the same order as `diff.files`. */
  readonly files: readonly PullRequestDiffFileProgress[];
}

/** Input for deterministic PR-diff progress calculation. */
export interface CalculatePullRequestDiffProgressInput {
  /** Exact identity-bound diff snapshot. */
  readonly diff: PullRequestDiffSnapshot;
  /** Persisted state for the same PR context and head revision. */
  readonly reviewContext: ReviewContextState;
  /** Shared T300 path-normalization and exclusion policy. */
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

/** Runtime scheduler and generation fence for large PR snapshots. */
export interface PullRequestDiffProgressWorkBudget {
  readonly maxWorkItems: number;
  readonly yieldControl: () => void | Promise<void>;
  readonly isCurrent: () => boolean;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer.`);
};

const validateCoordinate = (value: number | undefined, label: string): number => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive one-based coordinate.`);
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

interface NormalizedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

const normalizeIntervals = (intervals: readonly LineInterval[], label: string, upperBound?: number): readonly NormalizedInterval[] => {
  const sorted = intervals.map((interval) => {
    if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive)
      || interval.startLine < 0 || interval.endLineExclusive < interval.startLine) {
      throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
    }
    if (upperBound !== undefined && interval.endLineExclusive > upperBound) throw new RangeError(`${label} interval exceeds lineCount ${upperBound}.`);
    return { startLine: interval.startLine, endLineExclusive: interval.endLineExclusive };
  }).sort((left, right) => left.startLine - right.startLine || left.endLineExclusive - right.endLineExclusive);

  const merged: NormalizedInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || interval.startLine > previous.endLineExclusive) {
      merged.push(interval);
    } else if (interval.endLineExclusive > previous.endLineExclusive) {
      merged[merged.length - 1] = { startLine: previous.startLine, endLineExclusive: interval.endLineExclusive };
    }
  }
  return merged;
};

const containsCoordinate = (intervals: readonly NormalizedInterval[], coordinate: number): boolean => {
  const zeroBased = coordinate - 1;
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const interval = intervals[middle]!;
    if (zeroBased < interval.startLine) high = middle - 1;
    else if (zeroBased >= interval.endLineExclusive) low = middle + 1;
    else return true;
  }
  return false;
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
  if (oldCursor !== hunk.oldStart + hunk.oldCount || newCursor !== hunk.newStart + hunk.newCount) throw new RangeError(`Diff hunk header/body mismatch for ${fileId}.`);
  const oldAnchor = hunkAnchor(hunk.oldStart, hunk.oldCount);
  const newAnchor = hunkAnchor(hunk.newStart, hunk.newCount);
  return { oldAnchor, newAnchor, oldEndAnchor: oldAnchor + hunk.oldCount, newEndAnchor: newAnchor + hunk.newCount };
};

interface ChangedCoordinates {
  readonly additions: ReadonlySet<number>;
  readonly deletions: ReadonlySet<number>;
  readonly maxModifiedExtent: number;
}

const changedCoordinates = (file: PullRequestFileChange): ChangedCoordinates => {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  let previous: HunkPosition | undefined;
  let cumulativeDelta = 0;
  let maxModifiedExtent = 0;
  for (const hunk of file.hunks) {
    const position = validateHunkLines(file.fileId, hunk, additions, deletions);
    if (position.newAnchor - position.oldAnchor !== cumulativeDelta) throw new RangeError(`Diff hunk delta mismatch for ${file.fileId}.`);
    if (previous !== undefined) {
      const oldGap = position.oldAnchor - previous.oldEndAnchor;
      const newGap = position.newAnchor - previous.newEndAnchor;
      if (oldGap < 0 || newGap < 0) throw new RangeError(`Diff hunk order mismatch for ${file.fileId}.`);
      if (oldGap !== newGap) throw new RangeError(`Diff hunk gap mismatch for ${file.fileId}.`);
    }
    maxModifiedExtent = Math.max(maxModifiedExtent, position.newAnchor, position.newEndAnchor);
    cumulativeDelta += hunk.newCount - hunk.oldCount;
    previous = position;
  }
  if (additions.size !== file.additions) throw new RangeError(`PR diff addition statistics mismatch for ${file.fileId}.`);
  if (deletions.size !== file.deletions) throw new RangeError(`PR diff deletion statistics mismatch for ${file.fileId}.`);
  return { additions, deletions, maxModifiedExtent };
};

interface ValidatedFilePaths {
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly displayPath: string;
  readonly statePath: string;
}

const normalizePath = (path: string, policy: ReviewFileExclusionPolicy): string => policy.evaluate({ path, isBinary: false }).normalizedPath;

const validateCompleteAddedDeletedDiff = (file: PullRequestFileChange): void => {
  if (file.status === "added") {
    if (file.additions === 0) {
      if (file.hunks.length !== 0) throw new RangeError(`Added file must contain a complete diff for ${file.fileId}.`);
      return;
    }
    const only = file.hunks.length === 1 ? file.hunks[0] : undefined;
    if (only === undefined || only.oldStart !== 0 || only.oldCount !== 0 || only.newStart !== 1 || only.newCount !== file.additions) {
      throw new RangeError(`Added file must contain a complete diff for ${file.fileId}.`);
    }
  }
  if (file.status === "deleted") {
    if (file.deletions === 0) {
      if (file.hunks.length !== 0) throw new RangeError(`Deleted file must contain a complete diff for ${file.fileId}.`);
      return;
    }
    const only = file.hunks.length === 1 ? file.hunks[0] : undefined;
    if (only === undefined || only.oldStart !== 1 || only.oldCount !== file.deletions || only.newStart !== 0 || only.newCount !== 0) {
      throw new RangeError(`Deleted file must contain a complete diff for ${file.fileId}.`);
    }
  }
};

const validateStatusMatrix = (file: PullRequestFileChange, policy: ReviewFileExclusionPolicy): ValidatedFilePaths => {
  const oldPath = file.oldPath === undefined ? undefined : normalizePath(file.oldPath, policy);
  const newPath = file.newPath === undefined ? undefined : normalizePath(file.newPath, policy);
  switch ((file as { status: unknown }).status) {
    case "added":
      if (oldPath !== undefined || newPath === undefined || file.deletions !== 0 || file.hunks.some(({ oldCount }) => oldCount !== 0)) break;
      validateCompleteAddedDeletedDiff(file);
      return { newPath, displayPath: newPath, statePath: newPath };
    case "deleted":
      if (oldPath === undefined || newPath !== undefined || file.additions !== 0 || file.hunks.some(({ newCount }) => newCount !== 0)) break;
      validateCompleteAddedDeletedDiff(file);
      return { oldPath, displayPath: oldPath, statePath: oldPath };
    case "modified":
      if (oldPath === undefined || newPath === undefined || oldPath !== newPath) break;
      return { oldPath, newPath, displayPath: newPath, statePath: newPath };
    case "renamed":
    case "copied":
      if (oldPath === undefined || newPath === undefined || oldPath === newPath) break;
      return { oldPath, newPath, displayPath: newPath, statePath: newPath };
    case "binary":
      if ((oldPath === undefined && newPath === undefined) || file.hunks.length !== 0) break;
      return { oldPath, newPath, displayPath: newPath ?? oldPath!, statePath: newPath ?? oldPath! };
    default:
      throw new RangeError(`Unknown PR file status for ${file.fileId}.`);
  }
  throw new RangeError(`PR file status matrix mismatch for ${file.fileId}.`);
};

const countReviewed = (intervals: readonly NormalizedInterval[], changed: ReadonlySet<number>): number => {
  let count = 0;
  for (const coordinate of changed) if (containsCoordinate(intervals, coordinate)) count += 1;
  return count;
};

interface ValidatedState {
  readonly modifiedReviewed: readonly NormalizedInterval[];
  readonly originalReviewed: readonly NormalizedInterval[];
}

const validateFileState = (
  file: PullRequestFileChange,
  paths: ValidatedFilePaths,
  context: ReviewContextState,
  diff: PullRequestDiffSnapshot,
  policy: ReviewFileExclusionPolicy,
  actual: ChangedCoordinates | undefined
): ValidatedState => {
  const state = context.files[file.fileId];
  if (state === undefined) return { modifiedReviewed: [], originalReviewed: [] };
  if (state.fileId !== file.fileId) throw new RangeError(`File review identity mismatch for ${file.fileId}.`);
  if (state.revisionId !== diff.headSha) throw new RangeError(`File review revision mismatch for ${file.fileId}.`);
  validateCount(state.lineCount, `File review lineCount for ${file.fileId}`);
  const currentPath = normalizePath(state.currentPath, policy);
  if (currentPath !== paths.statePath) throw new RangeError(`File review currentPath mismatch for ${file.fileId}.`);
  if (actual !== undefined && actual.maxModifiedExtent > state.lineCount) throw new RangeError(`PR diff modified extent exceeds lineCount for ${file.fileId}.`);
  return {
    modifiedReviewed: normalizeIntervals(state.modifiedReviewed, "Modified reviewed", state.lineCount),
    originalReviewed: normalizeIntervals(state.originalReviewedByDiff[diff.originalDiffId] ?? [], "Original reviewed")
  };
};

/**
 * Calculates review progress for validated addition/deletion coordinates in one identity-bound PR diff snapshot.
 * Diff and state validity are independent of exclusion; exclusion affects aggregation only.
 * Reviewed intervals are normalized without per-line expansion, so work scales with interval and changed-line counts.
 *
 * @param input Exact diff snapshot, matching PR review context, and exclusion policy.
 * @returns Aggregate and ordered per-file progress. A zero included denominator returns progress `1`.
 * @throws {RangeError} For malformed runtime unions, incomplete added/deleted patches, paths, status/side matrices,
 * duplicate IDs or canonical paths, invalid hunks or statistics, stale or misrouted state, and out-of-bounds intervals or hunks.
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

    const paths = validateStatusMatrix(file, input.exclusionPolicy);
    const decision = input.exclusionPolicy.evaluate({ path: paths.displayPath, isBinary: file.status === "binary" });
    if (seenPaths.has(decision.normalizedPath)) throw new RangeError(`Duplicate PR diff path: ${decision.normalizedPath}`);
    seenPaths.add(decision.normalizedPath);

    const actual = file.status === "binary" ? undefined : changedCoordinates(file);
    const state = validateFileState(file, paths, input.reviewContext, input.diff, input.exclusionPolicy, actual);
    const base = { fileId: file.fileId, oldPath: paths.oldPath, newPath: paths.newPath, status: file.status, path: decision.normalizedPath, additions: file.additions, deletions: file.deletions };
    if (decision.excluded) {
      files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason });
      continue;
    }

    if (actual === undefined) throw new RangeError(`Included binary file is not reviewable: ${file.fileId}.`);
    const reviewedLineCount = countReviewed(state.modifiedReviewed, actual.additions) + countReviewed(state.originalReviewed, actual.deletions);
    const totalLineCount = file.additions + file.deletions;
    aggregateReviewed += reviewedLineCount;
    aggregateTotal += totalLineCount;
    files.push({ ...base, reviewedLineCount, totalLineCount, progress: ratio(reviewedLineCount, totalLineCount), excluded: false });
  }

  return { reviewedLineCount: aggregateReviewed, totalLineCount: aggregateTotal, progress: ratio(aggregateReviewed, aggregateTotal), files };
};

/**
 * Yields through every raw snapshot hunk and line before the canonical
 * calculator performs its identity-preserving result construction. The public
 * synchronous calculator remains available to existing non-UI consumers.
 */
export const calculatePullRequestDiffProgressCooperatively = async (
  input: Readonly<CalculatePullRequestDiffProgressInput>,
  budget: PullRequestDiffProgressWorkBudget
): Promise<PullRequestDiffProgress | undefined> => {
  if (!Number.isSafeInteger(budget.maxWorkItems) || budget.maxWorkItems <= 0) throw new RangeError("maxWorkItems must be a positive integer.");
  let pending = 0;
  const checkpoint = async (): Promise<boolean> => {
    if (!budget.isCurrent()) return false;
    if (++pending < budget.maxWorkItems) return true;
    pending = 0;
    await budget.yieldControl();
    return budget.isCurrent();
  };
  validateContext(input.reviewContext, input.diff);
  const normalizeCooperatively = async (intervals: readonly LineInterval[], label: string, upperBound?: number): Promise<readonly NormalizedInterval[] | undefined> => {
    const sorted: NormalizedInterval[] = [];
    for (const interval of intervals) {
      if (!await checkpoint()) return undefined;
      if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive) || interval.startLine < 0 || interval.endLineExclusive < interval.startLine) throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
      if (upperBound !== undefined && interval.endLineExclusive > upperBound) throw new RangeError(`${label} interval exceeds lineCount ${upperBound}.`);
      sorted.push({ startLine: interval.startLine, endLineExclusive: interval.endLineExclusive });
    }
    // Insertion keeps comparison and movement under the same item budget and is
    // intentionally used here because persisted review intervals are sparse.
    for (let index = 1; index < sorted.length; index += 1) {
      const value = sorted[index]!;
      let cursor = index - 1;
      while (cursor >= 0 && (sorted[cursor]!.startLine > value.startLine || (sorted[cursor]!.startLine === value.startLine && sorted[cursor]!.endLineExclusive > value.endLineExclusive))) {
        if (!await checkpoint()) return undefined;
        sorted[cursor + 1] = sorted[cursor]!;
        cursor -= 1;
      }
      sorted[cursor + 1] = value;
      if (!await checkpoint()) return undefined;
    }
    const merged: NormalizedInterval[] = [];
    for (const interval of sorted) {
      if (!await checkpoint()) return undefined;
      const previous = merged[merged.length - 1];
      if (previous === undefined || interval.startLine > previous.endLineExclusive) merged.push(interval);
      else if (interval.endLineExclusive > previous.endLineExclusive) merged[merged.length - 1] = { startLine: previous.startLine, endLineExclusive: interval.endLineExclusive };
    }
    return merged;
  };
  const changedCoordinatesCooperatively = async (file: PullRequestFileChange): Promise<ChangedCoordinates | undefined> => {
    const additions = new Set<number>();
    const deletions = new Set<number>();
    let previous: HunkPosition | undefined;
    let cumulativeDelta = 0;
    let maxModifiedExtent = 0;
    for (const hunk of file.hunks) {
      if (!await checkpoint()) return undefined;
      validateCount(hunk.oldStart, "Diff hunk oldStart"); validateCount(hunk.newStart, "Diff hunk newStart"); validateCount(hunk.oldCount, "Diff hunk oldCount"); validateCount(hunk.newCount, "Diff hunk newCount");
      let oldCursor = hunk.oldStart;
      let newCursor = hunk.newStart;
      let changedLineCount = 0;
      for (const line of hunk.lines) {
        if (!await checkpoint()) return undefined;
        switch ((line as { kind: unknown }).kind) {
          case "context": {
            const oldLine = validateCoordinate(line.oldLine, `Context oldLine for ${file.fileId}`); const newLine = validateCoordinate(line.newLine, `Context newLine for ${file.fileId}`);
            if (oldLine !== oldCursor || newLine !== newCursor) throw new RangeError(`Diff context coordinate mismatch for ${file.fileId}.`);
            oldCursor += 1; newCursor += 1; break;
          }
          case "deletion": {
            if (line.newLine !== undefined) throw new RangeError(`Deletion must not have newLine for ${file.fileId}.`);
            const oldLine = validateCoordinate(line.oldLine, `Deletion oldLine for ${file.fileId}`);
            if (oldLine !== oldCursor || deletions.has(oldLine)) throw new RangeError(`Diff deletion coordinate mismatch for ${file.fileId}.`);
            deletions.add(oldLine); changedLineCount += 1; oldCursor += 1; break;
          }
          case "addition": {
            if (line.oldLine !== undefined) throw new RangeError(`Addition must not have oldLine for ${file.fileId}.`);
            const newLine = validateCoordinate(line.newLine, `Addition newLine for ${file.fileId}`);
            if (newLine !== newCursor || additions.has(newLine)) throw new RangeError(`Diff addition coordinate mismatch for ${file.fileId}.`);
            additions.add(newLine); changedLineCount += 1; newCursor += 1; break;
          }
          default: throw new RangeError(`Unknown diff line kind for ${file.fileId}.`);
        }
      }
      if (changedLineCount === 0 || oldCursor !== hunk.oldStart + hunk.oldCount || newCursor !== hunk.newStart + hunk.newCount) throw new RangeError(`Diff hunk header/body mismatch for ${file.fileId}.`);
      const position: HunkPosition = { oldAnchor: hunkAnchor(hunk.oldStart, hunk.oldCount), newAnchor: hunkAnchor(hunk.newStart, hunk.newCount), oldEndAnchor: hunkAnchor(hunk.oldStart, hunk.oldCount) + hunk.oldCount, newEndAnchor: hunkAnchor(hunk.newStart, hunk.newCount) + hunk.newCount };
      if (position.newAnchor - position.oldAnchor !== cumulativeDelta) throw new RangeError(`Diff hunk delta mismatch for ${file.fileId}.`);
      if (previous !== undefined && (position.oldAnchor - previous.oldEndAnchor < 0 || position.newAnchor - previous.newEndAnchor < 0 || position.oldAnchor - previous.oldEndAnchor !== position.newAnchor - previous.newEndAnchor)) throw new RangeError(`Diff hunk order mismatch for ${file.fileId}.`);
      maxModifiedExtent = Math.max(maxModifiedExtent, position.newAnchor, position.newEndAnchor); cumulativeDelta += hunk.newCount - hunk.oldCount; previous = position;
    }
    if (additions.size !== file.additions || deletions.size !== file.deletions) throw new RangeError(`PR diff statistics mismatch for ${file.fileId}.`);
    return { additions, deletions, maxModifiedExtent };
  };
  const countCooperatively = async (intervals: readonly NormalizedInterval[], changed: ReadonlySet<number>): Promise<number | undefined> => {
    let count = 0;
    for (const coordinate of changed) {
      if (!await checkpoint()) return undefined;
      if (containsCoordinate(intervals, coordinate)) count += 1;
    }
    return count;
  };
  const seenFileIds = new Set<string>(); const seenPaths = new Set<string>();
  const files: PullRequestDiffFileProgress[] = []; let aggregateReviewed = 0; let aggregateTotal = 0;
  for (const file of input.diff.files) {
    if (!await checkpoint()) return undefined;
    validateCount(file.additions, "PR diff additions"); validateCount(file.deletions, "PR diff deletions");
    if (seenFileIds.has(file.fileId)) throw new RangeError(`Duplicate PR diff file: ${file.fileId}`); seenFileIds.add(file.fileId);
    const paths = validateStatusMatrix(file, input.exclusionPolicy);
    const decision = input.exclusionPolicy.evaluate({ path: paths.displayPath, isBinary: file.status === "binary" });
    if (seenPaths.has(decision.normalizedPath)) throw new RangeError(`Duplicate PR diff path: ${decision.normalizedPath}`); seenPaths.add(decision.normalizedPath);
    const actual = file.status === "binary" ? undefined : await changedCoordinatesCooperatively(file);
    if (file.status !== "binary" && actual === undefined) return undefined;
    const state = input.reviewContext.files[file.fileId];
    let modifiedReviewed: readonly NormalizedInterval[] = []; let originalReviewed: readonly NormalizedInterval[] = [];
    if (state !== undefined) {
      if (state.fileId !== file.fileId || state.revisionId !== input.diff.headSha) throw new RangeError(`File review identity mismatch for ${file.fileId}.`);
      validateCount(state.lineCount, `File review lineCount for ${file.fileId}`);
      if (normalizePath(state.currentPath, input.exclusionPolicy) !== paths.statePath) throw new RangeError(`File review currentPath mismatch for ${file.fileId}.`);
      if (actual !== undefined && actual.maxModifiedExtent > state.lineCount) throw new RangeError(`PR diff modified extent exceeds lineCount for ${file.fileId}.`);
      const modified = await normalizeCooperatively(state.modifiedReviewed, "Modified reviewed", state.lineCount);
      const original = await normalizeCooperatively(state.originalReviewedByDiff[input.diff.originalDiffId] ?? [], "Original reviewed");
      if (modified === undefined || original === undefined) return undefined;
      modifiedReviewed = modified; originalReviewed = original;
    }
    const base = { fileId: file.fileId, oldPath: paths.oldPath, newPath: paths.newPath, status: file.status, path: decision.normalizedPath, additions: file.additions, deletions: file.deletions };
    if (decision.excluded) { files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason }); continue; }
    if (actual === undefined) throw new RangeError(`Included binary file is not reviewable: ${file.fileId}.`);
    const modifiedCount = await countCooperatively(modifiedReviewed, actual.additions); const originalCount = await countCooperatively(originalReviewed, actual.deletions);
    if (modifiedCount === undefined || originalCount === undefined) return undefined;
    const reviewedLineCount = modifiedCount + originalCount; const totalLineCount = file.additions + file.deletions;
    aggregateReviewed += reviewedLineCount; aggregateTotal += totalLineCount;
    files.push({ ...base, reviewedLineCount, totalLineCount, progress: ratio(reviewedLineCount, totalLineCount), excluded: false });
  }
  return budget.isCurrent() ? { reviewedLineCount: aggregateReviewed, totalLineCount: aggregateTotal, progress: ratio(aggregateReviewed, aggregateTotal), files } : undefined;
};

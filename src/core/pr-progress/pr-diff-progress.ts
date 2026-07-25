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

const intervalCoordinates = (intervals: readonly LineInterval[], label: string, upperBound?: number): ReadonlySet<number> => {
  const result = new Set<number>();
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive)
      || interval.startLine < 0 || interval.endLineExclusive < interval.startLine) {
      throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
    }
    if (upperBound !== undefined && interval.endLineExclusive > upperBound) throw new RangeError(`${label} interval exceeds lineCount ${upperBound}.`);
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
  if (oldCursor !== hunk.oldStart + hunk.oldCount || newCursor !== hunk.newStart + hunk.newCount) throw new RangeError(`Diff hunk header/body mismatch for ${fileId}.`);
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

interface ValidatedFilePaths {
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly displayPath: string;
}

const normalizePath = (path: string, policy: ReviewFileExclusionPolicy): string => policy.evaluate({ path, isBinary: false }).normalizedPath;

const validateStatusMatrix = (file: PullRequestFileChange, policy: ReviewFileExclusionPolicy): ValidatedFilePaths => {
  const oldPath = file.oldPath === undefined ? undefined : normalizePath(file.oldPath, policy);
  const newPath = file.newPath === undefined ? undefined : normalizePath(file.newPath, policy);
  switch ((file as { status: unknown }).status) {
    case "added":
      if (oldPath !== undefined || newPath === undefined || file.deletions !== 0 || file.hunks.some(({ oldCount }) => oldCount !== 0)) break;
      return { newPath, displayPath: newPath };
    case "deleted":
      if (oldPath === undefined || newPath !== undefined || file.additions !== 0 || file.hunks.some(({ newCount }) => newCount !== 0)) break;
      return { oldPath, displayPath: oldPath };
    case "modified":
      if (oldPath === undefined || newPath === undefined || oldPath !== newPath) break;
      return { oldPath, newPath, displayPath: newPath };
    case "renamed":
    case "copied":
      if (oldPath === undefined || newPath === undefined || oldPath === newPath) break;
      return { oldPath, newPath, displayPath: newPath };
    case "binary":
      if ((oldPath === undefined && newPath === undefined) || file.hunks.length !== 0) break;
      return { oldPath, newPath, displayPath: newPath ?? oldPath! };
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

const validateActualModifiedBounds = (coordinates: ReadonlySet<number>, lineCount: number, fileId: string): void => {
  for (const coordinate of coordinates) if (coordinate > lineCount) throw new RangeError(`PR diff modified coordinate exceeds lineCount for ${fileId}.`);
};

/**
 * Calculates review progress for validated addition/deletion coordinates in one identity-bound PR diff snapshot.
 * Nonbinary snapshot structure is validated independently of exclusion; exclusion affects aggregation only.
 *
 * @param input Exact diff snapshot, matching PR review context, and exclusion policy.
 * @returns Aggregate and ordered per-file progress. A zero included denominator returns progress `1`.
 * @throws {RangeError} For malformed runtime unions, paths, status/side matrices, duplicate IDs or canonical paths,
 * invalid hunks or statistics, stale state, and review or actual modified coordinates beyond `lineCount`.
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
    const base = { fileId: file.fileId, oldPath: paths.oldPath, newPath: paths.newPath, status: file.status, path: decision.normalizedPath, additions: file.additions, deletions: file.deletions };
    if (decision.excluded) {
      files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason });
      continue;
    }

    if (actual === undefined) throw new RangeError(`Included binary file is not reviewable: ${file.fileId}.`);
    const state = input.reviewContext.files[file.fileId];
    if (state !== undefined && state.fileId !== file.fileId) throw new RangeError(`File review identity mismatch for ${file.fileId}.`);
    if (state !== undefined && state.revisionId !== input.diff.headSha) throw new RangeError(`File review revision mismatch for ${file.fileId}.`);
    if (state !== undefined) {
      validateCount(state.lineCount, `File review lineCount for ${file.fileId}`);
      validateActualModifiedBounds(actual.additions, state.lineCount, file.fileId);
    }

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

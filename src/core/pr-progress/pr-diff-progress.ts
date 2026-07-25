import type { DiffHunk, LineInterval, PullRequestFileChange, ReviewContextState } from "../contracts/index";
import {
  type ReviewFileExclusionPolicy,
  type ReviewFileExclusionReason
} from "../file-exclusion/index";

/**
 * Immutable identity and changed-file payload for one exact pull-request comparison.
 *
 * `files` must have been parsed from the comparison identified by `baseSha` and `headSha`.
 * `originalDiffId` is the canonical `${baseSha}..${headSha}` key used by
 * `FileReviewState.originalReviewedByDiff`.
 */
export interface PullRequestDiffSnapshot {
  /** Stable review-context identity that owns this comparison. */
  readonly contextId: string;
  /** Base commit SHA from which the diff was generated. */
  readonly baseSha: string;
  /** Head commit SHA from which the diff was generated. */
  readonly headSha: string;
  /** Canonical original-side state key, exactly `${baseSha}..${headSha}`. */
  readonly originalDiffId: string;
  /** Changed files parsed from this exact base/head comparison. */
  readonly files: readonly PullRequestFileChange[];
}

/** Progress result for one PR changed file. */
export interface PullRequestDiffFileProgress {
  /** Stable file identity retained across an unambiguous rename. */
  readonly fileId: string;
  /** Path on the base/original side when present. */
  readonly oldPath?: string;
  /** Path on the head/modified side when present. */
  readonly newPath?: string;
  /** Git/GitHub change classification retained for later UI tasks. */
  readonly status: PullRequestFileChange["status"];
  /** Normalized display path chosen from the modified path, then original path. */
  readonly path: string;
  /** Source addition statistic, retained even when the file is excluded. */
  readonly additions: number;
  /** Source deletion statistic, retained even when the file is excluded. */
  readonly deletions: number;
  /** Reviewed changed lines included in the numerator; excluded files report zero. */
  readonly reviewedLineCount: number;
  /** Reviewable changed lines included in the denominator; excluded files report zero. */
  readonly totalLineCount: number;
  /** Ratio in `0..1`; a zero denominator is defined as `1`. */
  readonly progress: number;
  /** Whether the shared file-exclusion policy removed this file from aggregation. */
  readonly excluded: boolean;
  /** Stable exclusion reason when `excluded` is true. */
  readonly exclusionReason?: ReviewFileExclusionReason;
}

/** Aggregate PR progress and ordered per-file results. */
export interface PullRequestDiffProgress {
  /** Reviewed changed lines across included files. */
  readonly reviewedLineCount: number;
  /** Added plus deleted lines across included files. */
  readonly totalLineCount: number;
  /** Aggregate ratio in `0..1`; a zero denominator is defined as `1`. */
  readonly progress: number;
  /** Results in the same order as `diff.files`. */
  readonly files: readonly PullRequestDiffFileProgress[];
}

/** Input for one deterministic PR diff progress calculation. */
export interface CalculatePullRequestDiffProgressInput {
  /** Identity-bound diff snapshot; files cannot be supplied separately from their revision identity. */
  readonly diff: PullRequestDiffSnapshot;
  /** Persisted state for the same pull-request context; Global/branch/workspace state is rejected. */
  readonly reviewContext: ReviewContextState;
  /** Shared T300 exclusion-policy snapshot. */
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
};

const validateCoordinate = (value: number | undefined, label: string): number => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive one-based coordinate.`);
  }
  return value;
};

const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;

const validateContext = (state: ReviewContextState, diff: PullRequestDiffSnapshot): void => {
  if (state.kind !== "pull-request" || state.pullRequest === undefined) {
    throw new RangeError("Progress requires a pull-request context.");
  }
  if (state.contextId !== diff.contextId) {
    throw new RangeError("PR contextId mismatch.");
  }
  if (state.pullRequest.baseSha !== diff.baseSha || state.pullRequest.headSha !== diff.headSha) {
    throw new RangeError("PR context revision mismatch.");
  }
  const canonicalOriginalDiffId = `${diff.baseSha}..${diff.headSha}`;
  if (diff.originalDiffId !== canonicalOriginalDiffId) {
    throw new RangeError(`originalDiffId must equal ${canonicalOriginalDiffId}.`);
  }
};

const intervalCoordinates = (intervals: readonly LineInterval[], label: string): ReadonlySet<number> => {
  const result = new Set<number>();
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.startLine)
      || !Number.isSafeInteger(interval.endLineExclusive)
      || interval.startLine < 0
      || interval.endLineExclusive < interval.startLine) {
      throw new RangeError(`${label} intervals must be zero-based half-open ranges.`);
    }
    for (let line = interval.startLine; line < interval.endLineExclusive; line += 1) {
      result.add(line + 1);
    }
  }
  return result;
};

interface HunkEnd {
  readonly oldExclusive: number;
  readonly newExclusive: number;
}

const validateHunkLines = (
  fileId: string,
  hunk: DiffHunk,
  additions: Set<number>,
  deletions: Set<number>
): HunkEnd => {
  validateCount(hunk.oldStart, "Diff hunk oldStart");
  validateCount(hunk.newStart, "Diff hunk newStart");
  validateCount(hunk.oldCount, "Diff hunk oldCount");
  validateCount(hunk.newCount, "Diff hunk newCount");

  let oldCursor = hunk.oldStart;
  let newCursor = hunk.newStart;
  for (const line of hunk.lines) {
    if (line.kind === "context") {
      const oldLine = validateCoordinate(line.oldLine, `Context oldLine for ${fileId}`);
      const newLine = validateCoordinate(line.newLine, `Context newLine for ${fileId}`);
      if (oldLine !== oldCursor || newLine !== newCursor) {
        throw new RangeError(`Diff context coordinate mismatch for ${fileId}.`);
      }
      oldCursor += 1;
      newCursor += 1;
      continue;
    }

    if (line.kind === "deletion") {
      if (line.newLine !== undefined) {
        throw new RangeError(`Deletion must not have newLine for ${fileId}.`);
      }
      const oldLine = validateCoordinate(line.oldLine, `Deletion oldLine for ${fileId}`);
      if (oldLine !== oldCursor) {
        throw new RangeError(`Diff deletion coordinate mismatch for ${fileId}.`);
      }
      if (deletions.has(oldLine)) {
        throw new RangeError(`Duplicate deletion coordinate for ${fileId}: ${oldLine}`);
      }
      deletions.add(oldLine);
      oldCursor += 1;
      continue;
    }

    if (line.oldLine !== undefined) {
      throw new RangeError(`Addition must not have oldLine for ${fileId}.`);
    }
    const newLine = validateCoordinate(line.newLine, `Addition newLine for ${fileId}`);
    if (newLine !== newCursor) {
      throw new RangeError(`Diff addition coordinate mismatch for ${fileId}.`);
    }
    if (additions.has(newLine)) {
      throw new RangeError(`Duplicate addition coordinate for ${fileId}: ${newLine}`);
    }
    additions.add(newLine);
    newCursor += 1;
  }

  const expectedOldExclusive = hunk.oldStart + hunk.oldCount;
  const expectedNewExclusive = hunk.newStart + hunk.newCount;
  if (oldCursor !== expectedOldExclusive || newCursor !== expectedNewExclusive) {
    throw new RangeError(`Diff hunk header/body mismatch for ${fileId}.`);
  }
  return { oldExclusive: oldCursor, newExclusive: newCursor };
};

const changedCoordinates = (file: PullRequestFileChange): {
  readonly additions: ReadonlySet<number>;
  readonly deletions: ReadonlySet<number>;
} => {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  let previousEnd: HunkEnd | undefined;

  for (const hunk of file.hunks) {
    const end = validateHunkLines(file.fileId, hunk, additions, deletions);
    if (previousEnd !== undefined) {
      const oldGap = hunk.oldStart - previousEnd.oldExclusive;
      const newGap = hunk.newStart - previousEnd.newExclusive;
      if (oldGap < 0 || newGap < 0) {
        throw new RangeError(`Diff hunk order mismatch for ${file.fileId}.`);
      }
      if (oldGap !== newGap) {
        throw new RangeError(`Diff hunk gap mismatch for ${file.fileId}.`);
      }
    }
    previousEnd = end;
  }

  if (additions.size !== file.additions) {
    throw new RangeError(`PR diff addition statistics mismatch for ${file.fileId}.`);
  }
  if (deletions.size !== file.deletions) {
    throw new RangeError(`PR diff deletion statistics mismatch for ${file.fileId}.`);
  }
  return { additions, deletions };
};

const countIntersection = (reviewed: ReadonlySet<number>, changed: ReadonlySet<number>): number => {
  let count = 0;
  for (const coordinate of reviewed) {
    if (changed.has(coordinate)) count += 1;
  }
  return count;
};

const displayPath = (file: PullRequestFileChange): string => {
  const path = file.newPath ?? file.oldPath;
  if (path === undefined) throw new RangeError(`PR diff file ${file.fileId} has no path.`);
  return path;
};

/**
 * Calculates review progress for actual addition/deletion coordinates in one identity-bound PR diff snapshot.
 *
 * Persisted review intervals are zero-based and half-open; diff coordinates are validated as one-based.
 * Excluded files retain source statistics but contribute zero to the numerator and denominator.
 *
 * @param input Exact diff snapshot, matching PR review context, and exclusion policy.
 * @returns Aggregate and ordered per-file progress. A zero included denominator returns progress `1`.
 * @throws {RangeError} When context or revision identity differs, originalDiffId is non-canonical,
 * diff statistics or hunk coordinates are inconsistent, file identities are duplicated, review intervals are
 * malformed, or a changed file has no display path.
 */
export const calculatePullRequestDiffProgress = (
  input: Readonly<CalculatePullRequestDiffProgressInput>
): PullRequestDiffProgress => {
  validateContext(input.reviewContext, input.diff);
  const seenFileIds = new Set<string>();
  let aggregateReviewed = 0;
  let aggregateTotal = 0;
  const files: PullRequestDiffFileProgress[] = [];

  for (const file of input.diff.files) {
    validateCount(file.additions, "PR diff additions");
    validateCount(file.deletions, "PR diff deletions");
    if (seenFileIds.has(file.fileId)) {
      throw new RangeError(`Duplicate PR diff file: ${file.fileId}`);
    }
    seenFileIds.add(file.fileId);

    const decision = input.exclusionPolicy.evaluate({
      path: displayPath(file),
      isBinary: file.status === "binary"
    });
    const base = {
      fileId: file.fileId,
      oldPath: file.oldPath,
      newPath: file.newPath,
      status: file.status,
      path: decision.normalizedPath,
      additions: file.additions,
      deletions: file.deletions
    };

    if (decision.excluded) {
      files.push({
        ...base,
        reviewedLineCount: 0,
        totalLineCount: 0,
        progress: 1,
        excluded: true,
        exclusionReason: decision.reason
      });
      continue;
    }

    const actual = changedCoordinates(file);
    const state = input.reviewContext.files[file.fileId];
    if (state !== undefined && state.revisionId !== input.diff.headSha) {
      throw new RangeError(`File review revision mismatch for ${file.fileId}.`);
    }
    const reviewedAdditions = intervalCoordinates(state?.modifiedReviewed ?? [], "Modified reviewed");
    const reviewedDeletions = intervalCoordinates(
      state?.originalReviewedByDiff[input.diff.originalDiffId] ?? [],
      "Original reviewed"
    );
    const reviewedLineCount = countIntersection(reviewedAdditions, actual.additions)
      + countIntersection(reviewedDeletions, actual.deletions);
    const totalLineCount = file.additions + file.deletions;

    aggregateReviewed += reviewedLineCount;
    aggregateTotal += totalLineCount;
    files.push({
      ...base,
      reviewedLineCount,
      totalLineCount,
      progress: ratio(reviewedLineCount, totalLineCount),
      excluded: false
    });
  }

  return {
    reviewedLineCount: aggregateReviewed,
    totalLineCount: aggregateTotal,
    progress: ratio(aggregateReviewed, aggregateTotal),
    files
  };
};

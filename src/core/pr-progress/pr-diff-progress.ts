import {
  type ReviewFileExclusionPolicy,
  type ReviewFileExclusionReason
} from "../file-exclusion/index";

/** GitHub PR changed-file statistics needed by the progress calculator. */
export interface PullRequestDiffFile {
  /** Git-format repository-relative path at the side represented by the changed-file entry. */
  readonly path: string;
  /** Number of added lines reported for this file. */
  readonly additions: number;
  /** Number of deleted lines reported for this file. */
  readonly deletions: number;
  /** Whether the upstream diff classified this file as binary. */
  readonly isBinary: boolean;
}

/** Reviewed changed-line coordinates already classified by diff side. */
export interface ReviewedPullRequestDiffLines {
  /** Git-format repository-relative path matching one changed-file entry. */
  readonly path: string;
  /** Distinct RIGHT/head-side added line coordinates marked reviewed. */
  readonly addedLines: readonly number[];
  /** Distinct LEFT/base-side deleted line coordinates marked reviewed. */
  readonly deletedLines: readonly number[];
}

/** Progress result for one PR changed file. */
export interface PullRequestDiffFileProgress {
  /** Normalized repository-relative path. */
  readonly path: string;
  /** Reviewed added and deleted line count included in the numerator. */
  readonly reviewedLineCount: number;
  /** Added and deleted line count included in the denominator. */
  readonly totalLineCount: number;
  /** Ratio in the inclusive range 0..1. A zero denominator is 1. */
  readonly progress: number;
  /** Whether the shared exclusion policy omitted this file from aggregation. */
  readonly excluded: boolean;
  /** Stable reason supplied by the shared exclusion policy when excluded. */
  readonly exclusionReason?: ReviewFileExclusionReason;
}

/** Aggregate result over all included files in one PR. */
export interface PullRequestDiffProgress {
  /** Reviewed added and deleted line count across included files. */
  readonly reviewedLineCount: number;
  /** Added and deleted line count across included files. */
  readonly totalLineCount: number;
  /** Ratio in the inclusive range 0..1. A zero denominator is 1. */
  readonly progress: number;
  /** Per-file results in the same order as the input changed-file list. */
  readonly files: readonly PullRequestDiffFileProgress[];
}

/** Input for one deterministic PR diff progress calculation. */
export interface CalculatePullRequestDiffProgressInput {
  /** Changed files returned for the target pull request. */
  readonly files: readonly PullRequestDiffFile[];
  /** Reviewed added/deleted coordinates grouped by file and diff side. */
  readonly reviewedLines: readonly ReviewedPullRequestDiffLines[];
  /** Shared T300 exclusion policy snapshot. */
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
};

const countReviewedCoordinates = (
  coordinates: readonly number[],
  availableLineCount: number,
  label: string
): number => {
  const distinct = new Set<number>();
  for (const coordinate of coordinates) {
    if (!Number.isSafeInteger(coordinate) || coordinate < 1) {
      throw new RangeError(`${label} coordinates must be positive integers.`);
    }
    distinct.add(coordinate);
  }
  return Math.min(distinct.size, availableLineCount);
};

const ratio = (reviewedLineCount: number, totalLineCount: number): number =>
  totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount;

/**
 * Calculates PR review progress from added/deleted line totals only.
 *
 * Reviewed coordinates must already be filtered to changed lines and classified as RIGHT/head additions or
 * LEFT/base deletions. The calculator deduplicates them and caps each side at GitHub's reported side total.
 * Excluded files remain in the per-file result for reason display but contribute zero to both aggregate counts.
 */
export const calculatePullRequestDiffProgress = (
  input: Readonly<CalculatePullRequestDiffProgressInput>
): PullRequestDiffProgress => {
  const reviewedByPath = new Map<string, ReviewedPullRequestDiffLines>();
  for (const reviewed of input.reviewedLines) {
    const normalizedPath = input.exclusionPolicy.evaluate({ path: reviewed.path, isBinary: false }).normalizedPath;
    if (reviewedByPath.has(normalizedPath)) {
      throw new RangeError(`Duplicate reviewed PR diff file: ${normalizedPath}`);
    }
    reviewedByPath.set(normalizedPath, reviewed);
  }

  const seenFiles = new Set<string>();
  let aggregateReviewedLineCount = 0;
  let aggregateTotalLineCount = 0;
  const files: PullRequestDiffFileProgress[] = [];

  for (const file of input.files) {
    validateCount(file.additions, "PR diff additions");
    validateCount(file.deletions, "PR diff deletions");

    const decision = input.exclusionPolicy.evaluate({ path: file.path, isBinary: file.isBinary });
    if (seenFiles.has(decision.normalizedPath)) {
      throw new RangeError(`Duplicate PR diff file: ${decision.normalizedPath}`);
    }
    seenFiles.add(decision.normalizedPath);

    if (decision.excluded) {
      files.push({
        path: decision.normalizedPath,
        reviewedLineCount: 0,
        totalLineCount: 0,
        progress: 1,
        excluded: true,
        exclusionReason: decision.reason
      });
      continue;
    }

    const reviewed = reviewedByPath.get(decision.normalizedPath);
    const reviewedAddedLineCount = countReviewedCoordinates(
      reviewed?.addedLines ?? [],
      file.additions,
      "Reviewed added-line"
    );
    const reviewedDeletedLineCount = countReviewedCoordinates(
      reviewed?.deletedLines ?? [],
      file.deletions,
      "Reviewed deleted-line"
    );
    const reviewedLineCount = reviewedAddedLineCount + reviewedDeletedLineCount;
    const totalLineCount = file.additions + file.deletions;

    aggregateReviewedLineCount += reviewedLineCount;
    aggregateTotalLineCount += totalLineCount;
    files.push({
      path: decision.normalizedPath,
      reviewedLineCount,
      totalLineCount,
      progress: ratio(reviewedLineCount, totalLineCount),
      excluded: false
    });
  }

  return {
    reviewedLineCount: aggregateReviewedLineCount,
    totalLineCount: aggregateTotalLineCount,
    progress: ratio(aggregateReviewedLineCount, aggregateTotalLineCount),
    files
  };
};

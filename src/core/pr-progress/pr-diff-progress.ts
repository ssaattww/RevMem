import type { PullRequestFileChange } from "../contracts/index";
import {
  type ReviewFileExclusionPolicy,
  type ReviewFileExclusionReason
} from "../file-exclusion/index";

/** Reviewed PR-context changed-line coordinates grouped by stable file identity. */
export interface ReviewedPullRequestDiffLines {
  /** Stable file identity matching PullRequestFileChange.fileId. */
  readonly fileId: string;
  /** RIGHT/head-side line coordinates marked reviewed in the PR context. */
  readonly addedLines: readonly number[];
  /** LEFT/base-side line coordinates marked reviewed in the PR context. */
  readonly deletedLines: readonly number[];
}

/** Progress result for one PR changed file, retaining classification for later UI tasks. */
export interface PullRequestDiffFileProgress {
  readonly fileId: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly status: PullRequestFileChange["status"];
  readonly path: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly excluded: boolean;
  readonly exclusionReason?: ReviewFileExclusionReason;
}

/** Aggregate result over all included files in one PR. */
export interface PullRequestDiffProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly files: readonly PullRequestDiffFileProgress[];
}

/** Input for one deterministic PR diff progress calculation. */
export interface CalculatePullRequestDiffProgressInput {
  readonly files: readonly PullRequestFileChange[];
  /** PR-context state only. Global reviewed ranges are intentionally not accepted here. */
  readonly reviewedLines: readonly ReviewedPullRequestDiffLines[];
  readonly exclusionPolicy: ReviewFileExclusionPolicy;
}

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
};

const validateCoordinate = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} coordinates must be positive integers.`);
  }
};

const ratio = (reviewedLineCount: number, totalLineCount: number): number =>
  totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount;

const changedCoordinates = (file: PullRequestFileChange): {
  readonly additions: ReadonlySet<number>;
  readonly deletions: ReadonlySet<number>;
} => {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "addition") {
        if (line.newLine === undefined) throw new RangeError(`Addition is missing newLine for ${file.fileId}.`);
        validateCoordinate(line.newLine, "Diff addition");
        additions.add(line.newLine);
      } else if (line.kind === "deletion") {
        if (line.oldLine === undefined) throw new RangeError(`Deletion is missing oldLine for ${file.fileId}.`);
        validateCoordinate(line.oldLine, "Diff deletion");
        deletions.add(line.oldLine);
      }
    }
  }
  return { additions, deletions };
};

const countIntersection = (
  reviewed: readonly number[],
  changed: ReadonlySet<number>,
  label: string
): number => {
  const distinct = new Set<number>();
  for (const coordinate of reviewed) {
    validateCoordinate(coordinate, label);
    if (changed.has(coordinate)) distinct.add(coordinate);
  }
  return distinct.size;
};

const displayPath = (file: PullRequestFileChange): string => {
  const path = file.newPath ?? file.oldPath;
  if (path === undefined) throw new RangeError(`PR diff file ${file.fileId} has no path.`);
  return path;
};

/** Calculates PR progress from actual hunk additions/deletions and PR-context review state. */
export const calculatePullRequestDiffProgress = (
  input: Readonly<CalculatePullRequestDiffProgressInput>
): PullRequestDiffProgress => {
  const reviewedByFileId = new Map<string, ReviewedPullRequestDiffLines>();
  for (const reviewed of input.reviewedLines) {
    if (reviewedByFileId.has(reviewed.fileId)) {
      throw new RangeError(`Duplicate reviewed PR diff file: ${reviewed.fileId}`);
    }
    reviewedByFileId.set(reviewed.fileId, reviewed);
  }

  const seenFileIds = new Set<string>();
  let aggregateReviewedLineCount = 0;
  let aggregateTotalLineCount = 0;
  const files: PullRequestDiffFileProgress[] = [];

  for (const file of input.files) {
    validateCount(file.additions, "PR diff additions");
    validateCount(file.deletions, "PR diff deletions");
    if (seenFileIds.has(file.fileId)) throw new RangeError(`Duplicate PR diff file: ${file.fileId}`);
    seenFileIds.add(file.fileId);

    const path = displayPath(file);
    const decision = input.exclusionPolicy.evaluate({ path, isBinary: file.status === "binary" });
    const base = {
      fileId: file.fileId,
      oldPath: file.oldPath,
      newPath: file.newPath,
      status: file.status,
      path: decision.normalizedPath
    };

    if (decision.excluded) {
      files.push({ ...base, reviewedLineCount: 0, totalLineCount: 0, progress: 1, excluded: true, exclusionReason: decision.reason });
      continue;
    }

    const actual = changedCoordinates(file);
    const reviewed = reviewedByFileId.get(file.fileId);
    const reviewedLineCount = countIntersection(reviewed?.addedLines ?? [], actual.additions, "Reviewed added-line")
      + countIntersection(reviewed?.deletedLines ?? [], actual.deletions, "Reviewed deleted-line");
    const totalLineCount = file.additions + file.deletions;

    aggregateReviewedLineCount += reviewedLineCount;
    aggregateTotalLineCount += totalLineCount;
    files.push({ ...base, reviewedLineCount, totalLineCount, progress: ratio(reviewedLineCount, totalLineCount), excluded: false });
  }

  return {
    reviewedLineCount: aggregateReviewedLineCount,
    totalLineCount: aggregateTotalLineCount,
    progress: ratio(aggregateReviewedLineCount, aggregateTotalLineCount),
    files
  };
};

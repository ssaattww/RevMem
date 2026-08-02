import type {
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState
} from "../contracts/index";

/** Current repository-file evidence used to calculate Global understanding. */
export interface GlobalUnderstandingFileSnapshot {
  /** Canonical repository-relative path. */
  readonly path: string;
  /** Revision represented by the current file content. */
  readonly revisionId: string;
  /** Total logical line count, including empty lines. */
  readonly lineCount: number;
  /** Sorted zero-based line indexes whose trimmed content is non-empty. */
  readonly nonEmptyLines: readonly number[];
  /** Optional content hash; missing evidence makes matching Global state stale. */
  readonly contentHash?: string;
}

/** Whether Global state for one included file is usable by the current snapshot. */
export type GlobalUnderstandingFileState = "current" | "missing" | "stale";

/** Global-understanding progress for one included repository file. */
export interface GlobalUnderstandingFileProgress {
  /** Canonical repository-relative path. */
  readonly path: string;
  /** Current-state disposition used for the numerator. */
  readonly state: GlobalUnderstandingFileState;
  /** Reviewed non-empty lines that remain valid in the current snapshot. */
  readonly reviewedNonEmptyLineCount: number;
  /** Current non-empty lines in this included file. */
  readonly totalNonEmptyLineCount: number;
  /** Ratio in `0..1`; a zero denominator is defined as `1`. */
  readonly progress: number;
}

/** Repository aggregate with deterministic per-file results. */
export interface RepositoryGlobalUnderstandingProgress {
  /** Reviewed non-empty lines across included files. */
  readonly reviewedNonEmptyLineCount: number;
  /** Non-empty lines across included files. */
  readonly totalNonEmptyLineCount: number;
  /** Aggregate ratio; a zero denominator is defined as `1`. */
  readonly progress: number;
  /** Per-file results in locale-independent repository-path order. */
  readonly files: readonly GlobalUnderstandingFileProgress[];
}

/** Input for one file-level Global-understanding calculation. */
export interface CalculateGlobalUnderstandingFileProgressInput {
  /** Current file evidence. */
  readonly snapshot: GlobalUnderstandingFileSnapshot;
  /** Global state mapped to the same current path, when present. */
  readonly globalFile?: GlobalFileReviewState;
}

/** Input for repository-level Global-understanding calculation. */
export interface CalculateRepositoryGlobalUnderstandingProgressInput {
  /** Expected repository owner identity. */
  readonly repositoryId: string;
  /** Exact current revision represented by every supplied file snapshot. */
  readonly currentRevisionId: string;
  /** Persisted Global state for the repository. */
  readonly globalState: RepositoryGlobalState;
  /** Included repository files only; excluded files and pruned directories are omitted. */
  readonly files: readonly GlobalUnderstandingFileSnapshot[];
}

const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;

const compareRepositoryPaths = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
};

const validateSnapshot = (snapshot: GlobalUnderstandingFileSnapshot): void => {
  requireNonEmptyString(snapshot.path, "snapshot.path");
  requireNonEmptyString(snapshot.revisionId, "snapshot.revisionId");
  if (!Number.isSafeInteger(snapshot.lineCount) || snapshot.lineCount < 0) {
    throw new RangeError("snapshot.lineCount must be a non-negative integer.");
  }
  if (snapshot.contentHash !== undefined) {
    requireNonEmptyString(snapshot.contentHash, "snapshot.contentHash");
  }

  let previous = -1;
  for (const line of snapshot.nonEmptyLines) {
    if (!Number.isSafeInteger(line) || line < 0 || line >= snapshot.lineCount || line <= previous) {
      throw new RangeError(
        "snapshot.nonEmptyLines must be strictly increasing zero-based indexes within lineCount."
      );
    }
    previous = line;
  }
};

interface NormalizedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

const normalizeReviewed = (
  reviewed: readonly LineInterval[],
  lineCount: number
): readonly NormalizedInterval[] => {
  const sorted = reviewed.map((interval) => {
    if (
      !Number.isSafeInteger(interval.startLine) ||
      !Number.isSafeInteger(interval.endLineExclusive) ||
      interval.startLine < 0 ||
      interval.endLineExclusive <= interval.startLine ||
      interval.endLineExclusive > lineCount
    ) {
      throw new RangeError(
        "Global reviewed intervals must be non-empty zero-based half-open ranges within lineCount."
      );
    }
    return {
      startLine: interval.startLine,
      endLineExclusive: interval.endLineExclusive
    };
  }).sort((left, right) =>
    left.startLine - right.startLine || left.endLineExclusive - right.endLineExclusive
  );

  const merged: NormalizedInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || interval.startLine > previous.endLineExclusive) {
      merged.push(interval);
    } else if (interval.endLineExclusive > previous.endLineExclusive) {
      merged[merged.length - 1] = {
        startLine: previous.startLine,
        endLineExclusive: interval.endLineExclusive
      };
    }
  }
  return merged;
};

const isCurrentGlobalFile = (
  snapshot: GlobalUnderstandingFileSnapshot,
  globalFile: GlobalFileReviewState
): boolean => {
  if (globalFile.currentPath !== snapshot.path || globalFile.revisionId !== snapshot.revisionId) {
    return false;
  }
  return snapshot.contentHash !== undefined &&
    globalFile.contentHash !== undefined &&
    snapshot.contentHash === globalFile.contentHash;
};

const countReviewedNonEmptyLines = (
  nonEmptyLines: readonly number[],
  intervals: readonly NormalizedInterval[]
): number => {
  let reviewed = 0;
  let intervalIndex = 0;
  for (const line of nonEmptyLines) {
    while (
      intervalIndex < intervals.length &&
      line >= intervals[intervalIndex]!.endLineExclusive
    ) {
      intervalIndex += 1;
    }
    const interval = intervals[intervalIndex];
    if (interval !== undefined && line >= interval.startLine) reviewed += 1;
  }
  return reviewed;
};

/** Calculates Global-understanding progress for one included file. */
export const calculateGlobalUnderstandingFileProgress = (
  input: CalculateGlobalUnderstandingFileProgressInput
): GlobalUnderstandingFileProgress => {
  validateSnapshot(input.snapshot);
  const total = input.snapshot.nonEmptyLines.length;
  if (input.globalFile === undefined) {
    return {
      path: input.snapshot.path,
      state: "missing",
      reviewedNonEmptyLineCount: 0,
      totalNonEmptyLineCount: total,
      progress: ratio(0, total)
    };
  }

  if (!isCurrentGlobalFile(input.snapshot, input.globalFile)) {
    return {
      path: input.snapshot.path,
      state: "stale",
      reviewedNonEmptyLineCount: 0,
      totalNonEmptyLineCount: total,
      progress: ratio(0, total)
    };
  }

  const reviewed = countReviewedNonEmptyLines(
    input.snapshot.nonEmptyLines,
    normalizeReviewed(input.globalFile.reviewed, input.snapshot.lineCount)
  );
  return {
    path: input.snapshot.path,
    state: "current",
    reviewedNonEmptyLineCount: reviewed,
    totalNonEmptyLineCount: total,
    progress: ratio(reviewed, total)
  };
};

/** Aggregates already-calculated included-file progress in deterministic path order. */
export const aggregateRepositoryGlobalUnderstandingProgress = (
  files: readonly GlobalUnderstandingFileProgress[]
): RepositoryGlobalUnderstandingProgress => {
  const sorted = [...files].sort((left, right) => compareRepositoryPaths(left.path, right.path));
  const paths = new Set<string>();
  let reviewed = 0;
  let total = 0;
  for (const file of sorted) {
    requireNonEmptyString(file.path, "file.path");
    if (paths.has(file.path)) {
      throw new RangeError(`duplicate Global understanding path: ${file.path}`);
    }
    paths.add(file.path);
    if (
      !Number.isSafeInteger(file.reviewedNonEmptyLineCount) ||
      !Number.isSafeInteger(file.totalNonEmptyLineCount) ||
      file.reviewedNonEmptyLineCount < 0 ||
      file.totalNonEmptyLineCount < file.reviewedNonEmptyLineCount
    ) {
      throw new RangeError(`Invalid Global understanding counts for ${file.path}.`);
    }
    reviewed += file.reviewedNonEmptyLineCount;
    total += file.totalNonEmptyLineCount;
  }
  return {
    reviewedNonEmptyLineCount: reviewed,
    totalNonEmptyLineCount: total,
    progress: ratio(reviewed, total),
    files: sorted
  };
};

/** Calculates repository-level Global understanding from included current-file snapshots. */
export const calculateRepositoryGlobalUnderstandingProgress = (
  input: CalculateRepositoryGlobalUnderstandingProgressInput
): RepositoryGlobalUnderstandingProgress => {
  requireNonEmptyString(input.repositoryId, "repositoryId");
  requireNonEmptyString(input.currentRevisionId, "currentRevisionId");
  if (input.globalState.repositoryId !== input.repositoryId) {
    throw new RangeError("Global repositoryId mismatch.");
  }
  if (input.globalState.currentRevisionId !== input.currentRevisionId) {
    throw new RangeError("Global currentRevisionId mismatch.");
  }

  const globalByPath = new Map<string, GlobalFileReviewState>();
  for (const globalFile of Object.values(input.globalState.files)) {
    requireNonEmptyString(globalFile.currentPath, "Global currentPath");
    if (globalByPath.has(globalFile.currentPath)) {
      throw new RangeError(`duplicate Global currentPath: ${globalFile.currentPath}`);
    }
    globalByPath.set(globalFile.currentPath, globalFile);
  }

  const snapshots = new Set<string>();
  const files = input.files.map((file) => {
    if (file.revisionId !== input.currentRevisionId) {
      throw new RangeError(`File snapshot revision mismatch for ${file.path}.`);
    }
    if (snapshots.has(file.path)) {
      throw new RangeError(`duplicate Global understanding snapshot path: ${file.path}`);
    }
    snapshots.add(file.path);
    return calculateGlobalUnderstandingFileProgress({
      snapshot: file,
      globalFile: globalByPath.get(file.path)
    });
  });
  return aggregateRepositoryGlobalUnderstandingProgress(files);
};

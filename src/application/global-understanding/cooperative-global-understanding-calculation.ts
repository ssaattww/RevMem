import type {
  GlobalFileReviewState,
  LineInterval
} from "../../core/contracts/index";
import type {
  GlobalUnderstandingFileProgress,
  GlobalUnderstandingFileSnapshot
} from "../../core/global-understanding/index";

/** Exact evidence represented as bounded canonical parts for cooperative comparison. */
export interface GlobalUnderstandingEvidenceKey {
  readonly parts: readonly string[];
}

/** Scheduler and item budget for post-load Global-understanding work. */
export interface GlobalUnderstandingCalculationWorkOptions {
  readonly maxWorkItems: number;
  readonly yieldControl: () => void | Promise<void>;
}

/** Loaded evidence required to build one exact cache key. */
export interface GlobalUnderstandingEvidenceSnapshot extends GlobalUnderstandingFileSnapshot {
  readonly cacheKey: string;
}

/** Input for exact cooperative cache-evidence construction. */
export interface BuildGlobalUnderstandingEvidenceKeyInput {
  readonly repositoryId: string;
  readonly currentRevisionId: string;
  readonly configurationKey: string;
  readonly includedPath: string;
  readonly includedNonEmptyLineCount: number;
  readonly loaded: GlobalUnderstandingEvidenceSnapshot;
  readonly globalFile?: GlobalFileReviewState;
}

interface NormalizedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
};

const validateWorkOptions = (options: GlobalUnderstandingCalculationWorkOptions): void => {
  if (!Number.isSafeInteger(options.maxWorkItems) || options.maxWorkItems <= 0) {
    throw new RangeError("maxWorkItems must be a positive integer.");
  }
};

class CooperativeWorkCounter {
  private pending = 0;

  public constructor(
    private readonly options: GlobalUnderstandingCalculationWorkOptions
  ) {
    validateWorkOptions(options);
  }

  public async step(): Promise<void> {
    this.pending += 1;
    if (this.pending >= this.options.maxWorkItems) {
      this.pending = 0;
      await this.options.yieldControl();
    }
  }
}

/** Builds an exact cache key without flattening every reviewed interval in one synchronous operation. */
export const buildGlobalUnderstandingEvidenceKey = async (
  input: BuildGlobalUnderstandingEvidenceKeyInput,
  options: GlobalUnderstandingCalculationWorkOptions
): Promise<GlobalUnderstandingEvidenceKey> => {
  const parts: string[] = [JSON.stringify([
    input.repositoryId,
    input.currentRevisionId,
    input.configurationKey,
    input.includedPath,
    input.includedNonEmptyLineCount,
    input.loaded.cacheKey,
    input.loaded.contentHash ?? null,
    input.loaded.lineCount,
    input.globalFile === undefined ? null : [
      input.globalFile.fileId,
      input.globalFile.currentPath,
      input.globalFile.revisionId,
      input.globalFile.contentHash ?? null
    ]
  ])];
  const counter = new CooperativeWorkCounter(options);
  for (const interval of input.globalFile?.reviewed ?? []) {
    parts.push(`${interval.startLine}:${interval.endLineExclusive}`);
    await counter.step();
  }
  return { parts };
};

/** Compares exact cache evidence with cooperative checkpoints across large interval sets. */
export const globalUnderstandingEvidenceKeysEqual = async (
  left: GlobalUnderstandingEvidenceKey,
  right: GlobalUnderstandingEvidenceKey,
  options: GlobalUnderstandingCalculationWorkOptions
): Promise<boolean> => {
  if (left.parts.length !== right.parts.length) return false;
  const counter = new CooperativeWorkCounter(options);
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return false;
    await counter.step();
  }
  return true;
};

const validateSnapshot = async (
  snapshot: GlobalUnderstandingFileSnapshot,
  counter: CooperativeWorkCounter
): Promise<void> => {
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
    await counter.step();
  }
};

const compareIntervals = (left: NormalizedInterval, right: NormalizedInterval): number =>
  left.startLine - right.startLine || left.endLineExclusive - right.endLineExclusive;

const copyAndValidateIntervals = async (
  reviewed: readonly LineInterval[],
  lineCount: number,
  counter: CooperativeWorkCounter
): Promise<NormalizedInterval[]> => {
  const copied: NormalizedInterval[] = [];
  for (const interval of reviewed) {
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
    copied.push({
      startLine: interval.startLine,
      endLineExclusive: interval.endLineExclusive
    });
    await counter.step();
  }
  return copied;
};

const cooperativeMergeSort = async (
  intervals: NormalizedInterval[],
  counter: CooperativeWorkCounter
): Promise<NormalizedInterval[]> => {
  if (intervals.length < 2) return intervals;
  let source = intervals;
  let target = new Array<NormalizedInterval>(intervals.length);
  for (let width = 1; width < intervals.length; width *= 2) {
    for (let left = 0; left < intervals.length; left += width * 2) {
      const middle = Math.min(left + width, intervals.length);
      const right = Math.min(left + width * 2, intervals.length);
      let leftIndex = left;
      let rightIndex = middle;
      for (let output = left; output < right; output += 1) {
        if (
          leftIndex < middle &&
          (rightIndex >= right || compareIntervals(source[leftIndex]!, source[rightIndex]!) <= 0)
        ) {
          target[output] = source[leftIndex]!;
          leftIndex += 1;
        } else {
          target[output] = source[rightIndex]!;
          rightIndex += 1;
        }
        await counter.step();
      }
    }
    const previousSource = source;
    source = target;
    target = previousSource;
  }
  return source;
};

const mergeIntervals = async (
  sorted: readonly NormalizedInterval[],
  counter: CooperativeWorkCounter
): Promise<NormalizedInterval[]> => {
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
    await counter.step();
  }
  return merged;
};

const countReviewedNonEmptyLines = async (
  nonEmptyLines: readonly number[],
  intervals: readonly NormalizedInterval[],
  counter: CooperativeWorkCounter
): Promise<number> => {
  let reviewed = 0;
  let intervalIndex = 0;
  for (const line of nonEmptyLines) {
    while (
      intervalIndex < intervals.length &&
      line >= intervals[intervalIndex]!.endLineExclusive
    ) {
      intervalIndex += 1;
      await counter.step();
    }
    const interval = intervals[intervalIndex];
    if (interval !== undefined && line >= interval.startLine) reviewed += 1;
    await counter.step();
  }
  return reviewed;
};

const isCurrentGlobalFile = (
  snapshot: GlobalUnderstandingFileSnapshot,
  globalFile: GlobalFileReviewState
): boolean => globalFile.currentPath === snapshot.path &&
  globalFile.revisionId === snapshot.revisionId &&
  snapshot.contentHash !== undefined &&
  globalFile.contentHash !== undefined &&
  snapshot.contentHash === globalFile.contentHash;

/** Calculates one file's progress with bounded scheduler checkpoints after source loading. */
export const calculateGlobalUnderstandingFileProgressCooperatively = async (
  snapshot: GlobalUnderstandingFileSnapshot,
  globalFile: GlobalFileReviewState | undefined,
  options: GlobalUnderstandingCalculationWorkOptions
): Promise<GlobalUnderstandingFileProgress> => {
  const counter = new CooperativeWorkCounter(options);
  await validateSnapshot(snapshot, counter);
  const total = snapshot.nonEmptyLines.length;
  if (globalFile === undefined) {
    return {
      path: snapshot.path,
      state: "missing",
      reviewedNonEmptyLineCount: 0,
      totalNonEmptyLineCount: total,
      progress: ratio(0, total)
    };
  }
  if (!isCurrentGlobalFile(snapshot, globalFile)) {
    return {
      path: snapshot.path,
      state: "stale",
      reviewedNonEmptyLineCount: 0,
      totalNonEmptyLineCount: total,
      progress: ratio(0, total)
    };
  }

  const copied = await copyAndValidateIntervals(globalFile.reviewed, snapshot.lineCount, counter);
  const sorted = await cooperativeMergeSort(copied, counter);
  const normalized = await mergeIntervals(sorted, counter);
  const reviewed = await countReviewedNonEmptyLines(snapshot.nonEmptyLines, normalized, counter);
  return {
    path: snapshot.path,
    state: "current",
    reviewedNonEmptyLineCount: reviewed,
    totalNonEmptyLineCount: total,
    progress: ratio(reviewed, total)
  };
};

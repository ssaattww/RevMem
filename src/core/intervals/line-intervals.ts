import type { LineInterval } from "../contracts/index";

/**
 * Validates one zero-based line boundary used by a half-open interval.
 */
function assertLineBoundary(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

/**
 * Orders one half-open interval and removes intervals with zero length.
 *
 * @param interval Interval whose endpoints may be reversed.
 * @returns A normalized interval, or `undefined` when both endpoints are equal.
 * @throws {RangeError} If either endpoint is not a non-negative safe integer.
 */
export function normalizeLineInterval(interval: LineInterval): LineInterval | undefined {
  assertLineBoundary(interval.startLine, "startLine");
  assertLineBoundary(interval.endLineExclusive, "endLineExclusive");

  if (interval.startLine === interval.endLineExclusive) {
    return undefined;
  }

  return interval.startLine < interval.endLineExclusive
    ? {
        startLine: interval.startLine,
        endLineExclusive: interval.endLineExclusive
      }
    : {
        startLine: interval.endLineExclusive,
        endLineExclusive: interval.startLine
      };
}

/**
 * Calculates the number of lines in one half-open interval.
 *
 * @param interval Interval to measure.
 * @returns The interval length after endpoint normalization.
 * @throws {RangeError} If either interval endpoint is not a non-negative safe integer.
 */
export function lineIntervalLength(interval: LineInterval): number {
  const normalized = normalizeLineInterval(interval);
  return normalized === undefined
    ? 0
    : normalized.endLineExclusive - normalized.startLine;
}

/**
 * Sorts intervals, removes empty intervals, and joins every overlap or adjacency.
 *
 * @param intervals Intervals in any order.
 * @returns New normalized intervals ordered by `startLine`.
 * @throws {RangeError} If any interval endpoint is not a non-negative safe integer.
 */
export function normalizeLineIntervals(
  intervals: readonly LineInterval[]
): LineInterval[] {
  const normalized = intervals
    .map(normalizeLineInterval)
    .filter((value): value is LineInterval => value !== undefined)
    .sort(
      (left, right) =>
        left.startLine - right.startLine ||
        left.endLineExclusive - right.endLineExclusive
    );

  const result: LineInterval[] = [];

  for (const current of normalized) {
    const previous = result.at(-1);

    if (previous === undefined || current.startLine > previous.endLineExclusive) {
      result.push({ ...current });
      continue;
    }

    previous.endLineExclusive = Math.max(
      previous.endLineExclusive,
      current.endLineExclusive
    );
  }

  return result;
}

/**
 * Finds the normalized interval that contains one zero-based line using binary search.
 *
 * @param intervals Sorted, non-overlapping normalized intervals. Callers must
 * provide this normalized form; this binary-search operation does not validate
 * or normalize the array.
 * @param line Zero-based line number to find.
 * @returns The containing interval, or `undefined` when the line is not reviewed.
 * @throws {RangeError} If `line` is not a non-negative safe integer.
 */
export function findLineIntervalContainingLine(
  intervals: readonly LineInterval[],
  line: number
): LineInterval | undefined {
  assertLineBoundary(line, "line");

  let lower = 0;
  let upper = intervals.length - 1;

  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const interval = intervals[middle];

    if (interval === undefined) {
      return undefined;
    }

    if (line < interval.startLine) {
      upper = middle - 1;
    } else if (line >= interval.endLineExclusive) {
      lower = middle + 1;
    } else {
      return interval;
    }
  }

  return undefined;
}

/**
 * Removes intervals from reviewed intervals while preserving unaffected fragments.
 *
 * @param intervals Reviewed intervals to subtract from.
 * @param intervalsToSubtract Intervals that must become unreviewed.
 * @returns Normalized remaining intervals, including split fragments.
 * @throws {RangeError} If any source or removal interval endpoint is not a
 * non-negative safe integer.
 */
export function subtractLineIntervals(
  intervals: readonly LineInterval[],
  intervalsToSubtract: readonly LineInterval[]
): LineInterval[] {
  const sources = normalizeLineIntervals(intervals);
  const removals = normalizeLineIntervals(intervalsToSubtract);
  const result: LineInterval[] = [];
  let firstRelevantRemoval = 0;

  for (const source of sources) {
    while (
      firstRelevantRemoval < removals.length &&
      removals[firstRelevantRemoval]!.endLineExclusive <= source.startLine
    ) {
      firstRelevantRemoval += 1;
    }

    let cursor = source.startLine;
    let removalIndex = firstRelevantRemoval;

    while (
      removalIndex < removals.length &&
      removals[removalIndex]!.startLine < source.endLineExclusive
    ) {
      const removal = removals[removalIndex]!;

      if (removal.startLine > cursor) {
        result.push({
          startLine: cursor,
          endLineExclusive: Math.min(removal.startLine, source.endLineExclusive)
        });
      }

      cursor = Math.max(cursor, removal.endLineExclusive);
      if (cursor >= source.endLineExclusive) {
        break;
      }

      removalIndex += 1;
    }

    if (cursor < source.endLineExclusive) {
      result.push({
        startLine: cursor,
        endLineExclusive: source.endLineExclusive
      });
    }

    while (
      firstRelevantRemoval < removals.length &&
      removals[firstRelevantRemoval]!.endLineExclusive <= source.endLineExclusive
    ) {
      firstRelevantRemoval += 1;
    }
  }

  return result;
}

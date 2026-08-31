import type { DiffHunk, LineInterval } from "../../core/contracts/index";
import { normalizeLineIntervals } from "../../core/intervals/index";

/** One contiguous original-side interval that survives at a contiguous modified-side location. */
export interface OriginalIntervalMapping {
  readonly original: LineInterval;
  readonly modifiedStartLine: number;
}

/** Session-oriented representation of one original-to-modified line mapping. */
export interface OriginalStartLineMapping {
  readonly originalStartLine: number;
  readonly modifiedStartLine: number;
  readonly lineCount: number;
}

/** One validated representation of an original-side line mapping. */
export type OriginalToModifiedLineMapping = OriginalIntervalMapping | OriginalStartLineMapping;

/** Immutable original-side projection for one exact file comparison. */
export interface OriginalSideLineProjection {
  readonly originalToModifiedLineMappings: OriginalStartLineMapping[];
  readonly originalDeletionIntervals: LineInterval[];
}

/** Review ranges separated into current modified and original-only comparison state. */
export interface OriginalSelectionReviewPlan {
  readonly modifiedIntervals: LineInterval[];
  readonly originalDeletionIntervals: LineInterval[];
}

const requireNonNegativeSafeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
};

const requireExpectedLine = (value: number | undefined, expected: number, name: string): void => {
  if (value === undefined || value - 1 !== expected) {
    throw new Error(`${name} does not match the immutable diff cursor.`);
  }
};

const hunkStartIndex = (start: number, count: number, name: string): number => {
  requireNonNegativeSafeInteger(count, `${name} count`);
  if (!Number.isSafeInteger(start) || (count > 0 && start < 1) || (count === 0 && start < 0)) {
    throw new RangeError(`${name} contains an invalid hunk range.`);
  }

  return count === 0 ? start : start - 1;
};

const appendMapping = (
  mappings: OriginalIntervalMapping[],
  originalStartLine: number,
  modifiedStartLine: number,
  lineCount: number
): void => {
  if (lineCount === 0) return;

  const previous = mappings.at(-1);
  if (
    previous !== undefined &&
    previous.original.endLineExclusive === originalStartLine &&
    previous.modifiedStartLine + previous.original.endLineExclusive - previous.original.startLine === modifiedStartLine
  ) {
    mappings[mappings.length - 1] = {
      original: { startLine: previous.original.startLine, endLineExclusive: originalStartLine + lineCount },
      modifiedStartLine: previous.modifiedStartLine
    };
    return;
  }

  mappings.push({
    original: { startLine: originalStartLine, endLineExclusive: originalStartLine + lineCount },
    modifiedStartLine
  });
};

/**
 * Derives exact surviving-line mappings from a complete immutable diff.
 *
 * Additions and deletions, including replacement blocks, are never guessed to
 * correspond. Malformed, unordered, or incomplete hunk evidence is rejected.
 */
export const createOriginalToModifiedLineMappings = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): OriginalIntervalMapping[] => {
  requireNonNegativeSafeInteger(input.originalLineCount, "originalLineCount");
  requireNonNegativeSafeInteger(input.modifiedLineCount, "modifiedLineCount");

  const mappings: OriginalIntervalMapping[] = [];
  let originalCursor = 0;
  let modifiedCursor = 0;

  for (const hunk of input.hunks) {
    const originalStart = hunkStartIndex(hunk.oldStart, hunk.oldCount, "original side");
    const modifiedStart = hunkStartIndex(hunk.newStart, hunk.newCount, "modified side");
    if (originalStart < originalCursor || modifiedStart < modifiedCursor) {
      throw new Error("Immutable diff hunks must be ordered and non-overlapping.");
    }

    const originalGap = originalStart - originalCursor;
    const modifiedGap = modifiedStart - modifiedCursor;
    if (originalGap !== modifiedGap) {
      throw new Error("Immutable diff gap does not preserve a one-to-one context mapping.");
    }
    appendMapping(mappings, originalCursor, modifiedCursor, originalGap);
    originalCursor = originalStart;
    modifiedCursor = modifiedStart;

    let consumedOriginal = 0;
    let consumedModified = 0;
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        requireExpectedLine(line.oldLine, originalCursor, "Context oldLine");
        requireExpectedLine(line.newLine, modifiedCursor, "Context newLine");
        appendMapping(mappings, originalCursor, modifiedCursor, 1);
        originalCursor += 1;
        modifiedCursor += 1;
        consumedOriginal += 1;
        consumedModified += 1;
      } else if (line.kind === "deletion") {
        requireExpectedLine(line.oldLine, originalCursor, "Deletion oldLine");
        originalCursor += 1;
        consumedOriginal += 1;
      } else if (line.kind === "addition") {
        requireExpectedLine(line.newLine, modifiedCursor, "Addition newLine");
        modifiedCursor += 1;
        consumedModified += 1;
      } else {
        throw new Error("Immutable diff contains an unsupported line kind.");
      }
    }

    if (consumedOriginal !== hunk.oldCount || consumedModified !== hunk.newCount) {
      throw new Error("Immutable diff hunk body does not match its declared line counts.");
    }
  }

  if (originalCursor > input.originalLineCount || modifiedCursor > input.modifiedLineCount) {
    throw new Error("Immutable diff exceeds a document line count.");
  }

  const originalTail = input.originalLineCount - originalCursor;
  const modifiedTail = input.modifiedLineCount - modifiedCursor;
  if (originalTail !== modifiedTail) {
    throw new Error("Immutable diff tail does not preserve a one-to-one context mapping.");
  }
  appendMapping(mappings, originalCursor, modifiedCursor, originalTail);
  return mappings;
};

const intervalOf = (mapping: OriginalToModifiedLineMapping): LineInterval => {
  if ("original" in mapping) return mapping.original;

  requireNonNegativeSafeInteger(mapping.originalStartLine, "originalStartLine");
  requireNonNegativeSafeInteger(mapping.lineCount, "lineCount");
  return {
    startLine: mapping.originalStartLine,
    endLineExclusive: mapping.originalStartLine + mapping.lineCount
  };
};

const validateMappings = (
  mappings: readonly OriginalToModifiedLineMapping[]
): OriginalToModifiedLineMapping[] => {
  let previousOriginalEnd = 0;
  let previousModifiedEnd = 0;

  return mappings.map((mapping) => {
    const original = intervalOf(mapping);
    requireNonNegativeSafeInteger(original.startLine, "original mapping startLine");
    requireNonNegativeSafeInteger(original.endLineExclusive, "original mapping endLineExclusive");
    requireNonNegativeSafeInteger(mapping.modifiedStartLine, "modifiedStartLine");
    if (original.endLineExclusive <= original.startLine) {
      throw new RangeError("Original mappings must have a positive line count.");
    }
    if (original.startLine < previousOriginalEnd || mapping.modifiedStartLine < previousModifiedEnd) {
      throw new Error("Original mappings must be ordered and non-overlapping.");
    }

    const lineCount = original.endLineExclusive - original.startLine;
    previousOriginalEnd = original.endLineExclusive;
    previousModifiedEnd = mapping.modifiedStartLine + lineCount;
    return mapping;
  });
};

const intersectIntervals = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): LineInterval[] => normalizeLineIntervals(left.flatMap((selection) =>
  right.flatMap((candidate) => {
    const startLine = Math.max(selection.startLine, candidate.startLine);
    const endLineExclusive = Math.min(selection.endLineExclusive, candidate.endLineExclusive);
    return startLine < endLineExclusive ? [{ startLine, endLineExclusive }] : [];
  })
));

/**
 * Separates original-side selections into modified current lines and
 * original-only deletion lines without inferring a replacement mapping.
 */
export const createOriginalSelectionReviewPlan = (input: {
  readonly selections: readonly LineInterval[];
  readonly originalDeletionIntervals: readonly LineInterval[];
  readonly originalToModifiedLineMappings: readonly OriginalToModifiedLineMapping[];
}): OriginalSelectionReviewPlan => {
  const selections = normalizeLineIntervals(input.selections);
  const originalDeletionIntervals = intersectIntervals(selections, input.originalDeletionIntervals);
  const mappings = validateMappings(input.originalToModifiedLineMappings);
  const modifiedIntervals = normalizeLineIntervals(selections.flatMap((selection) =>
    mappings.flatMap((mapping) => {
      const original = intervalOf(mapping);
      const startLine = Math.max(selection.startLine, original.startLine);
      const endLineExclusive = Math.min(selection.endLineExclusive, original.endLineExclusive);
      if (startLine >= endLineExclusive) return [];

      const modifiedStartLine = mapping.modifiedStartLine + startLine - original.startLine;
      return [{
        startLine: modifiedStartLine,
        endLineExclusive: modifiedStartLine + endLineExclusive - startLine
      }];
    })
  ));

  return { modifiedIntervals, originalDeletionIntervals };
};

/** Builds the session-oriented original-side projection from validated immutable hunk evidence. */
export const buildOriginalSideLineProjection = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): OriginalSideLineProjection => ({
  originalToModifiedLineMappings: createOriginalToModifiedLineMappings(input).map((mapping) => ({
    originalStartLine: mapping.original.startLine,
    modifiedStartLine: mapping.modifiedStartLine,
    lineCount: mapping.original.endLineExclusive - mapping.original.startLine
  })),
  originalDeletionIntervals: normalizeLineIntervals(input.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) => line.kind === "deletion" && line.oldLine !== undefined
      ? [{ startLine: line.oldLine - 1, endLineExclusive: line.oldLine }]
      : [])
  ))
});

/** Applies selections to a previously validated immutable original-side projection. */
export const projectOriginalSelectionIntervals = (
  selections: readonly LineInterval[],
  projection: Readonly<OriginalSideLineProjection>
): OriginalSelectionReviewPlan => createOriginalSelectionReviewPlan({
  selections,
  originalDeletionIntervals: projection.originalDeletionIntervals,
  originalToModifiedLineMappings: projection.originalToModifiedLineMappings
});

/** Derives the session-compatible surviving original-to-modified line mappings. */
export const deriveOriginalToModifiedLineMappings = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): OriginalStartLineMapping[] => buildOriginalSideLineProjection(input).originalToModifiedLineMappings;

/** Projects original-side intervals through already validated session-compatible mappings. */
export const projectOriginalIntervalsToModified = (
  intervals: readonly LineInterval[],
  originalToModifiedLineMappings: readonly OriginalStartLineMapping[]
): LineInterval[] => createOriginalSelectionReviewPlan({
  selections: intervals,
  originalDeletionIntervals: [],
  originalToModifiedLineMappings
}).modifiedIntervals;

import type { LineInterval } from "../../core/contracts/index";
import {
  normalizeLineIntervals,
  selectionsToLineIntervals,
  type TextSelection,
} from "../../core/intervals/index";
import type { ChangeBlock } from "./change-blocks";
import {
  projectOriginalIntervalsToModified,
  type OriginalStartLineMapping,
} from "./original-selection-review-plan";

/** Side whose editor supplies the raw selection. */
export type DiffSelectionSide = "original" | "modified";

/** Immutable ranges that one selection operation must apply to each existing side. */
export interface DiffSelectionTargetPlan {
  readonly originalIntervals: LineInterval[];
  readonly modifiedIntervals: LineInterval[];
}

const requireContentLineCount = (contentLineCount: number, name: string): void => {
  if (!Number.isSafeInteger(contentLineCount) || contentLineCount < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
};

const clipToContent = (
  selections: readonly LineInterval[],
  contentLineCount: number,
): LineInterval[] => normalizeLineIntervals(selections.flatMap((selection) => {
  const endLineExclusive = Math.min(selection.endLineExclusive, contentLineCount);
  return selection.startLine < endLineExclusive
    ? [{ startLine: selection.startLine, endLineExclusive }]
    : [];
}));

const intersects = (left: LineInterval, right: LineInterval): boolean =>
  left.startLine < right.endLineExclusive && right.startLine < left.endLineExclusive;

const blockRangeFor = (block: ChangeBlock, side: DiffSelectionSide): LineInterval | undefined =>
  side === "original" ? block.original : block.modified;

const validateBlockRange = (range: LineInterval | undefined, contentLineCount: number): void => {
  if (range === undefined) return;
  if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLineExclusive) ||
    range.startLine < 0 || range.startLine >= range.endLineExclusive || range.endLineExclusive > contentLineCount) {
    throw new RangeError("change block range must stay within its Git content line count.");
  }
};

/**
 * Converts one operated-side editor selection into immutable original and modified target ranges.
 *
 * The function is operation-neutral so marking and unmarking share exactly the same target determination.
 */
export const createDiffSelectionTargetPlan = (input: {
  readonly side: DiffSelectionSide;
  readonly selections: readonly TextSelection[];
  readonly editorLineCount: number;
  readonly originalContentLineCount: number;
  readonly modifiedContentLineCount: number;
  readonly changeBlocks: readonly ChangeBlock[];
  readonly originalToModifiedLineMappings: readonly OriginalStartLineMapping[];
}): DiffSelectionTargetPlan => {
  const editorSelections = selectionsToLineIntervals(input.selections, input.editorLineCount);
  requireContentLineCount(input.originalContentLineCount, "originalContentLineCount");
  requireContentLineCount(input.modifiedContentLineCount, "modifiedContentLineCount");
  const operatedContentLineCount = input.side === "original"
    ? input.originalContentLineCount
    : input.modifiedContentLineCount;
  if (operatedContentLineCount > input.editorLineCount) {
    throw new RangeError("operated-side content line count must not exceed editorLineCount.");
  }
  const contentSelections = clipToContent(editorSelections, operatedContentLineCount);
  if (contentSelections.length === 0) return { originalIntervals: [], modifiedIntervals: [] };

  for (const block of input.changeBlocks) {
    validateBlockRange(block.original, input.originalContentLineCount);
    validateBlockRange(block.modified, input.modifiedContentLineCount);
  }
  const touchedBlocks = input.changeBlocks.filter((block) => {
    const operatedRange = blockRangeFor(block, input.side);
    return operatedRange !== undefined && contentSelections.some((selection) => intersects(selection, operatedRange));
  });

  const originalBlockIntervals = touchedBlocks.flatMap((block) => block.original === undefined ? [] : [block.original]);
  const modifiedBlockIntervals = touchedBlocks.flatMap((block) => block.modified === undefined ? [] : [block.modified]);
  const modifiedContextIntervals = input.side === "modified"
    ? contentSelections
    : projectOriginalIntervalsToModified(contentSelections, input.originalToModifiedLineMappings);

  return {
    originalIntervals: normalizeLineIntervals(originalBlockIntervals),
    modifiedIntervals: normalizeLineIntervals([
      ...modifiedBlockIntervals,
      ...modifiedContextIntervals,
    ]),
  };
};

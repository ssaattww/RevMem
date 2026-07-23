import type { LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "./line-intervals";

/**
 * A zero-based text position independent from the VS Code API.
 */
export interface TextPosition {
  /** Zero-based line number. */
  line: number;
  /** Zero-based UTF-16 character offset within the line. */
  character: number;
}

/**
 * One editor selection represented by its anchor and active positions.
 */
export interface TextSelection {
  /** Position at which the selection was started. */
  anchor: TextPosition;
  /** Current selection endpoint or cursor position. */
  active: TextPosition;
}

/**
 * Validates one non-negative integer used by selection conversion.
 */
function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

/**
 * Validates that a position belongs to the current document.
 */
function assertPosition(position: TextPosition, lineCount: number, name: string): void {
  assertNonNegativeSafeInteger(position.line, `${name}.line`);
  assertNonNegativeSafeInteger(position.character, `${name}.character`);

  if (position.line >= lineCount) {
    throw new RangeError(`${name}.line must be smaller than lineCount.`);
  }
}

/**
 * Compares positions in document order.
 */
function comparePositions(left: TextPosition, right: TextPosition): number {
  return left.line - right.line || left.character - right.character;
}

/**
 * Converts one non-empty or cursor-only selection to a half-open line interval.
 */
function selectionToLineInterval(selection: TextSelection): LineInterval {
  const direction = comparePositions(selection.anchor, selection.active);
  const start = direction <= 0 ? selection.anchor : selection.active;
  const end = direction <= 0 ? selection.active : selection.anchor;

  if (direction === 0) {
    return {
      startLine: start.line,
      endLineExclusive: start.line + 1
    };
  }

  const endLineExclusive =
    start.line === end.line || end.character > 0 ? end.line + 1 : end.line;

  return {
    startLine: start.line,
    endLineExclusive
  };
}

/**
 * Converts editor selections to normalized reviewed line intervals.
 *
 * Cursor-only selections include the cursor line. A non-empty selection that
 * ends at character zero excludes that endpoint line because no character from
 * it is selected. Overlapping and adjacent results are joined.
 *
 * @param selections Editor selections to convert.
 * @param lineCount Current document line count.
 * @returns Sorted, non-overlapping half-open line intervals.
 * @throws {RangeError} If `lineCount`, a selection line, or a selection
 * character is not a non-negative safe integer; if a selection line is outside
 * the document; or if a non-empty selection targets a zero-line document.
 * @remarks This function cannot inspect document text. Callers are responsible
 * for ensuring each selection character is within the content length of its line.
 */
export function selectionsToLineIntervals(
  selections: readonly TextSelection[],
  lineCount: number
): LineInterval[] {
  assertNonNegativeSafeInteger(lineCount, "lineCount");

  if (selections.length === 0) {
    return [];
  }

  if (lineCount === 0) {
    throw new RangeError("Selections cannot target a document with zero lines.");
  }

  const intervals = selections.map((selection, index) => {
    assertPosition(selection.anchor, lineCount, `selections[${index}].anchor`);
    assertPosition(selection.active, lineCount, `selections[${index}].active`);
    return selectionToLineInterval(selection);
  });

  return normalizeLineIntervals(intervals);
}

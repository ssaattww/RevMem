import type { LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

/** Zero-based UTF-16 position equivalent to the VS Code text position contract. */
export interface TextPosition {
  /** Zero-based logical line. */
  readonly line: number;
  /** Zero-based UTF-16 character offset excluding the line terminator. */
  readonly character: number;
}

/** Ordered text range replaced by one document content change. */
export interface TextRange {
  /** Inclusive replacement start. */
  readonly start: TextPosition;
  /** Exclusive replacement end. */
  readonly end: TextPosition;
}

/**
 * Core-layer equivalent of `TextDocumentContentChangeEvent` without a VS Code dependency.
 * All ranges and offsets refer to the same pre-change document snapshot.
 */
export interface DocumentContentChange {
  /** Range replaced in the pre-change document. */
  readonly range: TextRange;
  /** UTF-16 offset of `range.start` in the pre-change document. */
  readonly rangeOffset: number;
  /** UTF-16 length of the replaced range in the pre-change document. */
  readonly rangeLength: number;
  /** Replacement text. */
  readonly text: string;
}

/** Change-equivalence settings consumed by the pure mapping engine. */
export interface RangeMappingOptions {
  /** Preserve review state for horizontal-whitespace-only replacements. */
  readonly ignoreWhitespaceChanges: boolean;
  /** Preserve review state for line-terminator-only replacements. */
  readonly ignoreEolChanges: boolean;
}

/** Immutable input for one transactional document-change mapping. */
export interface RangeMappingInput {
  /** Complete document text before every supplied change. */
  readonly beforeText: string;
  /** Reviewed zero-based half-open intervals in the pre-change document. */
  readonly reviewed: readonly LineInterval[];
  /** Non-overlapping, distinct-offset changes that all refer to `beforeText`. */
  readonly changes: readonly DocumentContentChange[];
  /** Explicit mapping settings. */
  readonly options: Readonly<RangeMappingOptions>;
}

/** Reviewed intervals and logical line count after applying the change transaction. */
export interface RangeMappingResult {
  /** Normalized reviewed ranges in the resulting document. */
  readonly reviewed: LineInterval[];
  /** Logical line count in the resulting document. */
  readonly lineCount: number;
}

interface DocumentLine {
  readonly startOffset: number;
  readonly contentEndOffset: number;
}

interface ValidatedChange {
  readonly range: TextRange;
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
  readonly removedText: string;
  readonly originalIndex: number;
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function assertBoolean(value: boolean, name: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
}

function scanDocumentLines(text: string): DocumentLine[] {
  const lines: DocumentLine[] = [];
  let lineStart = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (character !== "\r" && character !== "\n") {
      index += 1;
      continue;
    }

    lines.push({
      startOffset: lineStart,
      contentEndOffset: index
    });

    if (character === "\r" && text[index + 1] === "\n") {
      index += 2;
    } else {
      index += 1;
    }
    lineStart = index;
  }

  lines.push({
    startOffset: lineStart,
    contentEndOffset: text.length
  });

  return lines;
}

function offsetForPosition(
  lines: readonly DocumentLine[],
  position: TextPosition,
  name: string
): number {
  assertNonNegativeSafeInteger(position.line, `${name}.line`);
  assertNonNegativeSafeInteger(position.character, `${name}.character`);

  const line = lines[position.line];
  if (line === undefined) {
    throw new RangeError(`${name}.line must be within the original document line count.`);
  }

  const lineLength = line.contentEndOffset - line.startOffset;
  if (position.character > lineLength) {
    throw new RangeError(`${name}.character must be within the original document line.`);
  }

  return line.startOffset + position.character;
}

function validateChanges(
  beforeText: string,
  changes: readonly DocumentContentChange[]
): ValidatedChange[] {
  const lines = scanDocumentLines(beforeText);
  const validated = changes.map((change, originalIndex): ValidatedChange => {
    assertNonNegativeSafeInteger(change.rangeOffset, `changes[${originalIndex}].rangeOffset`);
    assertNonNegativeSafeInteger(change.rangeLength, `changes[${originalIndex}].rangeLength`);

    if (typeof change.text !== "string") {
      throw new TypeError(`changes[${originalIndex}].text must be a string.`);
    }

    const startOffset = offsetForPosition(
      lines,
      change.range.start,
      `changes[${originalIndex}].range.start`
    );
    const endOffset = offsetForPosition(
      lines,
      change.range.end,
      `changes[${originalIndex}].range.end`
    );

    if (endOffset < startOffset) {
      throw new RangeError(`changes[${originalIndex}].range must be ordered.`);
    }
    if (change.rangeOffset !== startOffset) {
      throw new RangeError(
        `changes[${originalIndex}].rangeOffset must match range.start in the original document.`
      );
    }
    if (change.rangeLength !== endOffset - startOffset) {
      throw new RangeError(
        `changes[${originalIndex}].rangeLength must match the original range length.`
      );
    }
    if (endOffset > beforeText.length) {
      throw new RangeError(`changes[${originalIndex}] must stay within the original document.`);
    }

    return {
      range: {
        start: { ...change.range.start },
        end: { ...change.range.end }
      },
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: change.text,
      removedText: beforeText.slice(startOffset, endOffset),
      originalIndex
    };
  });

  const ascending = [...validated].sort(
    (left, right) =>
      left.rangeOffset - right.rangeOffset ||
      left.rangeLength - right.rangeLength ||
      left.originalIndex - right.originalIndex
  );

  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1]!;
    const current = ascending[index]!;
    const previousEnd = previous.rangeOffset + previous.rangeLength;

    if (
      current.rangeOffset < previousEnd ||
      current.rangeOffset === previous.rangeOffset
    ) {
      throw new RangeError("Document content changes must not overlap or share an offset.");
    }
  }

  return validated.sort(
    (left, right) =>
      right.rangeOffset - left.rangeOffset ||
      right.rangeLength - left.rangeLength ||
      right.originalIndex - left.originalIndex
  );
}

function countLineBreaks(text: string): number {
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r" && text[index + 1] === "\n") {
      count += 1;
      index += 1;
    } else if (text[index] === "\r" || text[index] === "\n") {
      count += 1;
    }
  }

  return count;
}

function endsWithLineBreak(text: string): boolean {
  return text.endsWith("\n") || text.endsWith("\r");
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\n");
}

function removeHorizontalWhitespace(text: string): string {
  return text.replace(/[^\S\r\n]+/g, "");
}

function canonicalizeForIgnoredChanges(
  text: string,
  options: Readonly<RangeMappingOptions>
): string {
  let result = text;

  if (options.ignoreEolChanges) {
    result = normalizeEol(result);
  }
  if (options.ignoreWhitespaceChanges) {
    result = removeHorizontalWhitespace(result);
  }

  return result;
}

function applyOneChange(beforeText: string, change: ValidatedChange): string {
  return (
    beforeText.slice(0, change.rangeOffset) +
    change.text +
    beforeText.slice(change.rangeOffset + change.rangeLength)
  );
}

function differsByOneTerminalLineBreak(
  beforeText: string,
  change: ValidatedChange,
  options: Readonly<RangeMappingOptions>
): boolean {
  if (
    !options.ignoreEolChanges ||
    change.rangeOffset + change.rangeLength !== beforeText.length
  ) {
    return false;
  }

  const before = canonicalizeForIgnoredChanges(beforeText, options);
  const after = canonicalizeForIgnoredChanges(
    applyOneChange(beforeText, change),
    options
  );
  const beforeHasTerminal = before.endsWith("\n");
  const afterHasTerminal = after.endsWith("\n");

  if (beforeHasTerminal === afterHasTerminal) {
    return false;
  }

  const withTerminal = beforeHasTerminal ? before : after;
  const withoutTerminal = beforeHasTerminal ? after : before;

  return (
    !withTerminal.endsWith("\n\n") &&
    withTerminal.slice(0, -1) === withoutTerminal
  );
}

function isIgnoredChange(
  change: ValidatedChange,
  beforeText: string,
  options: Readonly<RangeMappingOptions>
): boolean {
  if (change.removedText === change.text) {
    return true;
  }
  if (!options.ignoreWhitespaceChanges && !options.ignoreEolChanges) {
    return false;
  }

  const removed = canonicalizeForIgnoredChanges(change.removedText, options);
  const inserted = canonicalizeForIgnoredChanges(change.text, options);
  return (
    removed === inserted ||
    differsByOneTerminalLineBreak(beforeText, change, options)
  );
}

function mapOneChange(
  reviewed: readonly LineInterval[],
  change: ValidatedChange
): LineInterval[] {
  const removedLineBreaks = change.range.end.line - change.range.start.line;
  const insertedLineBreaks = countLineBreaks(change.text);
  const lineDelta = insertedLineBreaks - removedLineBreaks;
  const isWholeLineBoundaryChange =
    change.range.start.character === 0 &&
    change.range.end.character === 0 &&
    (change.text.length === 0 || endsWithLineBreak(change.text));
  const invalidatedStart = change.range.start.line;
  const shiftThreshold = isWholeLineBoundaryChange
    ? change.range.end.line
    : change.range.end.line + 1;
  const result: LineInterval[] = [];

  for (const interval of reviewed) {
    const preservedPrefixEnd = Math.min(
      interval.endLineExclusive,
      invalidatedStart
    );
    if (interval.startLine < preservedPrefixEnd) {
      result.push({
        startLine: interval.startLine,
        endLineExclusive: preservedPrefixEnd
      });
    }

    const preservedSuffixStart = Math.max(interval.startLine, shiftThreshold);
    if (preservedSuffixStart < interval.endLineExclusive) {
      const shiftedStart = preservedSuffixStart + lineDelta;
      const shiftedEnd = interval.endLineExclusive + lineDelta;
      if (shiftedStart < 0 || shiftedEnd < 0) {
        throw new RangeError("Mapped reviewed ranges must not have negative line boundaries.");
      }
      result.push({
        startLine: shiftedStart,
        endLineExclusive: shiftedEnd
      });
    }
  }

  return normalizeLineIntervals(result);
}

function clampToLineCount(
  reviewed: readonly LineInterval[],
  lineCount: number
): LineInterval[] {
  const clamped: LineInterval[] = [];

  for (const interval of reviewed) {
    if (interval.startLine >= lineCount) {
      continue;
    }

    const endLineExclusive = Math.min(interval.endLineExclusive, lineCount);
    if (interval.startLine < endLineExclusive) {
      clamped.push({
        startLine: interval.startLine,
        endLineExclusive
      });
    }
  }

  return normalizeLineIntervals(clamped);
}

function applyChanges(
  beforeText: string,
  changesDescending: readonly ValidatedChange[]
): string {
  let result = beforeText;

  for (const change of changesDescending) {
    result =
      result.slice(0, change.rangeOffset) +
      change.text +
      result.slice(change.rangeOffset + change.rangeLength);
  }

  return result;
}

/**
 * Maps reviewed line intervals through one transactional document change event.
 *
 * Changes are validated against one original snapshot, sorted by descending
 * `rangeOffset`, and then applied from the end of the document. Unchanged lines
 * before a change keep their positions, unchanged lines after it shift by the
 * line-count delta, every overlapping old line is invalidated, and inserted
 * lines remain unreviewed. Ignored whitespace/EOL replacements preserve review
 * state but still contribute to the resulting document line count. Adding or
 * removing exactly one terminal line break is EOL-only; adding a further blank
 * line to a file that already ends in a line break remains a real line change.
 *
 * @param input Original text, reviewed ranges, non-overlapping changes, and settings.
 * @returns Detached normalized reviewed intervals and resulting logical line count.
 * @throws When positions, offsets, lengths, reviewed bounds, options, or overlap are invalid.
 */
export function mapReviewedRangesThroughDocumentChanges(
  input: RangeMappingInput
): RangeMappingResult {
  if (typeof input.beforeText !== "string") {
    throw new TypeError("beforeText must be a string.");
  }
  assertBoolean(
    input.options.ignoreWhitespaceChanges,
    "options.ignoreWhitespaceChanges"
  );
  assertBoolean(input.options.ignoreEolChanges, "options.ignoreEolChanges");

  const originalLineCount = scanDocumentLines(input.beforeText).length;
  let reviewed = normalizeLineIntervals(input.reviewed);
  for (const interval of reviewed) {
    if (interval.endLineExclusive > originalLineCount) {
      throw new RangeError("Reviewed intervals must stay within the original line count.");
    }
  }

  const changesDescending = validateChanges(input.beforeText, input.changes);
  const afterText = applyChanges(input.beforeText, changesDescending);

  for (const change of changesDescending) {
    if (!isIgnoredChange(change, input.beforeText, input.options)) {
      reviewed = mapOneChange(reviewed, change);
    }
  }

  const lineCount = scanDocumentLines(afterText).length;
  return {
    reviewed: clampToLineCount(reviewed, lineCount),
    lineCount
  };
}

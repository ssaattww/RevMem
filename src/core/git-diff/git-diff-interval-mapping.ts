import type { LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

/** One `@@` hunk, using zero-based, end-exclusive line coordinates on each revision. */
export interface GitDiffHunk {
  /** Zero-based old-revision line or zero-count insertion anchor. */
  readonly oldStart: number;
  /** Number of old-revision lines removed by this hunk. */
  readonly oldLineCount: number;
  /** Zero-based new-revision line or zero-count deletion anchor. */
  readonly newStart: number;
  /** Number of new-revision lines added by this hunk. */
  readonly newLineCount: number;
  /** Old-revision hunk body lines, without Git's `-` prefix or line terminators. */
  readonly removedLines: readonly string[];
  /** New-revision hunk body lines, without Git's `+` prefix or line terminators. */
  readonly addedLines: readonly string[];
}

/** Parsed metadata for one Git diff file section; it deliberately does not apply file-state changes. */
export interface GitDiffFile {
  /** Repository-relative old path, or `undefined` for `/dev/null`. */
  readonly oldPath: string | undefined;
  /** Repository-relative new path, or `undefined` for `/dev/null`. */
  readonly newPath: string | undefined;
  /** Whether rename metadata was present; T204 owns applying this metadata to file state. */
  readonly isRename: boolean;
  /** Validated zero-context hunks for this file section. */
  readonly hunks: readonly GitDiffHunk[];
}

/** Immutable result of parsing a complete `--unified=0 --find-renames` Git diff. */
export interface ParsedGitDiff {
  /** File sections in the order emitted by Git. */
  readonly files: readonly GitDiffFile[];
}

/** Independent equivalence settings for whitespace and line-terminator changes. */
export interface GitDiffMappingOptions {
  /** Preserve a replacement only when horizontal whitespace is the sole proven difference. */
  readonly ignoreWhitespaceChanges: boolean;
  /** Preserve a replacement only when line terminators, including one final newline, are the sole proven difference. */
  readonly ignoreEolChanges: boolean;
}

/** Input for mapping old-revision reviewed line intervals through a single parsed file diff. */
export interface GitDiffIntervalMappingInput {
  /** Normalized or unnormalized zero-based, end-exclusive old-revision reviewed intervals. */
  readonly reviewed: readonly LineInterval[];
  /** Complete zero-context Git diff text; incomplete or malformed diff text is rejected. */
  readonly diff: string;
  /** Repository-relative old path that identifies exactly one diff file section. */
  readonly oldPath: string;
  /** Repository-relative new path that identifies exactly one diff file section. */
  readonly newPath: string;
  /** Optional complete old text used to prove EOL/whitespace equivalence conservatively. */
  readonly oldText?: string;
  /** Optional complete new text used to prove EOL/whitespace equivalence conservatively. */
  readonly newText?: string;
  /** Equivalence settings; both fields must be booleans. */
  readonly options: Readonly<GitDiffMappingOptions>;
}

/** Result of conservative mapping: unchanged/ignored lines are mapped and changed old lines are invalidated. */
export interface GitDiffIntervalMappingResult {
  /** Normalized zero-based, end-exclusive reviewed intervals in the new revision. */
  readonly reviewed: LineInterval[];
  /** Normalized zero-based, end-exclusive old intervals whose review state was invalidated. */
  readonly invalidatedOld: LineInterval[];
}

interface MutableFile {
  oldPath?: string;
  newPath?: string;
  isRename: boolean;
  hunks: GitDiffHunk[];
  hasOldContentHeader: boolean;
  hasNewContentHeader: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function assertBoolean(value: boolean, name: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
}

function decodeQuotedPath(raw: string): string {
  const bytes: number[] = [];
  let index = 1;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\"") {
      if (index + 1 < raw.length && raw[index + 1] !== "\t") {
        throw new SyntaxError("Quoted Git path has trailing content.");
      }
      let decoded: string;
      try {
        decoded = UTF8_DECODER.decode(Uint8Array.from(bytes));
      } catch {
        throw new SyntaxError("Quoted Git path contains invalid UTF-8.");
      }
      if (decoded.includes("\0")) {
        throw new SyntaxError("Quoted Git path contains a NUL character.");
      }
      return decoded;
    }
    if (character !== "\\") {
      const codePoint = raw.codePointAt(index);
      if (codePoint === undefined) {
        throw new SyntaxError("Quoted Git path is malformed.");
      }
      const value = String.fromCodePoint(codePoint);
      bytes.push(...UTF8_ENCODER.encode(value));
      index += value.length;
      continue;
    }

    const escaped = raw[index + 1];
    if (escaped === undefined) {
      throw new SyntaxError("Quoted Git path ends in an incomplete escape.");
    }
    const escapedByte: Readonly<Record<string, number>> = {
      a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "\"": 34
    };
    if (escaped in escapedByte) {
      bytes.push(escapedByte[escaped] as number);
      index += 2;
      continue;
    }
    const octal = raw.slice(index + 1, index + 4);
    if (!/^[0-7]{3}$/.test(octal)) {
      throw new SyntaxError("Quoted Git path contains an unsupported escape.");
    }
    const octalByte = Number.parseInt(octal, 8);
    if (octalByte > 0xff) {
      throw new SyntaxError("Quoted Git path contains an octal escape outside one byte.");
    }
    if (octalByte === 0) {
      throw new SyntaxError("Quoted Git path contains a NUL character.");
    }
    bytes.push(octalByte);
    index += 4;
  }
  throw new SyntaxError("Quoted Git path is unterminated.");
}

function decodePath(raw: string, stripDiffPrefix: boolean): string | undefined {
  const encoded = raw.startsWith("\"")
    ? decodeQuotedPath(raw)
    : (raw.split("\t", 1)[0] ?? raw);
  if (encoded.includes("\0")) {
    throw new SyntaxError("Git path contains a NUL character.");
  }
  if (encoded === "/dev/null") {
    return undefined;
  }
  return stripDiffPrefix && (encoded.startsWith("a/") || encoded.startsWith("b/"))
    ? encoded.slice(2)
    : encoded;
}

function parseCoordinate(raw: string, count: number, side: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Diff ${side} coordinate must be a non-negative safe integer.`);
  }
  if (count > 0 && value === 0) {
    throw new RangeError(`Non-empty diff ${side} ranges must be one-based.`);
  }
  return count === 0 ? value : value - 1;
}

function validateHunks(hunks: readonly GitDiffHunk[]): void {
  let previousOldEnd = 0;
  let previousNewEnd = 0;
  let delta = 0;
  for (const hunk of hunks) {
    const oldEnd = hunk.oldStart + hunk.oldLineCount;
    const newEnd = hunk.newStart + hunk.newLineCount;
    const hunkDelta = hunk.newLineCount - hunk.oldLineCount;
    const expectedNewStart = hunk.oldStart + delta;
    if (!Number.isSafeInteger(oldEnd) || !Number.isSafeInteger(newEnd) ||
        !Number.isSafeInteger(hunkDelta) || !Number.isSafeInteger(expectedNewStart)) {
      throw new RangeError("Diff hunk derived coordinates and deltas must be safe integers.");
    }
    if (hunk.oldStart < previousOldEnd || hunk.newStart < previousNewEnd) {
      throw new RangeError("Diff hunks must be ordered and non-overlapping.");
    }
    if (hunk.newStart !== expectedNewStart) {
      throw new RangeError("Diff hunk coordinate delta is inconsistent with preceding hunks.");
    }
    previousOldEnd = oldEnd;
    previousNewEnd = newEnd;
    delta += hunkDelta;
    if (!Number.isSafeInteger(delta)) {
      throw new RangeError("Diff hunk cumulative delta must be a safe integer.");
    }
  }
}

/**
 * Parses complete Git output produced with `--unified=0 --find-renames`.
 *
 * Coordinates are converted to zero-based, end-exclusive intervals; zero-count ranges retain
 * Git's anchor coordinate. Malformed, truncated, overlapping, or delta-inconsistent content is
 * rejected so callers never preserve reviewed state from an ambiguous diff.
 *
 * @param diff Complete Git diff text.
 * @returns Detached parsed metadata and hunks. Rename metadata is parse-only and is not applied.
 * @throws `TypeError` for a non-string input, `SyntaxError` for malformed/truncated syntax, or `RangeError` for invalid coordinates.
 */
export function parseZeroContextGitDiff(diff: string): ParsedGitDiff {
  if (typeof diff !== "string") {
    throw new TypeError("diff must be a string.");
  }
  const lines = diff.split(/\r?\n/);
  const files: MutableFile[] = [];
  let currentFile: MutableFile | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) {
      currentFile = {
        isRename: false,
        hunks: [],
        hasOldContentHeader: false,
        hasNewContentHeader: false
      };
      files.push(currentFile);
      continue;
    }
    if (currentFile === undefined) {
      if (line.length === 0) {
        continue;
      }
      throw new SyntaxError("Diff content must begin with a diff --git header.");
    }
    if (line.startsWith("rename from ")) {
      currentFile.oldPath = decodePath(line.slice("rename from ".length), false);
      currentFile.isRename = true;
      continue;
    }
    if (line.startsWith("rename to ")) {
      currentFile.newPath = decodePath(line.slice("rename to ".length), false);
      currentFile.isRename = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      currentFile.oldPath = decodePath(line.slice(4), true);
      currentFile.hasOldContentHeader = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentFile.newPath = decodePath(line.slice(4), true);
      currentFile.hasNewContentHeader = true;
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (match === null) {
      continue;
    }
    const oldLineCount = match[2] === undefined ? 1 : Number(match[2]);
    const newLineCount = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isSafeInteger(oldLineCount) || !Number.isSafeInteger(newLineCount)) {
      throw new RangeError("Diff hunk line counts must be safe integers.");
    }
    if (oldLineCount === 0 && newLineCount === 0) {
      throw new SyntaxError("Diff hunk cannot be a zero-zero no-op.");
    }
    const removedLines: string[] = [];
    const addedLines: string[] = [];
    while (index + 1 < lines.length) {
      const body = lines[index + 1] ?? "";
      if (body.startsWith("diff --git ") || HUNK_HEADER.test(body)) {
        break;
      }
      if (body.startsWith("-")) {
        removedLines.push(body.slice(1));
      } else if (body.startsWith("+")) {
        addedLines.push(body.slice(1));
      } else if (body === "\\ No newline at end of file" || body.length === 0) {
        // Git metadata or the final split sentinel.
      } else {
        throw new SyntaxError("Zero-context diff hunks may only contain added or removed lines.");
      }
      index += 1;
    }
    if (removedLines.length !== oldLineCount || addedLines.length !== newLineCount) {
      throw new SyntaxError("Diff hunk body line counts must match its header.");
    }
    currentFile.hunks.push({
      oldStart: parseCoordinate(match[1] as string, oldLineCount, "old"),
      oldLineCount,
      newStart: parseCoordinate(match[3] as string, newLineCount, "new"),
      newLineCount,
      removedLines,
      addedLines
    });
  }

  for (const file of files) {
    if (file.hasOldContentHeader !== file.hasNewContentHeader) {
      throw new SyntaxError("Diff content headers must occur as an old/new pair.");
    }
    if (file.hasOldContentHeader && file.hunks.length === 0) {
      throw new SyntaxError("Modified-file content headers must be followed by at least one hunk.");
    }
    validateHunks(file.hunks);
  }
  return {
    files: files.map((file) => ({
      oldPath: file.oldPath,
      newPath: file.newPath,
      isRename: file.isRename,
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        removedLines: [...hunk.removedLines],
        addedLines: [...hunk.addedLines]
      }))
    }))
  };
}

function canonicalizeHorizontal(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/[^\S\r\n]+/g, ""));
}

function canonicalizeText(text: string, options: Readonly<GitDiffMappingOptions>): string {
  const eolNormalized = text.replace(/\r\n|\r/g, "\n");
  return options.ignoreWhitespaceChanges ? eolNormalized.replace(/[^\S\r\n]+/g, "") : eolNormalized;
}

function differsByOneTerminalLineBreak(
  oldText: string,
  newText: string,
  options: Readonly<GitDiffMappingOptions>
): boolean {
  const oldCanonical = canonicalizeText(oldText, options);
  const newCanonical = canonicalizeText(newText, options);
  const oldHasTerminal = oldCanonical.endsWith("\n");
  const newHasTerminal = newCanonical.endsWith("\n");
  if (oldHasTerminal === newHasTerminal) {
    return false;
  }
  const withTerminal = oldHasTerminal ? oldCanonical : newCanonical;
  const withoutTerminal = oldHasTerminal ? newCanonical : oldCanonical;
  return !withTerminal.endsWith("\n\n") && withTerminal.slice(0, -1) === withoutTerminal;
}

function documentsDifferOnlyByIgnoredEol(
  oldText: string | undefined,
  newText: string | undefined,
  options: Readonly<GitDiffMappingOptions>
): boolean {
  if (!options.ignoreEolChanges || oldText === undefined || newText === undefined || oldText === newText) {
    return false;
  }
  const oldCanonical = canonicalizeText(oldText, options);
  const newCanonical = canonicalizeText(newText, options);
  return oldCanonical === newCanonical || differsByOneTerminalLineBreak(oldText, newText, options);
}

function hasProvenUnchangedEols(
  hunk: GitDiffHunk,
  oldText: string | undefined,
  newText: string | undefined
): boolean {
  if (oldText === undefined || newText === undefined) {
    return false;
  }
  const oldEndings = Array.from(oldText.matchAll(/\r\n|\r|\n/g), (match) => match[0]);
  const newEndings = Array.from(newText.matchAll(/\r\n|\r|\n/g), (match) => match[0]);
  for (let offset = 0; offset < hunk.oldLineCount; offset += 1) {
    if ((oldEndings[hunk.oldStart + offset] ?? "") !== (newEndings[hunk.newStart + offset] ?? "")) {
      return false;
    }
  }
  return true;
}

function isIgnoredHunk(
  hunk: GitDiffHunk,
  input: Readonly<GitDiffIntervalMappingInput>,
  documentEolOnly: boolean
): boolean {
  if (hunk.oldLineCount !== hunk.newLineCount) {
    return false;
  }
  if (documentEolOnly) {
    return true;
  }
  if (!input.options.ignoreWhitespaceChanges || !hasProvenUnchangedEols(hunk, input.oldText, input.newText)) {
    return false;
  }
  const removed = canonicalizeHorizontal(hunk.removedLines);
  const added = canonicalizeHorizontal(hunk.addedLines);
  return removed.every((line, index) => line === added[index]);
}

function intersect(interval: LineInterval, start: number, end: number): LineInterval | undefined {
  const overlapStart = Math.max(interval.startLine, start);
  const overlapEnd = Math.min(interval.endLineExclusive, end);
  return overlapStart < overlapEnd ? { startLine: overlapStart, endLineExclusive: overlapEnd } : undefined;
}

function mapIntervals(
  reviewed: readonly LineInterval[],
  hunks: readonly GitDiffHunk[],
  input: Readonly<GitDiffIntervalMappingInput>,
  documentEolOnly: boolean
): GitDiffIntervalMappingResult {
  const mapped: LineInterval[] = [];
  const invalidated: LineInterval[] = [];
  for (const interval of normalizeLineIntervals(reviewed)) {
    let cursor = interval.startLine;
    let delta = 0;
    for (const hunk of hunks) {
      const oldEnd = hunk.oldStart + hunk.oldLineCount;
      if (oldEnd <= interval.startLine) {
        delta += hunk.newLineCount - hunk.oldLineCount;
        continue;
      }
      if (hunk.oldStart >= interval.endLineExclusive) {
        break;
      }
      const unchangedEnd = Math.min(interval.endLineExclusive, hunk.oldStart);
      if (cursor < unchangedEnd) {
        mapped.push({ startLine: cursor + delta, endLineExclusive: unchangedEnd + delta });
      }
      cursor = Math.max(cursor, hunk.oldStart);
      const changed = intersect(interval, hunk.oldStart, oldEnd);
      if (changed !== undefined) {
        if (isIgnoredHunk(hunk, input, documentEolOnly)) {
          mapped.push({ startLine: changed.startLine + delta, endLineExclusive: changed.endLineExclusive + delta });
        } else {
          invalidated.push(changed);
        }
        cursor = Math.max(cursor, changed.endLineExclusive);
      }
      delta += hunk.newLineCount - hunk.oldLineCount;
    }
    if (cursor < interval.endLineExclusive) {
      mapped.push({ startLine: cursor + delta, endLineExclusive: interval.endLineExclusive + delta });
    }
  }
  return { reviewed: normalizeLineIntervals(mapped), invalidatedOld: normalizeLineIntervals(invalidated) };
}

/**
 * Maps reviewed old-revision intervals through one Git diff without reviewing inserted lines.
 *
 * Changed lines are invalidated unless the supplied complete texts prove the enabled equivalence;
 * missing proof is treated as a change. This function parses rename/copy/delete metadata only and
 * intentionally performs no T204 file-state migration.
 *
 * @param input Reviewed intervals, complete diff, exact path pair, optional text proof, and settings.
 * @returns Detached normalized new reviewed intervals and invalidated old intervals.
 * @throws When options are invalid, diff parsing fails, or the exact path pair is absent.
 */
export function mapReviewedIntervalsAcrossDiff(
  input: Readonly<GitDiffIntervalMappingInput>
): GitDiffIntervalMappingResult {
  assertBoolean(input.options.ignoreWhitespaceChanges, "options.ignoreWhitespaceChanges");
  assertBoolean(input.options.ignoreEolChanges, "options.ignoreEolChanges");
  const file = parseZeroContextGitDiff(input.diff).files.find(
    (candidate) => candidate.oldPath === input.oldPath && candidate.newPath === input.newPath
  );
  if (file === undefined) {
    throw new RangeError("The requested old/new path pair was not found in the diff.");
  }
  return mapIntervals(
    input.reviewed,
    file.hunks,
    input,
    documentsDifferOnlyByIgnoredEol(input.oldText, input.newText, input.options)
  );
}

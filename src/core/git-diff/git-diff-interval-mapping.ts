import type { LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

export interface GitDiffHunk {
  readonly oldStart: number;
  readonly oldLineCount: number;
  readonly newStart: number;
  readonly newLineCount: number;
  readonly removedLines: readonly string[];
  readonly addedLines: readonly string[];
}

export interface GitDiffFile {
  readonly oldPath: string | undefined;
  readonly newPath: string | undefined;
  readonly isRename: boolean;
  readonly hunks: readonly GitDiffHunk[];
}

export interface ParsedGitDiff {
  readonly files: readonly GitDiffFile[];
}

export interface GitDiffMappingOptions {
  readonly ignoreWhitespaceChanges: boolean;
  readonly ignoreEolChanges: boolean;
}

export interface GitDiffIntervalMappingInput {
  readonly reviewed: readonly LineInterval[];
  readonly diff: string;
  readonly oldPath: string;
  readonly newPath: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly options: Readonly<GitDiffMappingOptions>;
}

export interface GitDiffIntervalMappingResult {
  readonly reviewed: LineInterval[];
  readonly invalidatedOld: LineInterval[];
}

interface MutableFile {
  oldPath?: string;
  newPath?: string;
  isRename: boolean;
  hunks: GitDiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function assertBoolean(value: boolean, name: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
}

function decodePath(raw: string): string | undefined {
  const path = raw.split("\t", 1)[0] ?? raw;
  if (path === "/dev/null") {
    return undefined;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function zeroBasedStart(rawStart: number, count: number): number {
  return count === 0 ? rawStart : rawStart - 1;
}

function validateHunks(hunks: readonly GitDiffHunk[]): void {
  let oldEnd = 0;
  let newEnd = 0;

  for (const hunk of hunks) {
    if (hunk.oldStart < oldEnd || hunk.newStart < newEnd) {
      throw new RangeError("Diff hunks must be ordered and non-overlapping.");
    }
    oldEnd = hunk.oldStart + hunk.oldLineCount;
    newEnd = hunk.newStart + hunk.newLineCount;
  }
}

/** Parses git diff output produced with `--unified=0 --find-renames`. */
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
      currentFile = { isRename: false, hunks: [] };
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
      currentFile.oldPath = line.slice("rename from ".length);
      currentFile.isRename = true;
      continue;
    }
    if (line.startsWith("rename to ")) {
      currentFile.newPath = line.slice("rename to ".length);
      currentFile.isRename = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      currentFile.oldPath = decodePath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentFile.newPath = decodePath(line.slice(4));
      continue;
    }

    const match = HUNK_HEADER.exec(line);
    if (match === null) {
      continue;
    }

    const oldRawStart = Number(match[1]);
    const oldLineCount = match[2] === undefined ? 1 : Number(match[2]);
    const newRawStart = Number(match[3]);
    const newLineCount = match[4] === undefined ? 1 : Number(match[4]);
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
        // Metadata or the trailing split sentinel.
      } else {
        throw new SyntaxError("Zero-context diff hunks may only contain added or removed lines.");
      }
      index += 1;
    }

    if (removedLines.length !== oldLineCount || addedLines.length !== newLineCount) {
      throw new SyntaxError("Diff hunk body line counts must match its header.");
    }

    currentFile.hunks.push({
      oldStart: zeroBasedStart(oldRawStart, oldLineCount),
      oldLineCount,
      newStart: zeroBasedStart(newRawStart, newLineCount),
      newLineCount,
      removedLines,
      addedLines
    });
  }

  for (const file of files) {
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

function canonicalizeLines(lines: readonly string[], options: Readonly<GitDiffMappingOptions>): string[] {
  return lines.map((line) => options.ignoreWhitespaceChanges ? line.replace(/\s+/g, "") : line);
}

function isIgnoredHunk(
  hunk: GitDiffHunk,
  options: Readonly<GitDiffMappingOptions>,
  wholeDocumentEolOnly: boolean
): boolean {
  if (hunk.oldLineCount !== hunk.newLineCount) {
    return false;
  }
  if (wholeDocumentEolOnly) {
    return true;
  }
  if (!options.ignoreWhitespaceChanges) {
    return false;
  }
  return canonicalizeLines(hunk.removedLines, options).every(
    (line, index) => line === canonicalizeLines(hunk.addedLines, options)[index]
  );
}

function intersect(interval: LineInterval, start: number, end: number): LineInterval | undefined {
  const overlapStart = Math.max(interval.startLine, start);
  const overlapEnd = Math.min(interval.endLineExclusive, end);
  return overlapStart < overlapEnd
    ? { startLine: overlapStart, endLineExclusive: overlapEnd }
    : undefined;
}

function mapIntervals(
  reviewed: readonly LineInterval[],
  hunks: readonly GitDiffHunk[],
  options: Readonly<GitDiffMappingOptions>,
  wholeDocumentEolOnly: boolean
): GitDiffIntervalMappingResult {
  const mapped: LineInterval[] = [];
  const invalidated: LineInterval[] = [];

  for (const interval of normalizeLineIntervals(reviewed)) {
    let cursor = interval.startLine;
    let delta = 0;

    for (const hunk of hunks) {
      const hunkOldEnd = hunk.oldStart + hunk.oldLineCount;
      if (hunkOldEnd <= interval.startLine) {
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

      const overlap = intersect(interval, hunk.oldStart, hunkOldEnd);
      if (overlap !== undefined) {
        if (isIgnoredHunk(hunk, options, wholeDocumentEolOnly)) {
          mapped.push({
            startLine: overlap.startLine + delta,
            endLineExclusive: overlap.endLineExclusive + delta
          });
        } else {
          invalidated.push(overlap);
        }
        cursor = Math.max(cursor, overlap.endLineExclusive);
      }
      delta += hunk.newLineCount - hunk.oldLineCount;
    }

    if (cursor < interval.endLineExclusive) {
      mapped.push({
        startLine: cursor + delta,
        endLineExclusive: interval.endLineExclusive + delta
      });
    }
  }

  return {
    reviewed: normalizeLineIntervals(mapped),
    invalidatedOld: normalizeLineIntervals(invalidated)
  };
}

/** Maps reviewed intervals from one Git revision to another without guessing changed lines. */
export function mapReviewedIntervalsAcrossDiff(
  input: Readonly<GitDiffIntervalMappingInput>
): GitDiffIntervalMappingResult {
  assertBoolean(input.options.ignoreWhitespaceChanges, "options.ignoreWhitespaceChanges");
  assertBoolean(input.options.ignoreEolChanges, "options.ignoreEolChanges");

  const parsed = parseZeroContextGitDiff(input.diff);
  const file = parsed.files.find(
    (candidate) => candidate.oldPath === input.oldPath && candidate.newPath === input.newPath
  );
  if (file === undefined) {
    throw new RangeError("The requested old/new path pair was not found in the diff.");
  }

  const wholeDocumentEolOnly = input.options.ignoreEolChanges &&
    input.oldText !== undefined &&
    input.newText !== undefined &&
    input.oldText !== input.newText &&
    input.oldText.replace(/\r\n|\r/g, "\n") === input.newText.replace(/\r\n|\r/g, "\n");

  return mapIntervals(input.reviewed, file.hunks, input.options, wholeDocumentEolOnly);
}

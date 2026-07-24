import type { LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";
import {
  parseZeroContextGitDiff,
  type GitDiffHunk,
  type GitDiffIntervalMappingInput,
  type GitDiffIntervalMappingResult,
  type GitDiffMappingOptions
} from "./git-diff-interval-mapping";

function canonicalize(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/\s+/g, ""));
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
  const removed = canonicalize(hunk.removedLines);
  const added = canonicalize(hunk.addedLines);
  return removed.every((line, index) => line === added[index]);
}

function overlap(
  interval: LineInterval,
  start: number,
  end: number
): LineInterval | undefined {
  const startLine = Math.max(interval.startLine, start);
  const endLineExclusive = Math.min(interval.endLineExclusive, end);
  return startLine < endLineExclusive ? { startLine, endLineExclusive } : undefined;
}

/** Maps reviewed intervals from one Git revision to another without reviewing inserted lines. */
export function mapReviewedIntervalsAcrossDiff(
  input: Readonly<GitDiffIntervalMappingInput>
): GitDiffIntervalMappingResult {
  if (typeof input.options.ignoreWhitespaceChanges !== "boolean" ||
      typeof input.options.ignoreEolChanges !== "boolean") {
    throw new TypeError("Git diff mapping options must be boolean values.");
  }

  const file = parseZeroContextGitDiff(input.diff).files.find(
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
  const mapped: LineInterval[] = [];
  const invalidated: LineInterval[] = [];

  for (const interval of normalizeLineIntervals(input.reviewed)) {
    let cursor = interval.startLine;
    let delta = 0;

    for (const hunk of file.hunks) {
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

      const changed = overlap(interval, hunk.oldStart, oldEnd);
      if (changed !== undefined) {
        if (isIgnoredHunk(hunk, input.options, wholeDocumentEolOnly)) {
          mapped.push({
            startLine: changed.startLine + delta,
            endLineExclusive: changed.endLineExclusive + delta
          });
        } else {
          invalidated.push(changed);
        }
        cursor = Math.max(cursor, changed.endLineExclusive);
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

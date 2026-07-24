import assert from "node:assert/strict";
import test from "node:test";

import {
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff
} from "../../src/core/git-diff/index";

const options = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false
} as const;

test("parses zero-context git diff metadata and multiple hunks", () => {
  const parsed = parseZeroContextGitDiff([
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -2,2 +2,3 @@",
    "-old two",
    "-old three",
    "+new two",
    "+new three",
    "+new four",
    "@@ -8 +9,0 @@",
    "-removed",
    ""
  ].join("\n"));

  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]?.oldPath, "src/a.ts");
  assert.equal(parsed.files[0]?.newPath, "src/a.ts");
  assert.deepEqual(parsed.files[0]?.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLineCount: hunk.oldLineCount,
    newStart: hunk.newStart,
    newLineCount: hunk.newLineCount
  })), [
    { oldStart: 1, oldLineCount: 2, newStart: 1, newLineCount: 3 },
    { oldStart: 7, oldLineCount: 1, newStart: 8, newLineCount: 0 }
  ]);
});

test("preserves unchanged reviewed lines and invalidates only changed lines across consecutive hunks", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -2 +2,2 @@",
    "-two",
    "+two changed",
    "+inserted",
    "@@ -5,2 +6 @@",
    "-five",
    "-six",
    "+six changed",
    ""
  ].join("\n");

  const result = mapReviewedIntervalsAcrossDiff({
    reviewed: [{ startLine: 0, endLineExclusive: 8 }],
    diff,
    oldPath: "a.txt",
    newPath: "a.txt",
    options
  });

  assert.deepEqual(result.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 3, endLineExclusive: 5 },
    { startLine: 6, endLineExclusive: 8 }
  ]);
  assert.deepEqual(result.invalidatedOld, [
    { startLine: 1, endLineExclusive: 2 },
    { startLine: 4, endLineExclusive: 6 }
  ]);
});

test("handles pure addition and pure deletion without reviewing inserted lines", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -2,0 +3,2 @@",
    "+new-a",
    "+new-b",
    "@@ -5,2 +7,0 @@",
    "-five",
    "-six",
    ""
  ].join("\n");

  const result = mapReviewedIntervalsAcrossDiff({
    reviewed: [{ startLine: 0, endLineExclusive: 8 }],
    diff,
    oldPath: "a.txt",
    newPath: "a.txt",
    options
  });

  assert.deepEqual(result.reviewed, [
    { startLine: 0, endLineExclusive: 2 },
    { startLine: 4, endLineExclusive: 6 }
  ]);
});

test("preserves equal-sized whitespace-only replacement only when configured", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -2 +2 @@",
    "-const value = 1;",
    "+const   value = 1;",
    ""
  ].join("\n");

  const input = {
    reviewed: [{ startLine: 1, endLineExclusive: 2 }],
    diff,
    oldPath: "a.txt",
    newPath: "a.txt"
  } as const;

  assert.deepEqual(mapReviewedIntervalsAcrossDiff({ ...input, options }).reviewed, []);
  assert.deepEqual(mapReviewedIntervalsAcrossDiff({
    ...input,
    options: { ...options, ignoreWhitespaceChanges: true }
  }).reviewed, [{ startLine: 1, endLineExclusive: 2 }]);
});

test("preserves EOL-only revision changes only when configured", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,2 +1,2 @@",
    "-one",
    "-two",
    "+one",
    "+two",
    ""
  ].join("\n");

  const input = {
    reviewed: [{ startLine: 0, endLineExclusive: 2 }],
    diff,
    oldPath: "a.txt",
    newPath: "a.txt",
    oldText: "one\r\ntwo\r\n",
    newText: "one\ntwo\n"
  } as const;

  assert.deepEqual(mapReviewedIntervalsAcrossDiff({ ...input, options }).reviewed, []);
  assert.deepEqual(mapReviewedIntervalsAcrossDiff({
    ...input,
    options: { ...options, ignoreEolChanges: true }
  }).reviewed, [{ startLine: 0, endLineExclusive: 2 }]);
});

test("rejects overlapping or out-of-order hunks instead of guessing reviewed state", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -4 +4 @@",
    "-four",
    "+changed",
    "@@ -3 +3 @@",
    "-three",
    "+changed",
    ""
  ].join("\n");

  assert.throws(() => parseZeroContextGitDiff(diff), /ordered and non-overlapping/);
});

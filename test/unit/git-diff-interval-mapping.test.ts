import assert from "node:assert/strict";
import test from "node:test";

import {
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff
} from "../../src/core/git-diff/index";
import { mapReviewedIntervalsAcrossDiff as mapFromModule } from "../../src/core/git-diff/git-diff-interval-mapping";

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
    "@@ -8 +8,0 @@",
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
    "@@ -5,2 +6,0 @@",
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
    { startLine: 4, endLineExclusive: 8 }
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
    newPath: "a.txt",
    oldText: "one\nconst value = 1;\nthree\n",
    newText: "one\nconst   value = 1;\nthree\n"
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

test("rejects a modified-file diff truncated after its content headers", () => {
  assert.throws(() => parseZeroContextGitDiff([
    "diff --git a/a.txt b/a.txt",
    "index 1111111..2222222 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    ""
  ].join("\n")), /content headers.*hunk/i);

  assert.deepEqual(parseZeroContextGitDiff([
    "diff --git a/a.txt b/b.txt",
    "similarity index 100%",
    "rename from a.txt",
    "rename to b.txt",
    ""
  ].join("\n")).files[0]?.hunks, []);
});

test("uses one authoritative mapper for direct and barrel imports, including pure additions", () => {
  const input = {
    reviewed: [{ startLine: 0, endLineExclusive: 4 }],
    diff: [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -2,0 +3,2 @@",
      "+insert one",
      "+insert two",
      ""
    ].join("\n"),
    oldPath: "a.txt",
    newPath: "a.txt",
    options
  } as const;

  const expected = {
    reviewed: [
      { startLine: 0, endLineExclusive: 2 },
      { startLine: 4, endLineExclusive: 6 }
    ],
    invalidatedOld: []
  };
  assert.deepEqual(mapReviewedIntervalsAcrossDiff(input), expected);
  assert.deepEqual(mapFromModule(input), expected);
});

test("does not let whitespace-ignore hide CRLF, LF, or CR changes unless EOL-ignore is enabled", () => {
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

  for (const oldText of ["one\r\ntwo\r\n", "one\rtwo\r"]) {
    const input = {
      reviewed: [{ startLine: 0, endLineExclusive: 2 }],
      diff,
      oldPath: "a.txt",
      newPath: "a.txt",
      oldText,
      newText: "one\ntwo\n"
    } as const;
    assert.deepEqual(mapReviewedIntervalsAcrossDiff({
      ...input,
      options: { ...options, ignoreWhitespaceChanges: true }
    }).reviewed, []);
    assert.deepEqual(mapReviewedIntervalsAcrossDiff({
      ...input,
      options: { ...options, ignoreWhitespaceChanges: true, ignoreEolChanges: true }
    }).reviewed, [{ startLine: 0, endLineExclusive: 2 }]);
  }
});

test("ignores exactly one final newline add or removal but not a real blank line", () => {
  const finalNewlineDiff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-a",
    "\\ No newline at end of file",
    "+a",
    ""
  ].join("\n");
  const input = {
    reviewed: [{ startLine: 0, endLineExclusive: 1 }],
    diff: finalNewlineDiff,
    oldPath: "a.txt",
    newPath: "a.txt"
  } as const;
  assert.deepEqual(mapReviewedIntervalsAcrossDiff({
    ...input,
    oldText: "a",
    newText: "a\n",
    options: { ...options, ignoreEolChanges: true }
  }).reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(mapReviewedIntervalsAcrossDiff({
    ...input,
    oldText: "a\n",
    newText: "a",
    options: { ...options, ignoreEolChanges: true }
  }).reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(mapReviewedIntervalsAcrossDiff({
    ...input,
    oldText: "a\n",
    newText: "a\n\n",
    options: { ...options, ignoreEolChanges: true }
  }).reviewed, []);
});

test("accepts real 0-count anchors and rejects unsafe or delta-inconsistent coordinates", () => {
  const valid = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -2,0 +3,2 @@",
    "+insert one",
    "+insert two",
    "@@ -5,2 +6,0 @@",
    "-five",
    "-six",
    ""
  ].join("\n");
  assert.doesNotThrow(() => parseZeroContextGitDiff(valid));

  const mismatch = valid.replace("@@ -5,2 +6,0 @@", "@@ -5,2 +99,0 @@");
  assert.throws(() => parseZeroContextGitDiff(mismatch), /coordinate delta/i);
  assert.throws(() => parseZeroContextGitDiff(valid.replace("-2,0", "-9007199254740992,0")), /safe integer/i);
});

test("decodes quoted Git paths and rejects malformed C escapes without applying T204 state changes", () => {
  const parsed = parseZeroContextGitDiff([
    "diff --git \"a/dir/\\346\\227\\245\\346\\234\\254\\t\\\"\\\\.txt\" \"b/dir/\\346\\227\\245\\346\\234\\254\\t\\\"\\\\.txt\"",
    "--- \"a/dir/\\346\\227\\245\\346\\234\\254\\t\\\"\\\\.txt\"",
    "+++ \"b/dir/\\346\\227\\245\\346\\234\\254\\t\\\"\\\\.txt\"",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    ""
  ].join("\n"));
  assert.equal(parsed.files[0]?.oldPath, "dir/日本\t\"\\.txt");
  assert.equal(parsed.files[0]?.newPath, "dir/日本\t\"\\.txt");
  assert.equal(parsed.files[0]?.isRename, false);
  assert.throws(() => parseZeroContextGitDiff([
    "diff --git a/a.txt b/a.txt",
    "--- \"a/bad\\q.txt\"",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    ""
  ].join("\n")), /escape/i);
});

test("rejects a rename content diff truncated after only one content header but accepts headerless rename metadata", () => {
  for (const contentHeader of ["--- a/a/foo.txt", "+++ b/b/foo.txt"]) {
    assert.throws(() => parseZeroContextGitDiff([
      "diff --git a/a/foo.txt b/b/foo.txt",
      "similarity index 90%",
      "rename from a/foo.txt",
      "rename to b/foo.txt",
      contentHeader,
      ""
    ].join("\n")), /content headers/i);
  }

  assert.deepEqual(parseZeroContextGitDiff([
    "diff --git a/a/foo.txt b/b/foo.txt",
    "similarity index 100%",
    "rename from a/foo.txt",
    "rename to b/foo.txt",
    ""
  ].join("\n")).files[0], {
    oldPath: "a/foo.txt",
    newPath: "b/foo.txt",
    isRename: true,
    hunks: []
  });
});

test("rejects derived coordinate overflow and an impossible zero-zero hunk while accepting real zero-count anchors", () => {
  assert.throws(() => parseZeroContextGitDiff([
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -9007199254740991,2 +9007199254740991,2 @@",
    "-one",
    "-two",
    "+one",
    "+two",
    ""
  ].join("\n")), /safe integer/i);
  assert.throws(() => parseZeroContextGitDiff([
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -0,0 +0,0 @@",
    ""
  ].join("\n")), /zero.*no-op/i);
});

test("rejects octal escapes outside one byte and decoded NUL paths", () => {
  for (const escapedPath of ["\\400", "\\000"]) {
    assert.throws(() => parseZeroContextGitDiff([
      "diff --git a/a.txt b/a.txt",
      `--- "a/${escapedPath}.txt"`,
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n")), /octal|NUL/i);
  }
});

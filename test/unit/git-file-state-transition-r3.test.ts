import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewState } from "../../src/core/contracts/index";
import { applyGitFileStateTransitions } from "../../src/core/git-diff/index";

const updatedAt = "2026-07-25T04:30:00.000Z";

function state(fileId: string, currentPath: string, overrides: Partial<FileReviewState> = {}): FileReviewState {
  return {
    schemaVersion: 1,
    fileId,
    currentPath,
    previousPaths: [],
    revisionId: "old",
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
    originalReviewedByDiff: {},
    lineCount: 1,
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

function apply(files: Record<string, FileReviewState>, diff: string) {
  return applyGitFileStateTransitions({
    files,
    diff,
    newRevisionId: "new",
    updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    newFiles: { "dest.ts": { fileId: "dest", lineCount: 1 } }
  });
}

test("rejects two copy sections targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/b.ts b/dest.ts", "similarity index 100%", "copy from b.ts", "copy to dest.ts", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff), /duplicate destination/i);
});

test("rejects copy and addition sections targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null", "+++ b/dest.ts",
    "@@ -0,0 +1 @@", "+new", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /duplicate destination/i);
});

test("rejects copy and timestamp-suffixed addition targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null",
    "+++ b/dest.ts\t2026-07-25 13:50:00.000000000 +0900", "@@ -0,0 +1 @@", "+new", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /duplicate destination/i);
});

test("rejects incomplete and duplicate rename metadata", () => {
  const malformedDiffs = [
    ["diff --git a/a.ts b/b.ts", "similarity index 100%", "rename from a.ts", ""].join("\n"),
    ["diff --git a/a.ts b/b.ts", "similarity index 100%", "rename to b.ts", ""].join("\n"),
    ["diff --git a/a.ts b/b.ts", "similarity index 100%", "rename from a.ts", "rename from c.ts", "rename to b.ts", ""].join("\n"),
    ["diff --git a/a.ts b/b.ts", "similarity index 100%", "rename from a.ts", "rename to b.ts", "rename to c.ts", ""].join("\n")
  ];
  for (const diff of malformedDiffs) {
    assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /rename metadata/i);
  }
});

test("rejects add and delete sections whose headers contradict file status", () => {
  const malformedDiffs = [
    ["diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null", "+++ /dev/null\t2026-07-25 13:50:00 +0900", ""].join("\n"),
    ["diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null", "+++ \"/dev/null\"", ""].join("\n"),
    ["diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- a/dest.ts", "+++ b/dest.ts", ""].join("\n"),
    ["diff --git a/a.ts b/a.ts", "deleted file mode 100644", "--- /dev/null", "+++ /dev/null", ""].join("\n"),
    ["diff --git a/a.ts b/a.ts", "deleted file mode 100644", "--- a/a.ts", "+++ b/a.ts", ""].join("\n")
  ];
  for (const diff of malformedDiffs) {
    assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /file mode|header side/i);
  }
});

test("rejects non-canonical modifiedReviewed on unchanged files", () => {
  const malformed = [
    [{ startLine: 0, endLineExclusive: 1 }, { startLine: 1, endLineExclusive: 2 }],
    [{ startLine: 1, endLineExclusive: 2 }, { startLine: 0, endLineExclusive: 1 }],
    [{ startLine: 0, endLineExclusive: 0 }],
    [{ startLine: 0, endLineExclusive: 1 }, { startLine: 0, endLineExclusive: 1 }]
  ];
  for (const modifiedReviewed of malformed) {
    assert.throws(() => applyGitFileStateTransitions({
      files: { a: state("a", "a.ts", { lineCount: 2, modifiedReviewed }) }, diff: "",
      newRevisionId: "new", updatedAt, options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    }), /modifiedReviewed.*canonical/i);
  }
});

test("rejects invalid originalReviewedByDiff state", () => {
  const invalidStates = [
    state("a", "a.ts", { originalReviewedByDiff: { "": [{ startLine: 0, endLineExclusive: 1 }] } }),
    state("a", "a.ts", { originalReviewedByDiff: { d: [{ startLine: -1, endLineExclusive: 1 }] } }),
    state("a", "a.ts", { originalReviewedByDiff: { d: [{ startLine: 1, endLineExclusive: 1 }] } }),
    state("a", "a.ts", { originalReviewedByDiff: { d: [{ startLine: 0, endLineExclusive: Number.NaN }] } }),
    state("a", "a.ts", { originalReviewedByDiff: { d: [{ startLine: 0, endLineExclusive: 2 }, { startLine: 1, endLineExclusive: 3 }] } })
  ];
  for (const file of invalidStates) {
    assert.throws(() => applyGitFileStateTransitions({
      files: { a: file }, diff: "", newRevisionId: "new", updatedAt,
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    }), /originalReviewedByDiff/i);
  }
});

test("rejects unsupported schema and invalid previous paths", () => {
  assert.throws(() => applyGitFileStateTransitions({
    files: { a: state("a", "a.ts", { schemaVersion: 2 as 1 }) }, diff: "", newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  }), /schemaVersion/i);
  assert.throws(() => applyGitFileStateTransitions({
    files: { a: state("a", "a.ts", { previousPaths: ["", "a.ts"] }) }, diff: "", newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  }), /previousPaths/i);
});

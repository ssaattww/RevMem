import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewState } from "../../src/core/contracts/index";
import { applyGitFileStateTransitions } from "../../src/core/git-diff/index";

const options = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false
} as const;
const updatedAt = "2026-07-25T01:00:00.000Z";

function state(fileId: string, currentPath: string, overrides: Partial<FileReviewState> = {}): FileReviewState {
  return {
    schemaVersion: 1,
    fileId,
    currentPath,
    previousPaths: [],
    revisionId: "old",
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 4 }],
    originalReviewedByDiff: {},
    lineCount: 4,
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

function apply(files: Record<string, FileReviewState>, diff: string, extra: Record<string, unknown> = {}) {
  return applyGitFileStateTransitions({
    files,
    diff,
    newRevisionId: "new",
    updatedAt,
    options,
    ...extra
  });
}

test("follows a 100 percent rename while preserving stable identity and content hash", () => {
  const diff = [
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 100%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    ""
  ].join("\n");
  const result = apply({ file1: state("file1", "src/old.ts", { contentHash: "same" }) }, diff);

  assert.deepEqual(result.unresolved, []);
  assert.equal(result.files.file1?.currentPath, "src/new.ts");
  assert.equal(result.files.file1?.contentHash, "same");
  assert.deepEqual(result.files.file1?.previousPaths, ["src/old.ts"]);
  assert.deepEqual(result.files.file1?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 4 }]);
});

test("maps content-changing rename and replaces stale content hash", () => {
  const diff = [
    "diff --git a/lib/old.ts b/lib/new.ts",
    "similarity index 75%",
    "rename from lib/old.ts",
    "rename to lib/new.ts",
    "--- a/lib/old.ts",
    "+++ b/lib/new.ts",
    "@@ -2 +2 @@",
    "-old",
    "+changed",
    ""
  ].join("\n");
  const result = apply({ file1: state("file1", "lib/old.ts", { contentHash: "stale" }) }, diff, {
    newFiles: { "lib/new.ts": { fileId: "file1", lineCount: 4, contentHash: "fresh", newText: "one\nchanged\nthree\nfour\n" } },
    oldTexts: { "lib/old.ts": "one\nold\nthree\nfour\n" }
  });

  assert.equal(result.files.file1?.contentHash, "fresh");
  assert.deepEqual(result.files.file1?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
});

test("resolves rename chains from the pre-transition snapshot", () => {
  const diff = [
    "diff --git a/a.ts b/b.ts",
    "similarity index 100%",
    "rename from a.ts",
    "rename to b.ts",
    "diff --git a/b.ts b/c.ts",
    "similarity index 100%",
    "rename from b.ts",
    "rename to c.ts",
    ""
  ].join("\n");
  const result = apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff);

  assert.equal(result.files.a?.currentPath, "b.ts");
  assert.equal(result.files.b?.currentPath, "c.ts");
});

test("resolves rename swaps without section-order dependence", () => {
  const diff = [
    "diff --git a/a.ts b/b.ts",
    "similarity index 100%",
    "rename from a.ts",
    "rename to b.ts",
    "diff --git a/b.ts b/a.ts",
    "similarity index 100%",
    "rename from b.ts",
    "rename to a.ts",
    ""
  ].join("\n");
  const result = apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff);

  assert.equal(result.files.a?.currentPath, "b.ts");
  assert.equal(result.files.b?.currentPath, "a.ts");
});

test("allows a destination occupied only by a file deleted in the same diff", () => {
  const diff = [
    "diff --git a/b.ts b/b.ts",
    "deleted file mode 100644",
    "--- a/b.ts",
    "+++ /dev/null",
    "@@ -1,4 +0,0 @@",
    "-1", "-2", "-3", "-4",
    "diff --git a/a.ts b/b.ts",
    "similarity index 100%",
    "rename from a.ts",
    "rename to b.ts",
    ""
  ].join("\n");
  const result = apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff);

  assert.equal(result.files.b, undefined);
  assert.equal(result.files.a?.currentPath, "b.ts");
  assert.deepEqual(result.deletedFileIds, ["b"]);
});

test("clears source review and creates unreviewed destinations for ambiguous copies", () => {
  const diff = [
    "diff --git a/source.ts b/copy-a.ts",
    "similarity index 100%",
    "copy from source.ts",
    "copy to copy-a.ts",
    "diff --git a/source.ts b/copy-b.ts",
    "similarity index 100%",
    "copy from source.ts",
    "copy to copy-b.ts",
    ""
  ].join("\n");
  const result = apply({ source: state("source", "source.ts") }, diff, {
    newFiles: {
      "copy-a.ts": { fileId: "copy-a", lineCount: 4 },
      "copy-b.ts": { fileId: "copy-b", lineCount: 4 }
    }
  });

  assert.deepEqual(result.files.source?.modifiedReviewed, []);
  assert.deepEqual(result.files["copy-a"]?.modifiedReviewed, []);
  assert.deepEqual(result.files["copy-b"]?.modifiedReviewed, []);
  assert.equal(result.unresolved.length, 2);
});

test("creates a plain added file as new unreviewed state", () => {
  const diff = [
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1,2 @@",
    "+one",
    "+two",
    ""
  ].join("\n");
  const result = apply({}, diff, {
    newFiles: { "new.ts": { fileId: "new-id", lineCount: 2, contentHash: "new-hash" } }
  });

  assert.equal(result.files["new-id"]?.currentPath, "new.ts");
  assert.deepEqual(result.files["new-id"]?.modifiedReviewed, []);
  assert.equal(result.files["new-id"]?.contentHash, "new-hash");
});

test("preserves whitespace-only rename changes only when complete texts prove the setting", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts",
    "similarity index 90%",
    "rename from old.ts",
    "rename to new.ts",
    "--- a/old.ts",
    "+++ b/new.ts",
    "@@ -1 +1 @@",
    "-const value = 1;",
    "+const  value = 1;",
    ""
  ].join("\n");
  const result = applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 1, modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }] }) },
    diff,
    newRevisionId: "new",
    updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const value = 1;\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 1, newText: "const  value = 1;\n" } }
  });

  assert.deepEqual(result.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
});

test("invalidates ambiguous rename source when two destinations compete", () => {
  const diff = [
    "diff --git a/source.ts b/a.ts",
    "similarity index 100%",
    "rename from source.ts",
    "rename to a.ts",
    "diff --git a/source.ts b/b.ts",
    "similarity index 100%",
    "rename from source.ts",
    "rename to b.ts",
    ""
  ].join("\n");
  const result = apply({ source: state("source", "source.ts") }, diff, {
    newFiles: {
      "a.ts": { fileId: "a", lineCount: 4 },
      "b.ts": { fileId: "b", lineCount: 4 }
    }
  });

  assert.deepEqual(result.files.source?.modifiedReviewed, []);
  assert.equal(result.files.source?.contentHash, undefined);
  assert.deepEqual(result.files.a?.modifiedReviewed, []);
  assert.deepEqual(result.files.b?.modifiedReviewed, []);
});

test("rejects malformed duplicate and trailing copy metadata", () => {
  const duplicate = [
    "diff --git a/a.ts b/b.ts",
    "copy from a.ts",
    "copy from c.ts",
    "copy to b.ts",
    ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, duplicate), /duplicate/i);

  const trailing = [
    "diff --git a/a.ts b/b.ts",
    "copy from \"a.ts\"junk",
    "copy to b.ts",
    ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, trailing), /trailing|quoted/i);
});

test("rejects invalid state line counts and reviewed intervals", () => {
  const diff = [
    "diff --git a/a.ts b/b.ts",
    "similarity index 100%",
    "rename from a.ts",
    "rename to b.ts",
    ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts", { lineCount: -1 }) }, diff), /lineCount/);
  assert.throws(() => apply({
    a: state("a", "a.ts", { modifiedReviewed: [{ startLine: 0, endLineExclusive: 5 }] })
  }, diff), /interval/);
});

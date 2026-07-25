import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewState } from "../../src/core/contracts/index";
import { applyGitFileStateTransitions } from "../../src/core/git-diff/index";

const options = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false
} as const;

function state(fileId: string, currentPath: string): FileReviewState {
  return {
    schemaVersion: 1,
    fileId,
    currentPath,
    previousPaths: [],
    revisionId: "old",
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 4 }],
    originalReviewedByDiff: {},
    lineCount: 4,
    updatedAt: "2026-07-25T00:00:00.000Z"
  };
}

test("follows a 100 percent rename while preserving stable file identity", () => {
  const diff = [
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 100%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    ""
  ].join("\n");

  const result = applyGitFileStateTransitions({
    files: { file1: state("file1", "src/old.ts") },
    diff,
    newRevisionId: "new",
    updatedAt: "2026-07-25T01:00:00.000Z",
    options
  });

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.deletedFileIds, []);
  assert.equal(result.files.file1?.currentPath, "src/new.ts");
  assert.deepEqual(result.files.file1?.previousPaths, ["src/old.ts"]);
  assert.deepEqual(result.files.file1?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 4 }]);
});

test("maps reviewed intervals through an unambiguous rename with content changes", () => {
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

  const result = applyGitFileStateTransitions({
    files: { file1: state("file1", "lib/old.ts") },
    diff,
    newRevisionId: "new",
    updatedAt: "2026-07-25T01:00:00.000Z",
    options
  });

  assert.equal(result.files.file1?.currentPath, "lib/new.ts");
  assert.deepEqual(result.files.file1?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
});

test("applies directory moves represented by independent unambiguous renames", () => {
  const diff = [
    "diff --git a/old/a.ts b/new/a.ts",
    "similarity index 100%",
    "rename from old/a.ts",
    "rename to new/a.ts",
    "diff --git a/old/b.ts b/new/b.ts",
    "similarity index 100%",
    "rename from old/b.ts",
    "rename to new/b.ts",
    ""
  ].join("\n");

  const result = applyGitFileStateTransitions({
    files: {
      a: state("a", "old/a.ts"),
      b: state("b", "old/b.ts")
    },
    diff,
    newRevisionId: "new",
    updatedAt: "2026-07-25T01:00:00.000Z",
    options
  });

  assert.equal(result.files.a?.currentPath, "new/a.ts");
  assert.equal(result.files.b?.currentPath, "new/b.ts");
});

test("removes deleted files from active state and reports their stable identities", () => {
  const diff = [
    "diff --git a/src/deleted.ts b/src/deleted.ts",
    "deleted file mode 100644",
    "--- a/src/deleted.ts",
    "+++ /dev/null",
    "@@ -1,4 +0,0 @@",
    "-one",
    "-two",
    "-three",
    "-four",
    ""
  ].join("\n");

  const result = applyGitFileStateTransitions({
    files: { file1: state("file1", "src/deleted.ts") },
    diff,
    newRevisionId: "new",
    updatedAt: "2026-07-25T01:00:00.000Z",
    options
  });

  assert.equal(result.files.file1, undefined);
  assert.deepEqual(result.deletedFileIds, ["file1"]);
});

test("does not transfer reviewed state through copies, splits, merges, or duplicate candidates", () => {
  const diff = [
    "diff --git a/src/source.ts b/src/copy-a.ts",
    "similarity index 100%",
    "copy from src/source.ts",
    "copy to src/copy-a.ts",
    "diff --git a/src/source.ts b/src/copy-b.ts",
    "similarity index 100%",
    "copy from src/source.ts",
    "copy to src/copy-b.ts",
    ""
  ].join("\n");

  const result = applyGitFileStateTransitions({
    files: { source: state("source", "src/source.ts") },
    diff,
    newRevisionId: "new",
    updatedAt: "2026-07-25T01:00:00.000Z",
    options
  });

  assert.equal(result.files.source?.currentPath, "src/source.ts");
  assert.deepEqual(result.files.source?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 4 }]);
  assert.equal(result.unresolved.length, 2);
  assert.ok(result.unresolved.every((entry) => entry.reason === "ambiguous-file-mapping"));
});

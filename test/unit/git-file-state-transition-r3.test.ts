import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewState } from "../../src/core/contracts/index";
import { applyGitFileStateTransitions } from "../../src/core/git-diff/index";

const updatedAt = "2026-07-25T04:30:00.000Z";

function state(fileId: string, currentPath: string): FileReviewState {
  return {
    schemaVersion: 1,
    fileId,
    currentPath,
    previousPaths: [],
    revisionId: "old",
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
    originalReviewedByDiff: {},
    lineCount: 1,
    updatedAt: "2026-07-25T00:00:00.000Z"
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
    "diff --git a/a.ts b/dest.ts",
    "similarity index 100%",
    "copy from a.ts",
    "copy to dest.ts",
    "diff --git a/b.ts b/dest.ts",
    "similarity index 100%",
    "copy from b.ts",
    "copy to dest.ts",
    ""
  ].join("\n");

  assert.throws(
    () => apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff),
    /duplicate destination/i
  );
});

test("rejects copy and addition sections targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts",
    "similarity index 100%",
    "copy from a.ts",
    "copy to dest.ts",
    "diff --git a/dest.ts b/dest.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/dest.ts",
    "@@ -0,0 +1 @@",
    "+new",
    ""
  ].join("\n");

  assert.throws(
    () => apply({ a: state("a", "a.ts") }, diff),
    /duplicate destination/i
  );
});

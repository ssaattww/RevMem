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

function renameDiff(oldPath: string, newPath: string): string {
  return [
    `diff --git a/${oldPath} b/${newPath}`,
    "similarity index 100%",
    `rename from ${oldPath}`,
    `rename to ${newPath}`,
    ""
  ].join("\n");
}

/** Verifies that two copy sections cannot create competing states for one destination path. */
test("rejects two copy sections targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/b.ts b/dest.ts", "similarity index 100%", "copy from b.ts", "copy to dest.ts", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts"), b: state("b", "b.ts") }, diff), /duplicate destination/i);
});

/** Verifies that copy and add sections cannot both claim the same destination path. */
test("rejects copy and addition sections targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null", "+++ b/dest.ts",
    "@@ -0,0 +1 @@", "+new", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /duplicate destination/i);
});

/** Verifies that timestamp-bearing file headers do not bypass duplicate destination validation. */
test("rejects copy and timestamp-suffixed addition targeting the same destination", () => {
  const diff = [
    "diff --git a/a.ts b/dest.ts", "similarity index 100%", "copy from a.ts", "copy to dest.ts",
    "diff --git a/dest.ts b/dest.ts", "new file mode 100644", "--- /dev/null",
    "+++ b/dest.ts\t2026-07-25 13:50:00.000000000 +0900", "@@ -0,0 +1 @@", "+new", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /duplicate destination/i);
});

/** Verifies that every rename declares exactly one source and destination without duplicate metadata. */
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

/** Verifies that add and delete status metadata agrees with the required /dev/null header sides. */
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

/** Verifies that input reviewed intervals must already be sorted, disjoint, and non-empty. */
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
    }), /modifiedReviewed.*(canonical|invalid interval)/i);
  }
});

/** Verifies that original-side review maps require non-empty IDs and canonical valid intervals. */
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

/** Verifies that unsupported schemas and non-canonical rename history are rejected before transition work. */
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

/** Verifies that new destination metadata requires a non-empty stable ID, valid count, and non-empty hash when supplied. */
test("rejects invalid new-file metadata before creating output state", () => {
  const diff = [
    "diff --git a/new.ts b/new.ts", "new file mode 100644", "--- /dev/null", "+++ b/new.ts",
    "@@ -0,0 +1 @@", "+new", ""
  ].join("\n");
  for (const metadata of [
    { fileId: "", lineCount: 1 },
    { fileId: "new", lineCount: 1, contentHash: "" }
  ]) {
    assert.throws(() => applyGitFileStateTransitions({
      files: {}, diff, newRevisionId: "new", updatedAt,
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
      newFiles: { "new.ts": metadata }
    }), /newFiles.*(fileId|contentHash)/i);
  }
});

/** Verifies that ignored-EOL mapping rejects supplied full text that does not reproduce the diff hunk. */
test("rejects unrelated full-text evidence for ignored EOL changes", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-oldValue", "+newValue", ""
  ].join("\n");
  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 2 }) }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: true },
    oldTexts: { "old.ts": "same\r\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "same\n" } }
  }), /text evidence.*diff hunk/i);
});

/** Verifies that destination full text must agree with its declared VS Code line count. */
test("rejects full-text evidence whose VS Code line count disagrees with metadata", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-old", "+new", ""
  ].join("\n");
  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 2 }) }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "old\n" },
    newFiles: {
      "new.ts": {
        fileId: "file",
        lineCount: 1,
        physicalLineCount: 1,
        newText: "new\n"
      }
    }
  }), /newFiles.*newText.*lineCount/i);
});

/** Verifies that terminal-EOL and empty text preserve the separate VS Code and physical line-count contracts. */
test("accepts matching VS Code and physical line counts for terminal EOL and empty text", () => {
  const terminalDiff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-old", "+new", ""
  ].join("\n");
  const emptyDiff = [
    "diff --git a/empty-old.ts b/empty-new.ts", "similarity index 100%",
    "rename from empty-old.ts", "rename to empty-new.ts", ""
  ].join("\n");

  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 2 }) }, diff: terminalDiff,
    newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "old\n" },
    newFiles: {
      "new.ts": { fileId: "file", lineCount: 2, physicalLineCount: 1, newText: "new\n" }
    }
  }));
  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "empty-old.ts", { lineCount: 1 }) }, diff: emptyDiff,
    newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "empty-old.ts": "" },
    newFiles: {
      "empty-new.ts": { fileId: "file", lineCount: 1, physicalLineCount: 0, newText: "" }
    }
  }));
});

/** Verifies that full-text source evidence uses the VS Code document line-count contract. */
test("validates source VS Code line counts for terminal EOL, empty, and non-terminal text", () => {
  const terminalDiff = [
    "diff --git a/terminal-old.ts b/terminal-new.ts", "similarity index 100%",
    "rename from terminal-old.ts", "rename to terminal-new.ts", ""
  ].join("\n");
  const emptyDiff = [
    "diff --git a/empty-old.ts b/empty-new.ts", "similarity index 100%",
    "rename from empty-old.ts", "rename to empty-new.ts", ""
  ].join("\n");
  const noTerminalDiff = [
    "diff --git a/plain-old.ts b/plain-new.ts", "similarity index 100%",
    "rename from plain-old.ts", "rename to plain-new.ts", ""
  ].join("\n");

  for (const fixture of [
    {
      diff: terminalDiff, oldPath: "terminal-old.ts", newPath: "terminal-new.ts",
      text: "line\n", lineCount: 2
    },
    {
      diff: emptyDiff, oldPath: "empty-old.ts", newPath: "empty-new.ts",
      text: "", lineCount: 1
    },
    {
      diff: noTerminalDiff, oldPath: "plain-old.ts", newPath: "plain-new.ts",
      text: "line", lineCount: 1
    }
  ]) {
    assert.doesNotThrow(() => applyGitFileStateTransitions({
      files: {
        file: state("file", fixture.oldPath, {
          lineCount: fixture.lineCount,
          modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }]
        })
      },
      diff: fixture.diff,
      newRevisionId: "new",
      updatedAt,
      options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
      oldTexts: { [fixture.oldPath]: fixture.text },
      newFiles: {
        [fixture.newPath]: {
          fileId: "file",
          lineCount: fixture.lineCount,
          newText: fixture.text
        }
      }
    }));
  }

  assert.throws(() => applyGitFileStateTransitions({
    files: {
      file: state("file", "stale-old.ts", {
        lineCount: 2,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }]
      })
    },
    diff: [
      "diff --git a/stale-old.ts b/stale-new.ts", "similarity index 100%",
      "rename from stale-old.ts", "rename to stale-new.ts", ""
    ].join("\n"),
    newRevisionId: "new",
    updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "stale-old.ts": "line" },
    newFiles: { "stale-new.ts": { fileId: "file", lineCount: 1, newText: "line" } }
  }), /oldTexts.*lineCount/i);

  assert.throws(() => applyGitFileStateTransitions({
    files: {},
    diff: [
      "diff --git a/missing-old.ts b/missing-new.ts", "similarity index 100%",
      "rename from missing-old.ts", "rename to missing-new.ts", ""
    ].join("\n"),
    newRevisionId: "new",
    updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "missing-old.ts": "line" },
    newFiles: { "missing-new.ts": { fileId: "file", lineCount: 1, newText: "line" } }
  }), /oldTexts.*source path/i);
});

/** Verifies that returning to a historical path removes it from history and records only the prior current path. */
test("allows renaming a file back to a previous path without duplicating history", () => {
  const result = applyGitFileStateTransitions({
    files: { file: state("file", "b.ts", { previousPaths: ["a.ts"] }) },
    diff: renameDiff("b.ts", "a.ts"),
    newRevisionId: "new",
    updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  });
  assert.equal(result.files.file?.currentPath, "a.ts");
  assert.deepEqual(result.files.file?.previousPaths, ["b.ts"]);
});

/** Verifies that successive A-to-B-to-A renames retain a canonical history without the current path. */
test("preserves canonical history across a to b to a renames", () => {
  const first = applyGitFileStateTransitions({
    files: { file: state("file", "a.ts") },
    diff: renameDiff("a.ts", "b.ts"),
    newRevisionId: "r2",
    updatedAt,
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  });
  const second = applyGitFileStateTransitions({
    files: first.files,
    diff: renameDiff("b.ts", "a.ts"),
    newRevisionId: "r3",
    updatedAt: "2026-07-25T04:31:00.000Z",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  });
  assert.equal(second.files.file?.currentPath, "a.ts");
  assert.deepEqual(second.files.file?.previousPaths, ["b.ts"]);
});

/** Verifies that one source cannot be both deleted and renamed by the same atomic transition. */
test("rejects delete and rename operations that consume the same source", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts", "deleted file mode 100644", "--- a/a.ts", "+++ /dev/null",
    "diff --git a/a.ts b/b.ts", "similarity index 100%", "rename from a.ts", "rename to b.ts", ""
  ].join("\n");
  assert.throws(() => apply({ a: state("a", "a.ts") }, diff), /source operation|delete.*rename/i);
});

/** Verifies that duplicate delete sections for one source are rejected before output construction. */
test("rejects duplicate delete operations for the same source", () => {
  const section = [
    "diff --git a/a.ts b/a.ts", "deleted file mode 100644", "--- a/a.ts", "+++ /dev/null"
  ];
  assert.throws(
    () => apply({ a: state("a", "a.ts") }, [...section, ...section, ""].join("\n")),
    /duplicate delete|source operation/i
  );
});

/** Verifies that an explicitly deleted stable ID is absent from the returned active snapshot. */
test("never returns a file ID in both files and deletedFileIds", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts", "deleted file mode 100644", "--- a/a.ts", "+++ /dev/null",
    "@@ -1 +0,0 @@", "-old", ""
  ].join("\n");
  const result = apply({ a: state("a", "a.ts") }, diff);
  assert.equal(result.files.a, undefined);
  assert.deepEqual(result.deletedFileIds, ["a"]);
  for (const fileId of result.deletedFileIds) {
    assert.equal(fileId in result.files, false);
  }
});

/** Verifies that complete-text evidence rejects a semantic change after a valid ignored-whitespace hunk. */
test("rejects hunk-after semantic changes hidden by otherwise valid full-text evidence", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const value = 1;", "+const  value = 1;", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 4, modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const value = 1;\nconst later = 1;\nconst tail = 1;\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 4, newText: "const  value = 1;\nconst later = 2;\nconst tail = 1;\n" } }
  }), /full-text evidence/i);
});

/** Verifies that complete-text evidence rejects a semantic change between two valid ignored-whitespace hunks. */
test("rejects semantic changes hidden between valid full-text evidence hunks", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const first = 1;", "+const  first = 1;",
    "@@ -5 +5 @@", "-const last = 1;", "+const  last = 1;", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 6, modifiedReviewed: [{ startLine: 0, endLineExclusive: 5 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const first = 1;\nconst middle = 1;\nconst third = 1;\nconst fourth = 1;\nconst last = 1;\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 6, newText: "const  first = 1;\nconst middle = 2;\nconst third = 1;\nconst fourth = 1;\nconst  last = 1;\n" } }
  }), /full-text evidence/i);
});

/** Verifies that complete-text evidence rejects a semantic change at the end after a valid ignored-whitespace hunk. */
test("rejects tail semantic changes hidden by otherwise valid full-text evidence", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const value = 1;", "+const  value = 1;", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 3, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const value = 1;\nconst tail = 1;\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 3, newText: "const  value = 1;\nconst tail = 2;\n" } }
  }), /full-text evidence/i);
});

/** Verifies that a hunk-external CRLF-to-LF change rejects otherwise valid whitespace-only evidence when EOL changes are not ignored. */
test("rejects hunk-after EOL changes hidden by otherwise valid whitespace evidence", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const value = 1;", "+const  value = 1;", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 3, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const value = 1;\r\nconst later = 1;\r\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 3, newText: "const  value = 1;\r\nconst later = 1;\n" } }
  }), /full-text evidence/i);
});

/** Verifies that an EOL change between two valid whitespace-only hunks rejects the complete evidence when EOL changes are not ignored. */
test("rejects EOL changes hidden between valid whitespace evidence hunks", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const first = 1;", "+const  first = 1;",
    "@@ -4 +4 @@", "-const last = 1;", "+const  last = 1;", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 5, modifiedReviewed: [{ startLine: 0, endLineExclusive: 4 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const first = 1;\r\nconst middle = 1;\r\nconst third = 1;\r\nconst last = 1;\r\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 5, newText: "const  first = 1;\r\nconst middle = 1;\nconst third = 1;\r\nconst  last = 1;\r\n" } }
  }), /full-text evidence/i);
});

/** Verifies that a terminal newline addition rejects otherwise valid whitespace-only evidence when EOL changes are not ignored. */
test("rejects terminal newline changes hidden by otherwise valid whitespace evidence", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const value = 1;", "+const  value = 1;", "\\ No newline at end of file", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts") }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "const value = 1;" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "const  value = 1;\n" } }
  }), /full-text evidence/i);
});

/** Verifies that EOL-ignore preserves reviewed ranges for the same hunk-external and terminal EOL evidence. */
test("allows hunk-external and terminal EOL changes when EOL changes are ignored", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1 @@", "-const value = 1;", "+const  value = 1;", ""
  ].join("\n");
  const external = applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 3, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) },
    diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    oldTexts: { "old.ts": "const value = 1;\r\nconst later = 1;\r\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 3, newText: "const  value = 1;\r\nconst later = 1;\n" } }
  });
  const terminal = applyGitFileStateTransitions({
    files: { file: state("file", "old.ts") }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    oldTexts: { "old.ts": "const value = 1;" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "const  value = 1;\n" } }
  });

  assert.deepEqual(external.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 2 }]);
  assert.deepEqual(terminal.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
});

/** Verifies that count-increasing replacements and EOF zero-count insertions do not require unprovable new-line separators. */
test("allows count-increasing replacements and EOF insertions with EOL checking enabled", () => {
  const replacement = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1,2 @@", "-a", "+a", "+x", ""
  ].join("\n");
  const eofInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1,0 +2 @@", "+x", ""
  ].join("\n");
  const input = {
    files: { file: state("file", "old.ts") }, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "a" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "a\nx" } }
  } as const;

  assert.doesNotThrow(() => applyGitFileStateTransitions({ ...input, diff: replacement }));
  assert.doesNotThrow(() => applyGitFileStateTransitions({ ...input, diff: eofInsertion }));
});

/** Verifies that first and middle insertions plus line-count-decreasing and EOF deletions retain only provable EOL boundaries. */
test("allows count-changing insertion and deletion boundaries that retain a valid complete document", () => {
  const firstInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -0,0 +1 @@", "+x", ""
  ].join("\n");
  const middleInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1,0 +2 @@", "+x", ""
  ].join("\n");
  const deletion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -2 +1,0 @@", "-b", ""
  ].join("\n");
  const options = { ignoreWhitespaceChanges: true, ignoreEolChanges: false } as const;

  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts") }, diff: firstInsertion, newRevisionId: "new", updatedAt, options,
    oldTexts: { "old.ts": "a" }, newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "x\na" } }
  }));
  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 2, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) }, diff: middleInsertion, newRevisionId: "new", updatedAt, options,
    oldTexts: { "old.ts": "a\nb" }, newFiles: { "new.ts": { fileId: "file", lineCount: 3, newText: "a\nx\nb" } }
  }));
  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 3, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) }, diff: deletion, newRevisionId: "new", updatedAt, options,
    oldTexts: { "old.ts": "a\nb\n" }, newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "a\n" } }
  }));
});

/** Verifies that an EOL change outside a count-changing hunk remains rejected when EOL changes are not ignored. */
test("rejects unprovable hunk-external EOL changes after a count-changing replacement", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1,2 @@", "-a", "+a", "+x", ""
  ].join("\n");

  assert.throws(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts", { lineCount: 3, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }] }) }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "a\nb\n" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 3, newText: "a\nx\nb" } }
  }), /EOL signature/i);
});

/** Verifies that EOL-ignore continues to accept the same count-changing replacement and EOF insertion evidence. */
test("allows count-changing replacement and EOF insertion when EOL changes are ignored", () => {
  const replacement = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1 +1,2 @@", "-a", "+a", "+x", ""
  ].join("\n");
  const eofInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1,0 +2 @@", "+x", ""
  ].join("\n");
  const input = {
    files: { file: state("file", "old.ts") }, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    oldTexts: { "old.ts": "a" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "a\nx" } }
  } as const;

  assert.doesNotThrow(() => applyGitFileStateTransitions({ ...input, diff: replacement }));
  assert.doesNotThrow(() => applyGitFileStateTransitions({ ...input, diff: eofInsertion }));
});

/** Verifies that EOF insertions cannot hide changes to pre-existing CRLF, LF, CR, or repeated terminal separators. */
test("rejects EOL changes before EOF insertions when EOL changes are not ignored", () => {
  const singleLineInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1,0 +2 @@", "+x", ""
  ].join("\n");
  const repeatedTerminalInsertion = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -2,0 +3 @@", "+x", ""
  ].join("\n");
  const options = { ignoreWhitespaceChanges: true, ignoreEolChanges: false } as const;
  const cases = [
    { oldText: "a\r\n", newText: "a\nx", diff: singleLineInsertion, oldLineCount: 2, lineCount: 2 },
    { oldText: "a\n", newText: "a\rx", diff: singleLineInsertion, oldLineCount: 2, lineCount: 2 },
    { oldText: "a\r", newText: "a\r\nx", diff: singleLineInsertion, oldLineCount: 2, lineCount: 2 },
    { oldText: "a\r\n\r\n", newText: "a\r\n\nx", diff: repeatedTerminalInsertion, oldLineCount: 3, lineCount: 3 }
  ] as const;

  for (const { oldText, newText, diff, oldLineCount, lineCount } of cases) {
    assert.throws(() => applyGitFileStateTransitions({
      files: { file: state("file", "old.ts", { lineCount: oldLineCount }) }, diff, newRevisionId: "new", updatedAt, options,
      oldTexts: { "old.ts": oldText },
      newFiles: { "new.ts": { fileId: "file", lineCount, newText } }
    }), /EOL signature/i);
  }
});

/** Verifies that an EOF insertion after a line without a terminal newline remains valid with EOL checking enabled. */
test("allows EOF insertion after a missing terminal newline when EOL changes are not ignored", () => {
  const diff = [
    "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts",
    "--- a/old.ts", "+++ b/new.ts", "@@ -1,0 +2 @@", "+x", ""
  ].join("\n");

  assert.doesNotThrow(() => applyGitFileStateTransitions({
    files: { file: state("file", "old.ts") }, diff, newRevisionId: "new", updatedAt,
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: false },
    oldTexts: { "old.ts": "a" },
    newFiles: { "new.ts": { fileId: "file", lineCount: 2, newText: "a\nx" } }
  }));
});

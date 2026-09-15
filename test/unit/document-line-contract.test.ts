import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDocumentLineContract,
  type RevisionDocumentText
} from "../../src/core/intervals/index";

const present = (content: string): RevisionDocumentText => ({
  existence: "present",
  content
});

const absent: RevisionDocumentText = { existence: "absent" };

test("document line contract distinguishes absent documents from present empty documents", () => {
  assert.deepEqual(deriveDocumentLineContract(absent), {
    existence: "absent",
    editorLineCount: 0,
    diffContentLineCount: 0,
    terminalNewline: "none"
  });
  assert.deepEqual(deriveDocumentLineContract(present("")), {
    existence: "present",
    editorLineCount: 1,
    diffContentLineCount: 0,
    terminalNewline: "none"
  });
});

test("document line contract derives the EOF newline table from present revision text", () => {
  const cases: ReadonlyArray<readonly [string, string, number, number, "none" | "lf" | "crlf"]> = [
    ["content without a terminal newline", "new", 1, 1, "none"],
    ["LF-terminated content", "new\n", 2, 1, "lf"],
    ["CRLF-terminated content", "new\r\n", 2, 1, "crlf"],
    ["one newline-only content line", "\n", 2, 1, "lf"],
    ["multiple terminal newlines retain real blank content lines", "new\n\n", 3, 2, "lf"],
    ["multiple CRLF terminal newlines retain real blank content lines", "new\r\n\r\n", 3, 2, "crlf"],
    ["interior line breaks without a terminal newline", "first\r\nsecond\nthird", 3, 3, "none"]
  ];

  for (const [description, content, editorLineCount, diffContentLineCount, terminalNewline] of cases) {
    assert.deepEqual(deriveDocumentLineContract(present(content)), {
      existence: "present",
      editorLineCount,
      diffContentLineCount,
      terminalNewline
    }, description);
  }
});

test("document line contract covers each revision pair in the EOF acceptance table", () => {
  const cases: ReadonlyArray<Readonly<{
    readonly description: string;
    readonly original: RevisionDocumentText;
    readonly modified: RevisionDocumentText;
    readonly originalCounts: readonly [number, number];
    readonly modifiedCounts: readonly [number, number];
  }>> = [
    { description: "new file without a terminal newline", original: absent, modified: present("new"), originalCounts: [0, 0], modifiedCounts: [1, 1] },
    { description: "new LF-terminated file", original: absent, modified: present("new\n"), originalCounts: [0, 0], modifiedCounts: [2, 1] },
    { description: "new CRLF-terminated file", original: absent, modified: present("new\r\n"), originalCounts: [0, 0], modifiedCounts: [2, 1] },
    { description: "deleted file without a terminal newline", original: present("old"), modified: absent, originalCounts: [1, 1], modifiedCounts: [0, 0] },
    { description: "deleted LF-terminated file", original: present("old\n"), modified: absent, originalCounts: [2, 1], modifiedCounts: [0, 0] },
    { description: "deleted CRLF-terminated file", original: present("old\r\n"), modified: absent, originalCounts: [2, 1], modifiedCounts: [0, 0] },
    { description: "replacement with terminal newlines on both sides", original: present("old\n"), modified: present("new\n"), originalCounts: [2, 1], modifiedCounts: [2, 1] },
    { description: "replacement that adds a terminal newline", original: present("old"), modified: present("new\n"), originalCounts: [1, 1], modifiedCounts: [2, 1] },
    { description: "replacement that removes a terminal newline", original: present("old\n"), modified: present("new"), originalCounts: [2, 1], modifiedCounts: [1, 1] },
    { description: "addition to an existing empty file", original: present(""), modified: present("new"), originalCounts: [1, 0], modifiedCounts: [1, 1] },
    { description: "emptying an existing file", original: present("old"), modified: present(""), originalCounts: [1, 1], modifiedCounts: [1, 0] },
    { description: "terminal newline addition only", original: present("same"), modified: present("same\n"), originalCounts: [1, 1], modifiedCounts: [2, 1] },
    { description: "terminal newline removal only", original: present("same\n"), modified: present("same"), originalCounts: [2, 1], modifiedCounts: [1, 1] }
  ];

  for (const entry of cases) {
    const original = deriveDocumentLineContract(entry.original);
    const modified = deriveDocumentLineContract(entry.modified);
    assert.deepEqual(
      [original.editorLineCount, original.diffContentLineCount],
      entry.originalCounts,
      `${entry.description}: original`
    );
    assert.deepEqual(
      [modified.editorLineCount, modified.diffContentLineCount],
      entry.modifiedCounts,
      `${entry.description}: modified`
    );
  }
});

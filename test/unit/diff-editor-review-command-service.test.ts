import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type { TextSelection } from "../../src/core/intervals/index";
import {
  DiffEditorReviewCommandService,
  deriveOriginalToModifiedLineMappings,
  projectOriginalIntervalsToModified,
  type DiffEditorReviewStateSession
} from "../../src/application/review-commands/index";

interface FakeEditor {
  readonly side: "original" | "modified";
  readonly lineCount: number;
  readonly selections: readonly TextSelection[];
}

const interval = (startLine: number, endLineExclusive: number) => ({ startLine, endLineExclusive });

const contextState = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "feature",
  branch: { refName: "refs/heads/feature", headRevision: "head-revision" },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "head-revision",
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      lineCount: 6,
      updatedAt: "2026-08-01T14:00:00.000Z"
    }
  },
  createdAt: "2026-08-01T13:00:00.000Z",
  updatedAt: "2026-08-01T14:00:00.000Z"
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "head-revision",
  files: {},
  updatedAt: "2026-08-01T14:00:00.000Z"
});

const session = (): DiffEditorReviewStateSession => ({
  contextState: contextState(),
  globalState: globalState(),
  target: { fileId: "file-1", currentPath: "src/example.ts", revisionId: "head-revision", lineCount: 6 },
  diffId: "base-revision..head-revision",
  originalLineCount: 5,
  originalDeletionIntervals: [interval(1, 3), interval(4, 5)],
  originalToModifiedLineMappings: [
    { originalStartLine: 0, modifiedStartLine: 0, lineCount: 1 },
    { originalStartLine: 3, modifiedStartLine: 4, lineCount: 1 }
  ],
  committer: { commit: async () => undefined }
});

const selection = (line: number): TextSelection => ({
  anchor: { line, character: 0 },
  active: { line, character: 0 }
});

test("editor context menu exposes all four review operations only for normal or PR Progress diff editors", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes?: { menus?: { "editor/context"?: Array<{ command?: string; when?: string }> } };
  };
  const items = manifest.contributes?.menus?.["editor/context"] ?? [];
  assert.equal(items.length, 7, "the existing editor/context contribution count is preserved");
  for (const command of [
    "reviewRange.markSelectionReviewed",
    "reviewRange.unmarkSelectionReviewed",
    "reviewRange.markFileReviewed",
    "reviewRange.unmarkFileReviewed"
  ]) {
    const item = items.find((candidate) => candidate.command === command);
    assert.ok(item, `${command} remains contributed exactly once`);
    assert.match(item.when ?? "", /!isInDiffEditor/u);
    assert.match(item.when ?? "", /reviewRange\.prProgressDiffReviewActions/u);
  }
});

test("derives original-to-modified mappings only from unchanged gaps and context lines", () => {
  const mappings = deriveOriginalToModifiedLineMappings({
    originalLineCount: 10,
    modifiedLineCount: 11,
    hunks: [
      {
        oldStart: 3,
        oldCount: 1,
        newStart: 3,
        newCount: 1,
        lines: [
          { kind: "deletion", oldLine: 3, text: "before" },
          { kind: "addition", newLine: 3, text: "after" }
        ]
      },
      {
        oldStart: 6,
        oldCount: 3,
        newStart: 6,
        newCount: 4,
        lines: [
          { kind: "context", oldLine: 6, newLine: 6, text: "same-six" },
          { kind: "deletion", oldLine: 7, text: "removed-seven" },
          { kind: "addition", newLine: 7, text: "added-seven" },
          { kind: "addition", newLine: 8, text: "added-eight" },
          { kind: "context", oldLine: 8, newLine: 9, text: "same-eight" }
        ]
      }
    ]
  });

  assert.deepEqual(mappings, [
    { originalStartLine: 0, modifiedStartLine: 0, lineCount: 2 },
    { originalStartLine: 3, modifiedStartLine: 3, lineCount: 3 },
    { originalStartLine: 7, modifiedStartLine: 8, lineCount: 3 }
  ]);
  assert.deepEqual(
    projectOriginalIntervalsToModified([interval(1, 9)], mappings),
    [interval(1, 2), interval(3, 6), interval(8, 10)]
  );
});

test("zero-count hunk anchors map only real lines before and after insertions or deletions", () => {
  assert.deepEqual(deriveOriginalToModifiedLineMappings({
    originalLineCount: 4,
    modifiedLineCount: 5,
    hunks: [{
      oldStart: 2,
      oldCount: 0,
      newStart: 3,
      newCount: 1,
      lines: [{ kind: "addition", newLine: 3, text: "inserted" }]
    }]
  }), [
    { originalStartLine: 0, modifiedStartLine: 0, lineCount: 2 },
    { originalStartLine: 2, modifiedStartLine: 3, lineCount: 2 }
  ]);

  assert.deepEqual(deriveOriginalToModifiedLineMappings({
    originalLineCount: 4,
    modifiedLineCount: 3,
    hunks: [{
      oldStart: 3,
      oldCount: 1,
      newStart: 2,
      newCount: 0,
      lines: [{ kind: "deletion", oldLine: 3, text: "deleted" }]
    }]
  }), [
    { originalStartLine: 0, modifiedStartLine: 0, lineCount: 2 },
    { originalStartLine: 3, modifiedStartLine: 2, lineCount: 1 }
  ]);
});

test("rejects ambiguous original-to-modified gaps instead of guessing", () => {
  assert.throws(() => deriveOriginalToModifiedLineMappings({
    originalLineCount: 4,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 3,
      oldCount: 1,
      newStart: 4,
      newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 3, text: "before" },
        { kind: "addition", newLine: 4, text: "after" }
      ]
    }]
  }), /gap|mapping|coordinate/i);
});

test("original-side mixed selection atomically updates mapped modified/Global and original-only ranges", async () => {
  const committed: unknown[] = [];
  const history: unknown[] = [];
  const state = session();
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => { committed.push(transaction); } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async (transaction) => { history.push(transaction); },
    now: () => new Date("2026-08-01T15:00:00.000Z")
  });

  assert.equal(await service.markSelectionReviewed({
    side: "original",
    lineCount: 5,
    selections: [selection(0), selection(1), selection(2), selection(3), selection(4)]
  }), "applied");
  assert.equal(committed.length, 1, "one user selection must cross the persistence boundary once");
  assert.equal(history.length, 1, "history receives the same composite transaction once");
  const transaction = committed[0] as {
    operation: string;
    side: string;
    diffId: string;
    next: { contextState: ReviewContextState; globalState: RepositoryGlobalState };
  };
  assert.equal(transaction.operation, "mark-original-selection-reviewed");
  assert.equal(transaction.side, "original");
  assert.equal(transaction.diffId, state.diffId);
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.modifiedReviewed, [
    interval(0, 1),
    interval(4, 5)
  ]);
  assert.deepEqual(transaction.next.globalState.files["file-1"]!.reviewed, [
    interval(0, 1),
    interval(4, 5)
  ]);
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, {
    [state.diffId]: [interval(1, 3), interval(4, 5)]
  });
});

test("original-side mixed selection unmarks both projected and original-only ranges in one transaction", async () => {
  const base = session();
  const state: DiffEditorReviewStateSession = {
    ...base,
    contextState: {
      ...base.contextState,
      files: {
        ...base.contextState.files,
        "file-1": {
          ...base.contextState.files["file-1"]!,
          modifiedReviewed: [interval(0, 1), interval(4, 5)],
          originalReviewedByDiff: { [base.diffId]: [interval(1, 3), interval(4, 5)] }
        }
      }
    },
    globalState: {
      ...base.globalState,
      files: {
        "file-1": {
          fileId: "file-1",
          currentPath: "src/example.ts",
          revisionId: "head-revision",
          reviewed: [interval(0, 1), interval(4, 5)],
          updatedAt: "2026-08-01T14:00:00.000Z"
        }
      }
    }
  };
  const committed: unknown[] = [];
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => { committed.push(transaction); } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async () => undefined
  });

  assert.equal(await service.unmarkSelectionReviewed({
    side: "original",
    lineCount: 5,
    selections: [selection(0), selection(1), selection(2), selection(3), selection(4)]
  }), "applied");
  assert.equal(committed.length, 1);
  const transaction = committed[0] as {
    operation: string;
    next: { contextState: ReviewContextState; globalState: RepositoryGlobalState };
  };
  assert.equal(transaction.operation, "unmark-original-selection-reviewed");
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.modifiedReviewed, []);
  assert.deepEqual(transaction.next.globalState.files["file-1"]!.reviewed, []);
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, {
    [base.diffId]: []
  });
});

test("whole-file mark covers all modified lines and original-only deletion lines regardless of focused side", async () => {
  for (const side of ["original", "modified"] as const) {
    const committed: unknown[] = [];
    const service = new DiffEditorReviewCommandService<FakeEditor>({
      getSide: (editor) => editor.side,
      getLineCount: (editor) => editor.lineCount,
      getSelections: (editor) => editor.selections,
      openSession: async () => ({ ...session(), committer: { commit: async (transaction) => { committed.push(transaction); } } }),
      confirmWholeFileOperation: async () => true,
      requestHistory: async () => undefined,
      now: () => new Date("2026-08-01T15:00:00.000Z")
    });

    assert.equal(await service.markFileReviewed({ side, lineCount: side === "original" ? 5 : 6, selections: [] }), "applied");
    const transaction = committed[0] as { next: { contextState: ReviewContextState; globalState: RepositoryGlobalState } };
    assert.deepEqual(transaction.next.contextState.files["file-1"]!.modifiedReviewed, [interval(0, 6)]);
    assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, { "base-revision..head-revision": [interval(1, 3), interval(4, 5)] });
    assert.deepEqual(transaction.next.globalState.files["file-1"]!.reviewed, [interval(0, 6)]);
  }
});

test("whole-file unmark clears context, Global, and every original diff range", async () => {
  const base = session();
  const state: DiffEditorReviewStateSession = {
    ...base,
    contextState: {
      ...base.contextState,
      files: { ...base.contextState.files, "file-1": { ...base.contextState.files["file-1"]!, modifiedReviewed: [interval(0, 6)], originalReviewedByDiff: { [base.diffId]: [interval(1, 3)], "older-diff": [interval(0, 1)] } } }
    },
    globalState: { ...base.globalState, files: { "file-1": { fileId: "file-1", currentPath: "src/example.ts", revisionId: "head-revision", reviewed: [interval(0, 6)], updatedAt: "2026-08-01T14:00:00.000Z" } } }
  };
  const committed: unknown[] = [];
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => { committed.push(transaction); } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async () => undefined
  });

  assert.equal(await service.unmarkFileReviewed({ side: "original", lineCount: 5, selections: [] }), "applied");
  const transaction = committed[0] as { next: { contextState: ReviewContextState; globalState: RepositoryGlobalState } };
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.modifiedReviewed, []);
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, {});
  assert.deepEqual(transaction.next.globalState.files["file-1"]!.reviewed, []);
});

test("repeated whole-file operations with only a newer timestamp do not commit or append history", async () => {
  let state = session();
  let timestamp = 0;
  const committed: unknown[] = [];
  const history: unknown[] = [];
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => {
      committed.push(transaction);
      state = { ...state, contextState: transaction.next.contextState, globalState: transaction.next.globalState };
    } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async (transaction) => { history.push(transaction); },
    now: () => new Date(Date.UTC(2026, 7, 1, 15, 0, timestamp++))
  });
  const editor = { side: "modified" as const, lineCount: 6, selections: [] };

  assert.equal(await service.markFileReviewed(editor), "applied");
  assert.equal(await service.markFileReviewed(editor), "no-op");
  assert.equal(await service.unmarkFileReviewed(editor), "applied");
  assert.equal(await service.unmarkFileReviewed(editor), "no-op");
  assert.equal(committed.length, 2);
  assert.equal(history.length, 2);
});

test("repeated identical diff selection is a timestamp-only no-op without another repository commit or history append", async () => {
  let state = session();
  let timestamp = 0;
  const committed: unknown[] = [];
  const history: unknown[] = [];
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => {
      committed.push(transaction);
      state = { ...state, contextState: transaction.next.contextState, globalState: transaction.next.globalState };
    } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async (transaction) => { history.push(transaction); },
    now: () => new Date(Date.UTC(2026, 7, 1, 15, 0, timestamp++))
  });
  const editor = { side: "modified" as const, lineCount: 6, selections: [selection(2)] };

  assert.equal(await service.markSelectionReviewed(editor), "applied");
  assert.equal(committed.length, 1);
  assert.equal(history.length, 1);
  assert.equal(await service.markSelectionReviewed(editor), "no-op");
  assert.equal(committed.length, 1);
  assert.equal(history.length, 1);
});

test("diff command returns no-op for empty selection collection", async () => {
  let opened = false;
  const service = new DiffEditorReviewCommandService<{ side: "modified" }>({
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => [],
    openSession: async () => { opened = true; throw new Error("unexpected"); },
    confirmWholeFileOperation: async () => true,
    requestHistory: async () => undefined
  });
  assert.equal(await service.markSelectionReviewed({ side: "modified" }), "no-op");
  assert.equal(opened, false);
});

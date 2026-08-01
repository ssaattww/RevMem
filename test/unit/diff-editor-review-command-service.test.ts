import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type { TextSelection } from "../../src/core/intervals/index";
import {
  DiffEditorReviewCommandService,
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
  committer: { commit: async () => undefined }
});

const selection = (line: number): TextSelection => ({
  anchor: { line, character: 0 },
  active: { line, character: 0 }
});

test("original-side selection updates only the immutable diff deletion state", async () => {
  const committed: unknown[] = [];
  const state = session();
  const service = new DiffEditorReviewCommandService<FakeEditor>({
    getSide: (editor) => editor.side,
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async () => ({ ...state, committer: { commit: async (transaction) => { committed.push(transaction); } } }),
    confirmWholeFileOperation: async () => true,
    requestHistory: async () => undefined,
    now: () => new Date("2026-08-01T15:00:00.000Z")
  });

  assert.equal(await service.markSelectionReviewed({ side: "original", lineCount: 5, selections: [selection(2)] }), "applied");
  const transaction = committed[0] as { side: string; diffId: string; next: { contextState: ReviewContextState; globalState: RepositoryGlobalState } };
  assert.equal(transaction.side, "original");
  assert.equal(transaction.diffId, state.diffId);
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, { [state.diffId]: [interval(2, 3)] });
  assert.deepEqual(transaction.next.globalState, state.globalState);
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

import assert from "node:assert/strict";
import test from "node:test";
import { DiffEditorReviewCommandService, type DiffEditorReviewStateSession } from "../../src/application/review-commands/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type FileReviewHistoryEvent, type RepositoryGlobalState, type ReviewContextState, type ReviewHistoryEvent } from "../../src/core/contracts/index";
import type { TextSelection } from "../../src/core/intervals/index";

interface FakeEditor { readonly side: "original" | "modified"; readonly lineCount: number; readonly selections: readonly TextSelection[] }
const interval = (startLine: number, endLineExclusive: number) => ({ startLine, endLineExclusive });
const selection = (line: number): TextSelection => ({ anchor: { line, character: 0 }, active: { line, character: 0 } });
const contextState = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: "context-1", kind: "branch", repositoryId: "repository-1", displayName: "feature",
  branch: { refName: "refs/heads/feature", headRevision: "head-revision" },
  files: { "file-1": { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: "file-1", currentPath: "src/example.ts", previousPaths: [], revisionId: "head-revision", modifiedReviewed: [], originalReviewedByDiff: {}, lineCount: 6, updatedAt: "2026-08-01T14:00:00.000Z" } },
  createdAt: "2026-08-01T13:00:00.000Z", updatedAt: "2026-08-01T14:00:00.000Z"
});
const globalState = (): RepositoryGlobalState => ({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: "repository-1", currentRevisionId: "head-revision", files: {}, updatedAt: "2026-08-01T14:00:00.000Z" });
const session = (): DiffEditorReviewStateSession => ({
  contextState: contextState(), globalState: globalState(),
  target: { fileId: "file-1", currentPath: "src/example.ts", revisionId: "head-revision", lineCount: 6 },
  diffId: "base-revision..head-revision:src/example.ts", originalLineCount: 5,
  originalDeletionIntervals: [interval(1, 3), interval(4, 5)], committer: { commit: async () => undefined }
});
const serviceFor = (state: DiffEditorReviewStateSession, committed: unknown[], history: unknown[] = []) => new DiffEditorReviewCommandService<FakeEditor>({
  getSide: (editor) => editor.side, getLineCount: (editor) => editor.lineCount, getSelections: (editor) => editor.selections,
  openSession: async () => ({ ...state, committer: { commit: async (transaction) => { committed.push(transaction); } } }),
  confirmWholeFileOperation: async () => true, requestHistory: async (transaction) => { history.push(transaction); },
  now: () => new Date("2026-08-01T15:00:00.000Z")
});

test("T303-R1-P1 original selection is restricted to deletion intervals", async () => {
  const committed: unknown[] = []; const history: unknown[] = []; const service = serviceFor(session(), committed, history);
  assert.equal(await service.markSelectionReviewed({ side: "original", lineCount: 5, selections: [selection(0)] }), "no-op");
  assert.equal(committed.length, 0); assert.equal(history.length, 0);
  assert.equal(await service.markSelectionReviewed({ side: "original", lineCount: 5, selections: [{ anchor: { line: 0, character: 0 }, active: { line: 4, character: 1 } }] }), "applied");
  const transaction = committed[0] as { next: { contextState: ReviewContextState } };
  assert.deepEqual(transaction.next.contextState.files["file-1"]!.originalReviewedByDiff, { "base-revision..head-revision:src/example.ts": [interval(1, 3), interval(4, 5)] });
});

test("T303-R1-P2 whole-file history records modified and every changed original diff", async () => {
  const events: ReviewHistoryEvent[] = []; let eventId = 0;
  const recorder = new ReviewHistoryRecorder({ sessionId: "session-1", createEventId: () => `event-${++eventId}`, appender: { append: async (_target, event) => { events.push(event); } } });
  const before = contextState();
  before.files["file-1"] = { ...before.files["file-1"]!, modifiedReviewed: [interval(0, 1)], originalReviewedByDiff: { "diff-a": [interval(1, 2)], "diff-b": [interval(3, 4)] } };
  const after: ReviewContextState = { ...before, updatedAt: "2026-08-01T15:00:00.000Z", files: { "file-1": { ...before.files["file-1"]!, modifiedReviewed: [], originalReviewedByDiff: {}, updatedAt: "2026-08-01T15:00:00.000Z" } } };
  await recorder.recordTransaction({ operation: "unmark-file-reviewed", repositoryId: "repository-1", contextId: "context-1", fileId: "file-1", expected: { contextState: before, globalState: globalState() }, next: { contextState: after, globalState: globalState() } }, "user-file");
  assert.deepEqual(events.map((event) => { const fileEvent = event as FileReviewHistoryEvent; return { side: fileEvent.diffSide, diffId: fileEvent.diffId, previous: fileEvent.previousRanges, next: fileEvent.nextRanges }; }), [
    { side: "modified", diffId: undefined, previous: [interval(0, 1)], next: [] },
    { side: "original", diffId: "diff-a", previous: [interval(1, 2)], next: [] },
    { side: "original", diffId: "diff-b", previous: [interval(3, 4)], next: [] }
  ]);
});

test("T303-R1-P3 metadata-only and empty-file entry changes are committed", async () => {
  const metadataBase = session();
  const metadataState: DiffEditorReviewStateSession = { ...metadataBase,
    contextState: { ...metadataBase.contextState, files: { "file-1": { ...metadataBase.contextState.files["file-1"]!, currentPath: "src/old.ts", modifiedReviewed: [interval(2, 3)] } } },
    globalState: { ...metadataBase.globalState, files: { "file-1": { fileId: "file-1", currentPath: "src/old.ts", revisionId: "head-revision", reviewed: [interval(2, 3)], updatedAt: "2026-08-01T14:00:00.000Z" } } },
    target: { ...metadataBase.target, contentHash: "new-hash" }
  };
  const committed: unknown[] = []; const service = serviceFor(metadataState, committed);
  assert.equal(await service.markSelectionReviewed({ side: "modified", lineCount: 6, selections: [selection(2)] }), "applied"); assert.equal(committed.length, 1);
  const emptyBase = session();
  const emptyState: DiffEditorReviewStateSession = { ...emptyBase, contextState: { ...emptyBase.contextState, files: {} }, target: { ...emptyBase.target, lineCount: 0 }, originalLineCount: 0, originalDeletionIntervals: [] };
  assert.equal(await serviceFor(emptyState, committed).markFileReviewed({ side: "modified", lineCount: 0, selections: [] }), "applied"); assert.equal(committed.length, 2);
});

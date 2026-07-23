import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type {
  ReviewStateFileTarget,
  ReviewStateTransaction
} from "../../src/core/review-state/index";
import type { TextSelection } from "../../src/core/intervals/index";
import {
  NormalEditorReviewCommandService,
  type ReviewWholeFileOperation
} from "../../src/application/review-commands/index";

interface FakeEditor {
  readonly lineCount: number;
  readonly selections: readonly TextSelection[];
}

const occurredAt = "2026-07-23T06:30:00.000Z";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const selection = (
  anchorLine: number,
  anchorCharacter: number,
  activeLine = anchorLine,
  activeCharacter = anchorCharacter
): TextSelection => ({
  anchor: { line: anchorLine, character: anchorCharacter },
  active: { line: activeLine, character: activeCharacter }
});

const target = (lineCount = 10): ReviewStateFileTarget => ({
  fileId: "file-1",
  currentPath: "src/example.ts",
  revisionId: "revision-1",
  lineCount,
  contentHash: "content-hash-1"
});

const fileState = (
  reviewed: readonly LineInterval[],
  overrides: Partial<FileReviewState> = {}
): FileReviewState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  fileId: "file-1",
  currentPath: "src/example.ts",
  previousPaths: [],
  revisionId: "revision-1",
  modifiedReviewed: reviewed.map((value) => ({ ...value })),
  originalReviewedByDiff: {
    "diff-1": [interval(7, 9)]
  },
  contentHash: "content-hash-1",
  lineCount: 10,
  updatedAt: "2026-07-23T06:00:00.000Z",
  ...overrides
});

const contextState = (
  reviewed: readonly LineInterval[] = []
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "main",
  branch: {
    refName: "refs/heads/main",
    headRevision: "revision-1"
  },
  files: {
    "file-1": fileState(reviewed)
  },
  createdAt: "2026-07-23T05:00:00.000Z",
  updatedAt: "2026-07-23T06:00:00.000Z"
});

const globalState = (
  reviewed: readonly LineInterval[] = []
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "revision-1",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-1",
      reviewed: reviewed.map((value) => ({ ...value })),
      contentHash: "content-hash-1",
      updatedAt: "2026-07-23T06:00:00.000Z"
    }
  },
  updatedAt: "2026-07-23T06:00:00.000Z"
});

interface HarnessOptions {
  readonly contextReviewed?: readonly LineInterval[];
  readonly globalReviewed?: readonly LineInterval[];
  readonly confirmation?: boolean;
  readonly commitError?: Error;
}

const createHarness = (options: HarnessOptions = {}) => {
  const commits: ReviewStateTransaction[] = [];
  const historyRequests: ReviewStateTransaction[] = [];
  const confirmations: ReviewWholeFileOperation[] = [];
  let openedSessions = 0;

  const service = new NormalEditorReviewCommandService<FakeEditor>({
    getLineCount: (editor) => editor.lineCount,
    getSelections: (editor) => editor.selections,
    openSession: async (editor) => {
      openedSessions += 1;
      return {
        contextState: contextState(options.contextReviewed),
        globalState: globalState(options.globalReviewed),
        target: target(editor.lineCount),
        committer: {
          commit: async (transaction) => {
            if (options.commitError !== undefined) {
              throw options.commitError;
            }
            commits.push(transaction as ReviewStateTransaction);
          }
        }
      };
    },
    confirmWholeFileOperation: async (operation) => {
      confirmations.push(operation);
      return options.confirmation ?? true;
    },
    requestHistory: async (transaction) => {
      historyRequests.push(transaction as ReviewStateTransaction);
    },
    now: () => new Date(occurredAt)
  });

  return {
    service,
    commits,
    historyRequests,
    confirmations,
    openedSessions: () => openedSessions
  };
};

const nextContextRanges = (
  transaction: ReviewStateTransaction
): readonly LineInterval[] =>
  transaction.next.contextState.files["file-1"]!.modifiedReviewed;

const nextGlobalRanges = (
  transaction: ReviewStateTransaction
): readonly LineInterval[] =>
  transaction.next.globalState.files["file-1"]!.reviewed;

test("markSelectionReviewed handles cursor, single selection, and merged multiple selections without confirmation", async () => {
  const harness = createHarness();
  const result = await harness.service.markSelectionReviewed({
    lineCount: 10,
    selections: [
      selection(1, 3),
      selection(3, 2, 5, 0),
      selection(4, 0, 6, 1)
    ]
  });

  assert.equal(result, "applied");
  assert.equal(harness.openedSessions(), 1);
  assert.deepEqual(harness.confirmations, []);
  assert.equal(harness.commits.length, 1);
  assert.equal(harness.historyRequests.length, 1);
  assert.equal(harness.commits[0]!.operation, "mark-ranges-reviewed");
  assert.deepEqual(nextContextRanges(harness.commits[0]!), [
    interval(1, 2),
    interval(3, 7)
  ]);
  assert.deepEqual(nextGlobalRanges(harness.commits[0]!), [
    interval(1, 2),
    interval(3, 7)
  ]);
  assert.equal(
    harness.commits[0]!.next.contextState.updatedAt,
    occurredAt
  );
  assert.equal(harness.historyRequests[0], harness.commits[0]);
});

test("unmarkSelectionReviewed removes normalized selected lines without confirmation", async () => {
  const harness = createHarness({
    contextReviewed: [interval(0, 10)],
    globalReviewed: [interval(0, 10)]
  });

  const result = await harness.service.unmarkSelectionReviewed({
    lineCount: 10,
    selections: [selection(2, 0), selection(4, 1, 6, 0)]
  });

  assert.equal(result, "applied");
  assert.deepEqual(harness.confirmations, []);
  assert.equal(harness.commits[0]!.operation, "unmark-ranges-reviewed");
  assert.deepEqual(nextContextRanges(harness.commits[0]!), [
    interval(0, 2),
    interval(3, 4),
    interval(6, 10)
  ]);
  assert.deepEqual(nextGlobalRanges(harness.commits[0]!), [
    interval(0, 2),
    interval(3, 4),
    interval(6, 10)
  ]);
});

test("whole-file commands do not open state or request history when confirmation is cancelled", async () => {
  for (const operation of ["mark", "unmark"] as const) {
    const harness = createHarness({ confirmation: false });
    const editor: FakeEditor = {
      lineCount: 10,
      selections: [selection(0, 0)]
    };

    const result = operation === "mark"
      ? await harness.service.markFileReviewed(editor)
      : await harness.service.unmarkFileReviewed(editor);

    assert.equal(result, "cancelled");
    assert.equal(harness.openedSessions(), 0);
    assert.deepEqual(harness.commits, []);
    assert.deepEqual(harness.historyRequests, []);
    assert.deepEqual(harness.confirmations, [
      operation === "mark" ? "mark-file-reviewed" : "unmark-file-reviewed"
    ]);
  }
});

test("confirmed whole-file commands mark or clear the entire current file", async () => {
  const markHarness = createHarness();
  const markResult = await markHarness.service.markFileReviewed({
    lineCount: 4,
    selections: [selection(0, 0)]
  });

  assert.equal(markResult, "applied");
  assert.deepEqual(markHarness.confirmations, ["mark-file-reviewed"]);
  assert.equal(markHarness.commits[0]!.operation, "mark-file-reviewed");
  assert.deepEqual(nextContextRanges(markHarness.commits[0]!), [interval(0, 4)]);
  assert.deepEqual(nextGlobalRanges(markHarness.commits[0]!), [interval(0, 4)]);

  const unmarkHarness = createHarness({
    contextReviewed: [interval(0, 10)],
    globalReviewed: [interval(0, 10)]
  });
  const unmarkResult = await unmarkHarness.service.unmarkFileReviewed({
    lineCount: 10,
    selections: [selection(0, 0)]
  });

  assert.equal(unmarkResult, "applied");
  assert.deepEqual(unmarkHarness.confirmations, ["unmark-file-reviewed"]);
  assert.equal(unmarkHarness.commits[0]!.operation, "unmark-file-reviewed");
  assert.deepEqual(nextContextRanges(unmarkHarness.commits[0]!), []);
  assert.deepEqual(nextGlobalRanges(unmarkHarness.commits[0]!), []);
  assert.deepEqual(
    unmarkHarness.commits[0]!.next.contextState.files["file-1"]!
      .originalReviewedByDiff,
    {}
  );
});

test("history is requested only after a successful state commit", async () => {
  const commitError = new Error("commit failed");
  const harness = createHarness({ commitError });

  await assert.rejects(
    harness.service.markSelectionReviewed({
      lineCount: 10,
      selections: [selection(1, 0)]
    }),
    commitError
  );

  assert.deepEqual(harness.commits, []);
  assert.deepEqual(harness.historyRequests, []);
});

test("an empty editor selection collection is a no-op without state or history requests", async () => {
  const harness = createHarness();

  const result = await harness.service.markSelectionReviewed({
    lineCount: 10,
    selections: []
  });

  assert.equal(result, "no-op");
  assert.equal(harness.openedSessions(), 0);
  assert.deepEqual(harness.commits, []);
  assert.deepEqual(harness.historyRequests, []);
  assert.deepEqual(harness.confirmations, []);
});

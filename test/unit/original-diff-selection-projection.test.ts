import assert from "node:assert/strict";
import test from "node:test";

import {
  DiffEditorReviewCommandService,
  buildOriginalSideLineProjection,
  projectOriginalSelectionIntervals,
  type DiffEditorReviewStateSession
} from "../../src/application/review-commands/index";
import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const DIFF_ID = `${BASE_SHA}..${HEAD_SHA}`;

const createContextState = (): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "github-pr:github.com/ssaattww/RevMem#92",
  kind: "pull-request",
  repositoryId: "github.com/ssaattww/RevMem",
  displayName: "PR #92",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 92,
    state: "open",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA
  },
  files: {
    file: {
      schemaVersion: 1,
      fileId: "file",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: HEAD_SHA,
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      lineCount: 4,
      updatedAt: "2026-08-30T00:00:00.000Z"
    }
  },
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z"
});

const createGlobalState = (): RepositoryGlobalState => ({
  schemaVersion: 1,
  repositoryId: "github.com/ssaattww/RevMem",
  currentRevisionId: HEAD_SHA,
  files: {
    file: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: HEAD_SHA,
      reviewed: [],
      updatedAt: "2026-08-30T00:00:00.000Z"
    }
  },
  updatedAt: "2026-08-30T00:00:00.000Z"
});

test("original selection projects unchanged context lines to modified coordinates and retains deletions on original", () => {
  const projection = buildOriginalSideLineProjection({
    originalLineCount: 4,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 1,
      oldCount: 4,
      newStart: 1,
      newCount: 4,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "A" },
        { kind: "deletion", oldLine: 2, text: "B" },
        { kind: "addition", newLine: 2, text: "X" },
        { kind: "context", oldLine: 3, newLine: 3, text: "C" },
        { kind: "context", oldLine: 4, newLine: 4, text: "D" }
      ]
    }]
  });

  assert.deepEqual(projection.originalToModifiedLineMappings, [
    { originalStartLine: 0, modifiedStartLine: 0, lineCount: 1 },
    { originalStartLine: 2, modifiedStartLine: 2, lineCount: 2 }
  ]);
  assert.deepEqual(projection.originalDeletionIntervals, [
    { startLine: 1, endLineExclusive: 2 }
  ]);

  assert.deepEqual(projectOriginalSelectionIntervals(
    [{ startLine: 0, endLineExclusive: 4 }],
    projection
  ), {
    modifiedIntervals: [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 4 }
    ],
    originalDeletionIntervals: [
      { startLine: 1, endLineExclusive: 2 }
    ]
  });
});

test("mixed original-side selection commits mapped current lines and original deletions atomically", async () => {
  const committed: unknown[] = [];
  const history: unknown[] = [];
  const contextState = createContextState();
  const globalState = createGlobalState();
  const session: DiffEditorReviewStateSession = {
    contextState,
    globalState,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: HEAD_SHA,
      lineCount: 4
    },
    diffId: DIFF_ID,
    originalLineCount: 4,
    originalDeletionIntervals: [{ startLine: 1, endLineExclusive: 2 }],
    originalToModifiedLineMappings: [
      { originalStartLine: 0, modifiedStartLine: 0, lineCount: 1 },
      { originalStartLine: 2, modifiedStartLine: 2, lineCount: 2 }
    ],
    committer: {
      commit: async (transaction: unknown) => {
        committed.push(transaction);
      }
    }
  };
  const service = new DiffEditorReviewCommandService<string>({
    getSide: () => "original",
    getLineCount: () => 4,
    getSelections: () => [{
      anchor: { line: 0, character: 0 },
      active: { line: 3, character: 1 }
    }],
    openSession: async () => session,
    confirmWholeFileOperation: async () => true,
    requestHistory: async (transaction) => {
      history.push(transaction);
    },
    now: () => new Date("2026-08-30T01:00:00.000Z")
  });

  assert.equal(await service.markSelectionReviewed("editor"), "applied");
  assert.equal(committed.length, 1);
  assert.equal(history.length, 1, "one composite transaction is recorded after its single commit");

  const transaction = committed[0] as {
    next: {
      contextState: ReviewContextState;
      globalState: RepositoryGlobalState;
    };
  };
  const file = transaction.next.contextState.files.file;
  assert.deepEqual(file?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
  assert.deepEqual(file?.originalReviewedByDiff[DIFF_ID], [
    { startLine: 1, endLineExclusive: 2 }
  ]);
  assert.deepEqual(transaction.next.globalState.files.file?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
});

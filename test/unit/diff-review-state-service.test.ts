import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import {
  markOriginalReviewedRanges,
  unmarkOriginalReviewedRanges
} from "../../src/core/review-state/index";

const interval = (startLine: number, endLineExclusive: number) => ({
  startLine,
  endLineExclusive
});

const contextState = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "feature",
  branch: {
    refName: "refs/heads/feature",
    headRevision: "head-revision"
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "head-revision",
      modifiedReviewed: [interval(1, 3)],
      originalReviewedByDiff: {
        "diff-old": [interval(2, 4)]
      },
      lineCount: 10,
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
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "head-revision",
      reviewed: [interval(1, 3)],
      updatedAt: "2026-08-01T14:00:00.000Z"
    }
  },
  updatedAt: "2026-08-01T14:00:00.000Z"
});

test("original-side ranges are isolated by immutable diff ID and do not update Global", () => {
  const transaction = markOriginalReviewedRanges({
    contextState: contextState(),
    globalState: globalState(),
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "head-revision",
      lineCount: 10
    },
    side: "original",
    diffId: "base-revision..head-revision:src/example.ts",
    originalLineCount: 8,
    intervals: [interval(4, 6), interval(5, 7)],
    occurredAt: "2026-08-01T15:00:00.000Z"
  });

  assert.equal(transaction.side, "original");
  assert.equal(transaction.diffId, "base-revision..head-revision:src/example.ts");
  assert.deepEqual(
    transaction.next.contextState.files["file-1"]!.originalReviewedByDiff,
    {
      "diff-old": [interval(2, 4)],
      "base-revision..head-revision:src/example.ts": [interval(4, 7)]
    }
  );
  assert.deepEqual(transaction.next.globalState, transaction.expected.globalState);
});

test("original-side unmark removes only the selected deletion range for the same diff", () => {
  const context = contextState();
  context.files["file-1"]!.originalReviewedByDiff = {
    "base-revision..head-revision:src/example.ts": [interval(1, 7)]
  };

  const transaction = unmarkOriginalReviewedRanges({
    contextState: context,
    globalState: globalState(),
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "head-revision",
      lineCount: 10
    },
    side: "original",
    diffId: "base-revision..head-revision:src/example.ts",
    originalLineCount: 8,
    intervals: [interval(3, 5)],
    occurredAt: "2026-08-01T15:00:00.000Z"
  });

  assert.deepEqual(
    transaction.next.contextState.files["file-1"]!.originalReviewedByDiff,
    {
      "base-revision..head-revision:src/example.ts": [interval(1, 3), interval(5, 7)]
    }
  );
  assert.deepEqual(transaction.next.globalState, transaction.expected.globalState);
});

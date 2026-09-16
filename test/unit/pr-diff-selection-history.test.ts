import assert from "node:assert/strict";
import test from "node:test";

import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import { recordPullRequestReviewHistory } from "../../src/composition/pull-request/pull-request-review-history";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewHistoryEvent,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState,
  type ReviewHistoryEvent,
} from "../../src/core/contracts/index";
import {
  markDiffBlockReviewed,
  markReviewedRanges,
  unmarkDiffBlockReviewed,
  type ReviewStateTransaction,
} from "../../src/core/review-state/index";

const range = [{ startLine: 0, endLineExclusive: 1 }];
const diffId = "base-revision..head-revision";
const fileId = "file-1";

const contextState = (modified: readonly LineInterval[], original: readonly LineInterval[]): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "pull-request",
  repositoryId: "repository-1",
  displayName: "PR",
  pullRequest: {
    host: "github.com",
    owner: "owner",
    repository: "repository",
    number: 1,
    state: "open",
    baseSha: "base-revision",
    headSha: "head-revision",
  },
  files: {
    [fileId]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId,
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "head-revision",
      modifiedReviewed: modified.map((item) => ({ ...item })),
      originalReviewedByDiff: { [diffId]: original.map((item) => ({ ...item })) },
      contentHash: "hash",
      lineCount: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
  },
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
});

const globalState = (reviewed: readonly LineInterval[]): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "head-revision",
  files: {
    [fileId]: {
      fileId,
      currentPath: "src/example.ts",
      revisionId: "head-revision",
      reviewed: reviewed.map((item) => ({ ...item })),
      contentHash: "hash",
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
  },
  updatedAt: "2026-09-16T00:00:00.000Z",
});

const target = {
  fileId,
  currentPath: "src/example.ts",
  revisionId: "head-revision",
  lineCount: 1,
  contentHash: "hash",
} as const;

const eventsFor = async (transaction: ReviewStateTransaction): Promise<ReviewHistoryEvent[]> => {
  const events: ReviewHistoryEvent[] = [];
  let eventId = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session-1",
    createEventId: () => `event-${++eventId}`,
    appender: { append: async (_storageTarget, event) => { events.push(event); } },
  });
  await recordPullRequestReviewHistory(recorder, transaction);
  return events;
};

const blockTransaction = (
  operation: "mark" | "unmark",
  states: { original: readonly LineInterval[]; modified: readonly LineInterval[]; global: readonly LineInterval[] },
): ReviewStateTransaction => {
  const input = {
    contextState: contextState(states.modified, states.original),
    globalState: globalState(states.global),
    target,
    diffId,
    originalLineCount: 1,
    invokedFrom: "modified" as const,
    originalIntervals: range,
    modifiedIntervals: range,
    occurredAt: "2026-09-16T00:01:00.000Z",
  };
  return operation === "mark" ? markDiffBlockReviewed(input) : unmarkDiffBlockReviewed(input);
};

test("persisted history distinguishes side selection from block selection for an addition", async () => {
  const side = markReviewedRanges({
    contextState: contextState([], []),
    globalState: globalState([]),
    target,
    intervals: range,
    occurredAt: "2026-09-16T00:01:00.000Z",
  });
  const block = markDiffBlockReviewed({
    contextState: contextState([], []),
    globalState: globalState([]),
    target,
    diffId,
    originalLineCount: 1,
    invokedFrom: "modified",
    originalIntervals: [],
    modifiedIntervals: range,
    occurredAt: "2026-09-16T00:01:00.000Z",
  });

  const [sideEvent] = await eventsFor(side);
  const [blockEvent] = await eventsFor(block);
  assert.equal(sideEvent?.reason, "user-selection");
  assert.equal(blockEvent?.reason, "user-block-selection");
  assert.equal(sideEvent?.type, "marked-reviewed");
  assert.equal(blockEvent?.type, "marked-reviewed");
});

for (const operation of ["mark", "unmark"] as const) {
  test(`block ${operation} history keeps its mode when only the modified event changes`, async () => {
    const reviewed = operation === "mark" ? [] : range;
    const original = operation === "mark" ? range : [];
    const events = await eventsFor(blockTransaction(operation, {
      original,
      modified: reviewed,
      global: reviewed,
    }));

    assert.equal(events.length, 1);
    assert.equal(events[0]?.reason, "user-block-selection");
    assert.equal((events[0] as FileReviewHistoryEvent | undefined)?.diffSide, "modified");
    assert.equal(events[0]?.type, operation === "mark" ? "marked-reviewed" : "unmarked-reviewed");
  });
}

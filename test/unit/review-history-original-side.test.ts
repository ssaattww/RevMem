import assert from "node:assert/strict";
import test from "node:test";

import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewHistoryEvent,
  type RepositoryGlobalState,
  type ReviewContextState,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";
import {
  markOriginalReviewedRanges,
  markOriginalSelectionReviewed
} from "../../src/core/review-state/index";

const interval = (startLine: number, endLineExclusive: number) => ({
  startLine,
  endLineExclusive
});

const contextState = (
  diffId: string,
  modifiedReviewed: readonly ReturnType<typeof interval>[] = [],
  originalReviewed: readonly ReturnType<typeof interval>[] = [interval(1, 2)]
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "c",
  kind: "branch",
  repositoryId: "r",
  displayName: "b",
  branch: { refName: "refs/heads/b", headRevision: "h" },
  files: {
    f: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "f",
      currentPath: "a.ts",
      previousPaths: [],
      revisionId: "h",
      modifiedReviewed: [...modifiedReviewed],
      originalReviewedByDiff: { [diffId]: [...originalReviewed] },
      lineCount: 6,
      updatedAt: "2026-08-01T00:00:00.000Z"
    }
  },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z"
});

const globalState = (
  reviewed: readonly ReturnType<typeof interval>[] = []
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "r",
  currentRevisionId: "h",
  files: reviewed.length === 0 ? {} : {
    f: {
      fileId: "f",
      currentPath: "a.ts",
      revisionId: "h",
      reviewed: [...reviewed],
      updatedAt: "2026-08-01T00:00:00.000Z"
    }
  },
  updatedAt: "2026-08-01T00:00:00.000Z"
});

const target = {
  fileId: "f",
  currentPath: "a.ts",
  revisionId: "h",
  lineCount: 6
} as const;

test("records original ranges and diff identity", async () => {
  const events: ReviewHistoryEvent[] = [];
  const recorder = new ReviewHistoryRecorder({
    sessionId: "s",
    createEventId: () => "e",
    appender: { append: async (_target, event) => { events.push(event); } }
  });
  const diffId = "base..head";
  const transaction = markOriginalReviewedRanges({
    contextState: contextState(diffId),
    globalState: globalState(),
    target,
    side: "original",
    diffId,
    originalLineCount: 4,
    intervals: [interval(2, 3)],
    occurredAt: "2026-08-01T01:00:00.000Z"
  });

  await recorder.recordTransaction(transaction, "user-selection");

  const event = events[0] as FileReviewHistoryEvent;
  assert.equal(events.length, 1);
  assert.equal(event.diffSide, "original");
  assert.equal(event.diffId, diffId);
  assert.deepEqual(event.previousRanges, [interval(1, 2)]);
  assert.deepEqual(event.nextRanges, [interval(1, 3)]);
});

test("records a mixed original selection as modified then original events", async () => {
  const events: ReviewHistoryEvent[] = [];
  let eventNumber = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "s",
    createEventId: () => `e-${String(++eventNumber)}`,
    appender: { append: async (_target, event) => { events.push(event); } }
  });
  const diffId = "base..head";
  const transaction = markOriginalSelectionReviewed({
    contextState: contextState(diffId, [interval(0, 1)], [interval(2, 3)]),
    globalState: globalState([interval(0, 1)]),
    target,
    side: "original",
    diffId,
    originalLineCount: 6,
    modifiedIntervals: [interval(3, 5)],
    originalIntervals: [interval(4, 5)],
    occurredAt: "2026-08-01T01:00:00.000Z"
  });

  await recorder.recordTransaction(transaction, "user-selection");

  assert.equal(events.length, 2);
  const modified = events[0] as FileReviewHistoryEvent;
  assert.equal(modified.eventId, "e-1");
  assert.equal(modified.diffSide, "modified");
  assert.equal(modified.rangeRepresentation, "context-and-global");
  assert.deepEqual(modified.previousRanges, [interval(0, 1)]);
  assert.deepEqual(modified.nextRanges, [interval(0, 1), interval(3, 5)]);
  assert.deepEqual(modified.globalPreviousRanges, [interval(0, 1)]);
  assert.deepEqual(modified.globalNextRanges, [interval(0, 1), interval(3, 5)]);

  const original = events[1] as FileReviewHistoryEvent;
  assert.equal(original.eventId, "e-2");
  assert.equal(original.diffSide, "original");
  assert.equal(original.diffId, diffId);
  assert.deepEqual(original.previousRanges, [interval(2, 3)]);
  assert.deepEqual(original.nextRanges, [interval(2, 3), interval(4, 5)]);
});

test("mixed original selection history omits an unchanged side", async () => {
  const events: ReviewHistoryEvent[] = [];
  const recorder = new ReviewHistoryRecorder({
    sessionId: "s",
    createEventId: () => "e",
    appender: { append: async (_target, event) => { events.push(event); } }
  });
  const diffId = "base..head";
  const transaction = markOriginalSelectionReviewed({
    contextState: contextState(diffId, [interval(1, 2)], []),
    globalState: globalState([interval(1, 2)]),
    target,
    side: "original",
    diffId,
    originalLineCount: 6,
    modifiedIntervals: [interval(1, 2)],
    originalIntervals: [interval(4, 5)],
    occurredAt: "2026-08-01T01:00:00.000Z"
  });

  await recorder.recordTransaction(transaction, "user-selection");

  assert.equal(events.length, 1);
  const event = events[0] as FileReviewHistoryEvent;
  assert.equal(event.diffSide, "original");
  assert.equal(event.diffId, diffId);
});

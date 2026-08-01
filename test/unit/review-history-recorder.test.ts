import assert from "node:assert/strict";
import test from "node:test";

import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent,
  type ReviewContextState,
  type RepositoryGlobalState
} from "../../src/core/contracts/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

test("records a user state transaction only after its state commit boundary", async () => {
  const events: unknown[] = [];
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session-1",
    createEventId: () => "event-1",
    appender: { append: async (_target, event) => { events.push(event); } }
  });
  const contextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: "context-1",
    kind: "branch" as const,
    repositoryId: "repository-1",
    displayName: "main",
    branch: { refName: "refs/heads/main", headRevision: "revision-1" },
    files: {},
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
  const globalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "repository-1",
    currentRevisionId: "revision-1",
    files: {},
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
  const transaction = markReviewedRanges({
    contextState,
    globalState,
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-1",
      lineCount: 3
    },
    intervals: [{ startLine: 0, endLineExclusive: 2 }],
    occurredAt: "2026-08-01T12:34:56.000Z"
  });

  await recorder.recordTransaction(transaction, "user-selection");

  assert.deepEqual(events, [{
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    eventId: "event-1",
    occurredAt: "2026-08-01T12:34:56.000Z",
    sessionId: "session-1",
    repositoryId: "repository-1",
    contextId: "context-1",
    revisionId: "revision-1",
    type: "marked-reviewed",
    reason: "user-selection",
    filePath: "src/example.ts",
    diffSide: "modified",
    previousRanges: [],
    nextRanges: [{ startLine: 0, endLineExclusive: 2 }]
  }]);
});

const file = (
  fileId: string,
  currentPath: string,
  reviewed: { startLine: number; endLineExclusive: number }[]
) => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  fileId,
  currentPath,
  previousPaths: [],
  revisionId: "revision-1",
  modifiedReviewed: reviewed,
  originalReviewedByDiff: {},
  lineCount: 5,
  updatedAt: "2026-08-01T12:34:56.000Z"
});

const context = (
  revisionId: string,
  files: ReviewContextState["files"]
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "main",
  branch: { refName: "refs/heads/main", headRevision: revisionId },
  files,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:34:56.000Z"
});

const global = (revisionId: string): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: revisionId,
  files: {},
  updatedAt: "2026-08-01T12:34:56.000Z"
});

test("records context creation, affected Git remap/rename/delete, and edited-file invalidation", async () => {
  const events: ReviewHistoryEvent[] = [];
  let eventNumber = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session-1",
    createEventId: () => `event-${++eventNumber}`,
    appender: {
      append: async (_target, event) => { events.push(event); }
    }
  });
  const before = context("revision-1", {
    "file-a": file("file-a", "src/edited.ts", [{ startLine: 0, endLineExclusive: 1 }]),
    "file-b": file("file-b", "src/old-name.ts", [{ startLine: 1, endLineExclusive: 2 }]),
    "file-c": file("file-c", "src/deleted.ts", [{ startLine: 2, endLineExclusive: 3 }])
  });
  const after = context("revision-2", {
    "file-a": { ...file("file-a", "src/edited.ts", [{ startLine: 3, endLineExclusive: 4 }]), revisionId: "revision-2" },
    "file-b": { ...file("file-b", "src/new-name.ts", [{ startLine: 1, endLineExclusive: 2 }]), revisionId: "revision-2" }
  });

  await recorder.recordContextCreated(before);
  await recorder.recordRevisionMapping(
    { contextState: before, globalState: global("revision-1") },
    { contextState: after, globalState: global("revision-2") },
    "mapping-unresolved",
    ["file-a"]
  );
  await recorder.recordEditInvalidation(
    after,
    {
      fileId: "file-a",
      currentPath: "src/edited.ts",
      revisionId: "revision-2",
      lineCount: 5
    },
    [{ startLine: 3, endLineExclusive: 4 }],
    []
  );

  assert.deepEqual(events.map((event) => event.type), [
    "context-created",
    "context-revision-changed",
    "mapping-unresolved",
    "file-renamed",
    "file-deleted",
    "invalidated-by-edit"
  ]);
  const files = events.slice(2, 5).map((event) => {
    assert.notEqual(event.type, "context-created");
    assert.notEqual(event.type, "context-revision-changed");
    const fileEvent = event as Exclude<ReviewHistoryEvent, { type: "context-created" | "context-revision-changed" }>;
    return {
      type: fileEvent.type,
      filePath: fileEvent.filePath,
      previousRanges: fileEvent.previousRanges,
      nextRanges: fileEvent.nextRanges
    };
  });
  assert.deepEqual(files, [
    {
      type: "mapping-unresolved",
      filePath: "src/edited.ts",
      previousRanges: [{ startLine: 0, endLineExclusive: 1 }],
      nextRanges: [{ startLine: 3, endLineExclusive: 4 }]
    },
    {
      type: "file-renamed",
      filePath: "src/new-name.ts",
      previousRanges: [{ startLine: 1, endLineExclusive: 2 }],
      nextRanges: [{ startLine: 1, endLineExclusive: 2 }]
    },
    {
      type: "file-deleted",
      filePath: "src/deleted.ts",
      previousRanges: [{ startLine: 2, endLineExclusive: 3 }],
      nextRanges: []
    }
  ]);
  assert.equal(events[5]?.reason, "content-hash-mismatch");
  assert.equal(events[2]?.reason, "mapping-unresolved");
  assert.equal(events[3]?.reason, "git-revision-mapped");
  assert.equal(events[4]?.reason, "git-revision-mapped");
});

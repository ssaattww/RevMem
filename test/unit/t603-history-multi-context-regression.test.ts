import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";

const repositoryId = "repository:t603-history-multi-context";
const targetA: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId,
  contextId: "branch:a"
};
const targetB: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId,
  contextId: "branch:b"
};

const createEvent = (
  target: ReviewStateRepositoryTarget,
  eventId: string
): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId,
  occurredAt: "2026-08-16T09:55:00.000Z",
  sessionId: "session-t603-history-multi-context",
  repositoryId: target.repositoryId,
  contextId: target.contextId,
  revisionId: `revision:${target.contextId}`,
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 1 }]
});

test("T603-R013 permits multiple contexts in one repository monthly history file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-history-context-"));
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(root, "global") },
    storageUri: { fsPath: path.join(root, "workspace") }
  };

  try {
    const store = new JsonlReviewHistoryStore({ storageUris });
    await store.append(targetA, createEvent(targetA, "event-a"));
    await store.append(targetB, createEvent(targetB, "event-b"));

    const route = resolveReviewStateStorageRoute(storageUris, targetA);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const events = (await readFile(historyPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ReviewHistoryEvent);

    assert.deepEqual(events.map((event) => event.contextId), [targetA.contextId, targetB.contextId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

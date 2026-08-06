import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonlReviewHistoryStore, resolveReviewStateStorageRoute } from "../../src/adapters/state-repository/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewHistoryEvent } from "../../src/core/contracts/index.js";

const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = "github-pr:github.com/ssaattww/revmem#48";
const REVISION = "c".repeat(40);

const event = (): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId: "t404-history-1",
  occurredAt: "2026-08-07T00:00:00.000Z",
  sessionId: "t404-session",
  repositoryId: REPOSITORY_ID,
  contextId: CONTEXT_ID,
  revisionId: REVISION,
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 1 }],
});

test("pull-request context history is routed to repository storage and survives store restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-history-"));
  const storageUris = { globalStorageUri: { fsPath: root } };
  const target = { kind: "pull-request" as const, repositoryId: REPOSITORY_ID, contextId: CONTEXT_ID };
  try {
    const first = new JsonlReviewHistoryStore({ storageUris });
    await first.append(target, event());

    const route = resolveReviewStateStorageRoute(storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const persisted = JSON.parse((await readFile(historyPath, "utf8")).trim()) as ReviewHistoryEvent;
    assert.deepEqual(persisted, event());

    const restarted = new JsonlReviewHistoryStore({ storageUris });
    await restarted.append(target, { ...event(), eventId: "t404-history-2" });
    const lines = (await readFile(historyPath, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

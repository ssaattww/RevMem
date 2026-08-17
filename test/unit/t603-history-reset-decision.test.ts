import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { serializeReviewHistoryEvent } from "../../src/core/review-history/index";

const target: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository:t603-history-reset",
  contextId: "branch:main"
};

const createTemporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-history-reset-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const createEvent = (
  eventId: string,
  occurredAt = "2026-08-16T10:00:00.000Z",
  repositoryId = target.repositoryId,
  contextId = target.contextId,
  schemaVersion = REVIEW_RANGE_SCHEMA_VERSION
): ReviewHistoryEvent => ({
  schemaVersion,
  eventId,
  occurredAt,
  sessionId: "session:t603-history-reset",
  repositoryId,
  contextId,
  revisionId: "revision-1",
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 1 }]
});

const findQuarantines = async (historyPath: string): Promise<string[]> => {
  const prefix = `${path.basename(historyPath)}.corrupt-`;
  return (await readdir(path.dirname(historyPath)))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".quarantine"))
    .map((name) => path.join(path.dirname(historyPath), name));
};

const assertRestartedFromNextEvent = async (
  historyPath: string,
  original: string,
  expectedEventId: string
): Promise<void> => {
  const lines = (await readFile(historyPath, "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.equal((JSON.parse(lines[0]!) as ReviewHistoryEvent).eventId, expectedEventId);
  const quarantines = await findQuarantines(historyPath);
  assert.equal(quarantines.length, 1);
  assert.equal(await readFile(quarantines[0]!, "utf8"), original);
};

test("T603 owner decision quarantines the whole corrupt history and starts active history at event one", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const original = `${serializeReviewHistoryEvent(createEvent("old-valid"))}\n{broken-json}\n`;
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, original, "utf8");

    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(target, createEvent("new-first"));

    await assertRestartedFromNextEvent(historyPath, original, "new-first");
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 owner decision does not salvage valid records from a corrupt history", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const original = `${serializeReviewHistoryEvent(createEvent("old-a"))}\n{broken-json}\n${serializeReviewHistoryEvent(createEvent("old-b"))}\n`;
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, original, "utf8");

    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(target, createEvent("new-only"));

    const active = (await readFile(historyPath, "utf8")).trimEnd().split("\n");
    assert.equal(active.length, 1);
    assert.equal((JSON.parse(active[0]!) as ReviewHistoryEvent).eventId, "new-only");
    assert.doesNotMatch(active[0]!, /old-a|old-b/u);
    const quarantines = await findQuarantines(historyPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), original);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 owner decision resets inconsistent owner month and duplicate-event history after quarantine", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    await mkdir(route.historyDirectory, { recursive: true });
    const fixtures: Array<{ readonly original: string; readonly nextId: string }> = [
      {
        original: `${serializeReviewHistoryEvent(createEvent("wrong-owner", undefined, "other-repository"))}\n`,
        nextId: "after-wrong-owner"
      },
      {
        original: `${serializeReviewHistoryEvent(createEvent("wrong-month", "2026-07-31T23:59:59.000Z"))}\n`,
        nextId: "after-wrong-month"
      },
      {
        original: `${serializeReviewHistoryEvent(createEvent("duplicate"))}\n${serializeReviewHistoryEvent(createEvent("duplicate"))}\n`,
        nextId: "after-duplicate"
      }
    ];

    for (const fixture of fixtures) {
      await writeFile(historyPath, fixture.original, "utf8");
      const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
      await store.append(target, createEvent(fixture.nextId));
      await assertRestartedFromNextEvent(historyPath, fixture.original, fixture.nextId);
      await Promise.all((await findQuarantines(historyPath)).map((filePath) => rm(filePath, { force: true })));
    }
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 owner decision does not reset unsupported future history schema", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const future = `${JSON.stringify({ ...createEvent("future"), schemaVersion: REVIEW_RANGE_SCHEMA_VERSION + 1 })}\n`;
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, future, "utf8");

    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await assert.rejects(() => store.append(target, createEvent("new")), /not supported/u);
    assert.equal(await readFile(historyPath, "utf8"), future);
    assert.equal((await findQuarantines(historyPath)).length, 0);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

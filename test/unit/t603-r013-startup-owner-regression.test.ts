import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NodeAtomicTextFileStore,
  type AtomicTextFileStore
} from "../../src/adapters/state-repository/index";
import { migratePersistedReviewHistoryFile } from "../../src/adapters/state-repository/jsonl-review-history-store";
import { serializeReviewHistoryEvent } from "../../src/core/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";

const historyEvent = (repositoryId: string): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId: "startup-owner-event",
  occurredAt: "2026-08-16T13:20:00.000Z",
  sessionId: "startup-owner-session",
  repositoryId,
  contextId: "branch:main",
  revisionId: "revision-startup-owner",
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 1 }]
});

const quarantines = async (filePath: string): Promise<string[]> => {
  const prefix = `${path.basename(filePath)}.corrupt-`;
  return (await readdir(path.dirname(filePath)))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".quarantine"))
    .map((name) => path.join(path.dirname(filePath), name));
};

test("T603-R013 startup history boundary quarantines evidence from a different repository owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-r013-owner-"));
  try {
    const filePath = path.join(root, "events-2026-08.jsonl");
    const raw = `${serializeReviewHistoryEvent(historyEvent("other-repository"))}\n`;
    await writeFile(filePath, raw, "utf8");
    const store: AtomicTextFileStore = new NodeAtomicTextFileStore();
    const migrate = migratePersistedReviewHistoryFile as unknown as (
      store: AtomicTextFileStore,
      filePath: string,
      expectedRepositoryId?: string
    ) => Promise<"absent" | "ready" | "reset">;

    assert.equal(await migrate(store, filePath, "expected-repository"), "reset");
    await assert.rejects(() => readFile(filePath, "utf8"), /ENOENT/u);
    const files = await quarantines(filePath);
    assert.equal(files.length, 1);
    assert.equal(await readFile(files[0]!, "utf8"), raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

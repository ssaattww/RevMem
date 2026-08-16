import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";
import {
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  parseReviewHistoryEventLine,
  serializeReviewHistoryEvent
} from "../../src/core/review-history/index";

const target: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository-1",
  contextId: "context-1"
};

const event = (eventId = "event-1"): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId,
  occurredAt: "2026-08-01T12:34:56.000Z",
  sessionId: "session-1",
  repositoryId: target.repositoryId,
  contextId: target.contextId,
  revisionId: "revision-1",
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 1, endLineExclusive: 3 }]
});

test("reads existing Context-only JSONL records without reinterpreting their range fields", () => {
  const legacy = event();
  const legacyLine = serializeReviewHistoryEvent(legacy);
  assert.doesNotMatch(legacyLine, /rangeRepresentation|globalPreviousRanges|globalNextRanges/u);
  assert.deepEqual(parseReviewHistoryEventLine(legacyLine), legacy);
});

const temporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-history-jsonl-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

test("appends one canonical event per JSONL line beneath the routed monthly history path", async () => {
  const temporary = await temporaryStorage();
  try {
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(target, event());
    await store.append(target, event("event-2"));

    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const lines = (await readFile(historyPath, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), event());
    assert.deepEqual(JSON.parse(lines[1]!), event("event-2"));
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("rejects an invalid event and preserves existing history", async () => {
  const temporary = await temporaryStorage();
  try {
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(target, event());
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const before = await readFile(historyPath, "utf8");

    await assert.rejects(
      () => store.append(target, { ...event("event-invalid"), eventId: "" }),
      /eventId/
    );
    assert.equal(await readFile(historyPath, "utf8"), before);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("quarantines corrupt existing JSONL and restarts active history from the next event", async () => {
  const temporary = await temporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const corrupt = "{invalid json}\n";
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, corrupt, { encoding: "utf8", flush: true });
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });

    await store.append(target, event());
    assert.equal(
      await readFile(historyPath, "utf8"),
      `${serializeReviewHistoryEvent(event())}\n`
    );
    const quarantineName = (await readdir(route.historyDirectory)).find(
      (name) =>
        name.startsWith("events-2026-08.jsonl.corrupt-") &&
        name.endsWith(".quarantine")
    );
    assert.ok(quarantineName);
    assert.equal(
      await readFile(path.join(route.historyDirectory, quarantineName), "utf8"),
      corrupt
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("routes workspace history to storageUri and external-file history to globalStorageUri", async () => {
  const temporary = await temporaryStorage();
  try {
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    const workspaceTarget: ReviewStateRepositoryTarget = {
      kind: "workspace",
      repositoryId: "workspace-1",
      contextId: "workspace-context-1"
    };
    const externalTarget: ReviewStateRepositoryTarget = {
      kind: "external-file",
      repositoryId: "external-1",
      contextId: "external-context-1"
    };
    const workspaceEvent = {
      ...event("workspace-event"),
      repositoryId: workspaceTarget.repositoryId,
      contextId: workspaceTarget.contextId
    };
    const externalEvent = {
      ...event("external-event"),
      repositoryId: externalTarget.repositoryId,
      contextId: externalTarget.contextId
    };
    await store.append(workspaceTarget, workspaceEvent);
    await store.append(externalTarget, externalEvent);

    const workspacePath = path.join(
      resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget).historyDirectory,
      "events-2026-08.jsonl"
    );
    const externalPath = path.join(
      resolveReviewStateStorageRoute(temporary.storageUris, externalTarget).historyDirectory,
      "events-2026-08.jsonl"
    );
    assert.match(workspacePath, /workspace[\\/]history[\\/]events-2026-08\.jsonl$/u);
    assert.match(externalPath, /global[\\/]external-files[\\/][a-f0-9]{64}[\\/]history/u);
    assert.deepEqual(JSON.parse((await readFile(workspacePath, "utf8")).trim()), workspaceEvent);
    assert.deepEqual(JSON.parse((await readFile(externalPath, "utf8")).trim()), externalEvent);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

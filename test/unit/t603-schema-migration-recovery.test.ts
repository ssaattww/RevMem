import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NodeNonGitSnapshotStorage
} from "../../src/adapters/non-git-snapshots/index";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  NodeAtomicTextFileStore,
  resolveReviewStateStorageRoute,
  type AtomicTextFileStore,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";

const timestamp = "2026-08-16T04:00:00.000Z";

const createTemporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const workspaceTarget: ReviewStateRepositoryTarget = {
  kind: "workspace",
  repositoryId: "workspace:legacy-fixture",
  contextId: "workspace:default"
};

const historyTarget: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository:legacy-fixture",
  contextId: "branch:main"
};

const createLegacyWorkspaceCommit = (): ReviewStateCommit => ({
  schemaVersion: 0,
  contextState: {
    schemaVersion: 0,
    contextId: workspaceTarget.contextId,
    kind: "workspace",
    repositoryId: workspaceTarget.repositoryId,
    displayName: "Legacy workspace",
    workspace: {
      workspaceId: workspaceTarget.repositoryId,
      snapshotRevision: "snapshot-legacy"
    },
    files: {
      "file-1": {
        schemaVersion: 0,
        fileId: "file-1",
        currentPath: "src/example.ts",
        previousPaths: [],
        revisionId: "snapshot-legacy",
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
        originalReviewedByDiff: {},
        lineCount: 4,
        updatedAt: timestamp
      }
    },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  globalState: {
    schemaVersion: 0,
    repositoryId: workspaceTarget.repositoryId,
    currentRevisionId: "snapshot-legacy",
    files: {
      "file-1": {
        fileId: "file-1",
        currentPath: "src/example.ts",
        revisionId: "snapshot-legacy",
        reviewed: [{ startLine: 0, endLineExclusive: 2 }],
        updatedAt: timestamp
      }
    },
    updatedAt: timestamp
  }
});

const createHistoryEvent = (
  eventId: string,
  schemaVersion = REVIEW_RANGE_SCHEMA_VERSION
): ReviewHistoryEvent => ({
  schemaVersion,
  eventId,
  occurredAt: "2026-08-16T04:05:00.000Z",
  sessionId: "session-1",
  repositoryId: historyTarget.repositoryId,
  contextId: historyTarget.contextId,
  revisionId: "revision-1",
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 2 }]
});

const findQuarantineSidecars = async (filePath: string): Promise<string[]> => {
  const prefix = `${path.basename(filePath)}.corrupt-`;
  const names = await readdir(path.dirname(filePath));
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".quarantine"))
    .map((name) => path.join(path.dirname(filePath), name));
};

class FailMigratedStateWriteStore implements AtomicTextFileStore {
  private readonly delegate = new NodeAtomicTextFileStore();

  public constructor(private readonly statePath: string) {}

  public readText(filePath: string): Promise<string | undefined> {
    return this.delegate.readText(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    if (
      filePath === this.statePath &&
      content.includes(`"schemaVersion": ${REVIEW_RANGE_SCHEMA_VERSION}`)
    ) {
      throw new Error("forced migrated state write failure");
    }
    await this.delegate.writeTextAtomically(filePath, content);
  }
}

test("T603 migrates a legacy workspace state, preserves reviewed evidence, and backs up the source", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const legacy = createLegacyWorkspaceCommit();
    const rawLegacy = `${JSON.stringify(legacy, null, 2)}\n`;
    await mkdir(path.dirname(route.statePointerPath), { recursive: true });
    await writeFile(route.statePointerPath, rawLegacy, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    const loaded = await repository.load(workspaceTarget);

    assert.ok(loaded);
    assert.equal(loaded.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(loaded.contextState.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(loaded.contextState.files["file-1"]?.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(loaded.globalState.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.deepEqual(
      loaded.contextState.files["file-1"]?.modifiedReviewed,
      [{ startLine: 0, endLineExclusive: 2 }]
    );

    const persisted = JSON.parse(await readFile(route.statePointerPath, "utf8")) as ReviewStateCommit;
    assert.equal(persisted.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(await readFile(`${route.statePointerPath}.pre-migration.bak`, "utf8"), rawLegacy);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 restores the pre-migration backup when publishing migrated state fails", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const rawLegacy = `${JSON.stringify(createLegacyWorkspaceCommit(), null, 2)}\n`;
    await mkdir(path.dirname(route.statePointerPath), { recursive: true });
    await writeFile(route.statePointerPath, rawLegacy, "utf8");

    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: new FailMigratedStateWriteStore(route.statePointerPath)
    });

    await assert.rejects(
      () => repository.load(workspaceTarget),
      /forced migrated state write failure/
    );
    assert.equal(repository.getCurrent(workspaceTarget), undefined);
    assert.equal(await readFile(route.statePointerPath, "utf8"), rawLegacy);
    assert.equal(await readFile(`${route.statePointerPath}.pre-migration.bak`, "utf8"), rawLegacy);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 quarantines corrupt state and exposes no reviewed ranges from uncertain JSON", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const corrupt = "{not-json\n";
    await mkdir(path.dirname(route.statePointerPath), { recursive: true });
    await writeFile(route.statePointerPath, corrupt, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal(await repository.load(workspaceTarget), undefined);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);
    await assert.rejects(() => readFile(route.statePointerPath, "utf8"), /ENOENT/u);

    const quarantines = await findQuarantineSidecars(route.statePointerPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), corrupt);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 migrates valid legacy JSONL records, quarantines corrupt records, and continues history", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, historyTarget);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const legacyEvent = createHistoryEvent("legacy-event", 0);
    const rawHistory = `${JSON.stringify(legacyEvent)}\n{broken-json}\n`;
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, rawHistory, "utf8");

    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(historyTarget, createHistoryEvent("new-event"));

    const lines = (await readFile(historyPath, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]!) as ReviewHistoryEvent).schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal((JSON.parse(lines[0]!) as ReviewHistoryEvent).eventId, "legacy-event");
    assert.equal((JSON.parse(lines[1]!) as ReviewHistoryEvent).eventId, "new-event");
    assert.equal(await readFile(`${historyPath}.pre-migration.bak`, "utf8"), rawHistory);

    const quarantines = await findQuarantineSidecars(historyPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), rawHistory);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603 migrates legacy snapshot persistence and backs it up before rewrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-snapshot-"));
  try {
    const snapshotId = "a".repeat(64);
    const snapshotPath = path.join(root, "entries", `${snapshotId}.json`);
    const rawLegacy = JSON.stringify({
      createdAt: 1_000,
      bytes: Buffer.from("legacy", "utf8").toString("base64")
    });
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, rawLegacy, "utf8");

    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    const restored = await storage.get(snapshotId);

    assert.ok(restored);
    assert.equal(Buffer.from(restored.bytes).toString("utf8"), "legacy");
    assert.equal(
      (JSON.parse(await readFile(snapshotPath, "utf8")) as { schemaVersion?: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.equal(await readFile(`${snapshotPath}.pre-migration.bak`, "utf8"), rawLegacy);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T603 quarantines a corrupt snapshot entry and treats it as unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-snapshot-corrupt-"));
  try {
    const snapshotId = "b".repeat(64);
    const snapshotPath = path.join(root, "entries", `${snapshotId}.json`);
    const corrupt = "{broken-snapshot";
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, corrupt, "utf8");

    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    assert.equal(await storage.get(snapshotId), undefined);
    await assert.rejects(() => readFile(snapshotPath, "utf8"), /ENOENT/u);

    const quarantines = await findQuarantineSidecars(snapshotPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), corrupt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

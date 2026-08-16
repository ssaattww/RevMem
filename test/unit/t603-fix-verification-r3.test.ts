import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NodeNonGitSnapshotStorage
} from "../../src/adapters/non-git-snapshots/index";
import { runPersistenceStartupMigration } from "../../src/adapters/persistence-startup-migration";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";

const timestamp = "2026-08-16T13:10:00.000Z";

const workspaceTarget: ReviewStateRepositoryTarget = {
  kind: "workspace",
  repositoryId: "workspace:t603-fv3",
  contextId: "workspace:default"
};

const repositoryTarget: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository:t603-fv3",
  contextId: "branch:main"
};

const createTemporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-fv3-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const createCommit = (target: ReviewStateRepositoryTarget): ReviewStateCommit => {
  const revisionId = "revision-fv3";
  const contextState = target.kind === "workspace"
    ? {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextId: target.contextId,
        kind: "workspace" as const,
        repositoryId: target.repositoryId,
        displayName: target.contextId,
        workspace: {
          workspaceId: target.repositoryId,
          snapshotRevision: revisionId
        },
        files: {
          "file-1": {
            schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
            fileId: "file-1",
            currentPath: "src/example.ts",
            previousPaths: [],
            revisionId,
            modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
            originalReviewedByDiff: {},
            lineCount: 2,
            updatedAt: timestamp
          }
        },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    : {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextId: target.contextId,
        kind: "branch" as const,
        repositoryId: target.repositoryId,
        displayName: target.contextId,
        branch: {
          refName: "refs/heads/main",
          headRevision: revisionId
        },
        files: {
          "file-1": {
            schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
            fileId: "file-1",
            currentPath: "src/example.ts",
            previousPaths: [],
            revisionId,
            modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
            originalReviewedByDiff: {},
            lineCount: 2,
            updatedAt: timestamp
          }
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };

  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState,
    globalState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId: target.repositoryId,
      currentRevisionId: revisionId,
      files: {
        "file-1": {
          fileId: "file-1",
          currentPath: "src/example.ts",
          revisionId,
          reviewed: [{ startLine: 0, endLineExclusive: 1 }],
          updatedAt: timestamp
        }
      },
      updatedAt: timestamp
    }
  };
};

const createHistoryEvent = (
  eventId: string,
  target = repositoryTarget,
  repositoryId = target.repositoryId
): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId,
  occurredAt: "2026-08-16T13:11:00.000Z",
  sessionId: "session-fv3",
  repositoryId,
  contextId: target.contextId,
  revisionId: "revision-fv3",
  type: "marked-reviewed",
  reason: "user-selection",
  filePath: "src/example.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [{ startLine: 0, endLineExclusive: 1 }]
});

const quarantineFiles = async (filePath: string): Promise<string[]> => {
  const prefix = `${path.basename(filePath)}.corrupt-`;
  try {
    return (await readdir(path.dirname(filePath)))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".quarantine"))
      .map((name) => path.join(path.dirname(filePath), name));
  } catch {
    return [];
  }
};

const latestPath = (
  snapshotRoot: string,
  workspaceContextId: string,
  fileId: string
): string => path.join(
  snapshotRoot,
  "latest",
  `${createHash("sha256").update(`${workspaceContextId}\u0000${fileId}`, "utf8").digest("hex")}.json`
);

test("T603-R006 direct snapshot wrapper corruption invalidates a valid latest pointer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-r006-direct-"));
  try {
    const snapshotId = "a".repeat(64);
    const contextId = "workspace:r006-direct";
    const fileId = "file:r006-direct";
    const entryPath = path.join(root, "entries", `${snapshotId}.json`);
    const pointerPath = latestPath(root, contextId, fileId);
    const corrupt = JSON.stringify({
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      createdAt: 1000,
      bytes: "not-canonical-base64***"
    });
    const pointer = JSON.stringify({
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      snapshotId
    });
    await mkdir(path.dirname(entryPath), { recursive: true });
    await mkdir(path.dirname(pointerPath), { recursive: true });
    await writeFile(entryPath, corrupt, "utf8");
    await writeFile(pointerPath, pointer, "utf8");

    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    assert.equal(await storage.get(snapshotId), undefined);
    await assert.rejects(() => readFile(entryPath, "utf8"), /ENOENT/u);
    await assert.rejects(() => readFile(pointerPath, "utf8"), /ENOENT/u);
    assert.equal((await quarantineFiles(entryPath)).length, 1);
    assert.equal((await quarantineFiles(pointerPath)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T603-R006 startup snapshot metadata migration invalidates latest for malformed entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-r006-startup-"));
  try {
    const snapshotId = "b".repeat(64);
    const contextId = "workspace:r006-startup";
    const fileId = "file:r006-startup";
    const entryPath = path.join(root, "entries", `${snapshotId}.json`);
    const pointerPath = latestPath(root, contextId, fileId);
    await mkdir(path.dirname(entryPath), { recursive: true });
    await mkdir(path.dirname(pointerPath), { recursive: true });
    await writeFile(entryPath, "{broken-wrapper", "utf8");
    await writeFile(pointerPath, JSON.stringify({
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      snapshotId
    }), "utf8");

    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    await storage.migratePersistedMetadata();
    await assert.rejects(() => readFile(entryPath, "utf8"), /ENOENT/u);
    await assert.rejects(() => readFile(pointerPath, "utf8"), /ENOENT/u);
    assert.equal((await quarantineFiles(entryPath)).length, 1);
    assert.equal((await quarantineFiles(pointerPath)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T603-R013 rejects a new eventId that collides with existing valid history", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
    await store.append(repositoryTarget, createHistoryEvent("duplicate-id"));
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTarget);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const before = await readFile(historyPath, "utf8");

    await assert.rejects(
      () => store.append(repositoryTarget, createHistoryEvent("duplicate-id")),
      /eventId|duplicate|unique/iu
    );
    assert.equal(await readFile(historyPath, "utf8"), before);
    assert.equal((await quarantineFiles(historyPath)).length, 0);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R013 startup migration quarantines wrong-owner repository history", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(repositoryTarget, createCommit(repositoryTarget));
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTarget);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const wrongOwner = `${JSON.stringify(createHistoryEvent("wrong-owner", repositoryTarget, "other-repository"))}\n`;
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, wrongOwner, "utf8");

    await runPersistenceStartupMigration({ storageUris: temporary.storageUris });
    await assert.rejects(() => readFile(historyPath, "utf8"), /ENOENT/u);
    const quarantines = await quarantineFiles(historyPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), wrongOwner);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R015 successful read-only reload clears owner-wide sticky uncertainty", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    const expected = createCommit(workspaceTarget);
    await repository.save(workspaceTarget, expected);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const validRaw = await readFile(route.statePointerPath, "utf8");

    await writeFile(route.statePointerPath, "{broken-state", "utf8");
    assert.equal(await repository.load(workspaceTarget), undefined);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);

    await writeFile(route.statePointerPath, validRaw, "utf8");
    assert.deepEqual(await repository.load(workspaceTarget), expected);
    assert.deepEqual(repository.getCurrent(workspaceTarget), expected);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

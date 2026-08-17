import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NodeNonGitSnapshotCodec,
  NodeNonGitSnapshotStorage
} from "../../src/adapters/non-git-snapshots/index";
import { runPersistenceStartupMigration } from "../../src/adapters/persistence-startup-migration";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
  type AtomicTextFileStore,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  quarantinePersistedText,
  runSchemaMigrationChain
} from "../../src/adapters/state-repository/persistence-schema-recovery";
import {
  NonGitSnapshotTracker
} from "../../src/application/non-git-snapshots/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";

const timestamp = "2026-08-16T06:30:00.000Z";

const workspaceTarget: ReviewStateRepositoryTarget = {
  kind: "workspace",
  repositoryId: "workspace:t603-review",
  contextId: "workspace:default"
};

const repositoryTargetA: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository:t603-review",
  contextId: "branch:a"
};

const repositoryTargetB: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: repositoryTargetA.repositoryId,
  contextId: "branch:b"
};

const externalTarget: ReviewStateRepositoryTarget = {
  kind: "external-file",
  repositoryId: "external-file-repository:t603-review",
  contextId: "external-file-context:t603-review"
};

const externalCanonicalUri = "file://buildserver/share/source/example.ts";

const createTemporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-findings-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const createCommit = (
  target: ReviewStateRepositoryTarget,
  revisionId = "revision-1"
): ReviewStateCommit => {
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
            modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
            originalReviewedByDiff: {},
            lineCount: 4,
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
          refName: `refs/heads/${target.contextId.replaceAll(":", "-")}`,
          headRevision: revisionId
        },
        files: {
          "file-1": {
            schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
            fileId: "file-1",
            currentPath: "src/example.ts",
            previousPaths: [],
            revisionId,
            modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
            originalReviewedByDiff: {},
            lineCount: 4,
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
          reviewed: [{ startLine: 0, endLineExclusive: 2 }],
          updatedAt: timestamp
        }
      },
      updatedAt: timestamp
    }
  };
};

const createExternalCommit = (): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: externalTarget.contextId,
    kind: "external-file",
    repositoryId: externalTarget.repositoryId,
    displayName: externalCanonicalUri,
    externalFile: {
      canonicalUri: externalCanonicalUri,
      snapshotRevision: "external-live:t603-review"
    },
    files: {
      "external-file-1": {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: "external-file-1",
        currentPath: externalCanonicalUri,
        previousPaths: [],
        revisionId: "external-live:t603-review",
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
        originalReviewedByDiff: {},
        lineCount: 2,
        updatedAt: timestamp
      }
    },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  globalState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: externalTarget.repositoryId,
    currentRevisionId: "external-live:t603-review",
    files: {
      "external-file-1": {
        fileId: "external-file-1",
        currentPath: externalCanonicalUri,
        revisionId: "external-live:t603-review",
        reviewed: [{ startLine: 0, endLineExclusive: 2 }],
        updatedAt: timestamp
      }
    },
    updatedAt: timestamp
  }
});

const toLegacyCommit = (commit: ReviewStateCommit): Record<string, unknown> => {
  const value = JSON.parse(JSON.stringify(commit)) as {
    schemaVersion: number;
    contextState: {
      schemaVersion: number;
      files: Record<string, { schemaVersion: number }>;
    };
    globalState: { schemaVersion: number };
  };
  value.schemaVersion = 0;
  value.contextState.schemaVersion = 0;
  value.globalState.schemaVersion = 0;
  for (const file of Object.values(value.contextState.files)) {
    file.schemaVersion = 0;
  }
  return value as unknown as Record<string, unknown>;
};

const createHistoryEvent = (
  eventId: string,
  occurredAt = "2026-08-16T06:35:00.000Z",
  target = repositoryTargetA,
  schemaVersion = REVIEW_RANGE_SCHEMA_VERSION
): ReviewHistoryEvent => ({
  schemaVersion,
  eventId,
  occurredAt,
  sessionId: "session-t603",
  repositoryId: target.repositoryId,
  contextId: target.contextId,
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

const readRepositoryManifest = async (
  storageUris: ReviewStateStorageUris,
  target = repositoryTargetA
): Promise<{
  readonly route: ReturnType<typeof resolveReviewStateStorageRoute>;
  readonly manifest: {
    schemaVersion: number;
    contexts: Array<{
      contextId: string;
      file: string;
      schemaVersion: number;
    }>;
    globalState: { file: string; schemaVersion: number };
  };
}> => {
  const route = resolveReviewStateStorageRoute(storageUris, target);
  const manifest = JSON.parse(await readFile(route.statePointerPath, "utf8")) as {
    schemaVersion: number;
    contexts: Array<{
      contextId: string;
      file: string;
      schemaVersion: number;
    }>;
    globalState: { file: string; schemaVersion: number };
  };
  return { route, manifest };
};

const downgradeRepositoryPersistence = async (
  storageUris: ReviewStateStorageUris
): Promise<void> => {
  const { route, manifest } = await readRepositoryManifest(storageUris);
  manifest.schemaVersion = 0;
  manifest.globalState.schemaVersion = 0;
  for (const reference of manifest.contexts) {
    reference.schemaVersion = 0;
    const contextPath = path.join(route.rootPath, reference.file);
    const context = JSON.parse(await readFile(contextPath, "utf8")) as {
      schemaVersion: number;
      files: Record<string, { schemaVersion: number }>;
    };
    context.schemaVersion = 0;
    for (const file of Object.values(context.files)) {
      file.schemaVersion = 0;
    }
    await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  }
  const globalPath = path.join(route.rootPath, manifest.globalState.file);
  const global = JSON.parse(await readFile(globalPath, "utf8")) as { schemaVersion: number };
  global.schemaVersion = 0;
  await writeFile(globalPath, `${JSON.stringify(global, null, 2)}\n`, "utf8");
  await writeFile(route.statePointerPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const createRepositoryWithTwoContexts = async (
  storageUris: ReviewStateStorageUris
): Promise<FileSystemReviewStateRepository> => {
  const repository = new FileSystemReviewStateRepository({ storageUris });
  await repository.save(repositoryTargetA, createCommit(repositoryTargetA));
  await repository.save(repositoryTargetB, createCommit(repositoryTargetB));
  return repository;
};

class VirtualAtomicTextFileStore implements AtomicTextFileStore {
  private readonly values = new Map<string, string>();

  public seed(filePath: string, content: string): void {
    this.values.set(filePath, content);
  }

  public async readText(filePath: string): Promise<string | undefined> {
    return this.values.get(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    this.values.set(filePath, content);
  }

  public async deleteText(filePath: string): Promise<void> {
    this.values.delete(filePath);
  }
}

test("T603-R001 hides cached state after downstream validation fails", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(workspaceTarget, createCommit(workspaceTarget));
    assert.ok(await repository.load(workspaceTarget));

    const corrupt = JSON.parse(await readFile(route.statePointerPath, "utf8")) as Record<string, unknown>;
    const contextState = corrupt.contextState as Record<string, unknown>;
    contextState.ownerReconciliation = { invalid: { sourceOwner: "workspace" } };
    await writeFile(route.statePointerPath, `${JSON.stringify(corrupt, null, 2)}\n`, "utf8");

    await repository.load(workspaceTarget).catch(() => undefined);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R001 quarantines deep current-schema corruption instead of exposing it", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(workspaceTarget, createCommit(workspaceTarget));
    const corrupt = JSON.parse(await readFile(route.statePointerPath, "utf8")) as {
      contextState: { files: Record<string, { lineCount: number }> };
    };
    corrupt.contextState.files["file-1"]!.lineCount = -1;
    const raw = `${JSON.stringify(corrupt, null, 2)}\n`;
    await writeFile(route.statePointerPath, raw, "utf8");

    assert.equal(await repository.load(workspaceTarget), undefined);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R001 propagates owner-wide Global uncertainty to sibling cached contexts", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = await createRepositoryWithTwoContexts(temporary.storageUris);
    assert.ok(await repository.load(repositoryTargetA));
    assert.ok(await repository.load(repositoryTargetB));
    const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
    const globalPath = path.join(route.rootPath, manifest.globalState.file);
    const global = JSON.parse(await readFile(globalPath, "utf8")) as Record<string, unknown>;
    global.files = "corrupt";
    await writeFile(globalPath, `${JSON.stringify(global, null, 2)}\n`, "utf8");

    assert.equal(await repository.load(repositoryTargetA), undefined);
    assert.equal(repository.getCurrent(repositoryTargetA), undefined);
    assert.equal(repository.getCurrent(repositoryTargetB), undefined);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R002 migration chains remain adjacent when the target schema advances", () => {
  const migrate = runSchemaMigrationChain as unknown as (
    value: Record<string, unknown>,
    documentName: string,
    steps: readonly {
      fromVersion: number;
      toVersion: number;
      migrate: (value: Record<string, unknown>) => Record<string, unknown>;
    }[],
    absentSchemaVersion?: number,
    targetSchemaVersion?: number
  ) => { readonly value: Record<string, unknown> };
  const migrated = migrate(
    { schemaVersion: 0, value: "legacy" },
    "test document",
    [
      { fromVersion: 0, toVersion: 1, migrate: (value) => ({ ...value, schemaVersion: 1 }) },
      { fromVersion: 1, toVersion: 2, migrate: (value) => ({ ...value, schemaVersion: 2 }) }
    ],
    undefined,
    2
  );
  assert.equal(migrated.value.schemaVersion, 2);
});

test("T603-R003 migrates every manifest-referenced context before advancing references", async () => {
  const temporary = await createTemporaryStorage();
  try {
    await createRepositoryWithTwoContexts(temporary.storageUris);
    await downgradeRepositoryPersistence(temporary.storageUris);
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    const absentTarget: ReviewStateRepositoryTarget = {
      ...repositoryTargetA,
      contextId: "branch:absent"
    };
    assert.equal(await repository.load(absentTarget), undefined);

    const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
    assert.equal(manifest.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    for (const reference of manifest.contexts) {
      assert.equal(reference.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
      const context = JSON.parse(await readFile(path.join(route.rootPath, reference.file), "utf8")) as {
        schemaVersion: number;
      };
      assert.equal(context.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    }
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R004 rejects nested future schema without downgrading it", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const legacy = toLegacyCommit(createCommit(workspaceTarget)) as {
      contextState: { files: Record<string, { schemaVersion: number }> };
    };
    legacy.contextState.files["file-1"]!.schemaVersion = REVIEW_RANGE_SCHEMA_VERSION + 1;
    const raw = `${JSON.stringify(legacy, null, 2)}\n`;
    await mkdir(path.dirname(route.statePointerPath), { recursive: true });
    await writeFile(route.statePointerPath, raw, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await assert.rejects(() => repository.load(workspaceTarget), /not supported/u);
    assert.equal(await readFile(route.statePointerPath, "utf8"), raw);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 0);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R005 quarantines malformed schema metadata instead of classifying it as future", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const malformed = createCommit(workspaceTarget) as unknown as Record<string, unknown>;
    malformed.schemaVersion = "1";
    const raw = `${JSON.stringify(malformed, null, 2)}\n`;
    await mkdir(path.dirname(route.statePointerPath), { recursive: true });
    await writeFile(route.statePointerPath, raw, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal(await repository.load(workspaceTarget), undefined);
    await assert.rejects(() => readFile(route.statePointerPath, "utf8"), /ENOENT/u);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R005 treats explicit null snapshot schema as corruption, not missing legacy metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-null-schema-"));
  try {
    const snapshotId = "1".repeat(64);
    const filePath = path.join(root, "entries", `${snapshotId}.json`);
    const raw = JSON.stringify({
      schemaVersion: null,
      createdAt: 1000,
      bytes: Buffer.from("legacy", "utf8").toString("base64")
    });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, raw, "utf8");

    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    assert.equal(await storage.get(snapshotId), undefined);
    await assert.rejects(() => readFile(filePath, "utf8"), /ENOENT/u);
    assert.equal((await findQuarantineSidecars(filePath)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const assertPayloadCorruptionIsQuarantined = async (
  payloadKind: "gzip" | "hash" | "envelope"
): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), `review-range-t603-payload-${payloadKind}-`));
  try {
    const codec = new NodeNonGitSnapshotCodec();
    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: root });
    const contextId = `workspace:${payloadKind}`;
    const fileId = `file:${payloadKind}`;
    let snapshotId: string;
    let bytes: Uint8Array;
    if (payloadKind === "gzip") {
      snapshotId = "2".repeat(64);
      bytes = Uint8Array.from(Buffer.from("not-gzip", "utf8"));
    } else if (payloadKind === "hash") {
      const payload = JSON.stringify({
        schemaVersion: 1,
        createdAt: 1000,
        workspaceContextId: contextId,
        fileId,
        content: "hello",
        reviewedRanges: []
      });
      snapshotId = "3".repeat(64);
      bytes = await codec.compress(payload);
    } else {
      const payload = JSON.stringify({
        schemaVersion: 1,
        createdAt: 1000,
        workspaceContextId: contextId,
        fileId,
        content: 42,
        reviewedRanges: []
      });
      snapshotId = codec.sha256(payload);
      bytes = await codec.compress(payload);
    }
    await storage.put(snapshotId, bytes, 1000);
    await storage.setLatest(contextId, fileId, snapshotId);
    const tracker = new NonGitSnapshotTracker(storage, codec, {
      maxSnapshots: 10,
      maxSnapshotCompressedBytes: 1_000_000,
      maxTotalCompressedBytes: 2_000_000,
      retentionMs: 10_000
    });

    assert.equal(await tracker.restore(snapshotId, 1001), undefined);
    assert.equal(await storage.get(snapshotId), undefined);
    assert.equal(await storage.getLatest(contextId, fileId), undefined);
    assert.equal(
      (await findQuarantineSidecars(path.join(root, "entries", `${snapshotId}.json`))).length,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

for (const payloadKind of ["gzip", "hash", "envelope"] as const) {
  test(`T603-R006 quarantines ${payloadKind} snapshot payload corruption and invalidates latest`, async () => {
    await assertPayloadCorruptionIsQuarantined(payloadKind);
  });
}

test("T603-R008 rejects append after corrupt JSONL while preserving and quarantining the original", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTargetA);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    const raw = "{broken-json}\n";
    await mkdir(route.historyDirectory, { recursive: true });
    await writeFile(historyPath, raw, "utf8");
    const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });

    await assert.rejects(
      () => store.append(repositoryTargetA, createHistoryEvent("new-event")),
      /corrupt|invalid|history/iu
    );
    assert.equal(await readFile(historyPath, "utf8"), raw);
    assert.equal((await findQuarantineSidecars(historyPath)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R009 preserves a valid sibling context when the manifest misreferences it", async () => {
  const temporary = await createTemporaryStorage();
  try {
    await createRepositoryWithTwoContexts(temporary.storageUris);
    const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
    const referenceA = manifest.contexts.find((entry) => entry.contextId === repositoryTargetA.contextId)!;
    const referenceB = manifest.contexts.find((entry) => entry.contextId === repositoryTargetB.contextId)!;
    const siblingPath = path.join(route.rootPath, referenceB.file);
    const siblingRaw = await readFile(siblingPath, "utf8");
    referenceA.file = referenceB.file;
    await writeFile(route.statePointerPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal(await repository.load(repositoryTargetA), undefined);
    assert.equal(await readFile(siblingPath, "utf8"), siblingRaw);
    assert.equal((await findQuarantineSidecars(siblingPath)).length, 0);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R009 rejects cross-subtree manifest references without deleting the valid child", async () => {
  const temporary = await createTemporaryStorage();
  try {
    await createRepositoryWithTwoContexts(temporary.storageUris);
    const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
    const referenceA = manifest.contexts.find((entry) => entry.contextId === repositoryTargetA.contextId)!;
    const globalPath = path.join(route.rootPath, manifest.globalState.file);
    const globalRaw = await readFile(globalPath, "utf8");
    referenceA.file = `contexts/../${manifest.globalState.file}`;
    await writeFile(route.statePointerPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal(await repository.load(repositoryTargetA), undefined);
    assert.equal(await readFile(globalPath, "utf8"), globalRaw);
    assert.equal((await findQuarantineSidecars(globalPath)).length, 0);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R010 migrates state, historical JSONL, snapshot entries, and latest pointers during startup", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const workspaceRoute = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const legacyWorkspace = `${JSON.stringify(toLegacyCommit(createCommit(workspaceTarget)), null, 2)}\n`;
    await mkdir(path.dirname(workspaceRoute.statePointerPath), { recursive: true });
    await writeFile(workspaceRoute.statePointerPath, legacyWorkspace, "utf8");

    await createRepositoryWithTwoContexts(temporary.storageUris);
    await downgradeRepositoryPersistence(temporary.storageUris);

    const historyPath = path.join(workspaceRoute.historyDirectory, "events-2026-07.jsonl");
    const legacyHistory = `${JSON.stringify(createHistoryEvent(
      "legacy-july",
      "2026-07-01T00:00:00.000Z",
      workspaceTarget,
      0
    ))}\n`;
    await mkdir(workspaceRoute.historyDirectory, { recursive: true });
    await writeFile(historyPath, legacyHistory, "utf8");

    const snapshotId = "4".repeat(64);
    const snapshotPath = path.join(workspaceRoute.snapshotDirectory, "entries", `${snapshotId}.json`);
    const rawSnapshot = JSON.stringify({
      createdAt: 1000,
      bytes: Buffer.from("legacy", "utf8").toString("base64")
    });
    const latestContextId = "workspace:legacy";
    const latestFileId = "file:legacy";
    const latestName = `${createHash("sha256")
      .update(`${latestContextId}\u0000${latestFileId}`, "utf8")
      .digest("hex")}.json`;
    const latestPath = path.join(workspaceRoute.snapshotDirectory, "latest", latestName);
    const rawLatest = JSON.stringify({ snapshotId });
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await mkdir(path.dirname(latestPath), { recursive: true });
    await writeFile(snapshotPath, rawSnapshot, "utf8");
    await writeFile(latestPath, rawLatest, "utf8");

    const modulePath = "../../src/adapters/persistence-startup-migration.js";
    const startupModule = await import(modulePath) as {
      runPersistenceStartupMigration?: (options: {
        readonly storageUris: ReviewStateStorageUris;
      }) => Promise<void>;
    };
    assert.equal(typeof startupModule.runPersistenceStartupMigration, "function");
    await startupModule.runPersistenceStartupMigration!({ storageUris: temporary.storageUris });

    assert.equal(
      (JSON.parse(await readFile(workspaceRoute.statePointerPath, "utf8")) as { schemaVersion: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.equal(await readFile(`${workspaceRoute.statePointerPath}.pre-migration.bak`, "utf8"), legacyWorkspace);

    const { route: repositoryRoute, manifest } = await readRepositoryManifest(temporary.storageUris);
    assert.equal(manifest.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    for (const reference of manifest.contexts) {
      assert.equal(
        (JSON.parse(await readFile(path.join(repositoryRoute.rootPath, reference.file), "utf8")) as { schemaVersion: number }).schemaVersion,
        REVIEW_RANGE_SCHEMA_VERSION
      );
    }

    assert.equal(
      (JSON.parse((await readFile(historyPath, "utf8")).trim()) as { schemaVersion: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.equal(await readFile(`${historyPath}.pre-migration.bak`, "utf8"), legacyHistory);
    assert.equal(
      (JSON.parse(await readFile(snapshotPath, "utf8")) as { schemaVersion: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.equal(await readFile(`${snapshotPath}.pre-migration.bak`, "utf8"), rawSnapshot);
    assert.equal(
      (JSON.parse(await readFile(latestPath, "utf8")) as { schemaVersion: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.equal(await readFile(`${latestPath}.pre-migration.bak`, "utf8"), rawLatest);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R011 CI executes the changed JSONL test and review-finding regression suite", async () => {
  const workflow = await readFile(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /t603-review-findings\.test\.js/u);
  assert.match(workflow, /review-history-jsonl-store\.test\.js/u);
});

test("T603-R013 rejects wrong-owner, wrong-month, and duplicate history evidence", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTargetA);
    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    await mkdir(route.historyDirectory, { recursive: true });
    const cases: Array<{ readonly name: string; readonly content: string; readonly nextId: string }> = [
      {
        name: "wrong owner",
        content: `${JSON.stringify({ ...createHistoryEvent("wrong-owner"), repositoryId: "other-owner" })}\n`,
        nextId: "after-wrong-owner"
      },
      {
        name: "wrong month",
        content: `${JSON.stringify(createHistoryEvent("wrong-month", "2026-07-31T23:59:59.000Z"))}\n`,
        nextId: "after-wrong-month"
      },
      {
        name: "duplicate eventId",
        content: `${JSON.stringify(createHistoryEvent("duplicate"))}\n${JSON.stringify(createHistoryEvent("duplicate"))}\n`,
        nextId: "after-duplicate"
      }
    ];

    for (const fixture of cases) {
      await writeFile(historyPath, fixture.content, "utf8");
      const store = new JsonlReviewHistoryStore({ storageUris: temporary.storageUris });
      await assert.rejects(
        () => store.append(repositoryTargetA, createHistoryEvent(fixture.nextId)),
        fixture.name
      );
      assert.equal(await readFile(historyPath, "utf8"), fixture.content);
      await Promise.all((await findQuarantineSidecars(historyPath)).map((filePath) => rm(filePath, { force: true })));
    }
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-R014 quarantine removal uses the injected persistence abstraction", async () => {
  const store = new VirtualAtomicTextFileStore();
  const filePath = "/virtual/persisted-state.json";
  store.seed(filePath, "corrupt");

  await quarantinePersistedText(store, filePath, "corrupt");

  assert.equal(await store.readText(filePath), undefined);
  assert.equal(
    await store.readText(`${filePath}.corrupt-11d510e067d2cdcd.quarantine`),
    "corrupt"
  );
});

test("T603-IFR-002 rejects a repository storage-root junction before it can touch an outside sentinel", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(repositoryTargetA, createCommit(repositoryTargetA));
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTargetA);
    const outside = path.join(temporary.root, "outside");
    const sentinel = path.join(outside, "manifest.json");
    await mkdir(outside, { recursive: true });
    await writeFile(sentinel, "outside-sentinel", "utf8");
    await rm(route.rootPath, { recursive: true, force: true });
    await symlink(outside, route.rootPath, process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(
      () => new FileSystemReviewStateRepository({ storageUris: temporary.storageUris }).load(repositoryTargetA),
      /symbolic link|junction/u
    );
    assert.equal(await readFile(sentinel, "utf8"), "outside-sentinel");
    assert.equal((await readdir(outside)).length, 1);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

for (const location of ["history", "snapshots", "reference"] as const) {
  test(`T603-IFR-002 rejects a ${location} junction without reading, rewriting, or deleting its outside sentinel`, async () => {
    const temporary = await createTemporaryStorage();
    try {
      const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
      await repository.save(repositoryTargetA, createCommit(repositoryTargetA));
      const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
      const outside = path.join(temporary.root, `outside-${location}`);
      await mkdir(outside, { recursive: true });
      let linkedPath: string;
      let operation: () => Promise<unknown>;
      if (location === "history") {
        linkedPath = route.historyDirectory;
        await writeFile(path.join(outside, "events-2026-08.jsonl"), "outside-history", "utf8");
        operation = () => runPersistenceStartupMigration({ storageUris: temporary.storageUris });
      } else if (location === "snapshots") {
        linkedPath = route.snapshotDirectory;
        await writeFile(path.join(outside, "sentinel.json"), "outside-snapshot", "utf8");
        operation = () => runPersistenceStartupMigration({ storageUris: temporary.storageUris });
      } else {
        const reference = manifest.contexts[0]!;
        linkedPath = path.dirname(path.join(route.rootPath, reference.file));
        await writeFile(path.join(outside, path.basename(reference.file)), "outside-reference", "utf8");
        operation = () => repository.load(repositoryTargetA);
      }
      await rm(linkedPath, { recursive: true, force: true });
      await symlink(outside, linkedPath, process.platform === "win32" ? "junction" : "dir");

      await assert.rejects(operation, /symbolic link|junction/u);
      const names = await readdir(outside);
      assert.equal(names.length, 1);
      assert.match(await readFile(path.join(outside, names[0]!), "utf8"), /^outside-/u);
    } finally {
      await rm(temporary.root, { recursive: true, force: true });
    }
  });
}

test("T603-IFR-003 migrates a repository v0 context whose nested file schema is absent", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(repositoryTargetA, createCommit(repositoryTargetA));
    const { route, manifest } = await readRepositoryManifest(temporary.storageUris);
    manifest.schemaVersion = 0;
    manifest.globalState.schemaVersion = 0;
    const reference = manifest.contexts[0]!;
    reference.schemaVersion = 0;
    const contextPath = path.join(route.rootPath, reference.file);
    const context = JSON.parse(await readFile(contextPath, "utf8")) as {
      schemaVersion: number;
      files: Record<string, { schemaVersion?: number }>;
    };
    context.schemaVersion = 0;
    for (const file of Object.values(context.files)) delete file.schemaVersion;
    const globalPath = path.join(route.rootPath, manifest.globalState.file);
    const global = JSON.parse(await readFile(globalPath, "utf8")) as { schemaVersion: number };
    global.schemaVersion = 0;
    await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
    await writeFile(globalPath, `${JSON.stringify(global, null, 2)}\n`, "utf8");
    await writeFile(route.statePointerPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const loaded = await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .load(repositoryTargetA);
    assert.equal(loaded?.contextState.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(
      (JSON.parse(await readFile(contextPath, "utf8")) as { files: Record<string, { schemaVersion: number }> })
        .files["file-1"]!.schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
    assert.ok(await readFile(`${contextPath}.pre-migration.bak`, "utf8"));
    const beforeRepeat = await readFile(contextPath, "utf8");
    await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris }).load(repositoryTargetA);
    assert.equal(await readFile(contextPath, "utf8"), beforeRepeat);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-IFR-004 quarantines semantic current-schema corruption before exposure and recovers after repair", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const original = createCommit(workspaceTarget);
    await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .save(workspaceTarget, original);
    const validRaw = await readFile(route.statePointerPath, "utf8");
    const corrupt = JSON.parse(validRaw) as {
      contextState: { files: Record<string, { currentPath: string; previousPaths: string[] }>; ownerReconciliation?: unknown };
    };
    corrupt.contextState.files["file-1"]!.currentPath = "../outside.ts";
    corrupt.contextState.files["file-1"]!.previousPaths = ["../older.ts"];
    corrupt.contextState.ownerReconciliation = { broken: { sourceOwner: "workspace" } };
    await writeFile(route.statePointerPath, `${JSON.stringify(corrupt, null, 2)}\n`, "utf8");

    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal(await repository.load(workspaceTarget), undefined);
    await assert.rejects(() => readFile(route.statePointerPath, "utf8"), /ENOENT/u);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 1);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);

    await writeFile(route.statePointerPath, validRaw, "utf8");
    assert.deepEqual(await repository.load(workspaceTarget), original);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-IFR-004 preserves reviewed external-file canonical URI state across save, load, and restart", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const expected = createExternalCommit();
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(externalTarget, expected);
    assert.deepEqual(await repository.load(externalTarget), expected);
    const restarted = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.deepEqual(await restarted.load(externalTarget), expected);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, externalTarget);
    assert.equal((await findQuarantineSidecars(route.statePointerPath)).length, 0);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-IFR-004 quarantines a noncanonical external-file URI before exposure", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const expected = createExternalCommit();
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(externalTarget, expected);
    const { route, manifest } = await readRepositoryManifest(temporary.storageUris, externalTarget);
    const contextPath = path.join(route.rootPath, manifest.contexts[0]!.file);
    const corrupted = JSON.parse(await readFile(contextPath, "utf8")) as {
      files: Record<string, { currentPath: string }>;
    };
    corrupted.files["external-file-1"]!.currentPath = "file://buildserver/share/../outside.ts";
    const raw = `${JSON.stringify(corrupted, null, 2)}\n`;
    await writeFile(contextPath, raw, "utf8");

    assert.equal(await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .load(externalTarget), undefined);
    await assert.rejects(() => readFile(contextPath, "utf8"), /ENOENT/u);
    const quarantines = await findQuarantineSidecars(contextPath);
    assert.equal(quarantines.length, 1);
    assert.equal(await readFile(quarantines[0]!, "utf8"), raw);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

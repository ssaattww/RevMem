import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPersistenceStartupMigration } from "../../src/adapters/persistence-startup-migration";
import {
  FileSystemReviewStateRepository,
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
import { serializeReviewHistoryEvent } from "../../src/core/review-history/index";

const timestamp = "2026-08-17T06:30:00.000Z";

const workspaceTarget: ReviewStateRepositoryTarget = {
  kind: "workspace",
  repositoryId: "workspace:t603-r5",
  contextId: "workspace:default"
};

const repositoryTarget: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "repository:t603-r5",
  contextId: "branch:main"
};

const createTemporaryStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t603-r5-"));
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
  revisionId = "revision-r5"
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

const createHistoryEvent = (repositoryId: string): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId: "r5-startup-owner",
  occurredAt: "2026-08-17T06:31:00.000Z",
  sessionId: "session-r5",
  repositoryId,
  contextId: repositoryTarget.contextId,
  revisionId: "revision-r5",
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

class RecoveryGateStore implements AtomicTextFileStore {
  private readonly delegate = new NodeAtomicTextFileStore();
  private gatePath: string | undefined;
  private matchingReads = 0;
  private enteredResolve: (() => void) | undefined;
  private releaseResolve: (() => void) | undefined;
  private enteredPromise: Promise<void> = Promise.resolve();
  private releasePromise: Promise<void> = Promise.resolve();

  public armSecondRead(filePath: string): {
    readonly entered: Promise<void>;
    readonly release: () => void;
  } {
    this.gatePath = filePath;
    this.matchingReads = 0;
    this.enteredPromise = new Promise<void>((resolve) => {
      this.enteredResolve = resolve;
    });
    this.releasePromise = new Promise<void>((resolve) => {
      this.releaseResolve = resolve;
    });
    return {
      entered: this.enteredPromise,
      release: () => {
        this.releaseResolve?.();
      }
    };
  }

  public async readText(filePath: string): Promise<string | undefined> {
    if (filePath === this.gatePath) {
      this.matchingReads += 1;
      if (this.matchingReads === 2) {
        this.enteredResolve?.();
        await this.releasePromise;
        this.gatePath = undefined;
      }
    }
    return this.delegate.readText(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    await this.delegate.writeTextAtomically(filePath, content);
  }

  public async deleteText(filePath: string): Promise<void> {
    await this.delegate.deleteText(filePath);
  }
}

class MigrationReadGateStore implements AtomicTextFileStore {
  private readonly delegate = new NodeAtomicTextFileStore();
  private targetPath: string | undefined;
  private enteredResolve: (() => void) | undefined;
  private releaseResolve: (() => void) | undefined;
  private entered = Promise.resolve();
  private release = Promise.resolve();

  public arm(filePath: string): { readonly entered: Promise<void>; readonly resume: () => void } {
    this.targetPath = filePath;
    this.entered = new Promise<void>((resolve) => { this.enteredResolve = resolve; });
    this.release = new Promise<void>((resolve) => { this.releaseResolve = resolve; });
    return { entered: this.entered, resume: () => this.releaseResolve?.() };
  }

  public async readText(filePath: string): Promise<string | undefined> {
    const value = await this.delegate.readText(filePath);
    if (filePath === this.targetPath) {
      this.targetPath = undefined;
      this.enteredResolve?.();
      await this.release;
    }
    return value;
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    await this.delegate.writeTextAtomically(filePath, content);
  }

  public async deleteText(filePath: string): Promise<void> {
    await this.delegate.deleteText(filePath);
  }
}

const toLegacyWorkspaceCommit = (commit: ReviewStateCommit): Record<string, unknown> => {
  const legacy = JSON.parse(JSON.stringify(commit)) as {
    schemaVersion: number;
    contextState: { schemaVersion: number; files: Record<string, { schemaVersion?: number }> };
    globalState: { schemaVersion: number };
  };
  legacy.schemaVersion = 0;
  legacy.contextState.schemaVersion = 0;
  legacy.globalState.schemaVersion = 0;
  for (const file of Object.values(legacy.contextState.files)) delete file.schemaVersion;
  return legacy as unknown as Record<string, unknown>;
};

const downgradeRepositoryToLegacy = async (storageUris: ReviewStateStorageUris): Promise<void> => {
  const route = resolveReviewStateStorageRoute(storageUris, repositoryTarget);
  const manifest = JSON.parse(await readFile(route.statePointerPath, "utf8")) as {
    schemaVersion: number;
    contexts: Array<{ file: string; schemaVersion: number }>;
    globalState: { file: string; schemaVersion: number };
  };
  manifest.schemaVersion = 0;
  manifest.globalState.schemaVersion = 0;
  for (const reference of manifest.contexts) {
    reference.schemaVersion = 0;
    const contextPath = path.join(route.rootPath, reference.file);
    const context = JSON.parse(await readFile(contextPath, "utf8")) as {
      schemaVersion: number;
      files: Record<string, { schemaVersion?: number }>;
    };
    context.schemaVersion = 0;
    for (const file of Object.values(context.files)) delete file.schemaVersion;
    await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  }
  const globalPath = path.join(route.rootPath, manifest.globalState.file);
  const global = JSON.parse(await readFile(globalPath, "utf8")) as { schemaVersion: number };
  global.schemaVersion = 0;
  await writeFile(globalPath, `${JSON.stringify(global, null, 2)}\n`, "utf8");
  await writeFile(route.statePointerPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

test("T603-R013 startup keeps canonical repository owner when the manifest has no selected context", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await repository.save(repositoryTarget, createCommit(repositoryTarget));
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTarget);

    const manifest = JSON.parse(await readFile(route.statePointerPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      route.statePointerPath,
      `${JSON.stringify({ ...manifest, contexts: [] }, null, 2)}\n`,
      "utf8"
    );

    const historyPath = path.join(route.historyDirectory, "events-2026-08.jsonl");
    await mkdir(route.historyDirectory, { recursive: true });
    const wrongOwner = `${serializeReviewHistoryEvent(createHistoryEvent("other-repository"))}\n`;
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

test("T603-R015 recovery never exposes stale cached reviewed state before the repaired load refreshes memory", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const store = new RecoveryGateStore();
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: store
    });
    const expected = createCommit(workspaceTarget);
    await repository.save(workspaceTarget, expected);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    const validRaw = await readFile(route.statePointerPath, "utf8");

    await writeFile(route.statePointerPath, "{broken-state", "utf8");
    assert.equal(await repository.load(workspaceTarget), undefined);
    assert.equal(repository.getCurrent(workspaceTarget), undefined);

    await writeFile(route.statePointerPath, validRaw, "utf8");
    const gate = store.armSecondRead(route.statePointerPath);
    const reload = repository.load(workspaceTarget);
    await gate.entered;
    const visibleDuringRecovery = repository.getCurrent(workspaceTarget);
    gate.release();
    const loaded = await reload;

    assert.equal(visibleDuringRecovery, undefined);
    assert.deepEqual(loaded, expected);
    assert.deepEqual(repository.getCurrent(workspaceTarget), expected);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-IFR-001 serializes legacy migration load before a second instance saves newer workspace state", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const initial = createCommit(workspaceTarget);
    const newer = createCommit(workspaceTarget, "revision-newer");
    const seed = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await seed.save(workspaceTarget, initial);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, workspaceTarget);
    await writeFile(
      route.statePointerPath,
      `${JSON.stringify(toLegacyWorkspaceCommit(initial), null, 2)}\n`,
      "utf8"
    );

    const store = new MigrationReadGateStore();
    const loadingRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: store
    });
    const gate = store.arm(route.statePointerPath);
    const loading = loadingRepository.load(workspaceTarget);
    await gate.entered;
    let saveFinished = false;
    const saving = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .save(workspaceTarget, newer)
      .then(() => { saveFinished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveFinished, false);
    gate.resume();
    await Promise.all([loading, saving]);

    const durable = await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .load(workspaceTarget);
    assert.equal(durable?.globalState.currentRevisionId, "revision-newer");
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T603-IFR-001 preserves newer repository Context, Global, and manifest after a gated legacy load", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const initial = createCommit(repositoryTarget);
    const newer = createCommit(repositoryTarget, "revision-newer");
    const seed = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    await seed.save(repositoryTarget, initial);
    await downgradeRepositoryToLegacy(temporary.storageUris);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, repositoryTarget);

    const store = new MigrationReadGateStore();
    const loadingRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: store
    });
    const gate = store.arm(route.statePointerPath);
    const loading = loadingRepository.load(repositoryTarget);
    await gate.entered;
    let saveFinished = false;
    const saving = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .save(repositoryTarget, newer)
      .then(() => { saveFinished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveFinished, false);
    gate.resume();
    await Promise.all([loading, saving]);

    const durable = await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris })
      .load(repositoryTarget);
    assert.equal(durable?.contextState.branch?.headRevision, "revision-newer");
    assert.equal(durable?.globalState.currentRevisionId, "revision-newer");
    assert.equal(
      (JSON.parse(await readFile(route.statePointerPath, "utf8")) as { schemaVersion: number }).schemaVersion,
      REVIEW_RANGE_SCHEMA_VERSION
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

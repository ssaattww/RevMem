import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository,
  NodeAtomicTextFileStore,
  StaleReviewStateError,
  type AtomicTextFileStore,
  type PersistenceFailureNotification,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";

const timestamp = "2026-07-23T05:00:00.000Z";

const createContextState = (
  repositoryId: string,
  contextId: string,
  reviewedEndLineExclusive: number
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: contextId,
  branch: {
    refName: `refs/heads/${contextId}`,
    headRevision: "abc123"
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "abc123",
      modifiedReviewed: [
        {
          startLine: 0,
          endLineExclusive: reviewedEndLineExclusive
        }
      ],
      originalReviewedByDiff: {},
      lineCount: 10,
      updatedAt: timestamp
    }
  },
  createdAt: timestamp,
  updatedAt: timestamp
});

const createGlobalState = (
  repositoryId: string,
  reviewedEndLineExclusive: number
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId: "abc123",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "abc123",
      reviewed: [
        {
          startLine: 0,
          endLineExclusive: reviewedEndLineExclusive
        }
      ],
      updatedAt: timestamp
    }
  },
  updatedAt: timestamp
});

const createCommit = (
  target: ReviewStateRepositoryTarget,
  reviewedEndLineExclusive: number
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: createContextState(
    target.repositoryId,
    target.contextId,
    reviewedEndLineExclusive
  ),
  globalState: createGlobalState(
    target.repositoryId,
    reviewedEndLineExclusive
  )
});

const createTransaction = (
  target: ReviewStateRepositoryTarget,
  expected: ReviewStateCommit,
  next: ReviewStateCommit
): ReviewStateTransactionLike => ({
  repositoryId: target.repositoryId,
  contextId: target.contextId,
  expected: {
    contextState: expected.contextState,
    globalState: expected.globalState
  },
  next: {
    contextState: next.contextState,
    globalState: next.globalState
  }
});

const createTemporaryStorage = async (): Promise<{
  root: string;
  storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-state-memory-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const gitTarget = (
  contextId = "branch:main"
): ReviewStateRepositoryTarget => ({
  kind: "git",
  repositoryId: "github.com/example/review-range",
  contextId
});

/**
 * Test store that can pause or fail one manifest replacement while delegating all other persistence to Node.
 */
class ControlledAtomicTextFileStore implements AtomicTextFileStore {
  private block: { started: () => void; released: Promise<void> } | undefined;
  private failNextManifestWrite = false;

  public constructor(
    private readonly delegate: AtomicTextFileStore = new NodeAtomicTextFileStore()
  ) {}

  public blockNextManifestWrite(): {
    started: Promise<void>;
    release: () => void;
  } {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.block = { started: markStarted, released };

    return { started, release };
  }

  public failNextManifestReplacement(): void {
    this.failNextManifestWrite = true;
  }

  public readText(filePath: string): Promise<string | undefined> {
    return this.delegate.readText(filePath);
  }

  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    if (path.basename(filePath) === "manifest.json") {
      const block = this.block;
      if (block !== undefined) {
        this.block = undefined;
        block.started();
        await block.released;
      }
      if (this.failNextManifestWrite) {
        this.failNextManifestWrite = false;
        throw new Error("forced manifest replacement failure");
      }
    }

    await this.delegate.writeTextAtomically(filePath, content);
  }
}

test("saving one context refreshes repository-wide Global for every current context", async () => {
  const temporary = await createTemporaryStorage();
  const firstTarget = gitTarget();
  const secondTarget = gitTarget("branch:feature");

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    await repository.save(firstTarget, createCommit(firstTarget, 2));
    await repository.save(secondTarget, createCommit(secondTarget, 7));

    assert.deepEqual(
      repository.getCurrent(firstTarget)?.contextState,
      createContextState(firstTarget.repositoryId, firstTarget.contextId, 2)
    );
    assert.deepEqual(
      repository.getCurrent(firstTarget)?.globalState,
      createGlobalState(firstTarget.repositoryId, 7)
    );
    assert.deepEqual(
      repository.getCurrent(secondTarget),
      createCommit(secondTarget, 7)
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that a commit atomically advances matching expected context and Global snapshots.
/// </summary>
test("commit atomically advances matching expected context and Global snapshots", async () => {
  const temporary = await createTemporaryStorage();
  const target = gitTarget();
  const initial = createCommit(target, 2);
  const next = createCommit(target, 6);

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    await repository.save(target, initial);
    await repository.commit(createTransaction(target, initial, next));

    assert.deepEqual(repository.getCurrent(target), next);

    const reloaded = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(await reloaded.load(target), next);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that a commit rejects stale expected snapshots without changing disk or memory.
/// </summary>
test("commit rejects stale expected snapshots without changing disk or memory", async () => {
  const temporary = await createTemporaryStorage();
  const target = gitTarget();
  const staleExpected = createCommit(target, 2);
  const current = createCommit(target, 5);
  const rejectedNext = createCommit(target, 9);
  const failures: PersistenceFailureNotification[] = [];

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      notifyPersistenceFailure: (failure) => {
        failures.push(failure);
      }
    });

    await repository.save(target, current);

    await assert.rejects(
      () =>
        repository.commit(
          createTransaction(target, staleExpected, rejectedNext)
        ),
      (error: unknown) => error instanceof StaleReviewStateError
    );

    assert.deepEqual(repository.getCurrent(target), current);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.operation, "commit");

    const reloaded = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(await reloaded.load(target), current);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that concurrent commits on one repository instance serialize their CAS comparison so only one succeeds.
/// </summary>
test("concurrent commits with the same expected snapshot reject one stale transaction", async () => {
  const temporary = await createTemporaryStorage();
  const target = gitTarget();
  const initial = createCommit(target, 2);
  const firstNext = createCommit(target, 6);
  const secondNext = createCommit(target, 8);

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    await repository.save(target, initial);

    const results = await Promise.allSettled([
      repository.commit(createTransaction(target, initial, firstNext)),
      repository.commit(createTransaction(target, initial, secondNext))
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1
    );
    const rejected = results.find(
      (result) => result.status === "rejected"
    );
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof StaleReviewStateError);
    const current = repository.getCurrent(target);
    const reviewedEndLineExclusive = current?.contextState.files["file-1"]
      ?.modifiedReviewed[0]?.endLineExclusive;
    assert.ok(
      reviewedEndLineExclusive === 6 || reviewedEndLineExclusive === 8
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that a save queued before a commit advances state first, causing the commit's older expected snapshot to become stale.
/// </summary>
test("a queued save makes a concurrently requested commit stale", async () => {
  const temporary = await createTemporaryStorage();
  const target = gitTarget();
  const initial = createCommit(target, 2);
  const saved = createCommit(target, 5);
  const committed = createCommit(target, 8);
  const fileStore = new ControlledAtomicTextFileStore();

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: fileStore
    });
    await repository.save(target, initial);

    const blockedManifestWrite = fileStore.blockNextManifestWrite();
    const save = repository.save(target, saved);
    await blockedManifestWrite.started;
    const commit = repository.commit(createTransaction(target, initial, committed));
    blockedManifestWrite.release();

    await save;
    await assert.rejects(
      () => commit,
      (error: unknown) => error instanceof StaleReviewStateError
    );
    assert.deepEqual(repository.getCurrent(target), saved);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that a failed queued save releases the storage-root queue so a later context save can persist.
/// </summary>
test("a failed queued save does not block a later context save", async () => {
  const temporary = await createTemporaryStorage();
  const firstTarget = gitTarget();
  const secondTarget = gitTarget("branch:feature");
  const fileStore = new ControlledAtomicTextFileStore();

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: fileStore
    });
    await repository.save(firstTarget, createCommit(firstTarget, 2));

    fileStore.failNextManifestReplacement();
    const failedSave = repository.save(firstTarget, createCommit(firstTarget, 5));
    const laterSave = repository.save(secondTarget, createCommit(secondTarget, 8));

    await assert.rejects(() => failedSave, /forced manifest replacement failure/);
    await laterSave;

    const reloaded = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(
      (await reloaded.load(secondTarget))?.contextState,
      createCommit(secondTarget, 8).contextState
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/// <summary>
/// Verifies that a stale-state error copies its target instead of retaining a caller-owned target alias.
/// </summary>
test("StaleReviewStateError retains a target copy", () => {
  const target = {
    kind: "git" as const,
    repositoryId: "github.com/example/review-range",
    contextId: "branch:main"
  };
  const error = new StaleReviewStateError(target);

  target.contextId = "branch:feature";

  assert.equal(error.target.contextId, "branch:main");
});

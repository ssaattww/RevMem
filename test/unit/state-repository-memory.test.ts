import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository,
  StaleReviewStateError,
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

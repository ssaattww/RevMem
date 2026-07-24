import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  type ReviewStateCommit,
  type ReviewStatePersistenceDelegate,
  type ReviewStateRepositoryTarget,
  type ReviewStateSaveScheduler,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index";

const repositoryId = "external-file-repository:test";
const contextId = "external-file-context:test";
const revisionId = "external-live:test";
const externalTarget: ReviewStateRepositoryTarget = {
  kind: "external-file",
  repositoryId,
  contextId
};

const createExternalCommit = (second: number): ReviewStateCommit => {
  const occurredAt = `2026-07-24T13:00:0${second}.000Z`;
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId,
      kind: "external-file",
      repositoryId,
      displayName: "file://server/share/example.ts",
      externalFile: {
        canonicalUri: "file://server/share/example.ts",
        snapshotRevision: revisionId
      },
      files: {},
      createdAt: occurredAt,
      updatedAt: occurredAt
    },
    globalState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId,
      currentRevisionId: revisionId,
      files: {},
      updatedAt: occurredAt
    }
  };
};

const createTransaction = (
  expected: ReviewStateCommit,
  next: ReviewStateCommit
): ReviewStateTransactionLike => ({
  repositoryId,
  contextId,
  expected: {
    contextState: expected.contextState,
    globalState: expected.globalState
  },
  next: {
    contextState: next.contextState,
    globalState: next.globalState
  }
});

class ManualScheduler implements ReviewStateSaveScheduler {
  private readonly callbacks = new Map<object, () => void>();

  public schedule(callback: () => void): object {
    const handle = {};
    this.callbacks.set(handle, callback);
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "object" && handle !== null) {
      this.callbacks.delete(handle);
    }
  }

  public get pendingCount(): number {
    return this.callbacks.size;
  }
}

class RecordingDelegate implements ReviewStatePersistenceDelegate {
  public readonly events: string[] = [];

  public async load(): Promise<ReviewStateCommit | undefined> {
    return undefined;
  }

  public async save(
    target: ReviewStateRepositoryTarget
  ): Promise<void> {
    this.events.push(`save:${target.kind}`);
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    this.events.push(`commit:${transaction.next.contextState.kind}`);
  }
}

test("external-file confirmation flushes its pending external-file save first", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingDelegate();
  const repository = new DebouncedReviewStateRepository({
    delegate,
    scheduler,
    debounceMilliseconds: 1000
  });
  const initial = createExternalCommit(1);
  const confirmed = createExternalCommit(2);

  const pendingSave = repository.save(externalTarget, initial);
  await repository.commit(createTransaction(initial, confirmed));
  await pendingSave;

  assert.equal(scheduler.pendingCount, 0);
  assert.deepEqual(delegate.events, [
    "save:external-file",
    "commit:external-file"
  ]);
});

test("filesystem persistence rejects external-file context under a Git target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-target-kind-"));
  const repository = new FileSystemReviewStateRepository({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") }
    }
  });

  try {
    await assert.rejects(
      repository.save(
        { ...externalTarget, kind: "git" },
        createExternalCommit(1)
      ),
      /Git persistence requires a branch review context/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem persistence accepts external-file context only under external-file target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-external-kind-"));
  const repository = new FileSystemReviewStateRepository({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") }
    }
  });
  const commit = createExternalCommit(1);

  try {
    await repository.save(externalTarget, commit);
    const loaded = await repository.load(externalTarget);
    assert.deepEqual(loaded, commit);

    await assert.rejects(
      repository.save(
        { ...externalTarget, kind: "external-file" },
        {
          ...commit,
          contextState: {
            ...commit.contextState,
            kind: "branch",
            branch: {
              refName: "refs/heads/main",
              headRevision: revisionId
            }
          }
        }
      ),
      /External-file persistence requires an external-file review context/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  DebouncedReviewStateRepository,
  type ReviewStateCommit,
  type ReviewStatePersistenceDelegate,
  type ReviewStateRepositoryTarget,
  type ReviewStateSaveScheduler,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index";

const repositoryId = "workspace:t107";
const contextId = "workspace:default";
const target: ReviewStateRepositoryTarget = {
  kind: "workspace",
  repositoryId,
  contextId
};

const createCommit = (revision: number): ReviewStateCommit => {
  const occurredAt = `2026-07-23T10:00:0${revision}.000Z`;
  const revisionId = "workspace-live:t107";

  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId,
      kind: "workspace",
      repositoryId,
      displayName: "Workspace review",
      workspace: {
        workspaceId: repositoryId,
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
  repositoryId: expected.contextState.repositoryId,
  contextId: expected.contextState.contextId,
  expected: {
    contextState: expected.contextState,
    globalState: expected.globalState
  },
  next: {
    contextState: next.contextState,
    globalState: next.globalState
  }
});

const createExternalCommit = (revision: number): ReviewStateCommit => {
  const occurredAt = `2026-07-23T11:00:0${revision}.000Z`;
  const externalRepositoryId = "external-file-repository:t107";
  const externalContextId = "external-file-context:default";
  const revisionId = "external-live:t107";

  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: externalContextId,
      kind: "external-file",
      repositoryId: externalRepositoryId,
      displayName: "file:///outside/example.ts",
      workspace: {
        workspaceId: externalRepositoryId,
        snapshotRevision: revisionId
      },
      externalFile: {
        canonicalUri: "file:///outside/example.ts"
      },
      files: {},
      createdAt: occurredAt,
      updatedAt: occurredAt
    },
    globalState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId: externalRepositoryId,
      currentRevisionId: revisionId,
      files: {},
      updatedAt: occurredAt
    }
  };
};

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const createDeferred = (): Deferred => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class ManualScheduler implements ReviewStateSaveScheduler {
  private readonly callbacks = new Map<object, () => void>();
  public readonly delays: number[] = [];

  public schedule(callback: () => void, delayMilliseconds: number): object {
    const handle = {};
    this.callbacks.set(handle, callback);
    this.delays.push(delayMilliseconds);
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

  public runAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}

class RecordingRepository implements ReviewStatePersistenceDelegate {
  public readonly events: string[] = [];
  public readonly saves: ReviewStateCommit[] = [];
  public readonly saveTargets: ReviewStateRepositoryTarget[] = [];
  public failSave = false;

  public async load(): Promise<ReviewStateCommit | undefined> {
    this.events.push("load");
    return this.saves.at(-1);
  }

  public async save(
    saveTarget: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.events.push(`save:${commit.contextState.updatedAt}`);
    if (this.failSave) {
      throw new Error("forced debounced save failure");
    }
    this.saveTargets.push({ ...saveTarget });
    this.saves.push(commit);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    this.events.push(`commit:${transaction.next.contextState.updatedAt}`);
  }
}

class BlockingRepository implements ReviewStatePersistenceDelegate {
  public readonly loadStarted = createDeferred();
  public readonly releaseLoad = createDeferred();
  public readonly commitStarted = createDeferred();
  public readonly releaseCommit = createDeferred();

  public async load(): Promise<ReviewStateCommit | undefined> {
    this.loadStarted.resolve();
    await this.releaseLoad.promise;
    return undefined;
  }

  public async save(): Promise<void> {
    throw new Error("Unexpected background save.");
  }

  public async commit(): Promise<void> {
    this.commitStarted.resolve();
    await this.releaseCommit.promise;
  }
}

test("multiple background saves are coalesced and persist only the newest complete snapshot", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  const repository = new DebouncedReviewStateRepository({
    delegate,
    debounceMilliseconds: 75,
    scheduler
  });
  const first = createCommit(1);
  const second = createCommit(2);

  const firstSave = repository.save(target, first);
  const secondSave = repository.save(target, second);

  assert.equal(delegate.saves.length, 0);
  assert.equal(scheduler.pendingCount, 1);
  assert.deepEqual(scheduler.delays, [75, 75]);

  scheduler.runAll();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(delegate.saves, [second]);
  assert.equal(scheduler.pendingCount, 0);
});

test("storage kinds remain isolated even when repository and context IDs are identical", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  const repository = new DebouncedReviewStateRepository({ delegate, scheduler });
  const gitTarget: ReviewStateRepositoryTarget = {
    ...target,
    kind: "git"
  };

  const workspaceSave = repository.save(target, createCommit(1));
  const gitSave = repository.save(gitTarget, createCommit(2));

  assert.equal(scheduler.pendingCount, 2);
  scheduler.runAll();
  await Promise.all([workspaceSave, gitSave]);

  assert.deepEqual(
    delegate.saveTargets.map((savedTarget) => savedTarget.kind).sort(),
    ["git", "workspace"]
  );
});

test("a confirmation transaction flushes pending background state and commits without waiting for the debounce timer", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  const repository = new DebouncedReviewStateRepository({
    delegate,
    debounceMilliseconds: 1000,
    scheduler
  });
  const initial = createCommit(1);
  const confirmed = createCommit(2);

  const pendingSave = repository.save(target, initial);
  await repository.commit(createTransaction(initial, confirmed));
  await pendingSave;

  assert.equal(scheduler.pendingCount, 0);
  assert.deepEqual(delegate.events, [
    `save:${initial.contextState.updatedAt}`,
    `commit:${confirmed.contextState.updatedAt}`
  ]);
});

test("external-file confirmation flushes the external pending state before commit", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  const repository = new DebouncedReviewStateRepository({
    delegate,
    debounceMilliseconds: 1000,
    scheduler
  });
  const externalTarget: ReviewStateRepositoryTarget = {
    kind: "external-file",
    repositoryId: "external-file-repository:t107",
    contextId: "external-file-context:default"
  };
  const initial = createExternalCommit(1);
  const confirmed = createExternalCommit(2);

  const pendingSave = repository.save(externalTarget, initial);
  await repository.commit(createTransaction(initial, confirmed));
  const eventsBeforeTimer = [...delegate.events];
  scheduler.runAll();
  await pendingSave;

  assert.equal(scheduler.pendingCount, 0);
  assert.deepEqual(eventsBeforeTimer, [
    `save:${initial.contextState.updatedAt}`,
    `commit:${confirmed.contextState.updatedAt}`
  ]);
});

test("dispose flushes a pending save immediately for Extension Host deactivation", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  const repository = new DebouncedReviewStateRepository({
    delegate,
    debounceMilliseconds: 1000,
    scheduler
  });
  const pendingCommit = createCommit(1);

  const pendingSave = repository.save(target, pendingCommit);
  await repository.dispose();
  await pendingSave;

  assert.equal(scheduler.pendingCount, 0);
  assert.deepEqual(delegate.saves, [pendingCommit]);
  await assert.rejects(
    () => repository.save(target, createCommit(2)),
    /disposed/
  );
});

test("dispose waits for an immediate commit queued behind an in-flight load", async () => {
  const delegate = new BlockingRepository();
  const repository = new DebouncedReviewStateRepository({ delegate });
  const initial = createCommit(1);
  const confirmed = createCommit(2);

  const load = repository.load(target);
  await delegate.loadStarted.promise;
  const commit = repository.commit(createTransaction(initial, confirmed));
  let disposeCompleted = false;
  const dispose = repository.dispose().then(() => {
    disposeCompleted = true;
  });

  delegate.releaseLoad.resolve();
  await delegate.commitStarted.promise;
  await Promise.resolve();
  assert.equal(
    disposeCompleted,
    false,
    "Extension Host deactivation must wait for work accepted before disposal."
  );

  delegate.releaseCommit.resolve();
  await Promise.all([load, commit, dispose]);
  assert.equal(disposeCompleted, true);
});

test("all callers observe a debounced persistence failure instead of receiving a false success", async () => {
  const scheduler = new ManualScheduler();
  const delegate = new RecordingRepository();
  delegate.failSave = true;
  const repository = new DebouncedReviewStateRepository({
    delegate,
    scheduler
  });

  const firstSave = repository.save(target, createCommit(1));
  const secondSave = repository.save(target, createCommit(2));
  scheduler.runAll();

  await assert.rejects(firstSave, /forced debounced save failure/);
  await assert.rejects(secondSave, /forced debounced save failure/);
  assert.equal(delegate.saves.length, 0);
});

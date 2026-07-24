import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository,
  NodeAtomicTextFileStore,
  resolveReviewStateStorageRoute,
  type AtomicTextFileStore,
  type PersistenceFailureNotification,
  type RepositoryStateManifest,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index";
import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";

const timestamp = "2026-07-23T04:00:00.000Z";

const createContextState = (
  repositoryId: string,
  contextId: string,
  reviewedEndLineExclusive = 3,
  kind: "branch" | "workspace" = "branch"
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind,
  repositoryId,
  displayName: kind === "workspace" ? "Workspace review" : "branch/main",
  ...(kind === "workspace"
    ? {
        workspace: {
          workspaceId: repositoryId,
          snapshotRevision: "snapshot-1"
        }
      }
    : {
        branch: {
          refName: "refs/heads/main",
          headRevision: "abc123"
        }
      }),
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: kind === "workspace" ? "snapshot-1" : "abc123",
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
  reviewedEndLineExclusive = 3
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
  repositoryId: string,
  contextId: string,
  reviewedEndLineExclusive = 3,
  kind: "branch" | "workspace" = "branch"
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: createContextState(
    repositoryId,
    contextId,
    reviewedEndLineExclusive,
    kind
  ),
  globalState: createGlobalState(repositoryId, reviewedEndLineExclusive)
});

const createTemporaryStorage = async (): Promise<{
  root: string;
  storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-state-repository-"));

  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const repositoryTarget = (
  repositoryId = "github.com/example/review-range",
  contextId = "branch:refs/heads/main"
): ReviewStateRepositoryTarget => ({
  kind: "git",
  repositoryId,
  contextId
});

const workspaceTarget = (
  repositoryId = "workspace:stable-id",
  contextId = "workspace:default"
): ReviewStateRepositoryTarget => ({
  kind: "workspace",
  repositoryId,
  contextId
});

class ToggleFailingAtomicTextFileStore implements AtomicTextFileStore {
  public failManifestWrite = false;

  public constructor(
    private readonly delegate: AtomicTextFileStore = new NodeAtomicTextFileStore()
  ) {}

  public readText(filePath: string): Promise<string | undefined> {
    return this.delegate.readText(filePath);
  }

  public writeTextAtomically(filePath: string, content: string): Promise<void> {
    if (
      this.failManifestWrite &&
      (filePath.endsWith(`${path.sep}manifest.json`) ||
        filePath.endsWith(`${path.sep}workspace-state.json`))
    ) {
      throw new Error("forced manifest replacement failure");
    }

    return this.delegate.writeTextAtomically(filePath, content);
  }
}

test("routing separates Git and PR state from non-Git workspace state", async () => {
  const temporary = await createTemporaryStorage();

  try {
    const gitTarget = repositoryTarget();
    const pullRequestTarget: ReviewStateRepositoryTarget = {
      ...gitTarget,
      kind: "pull-request",
      contextId: "pr:42"
    };
    const workspace = workspaceTarget();

    const gitRoute = resolveReviewStateStorageRoute(temporary.storageUris, gitTarget);
    const pullRequestRoute = resolveReviewStateStorageRoute(
      temporary.storageUris,
      pullRequestTarget
    );
    const workspaceRoute = resolveReviewStateStorageRoute(
      temporary.storageUris,
      workspace
    );

    assert.equal(gitRoute.storageKind, "repository");
    assert.equal(pullRequestRoute.storageKind, "repository");
    assert.equal(gitRoute.rootPath, pullRequestRoute.rootPath);
    assert.equal(path.basename(gitRoute.rootPath).length, 64);
    assert.match(path.basename(gitRoute.rootPath), /^[a-f0-9]{64}$/);
    assert.equal(path.basename(path.dirname(gitRoute.rootPath)), "repositories");
    assert.equal(
      path.basename(path.dirname(path.dirname(gitRoute.rootPath))),
      "global"
    );
    assert.equal(gitRoute.statePointerPath, path.join(gitRoute.rootPath, "manifest.json"));
    assert.equal(gitRoute.historyDirectory, path.join(gitRoute.rootPath, "history"));
    assert.equal(gitRoute.snapshotDirectory, path.join(gitRoute.rootPath, "snapshots"));
    assert.equal(gitRoute.cacheDirectory, path.join(gitRoute.rootPath, "cache"));
    assert.equal(gitRoute.lockPath, path.join(gitRoute.rootPath, "lock"));

    assert.equal(workspaceRoute.storageKind, "workspace");
    assert.equal(workspaceRoute.rootPath, temporary.storageUris.storageUri?.fsPath);
    assert.equal(
      workspaceRoute.statePointerPath,
      path.join(workspaceRoute.rootPath, "workspace-state.json")
    );
    assert.equal(
      workspaceRoute.historyDirectory,
      path.join(workspaceRoute.rootPath, "history")
    );
    assert.equal(
      workspaceRoute.snapshotDirectory,
      path.join(workspaceRoute.rootPath, "snapshots")
    );
    assert.equal(workspaceRoute.cacheDirectory, undefined);
    assert.notEqual(workspaceRoute.rootPath, gitRoute.rootPath);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("workspace routing requires ExtensionContext.storageUri", () => {
  assert.throws(
    () =>
      resolveReviewStateStorageRoute(
        {
          globalStorageUri: { fsPath: "/global-only" }
        },
        workspaceTarget()
      ),
    /storageUri/
  );
});

test("repository save commits manifest last and reloads the same context and Global state", async () => {
  const temporary = await createTemporaryStorage();
  const target = repositoryTarget();
  const commit = createCommit(target.repositoryId, target.contextId);

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    await repository.save(target, commit);

    assert.deepEqual(repository.getCurrent(target), commit);
    assert.notEqual(repository.getCurrent(target), commit);

    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    const manifest = JSON.parse(
      await readFile(route.statePointerPath, "utf8")
    ) as RepositoryStateManifest;

    assert.equal(manifest.schemaVersion, REVIEW_RANGE_SCHEMA_VERSION);
    assert.equal(manifest.storageKind, "repository");
    assert.equal(manifest.repositoryId, target.repositoryId);
    assert.equal(manifest.contexts.length, 1);
    assert.equal(manifest.contexts[0]?.contextId, target.contextId);
    assert.ok(manifest.contexts[0]?.file.startsWith("contexts/"));
    assert.ok(manifest.globalState.file.startsWith("global-state/"));

    const contextDocument = JSON.parse(
      await readFile(path.join(route.rootPath, manifest.contexts[0]!.file), "utf8")
    ) as ReviewContextState;
    const globalDocument = JSON.parse(
      await readFile(path.join(route.rootPath, manifest.globalState.file), "utf8")
    ) as RepositoryGlobalState;

    assert.deepEqual(contextDocument, commit.contextState);
    assert.deepEqual(globalDocument, commit.globalState);

    const reloadedRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    assert.deepEqual(await reloadedRepository.load(target), commit);
    assert.deepEqual(reloadedRepository.getCurrent(target), commit);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("repository manifest preserves other contexts while atomically advancing one context", async () => {
  const temporary = await createTemporaryStorage();
  const firstTarget = repositoryTarget(undefined, "branch:main");
  const secondTarget = repositoryTarget(undefined, "pr:42");

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    await repository.save(
      firstTarget,
      createCommit(firstTarget.repositoryId, firstTarget.contextId, 2)
    );
    await repository.save(
      secondTarget,
      createCommit(secondTarget.repositoryId, secondTarget.contextId, 6)
    );

    const route = resolveReviewStateStorageRoute(temporary.storageUris, firstTarget);
    const manifest = JSON.parse(
      await readFile(route.statePointerPath, "utf8")
    ) as RepositoryStateManifest;

    assert.deepEqual(
      manifest.contexts.map((context) => context.contextId).sort(),
      [firstTarget.contextId, secondTarget.contextId].sort()
    );

    const reloadedRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    const firstReloaded = await reloadedRepository.load(firstTarget);
    assert.deepEqual(
      firstReloaded?.contextState,
      createContextState(firstTarget.repositoryId, firstTarget.contextId, 2)
    );
    assert.deepEqual(
      firstReloaded?.globalState,
      createGlobalState(firstTarget.repositoryId, 6)
    );
    assert.deepEqual(
      await reloadedRepository.load(secondTarget),
      createCommit(secondTarget.repositoryId, secondTarget.contextId, 6)
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("non-Git state uses workspace-state.json and never writes under globalStorageUri", async () => {
  const temporary = await createTemporaryStorage();
  const target = workspaceTarget();
  const commit = createCommit(
    target.repositoryId,
    target.contextId,
    4,
    "workspace"
  );

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });

    await repository.save(target, commit);

    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    assert.deepEqual(
      JSON.parse(await readFile(route.statePointerPath, "utf8")),
      commit
    );
    await assert.rejects(() => readdir(temporary.storageUris.globalStorageUri.fsPath));

    const reloadedRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(await reloadedRepository.load(target), commit);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("a failed repository manifest replacement preserves disk and memory state", async () => {
  const temporary = await createTemporaryStorage();
  const target = repositoryTarget();
  const initialCommit = createCommit(target.repositoryId, target.contextId, 2);
  const nextCommit = createCommit(target.repositoryId, target.contextId, 8);
  const failures: PersistenceFailureNotification[] = [];
  const fileStore = new ToggleFailingAtomicTextFileStore();

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: fileStore,
      notifyPersistenceFailure: (failure) => {
        failures.push(failure);
      }
    });

    await repository.save(target, initialCommit);
    fileStore.failManifestWrite = true;

    await assert.rejects(
      () => repository.save(target, nextCommit),
      /forced manifest replacement failure/
    );

    assert.deepEqual(repository.getCurrent(target), initialCommit);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.operation, "save");
    assert.deepEqual(failures[0]?.target, target);
    assert.ok(failures[0]?.filePath.endsWith(`${path.sep}manifest.json`));

    const reloadedRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(await reloadedRepository.load(target), initialCommit);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("a failed workspace replacement preserves disk and memory state", async () => {
  const temporary = await createTemporaryStorage();
  const target = workspaceTarget();
  const initialCommit = createCommit(
    target.repositoryId,
    target.contextId,
    2,
    "workspace"
  );
  const nextCommit = createCommit(
    target.repositoryId,
    target.contextId,
    8,
    "workspace"
  );
  const fileStore = new ToggleFailingAtomicTextFileStore();

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      atomicFileStore: fileStore
    });

    await repository.save(target, initialCommit);
    fileStore.failManifestWrite = true;

    await assert.rejects(
      () => repository.save(target, nextCommit),
      /forced manifest replacement failure/
    );
    assert.deepEqual(repository.getCurrent(target), initialCommit);

    const reloadedRepository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.deepEqual(await reloadedRepository.load(target), initialCommit);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("schema mismatch is rejected and reported during load", async () => {
  const temporary = await createTemporaryStorage();
  const target = workspaceTarget();
  const failures: PersistenceFailureNotification[] = [];

  try {
    const route = resolveReviewStateStorageRoute(temporary.storageUris, target);
    await new NodeAtomicTextFileStore().writeTextAtomically(
      route.statePointerPath,
      JSON.stringify({
        ...createCommit(target.repositoryId, target.contextId, 2, "workspace"),
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION + 1
      })
    );

    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris,
      notifyPersistenceFailure: (failure) => {
        failures.push(failure);
      }
    });

    await assert.rejects(() => repository.load(target), /schema version/i);
    assert.equal(repository.getCurrent(target), undefined);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.operation, "load");
    assert.equal(failures[0]?.filePath, route.statePointerPath);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("save validates manifest, context, Global, target identity before any write", async () => {
  const temporary = await createTemporaryStorage();
  const target = repositoryTarget();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target);

  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    const invalidCommit = createCommit("other-repository", target.contextId);

    await assert.rejects(
      () => repository.save(target, invalidCommit),
      /repositoryId/
    );
    await assert.rejects(() => readFile(route.statePointerPath, "utf8"));
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("NodeAtomicTextFileStore replaces a file without leaving temporary files", async () => {
  const temporary = await createTemporaryStorage();
  const directory = path.join(temporary.root, "atomic");
  const filePath = path.join(directory, "state.json");
  const fileStore = new NodeAtomicTextFileStore();

  try {
    await fileStore.writeTextAtomically(filePath, "before");
    await fileStore.writeTextAtomically(filePath, "after");

    assert.equal(await fileStore.readText(filePath), "after");
    assert.deepEqual(await readdir(directory), ["state.json"]);
    assert.equal(await fileStore.readText(path.join(directory, "missing.json")), undefined);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

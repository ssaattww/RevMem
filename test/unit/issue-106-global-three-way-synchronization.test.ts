import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  StaleReviewStateError,
  type ReviewStateRepositoryTarget,
} from "../../src/adapters/state-repository/index.js";
import {
  createGitHubPullRequestContextIdFromRepositoryId,
  GitHubPullRequestContextStateService,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
} from "../../src/application/github-pr-context/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const REPOSITORY_ID = "github.com/ssaattww/revmem";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const TIMESTAMP = "2026-09-01T00:00:00.000Z";
const FILE_ID = "src/example.ts";

const contextId = (number: number): string =>
  createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, number);

const pullRequest = (
  number: number,
  baseSha: string,
  headSha: string,
): PullRequestReviewContext => ({
  host: "github.com",
  owner: "ssaattww",
  repository: "revmem",
  number,
  state: "open",
  title: `PR ${number}`,
  baseSha,
  headSha,
});

const contextState = (
  number: number,
  baseSha = SHA_A,
  headSha = SHA_B,
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: contextId(number),
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${number}`,
  pullRequest: pullRequest(number, baseSha, headSha),
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: FILE_ID,
      previousPaths: [],
      revisionId: headSha,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 2,
      updatedAt: TIMESTAMP,
    },
  },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
});

const globalState = (revisionId = SHA_B): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revisionId,
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: FILE_ID,
      revisionId,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      updatedAt: TIMESTAMP,
    },
  },
  updatedAt: TIMESTAMP,
});

const target = (number: number): ReviewStateRepositoryTarget => ({
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  contextId: contextId(number),
});

const advanceContext = (state: ReviewContextState, revisionId: string): ReviewContextState => ({
  ...structuredClone(state),
  pullRequest: {
    ...state.pullRequest!,
    baseSha: state.pullRequest!.headSha,
    headSha: revisionId,
  },
  files: Object.fromEntries(Object.entries(state.files).map(([fileId, file]) => [fileId, {
    ...file,
    revisionId,
  }])),
  updatedAt: "2026-09-01T00:01:00.000Z",
});

const advanceGlobal = (state: RepositoryGlobalState, revisionId: string): RepositoryGlobalState => ({
  ...structuredClone(state),
  currentRevisionId: revisionId,
  files: Object.fromEntries(Object.entries(state.files).map(([fileId, file]) => [fileId, {
    ...file,
    revisionId,
  }])),
  updatedAt: "2026-09-01T00:01:00.000Z",
});

class MemoryPullRequestRepository implements GitHubPullRequestContextRepositoryPort {
  public commits = 0;
  public constructor(public current: PullRequestReviewStateCommit) {}

  public async load(): Promise<PullRequestReviewStateCommit> {
    return structuredClone(this.current);
  }

  public async create(): Promise<void> {
    throw new Error("not used");
  }

  public async commit(transaction: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> {
    this.commits += 1;
    this.current = structuredClone(transaction.next);
  }
}

test("ISSUE-106 owner transaction publishes every PR Context and one Global revision atomically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-owner-"));
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
    });
    await repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    await repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53),
      globalState: globalState(),
    });

    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(expected);
    assert.deepEqual(expected.contextStates.map((state) => state.contextId), [contextId(52), contextId(53)]);

    await repository.commitRepository({
      repositoryId: REPOSITORY_ID,
      expected,
      next: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: REPOSITORY_ID,
        contextStates: expected.contextStates.map((state) => advanceContext(state, SHA_C)),
        globalState: advanceGlobal(expected.globalState, SHA_C),
      },
    });

    const reloaded52 = await repository.load(target(52));
    const reloaded53 = await repository.load(target(53));
    assert.equal(reloaded52?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(reloaded53?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(reloaded52?.globalState.currentRevisionId, SHA_C);
    assert.equal(reloaded53?.globalState.currentRevisionId, SHA_C);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ISSUE-106 different PR heads coexist while Global identifies the current repository-owner revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-different-heads-"));
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
    });
    await repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    await repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53, SHA_A, SHA_D),
      globalState: globalState(),
    });
    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(expected);

    await repository.commitRepository({
      repositoryId: REPOSITORY_ID,
      expected,
      next: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: REPOSITORY_ID,
        contextStates: expected.contextStates.map((state) =>
          state.contextId === contextId(52)
            ? advanceContext(state, SHA_C)
            : {
                ...structuredClone(state),
                pullRequest: { ...state.pullRequest!, state: "closed" },
                updatedAt: "2026-09-01T00:01:00.000Z",
              }
        ),
        globalState: advanceGlobal(expected.globalState, SHA_C),
      },
    });

    const reloaded52 = await repository.load(target(52));
    const reloaded53 = await repository.load(target(53));
    assert.equal(reloaded52?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(reloaded53?.contextState.pullRequest?.headSha, SHA_D);
    assert.equal(reloaded53?.contextState.pullRequest?.state, "closed");
    assert.equal(reloaded52?.globalState.currentRevisionId, SHA_C);
    assert.equal(reloaded53?.globalState.currentRevisionId, SHA_C);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ISSUE-106 owner transaction rejects mixed current Context or Global revisions before publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-mixed-current-"));
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
    });
    await repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    await repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53),
      globalState: globalState(),
    });
    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(expected);
    const advancedContexts = expected.contextStates.map((state) => advanceContext(state, SHA_C));
    const advancedOwnerGlobal = advanceGlobal(expected.globalState, SHA_C);

    const invalidContext = structuredClone(advancedContexts);
    invalidContext[0]!.files[FILE_ID]!.revisionId = SHA_B;
    await assert.rejects(
      () => repository.commitRepository({
        repositoryId: REPOSITORY_ID,
        expected,
        next: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          repositoryId: REPOSITORY_ID,
          contextStates: invalidContext,
          globalState: advancedOwnerGlobal,
        },
      }),
      /Context file identity or revision/u,
    );

    const invalidGlobal = structuredClone(advancedOwnerGlobal);
    invalidGlobal.files[FILE_ID]!.revisionId = SHA_B;
    await assert.rejects(
      () => repository.commitRepository({
        repositoryId: REPOSITORY_ID,
        expected,
        next: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          repositoryId: REPOSITORY_ID,
          contextStates: advancedContexts,
          globalState: invalidGlobal,
        },
      }),
      /Global file identity or revision/u,
    );

    const visible = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.deepEqual(visible, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ISSUE-106 stale owner CAS publishes none of the planned Context or Global snapshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-stale-"));
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
    });
    await repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    await repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53),
      globalState: globalState(),
    });
    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(expected);

    const current52 = await repository.load(target(52));
    assert.ok(current52);
    await repository.commit({
      repositoryId: REPOSITORY_ID,
      contextId: contextId(52),
      expected: current52,
      next: {
        contextState: {
          ...current52.contextState,
          displayName: "PR #52 metadata race",
          updatedAt: "2026-09-01T00:00:30.000Z",
        },
        globalState: current52.globalState,
      },
    });

    await assert.rejects(
      () => repository.commitRepository({
        repositoryId: REPOSITORY_ID,
        expected,
        next: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          repositoryId: REPOSITORY_ID,
          contextStates: expected.contextStates.map((state) => advanceContext(state, SHA_C)),
          globalState: advanceGlobal(expected.globalState, SHA_C),
        },
      }),
      StaleReviewStateError,
    );

    const after52 = await repository.load(target(52));
    const after53 = await repository.load(target(53));
    assert.equal(after52?.contextState.displayName, "PR #52 metadata race");
    assert.equal(after52?.contextState.pullRequest?.headSha, SHA_B);
    assert.equal(after53?.contextState.pullRequest?.headSha, SHA_B);
    assert.equal(after52?.globalState.currentRevisionId, SHA_B);
    assert.equal(after53?.globalState.currentRevisionId, SHA_B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("ISSUE-106 owner transaction failure before manifest publication leaves the previous owner generation visible", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-failure-"));
  let failManifest = false;
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
      beforeAtomicPublication: (filePath) => {
        if (failManifest && path.basename(filePath) === "manifest.json") {
          throw new Error("forced owner manifest publication failure");
        }
      },
    });
    await repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    await repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53),
      globalState: globalState(),
    });
    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(expected);
    failManifest = true;
    await assert.rejects(() => repository.commitRepository({
      repositoryId: REPOSITORY_ID,
      expected,
      next: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: REPOSITORY_ID,
        contextStates: expected.contextStates.map((state) => advanceContext(state, SHA_C)),
        globalState: advanceGlobal(expected.globalState, SHA_C),
      },
    }), /forced owner manifest publication failure/);
    failManifest = false;

    const restarted = new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: root } },
    });
    const visible = await restarted.loadRepositorySnapshot(REPOSITORY_ID);
    assert.ok(visible);
    assert.deepEqual(visible.contextStates.map((state) => state.pullRequest?.headSha), [SHA_B, SHA_B]);
    assert.equal(visible.globalState.currentRevisionId, SHA_B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ISSUE-106 debounced production owner flushes pending saves before one repository CAS", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-debounced-"));
  const delegate = new FileSystemReviewStateRepository({
    storageUris: { globalStorageUri: { fsPath: root } },
  });
  const repository = new DebouncedReviewStateRepository({
    delegate,
    debounceMilliseconds: 60_000,
    scheduler: {
      schedule: () => Symbol("pending-owner-save"),
      cancel: () => undefined,
    },
  });
  try {
    const pending52 = repository.save(target(52), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(52),
      globalState: globalState(),
    });
    const pending53 = repository.save(target(53), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: contextState(53),
      globalState: globalState(),
    });

    const expected = await repository.loadRepositorySnapshot(REPOSITORY_ID);
    await Promise.all([pending52, pending53]);
    assert.ok(expected);
    assert.deepEqual(expected.contextStates.map((state) => state.contextId), [contextId(52), contextId(53)]);

    await repository.commitRepository({
      repositoryId: REPOSITORY_ID,
      expected,
      next: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: REPOSITORY_ID,
        contextStates: expected.contextStates.map((state) => advanceContext(state, SHA_C)),
        globalState: advanceGlobal(expected.globalState, SHA_C),
      },
    });

    const durable = await delegate.loadRepositorySnapshot(REPOSITORY_ID);
    assert.deepEqual(durable?.contextStates.map((state) => state.pullRequest?.headSha), [SHA_C, SHA_C]);
    assert.equal(durable?.globalState.currentRevisionId, SHA_C);
  } finally {
    await repository.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("ISSUE-106 pull-request mapping can prepare from one owner snapshot without state or history publication", async () => {
  const repository = new MemoryPullRequestRepository({
    contextState: contextState(52),
    globalState: globalState(),
  });
  const historyReasons: string[] = [];
  const service = new GitHubPullRequestContextStateService(
    repository,
    async ({ current, nextPullRequest }) => ({
      contextState: {
        ...structuredClone(current.contextState),
        pullRequest: nextPullRequest,
        files: Object.fromEntries(Object.entries(current.contextState.files).map(([fileId, file]) => [fileId, {
          ...file,
          revisionId: nextPullRequest.headSha,
        }])),
        updatedAt: "2026-09-01T00:01:00.000Z",
      },
      globalState: advanceGlobal(current.globalState, nextPullRequest.headSha),
      mappingDisposition: "mapped",
    }),
    {
      recordContextCreated: async () => undefined,
      recordRevisionMapping: async (_previous, _next, reason) => {
        historyReasons.push(reason ?? "");
      },
    },
  );
  const current = structuredClone(repository.current);

  const prepared = await service.prepareUpdate({
    repositoryId: REPOSITORY_ID,
    identity: {
      host: "github.com",
      owner: "ssaattww",
      repository: "revmem",
      pullRequestNumber: 52,
    },
    displayName: "PR #52",
    pullRequest: pullRequest(52, SHA_B, SHA_C),
  }, current);

  assert.equal(repository.commits, 0);
  assert.deepEqual(historyReasons, []);
  assert.deepEqual(prepared.expected, current);
  assert.equal(prepared.next.contextState.pullRequest?.headSha, SHA_C);
  assert.equal(prepared.next.globalState.currentRevisionId, SHA_C);

  await service.recordPreparedUpdateHistory(prepared);
  assert.deepEqual(historyReasons, ["git-revision-mapped"]);
});

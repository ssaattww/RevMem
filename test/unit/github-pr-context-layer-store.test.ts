import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeGitHubPullRequestIdentity,
  createGitHubPullRequestContextId,
  createGitHubPullRequestContextIdFromRepositoryId,
  GitHubPullRequestContextStateService,
  isPullRequestDecorationEnabled,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
} from "../../src/application/github-pr-context/index.js";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

class InMemoryRepository implements GitHubPullRequestContextRepositoryPort {
  public current: PullRequestReviewStateCommit | undefined;
  public commits = 0;
  public async load(): Promise<PullRequestReviewStateCommit | undefined> { return this.current === undefined ? undefined : clone(this.current); }
  public async create(transaction: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> {
    if (this.current !== undefined) throw new Error("stale create");
    this.current = clone(transaction.next);
  }
  public async commit(transaction: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> {
    if (this.current === undefined || JSON.stringify(this.current) !== JSON.stringify(transaction.expected)) throw new Error("stale commit");
    this.commits += 1;
    this.current = clone(transaction.next);
  }
}

function pullRequest(overrides: Partial<PullRequestReviewContext & { decorationEnabled?: boolean }> = {}): PullRequestReviewContext & { decorationEnabled?: boolean } {
  return { host: "github.com", owner: "ssaattww", repository: "revmem", number: 48, state: "open", baseSha: SHA_A, headSha: SHA_B, ...overrides };
}

function context(overrides: Partial<ReviewContextState> = {}): ReviewContextState {
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, 48),
    kind: "pull-request",
    repositoryId: REPOSITORY_ID,
    displayName: "PR #48",
    pullRequest: pullRequest(),
    files: {
      file: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: "file",
        currentPath: "src/example.ts",
        previousPaths: ["src/old.ts"],
        revisionId: SHA_B,
        modifiedReviewed: [{ startLine: 1, endLineExclusive: 3 }],
        originalReviewedByDiff: { [`${SHA_A}..${SHA_B}`]: [{ startLine: 4, endLineExclusive: 5 }] },
        lineCount: 8,
        updatedAt: "2026-08-06T10:00:00.000Z",
      },
    },
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

function globalState(revision = SHA_B): RepositoryGlobalState {
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: REPOSITORY_ID,
    currentRevisionId: revision,
    files: {
      file: { fileId: "file", currentPath: "src/example.ts", revisionId: revision, reviewed: [{ startLine: 1, endLineExclusive: 3 }], updatedAt: "2026-08-06T10:00:00.000Z" },
    },
    updatedAt: "2026-08-06T10:00:00.000Z",
  };
}

function service(repository: GitHubPullRequestContextRepositoryPort): GitHubPullRequestContextStateService {
  return new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({
    contextState: {
      ...current.contextState,
      pullRequest: nextPullRequest,
      files: { file: { ...current.contextState.files.file!, revisionId: nextPullRequest.headSha, modifiedReviewed: [] } },
      updatedAt: "2026-08-06T10:10:00.000Z",
    },
    globalState: {
      ...current.globalState,
      currentRevisionId: nextPullRequest.headSha,
      files: { file: { ...current.globalState.files.file!, revisionId: nextPullRequest.headSha, reviewed: [] } },
      updatedAt: "2026-08-06T10:10:00.000Z",
    },
  }));
}

test("canonical repository identityをcontext IDへ共有する", () => {
  assert.equal(createGitHubPullRequestContextId({ host: "GitHub.COM:443", owner: "SSAATTWW", repository: "RevMem.git", pullRequestNumber: 48 }), createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, 48));
  assert.deepEqual(canonicalizeGitHubPullRequestIdentity({ host: "ghe.example:8443", owner: "Team", repository: "Repo", pullRequestNumber: 1 }), { host: "ghe.example:8443", owner: "Team", repository: "Repo", pullRequestNumber: 1 });
});

test("create境界はcanonical context ID不一致を拒否する", async () => {
  const repository = new InMemoryRepository();
  await assert.rejects(() => service(repository).create({ contextState: context({ contextId: "github-pr:github.com/SSAATTWW/RevMem#48" }), globalState: globalState() }, undefined), /canonical/);
});

test("metadata-only更新はfile stateとGlobalを保持する", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const result = await service(repository).update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com:443", owner: "SSAATTWW", repository: "RevMem", pullRequestNumber: 48 }, pullRequest: pullRequest({ state: "closed" }) });
  assert.deepEqual(result.contextState.files, context().files);
  assert.deepEqual(result.globalState, globalState());
  assert.equal(isPullRequestDecorationEnabled(result.contextState.pullRequest!), false);
});

test("closed既定無効と明示overrideを永続化する", async () => {
  assert.equal(isPullRequestDecorationEnabled(pullRequest({ state: "closed" })), false);
  assert.equal(isPullRequestDecorationEnabled(pullRequest({ state: "closed", decorationEnabled: true })), true);
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const result = await service(repository).update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ state: "closed", decorationEnabled: true }) });
  assert.equal(isPullRequestDecorationEnabled(result.contextState.pullRequest!), true);
  assert.equal((repository.current?.contextState.pullRequest as PullRequestReviewContext & { decorationEnabled?: boolean }).decorationEnabled, true);
});

test("revision変更はContextとGlobalを同一headへmapする", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const result = await service(repository).update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ headSha: SHA_C }) });
  assert.equal(result.contextState.files.file?.revisionId, SHA_C);
  assert.equal(result.globalState.currentRevisionId, SHA_C);
  assert.equal(result.globalState.files.file?.revisionId, SHA_C);
});

test("mixed snapshot mapping commits once and records a distinct history disposition", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const reasons: string[] = [];
  const sut = new GitHubPullRequestContextStateService(
    repository,
    async ({ current, nextPullRequest }) => ({
      contextState: {
        ...current.contextState,
        pullRequest: nextPullRequest,
        files: { file: { ...current.contextState.files.file!, revisionId: nextPullRequest.headSha } },
      },
      globalState: {
        ...current.globalState,
        currentRevisionId: nextPullRequest.headSha,
        files: { file: { ...current.globalState.files.file!, revisionId: nextPullRequest.headSha } },
      },
      mappingDisposition: "mixed",
    }),
    {
      recordContextCreated: async () => undefined,
      recordRevisionMapping: async (_previous, _next, reason) => { reasons.push(reason ?? ""); },
    }
  );

  await sut.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ headSha: SHA_C }) });

  assert.equal(repository.commits, 1);
  assert.deepEqual(reasons, ["exact-revision-snapshot-mixed"]);
});

test("旧revision Globalを返すmapperはfail closedにする", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const invalid = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({ contextState: { ...current.contextState, pullRequest: nextPullRequest }, globalState: current.globalState }));
  await assert.rejects(() => invalid.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ headSha: SHA_C }) }), /Context\/Global/);
  assert.equal(repository.commits, 0);
});

test("実filesystem repositoryでcreate、restart load、CAS stale rejectionを検証する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-"));
  const storageUris = { globalStorageUri: { fsPath: root } };
  const first = service(new FileSystemReviewStateRepository({ storageUris }));
  const initial = { contextState: context(), globalState: globalState() };
  await first.create(initial, undefined);

  const restartedRepository = new FileSystemReviewStateRepository({ storageUris });
  const restarted = service(restartedRepository);
  const loaded = await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 });
  assert.deepEqual(loaded?.contextState, initial.contextState);
  assert.deepEqual(loaded?.globalState, initial.globalState);

  const staleRepository = new FileSystemReviewStateRepository({ storageUris });
  await staleRepository.load({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: context().contextId });
  await restarted.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ title: "new" }) });
  await assert.rejects(() => staleRepository.commit({ repositoryId: REPOSITORY_ID, contextId: context().contextId, expected: initial, next: initial }), /no longer matches/);
});

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

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
    if (this.current !== undefined || transaction.expected.contextState !== undefined) throw new Error("stale create");
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
      "stable-file-id": {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: "stable-file-id",
        currentPath: "src/example.ts",
        previousPaths: ["src/old-example.ts"],
        revisionId: SHA_B,
        modifiedReviewed: [{ startLine: 1, endLineExclusive: 3 }],
        originalReviewedByDiff: { [`${SHA_A}..${SHA_B}`]: [{ startLine: 4, endLineExclusive: 5 }] },
        contentHash: "hash",
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
      "stable-file-id": {
        fileId: "stable-file-id",
        currentPath: "src/example.ts",
        revisionId: revision,
        reviewed: [{ startLine: 1, endLineExclusive: 3 }],
        contentHash: "hash",
        updatedAt: "2026-08-06T10:00:00.000Z",
      },
    },
    updatedAt: "2026-08-06T10:00:00.000Z",
  };
}

function service(repository: GitHubPullRequestContextRepositoryPort): GitHubPullRequestContextStateService {
  return new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({
    contextState: {
      ...current.contextState,
      pullRequest: nextPullRequest,
      files: {
        ...current.contextState.files,
        "stable-file-id": {
          ...current.contextState.files["stable-file-id"]!,
          revisionId: nextPullRequest.headSha,
          modifiedReviewed: [],
        },
      },
      updatedAt: "2026-08-06T10:10:00.000Z",
    },
    globalState: {
      ...current.globalState,
      currentRevisionId: nextPullRequest.headSha,
      files: {
        ...current.globalState.files,
        "stable-file-id": {
          ...current.globalState.files["stable-file-id"]!,
          revisionId: nextPullRequest.headSha,
          reviewed: [],
        },
      },
      updatedAt: "2026-08-06T10:10:00.000Z",
    },
  }));
}

test("GitHub.com identityはcaseとdefault HTTPS portをcanonical化する", () => {
  assert.equal(createGitHubPullRequestContextId({ host: "GitHub.COM:443", owner: "SSAATTWW", repository: "RevMem.git", pullRequestNumber: 48 }), createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, 48));
  assert.deepEqual(canonicalizeGitHubPullRequestIdentity({ host: "ghe.example:8443", owner: "Team", repository: "Repo", pullRequestNumber: 1 }), { host: "ghe.example:8443", owner: "Team", repository: "Repo", pullRequestNumber: 1 });
  assert.throws(() => canonicalizeGitHubPullRequestIdentity({ host: "github.com:70000", owner: "a", repository: "b", pullRequestNumber: 1 }));
});

test("create境界はcanonical repositoryIdとcontextIdの不一致を拒否する", async () => {
  const repository = new InMemoryRepository();
  await assert.rejects(() => service(repository).create({ contextState: context({ contextId: "github-pr:github.com/SSAATTWW/RevMem#48" }), globalState: globalState() }, undefined), /canonical/);
  assert.equal(repository.current, undefined);
});

test("metadata-only更新はauthoritative file stateとGlobalを保持する", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const result = await service(repository).update({
    repositoryId: REPOSITORY_ID,
    identity: { host: "github.com:443", owner: "SSAATTWW", repository: "RevMem", pullRequestNumber: 48 },
    pullRequest: pullRequest({ state: "closed", title: "Closed PR" }),
    displayName: "PR #48 closed",
  });
  assert.deepEqual(result.contextState.files, context().files);
  assert.deepEqual(result.globalState, globalState());
  assert.equal(isPullRequestDecorationEnabled(result.contextState.pullRequest!), false);
});

test("closed既定無効と明示overrideを保存・復元できる", async () => {
  assert.equal(isPullRequestDecorationEnabled(pullRequest({ state: "closed" })), false);
  assert.equal(isPullRequestDecorationEnabled(pullRequest({ state: "closed", decorationEnabled: true })), true);
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const updated = await service(repository).update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ state: "closed", decorationEnabled: true }) });
  assert.equal(isPullRequestDecorationEnabled(updated.contextState.pullRequest!), true);
  assert.equal((repository.current?.contextState.pullRequest as PullRequestReviewContext & { decorationEnabled?: boolean }).decorationEnabled, true);
});

test("revision変更はContextとowner-wide Globalを同じheadへmapしてCAS commitする", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const result = await service(repository).update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ headSha: SHA_C }) });
  assert.equal(result.contextState.files["stable-file-id"]?.revisionId, SHA_C);
  assert.equal(result.globalState.currentRevisionId, SHA_C);
  assert.equal(result.globalState.files["stable-file-id"]?.revisionId, SHA_C);
  assert.deepEqual(result.globalState.files["stable-file-id"]?.reviewed, []);
});

test("Globalを旧revisionのまま返すmapperはfail closedで永続化しない", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const invalid = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({ contextState: { ...current.contextState, pullRequest: nextPullRequest }, globalState: current.globalState }));
  await assert.rejects(() => invalid.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ headSha: SHA_C }) }), /Context\/Global/);
  assert.equal(repository.commits, 0);
});

test("実filesystem repositoryでcreate、restart load、CAS stale rejectionを検証する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-"));
  const storageUris = { globalStorageUri: { fsPath: root } };
  const firstRepository = new FileSystemReviewStateRepository({ storageUris });
  const firstService = service(firstRepository);
  const initial = { contextState: context(), globalState: globalState() };
  await firstService.create(initial, undefined);

  const restartedRepository = new FileSystemReviewStateRepository({ storageUris });
  const restartedService = service(restartedRepository);
  const loaded = await restartedService.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 });
  assert.deepEqual(loaded, initial);

  const staleRepository = new FileSystemReviewStateRepository({ storageUris });
  await staleRepository.load({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: context().contextId });
  await restartedService.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pullRequest({ title: "new" }) });
  await assert.rejects(() => staleRepository.commit({ repositoryId: REPOSITORY_ID, contextId: context().contextId, expected: initial, next: initial }), /no longer matches/);
});

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

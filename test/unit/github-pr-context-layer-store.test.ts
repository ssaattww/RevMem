import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeGitHubPullRequestIdentity,
  createGitHubPullRequestContextId,
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

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

class InMemoryRepository implements GitHubPullRequestContextRepositoryPort {
  public current: PullRequestReviewStateCommit | undefined;
  public commits = 0;

  public async load(): Promise<PullRequestReviewStateCommit | undefined> {
    return this.current === undefined ? undefined : clone(this.current);
  }

  public async create(transaction: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> {
    if (this.current !== undefined || transaction.expected.contextState !== undefined) {
      throw new Error("stale create");
    }
    this.current = clone(transaction.next);
  }

  public async commit(transaction: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> {
    if (this.current === undefined || JSON.stringify(this.current) !== JSON.stringify(transaction.expected)) {
      throw new Error("stale commit");
    }
    this.commits += 1;
    this.current = clone(transaction.next);
  }
}

function pullRequest(overrides: Partial<PullRequestReviewContext> = {}): PullRequestReviewContext {
  return {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 48,
    state: "open",
    baseSha: SHA_A,
    headSha: SHA_B,
    ...overrides,
  };
}

function context(overrides: Partial<ReviewContextState> = {}): ReviewContextState {
  const identity = { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 };
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: createGitHubPullRequestContextId(identity),
    kind: "pull-request",
    repositoryId: "github.com/ssaattww/revmem",
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
        originalReviewedByDiff: {
          [`${SHA_A}..${SHA_B}`]: [{ startLine: 4, endLineExclusive: 5 }],
        },
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

function globalState(): RepositoryGlobalState {
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "github.com/ssaattww/revmem",
    currentRevisionId: SHA_B,
    files: {},
    updatedAt: "2026-08-06T10:00:00.000Z",
  };
}

test("GitHub.com identityはcaseとdefault HTTPS portをcanonical化する", () => {
  const first = createGitHubPullRequestContextId({
    host: "GitHub.COM:443",
    owner: "SSAATTWW",
    repository: "RevMem.git",
    pullRequestNumber: 48,
  });
  const second = createGitHubPullRequestContextId({
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    pullRequestNumber: 48,
  });
  assert.equal(first, second);
  assert.deepEqual(canonicalizeGitHubPullRequestIdentity({ host: "ghe.example:8443", owner: "Team", repository: "Repo", pullRequestNumber: 1 }), {
    host: "ghe.example:8443",
    owner: "Team",
    repository: "Repo",
    pullRequestNumber: 1,
  });
  assert.throws(() => canonicalizeGitHubPullRequestIdentity({ host: "github.com:70000", owner: "a", repository: "b", pullRequestNumber: 1 }));
});

test("metadata-only更新はauthoritative file IDs、rename履歴、両side ranges、Globalを保持する", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const service = new GitHubPullRequestContextStateService(repository, async () => {
    throw new Error("metadata-only update must not map revisions");
  });

  const result = await service.update({
    repositoryId: "github.com/ssaattww/revmem",
    identity: { host: "github.com:443", owner: "SSAATTWW", repository: "RevMem", pullRequestNumber: 48 },
    pullRequest: pullRequest({ state: "closed", title: "Closed PR" }),
    displayName: "PR #48 closed",
  });

  assert.deepEqual(result.contextState.files, context().files);
  assert.deepEqual(result.globalState, globalState());
  assert.equal(result.contextState.pullRequest?.state, "closed");
  assert.equal(repository.commits, 1);
});

test("revision変更はmapper evidenceを必須とし、mapperが変更行を未確認化したcomplete snapshotだけをCAS commitする", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  let mapperCalls = 0;
  const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => {
    mapperCalls += 1;
    return {
      ...current,
      pullRequest: nextPullRequest,
      files: {
        ...current.files,
        "stable-file-id": {
          ...current.files["stable-file-id"]!,
          revisionId: nextPullRequest.headSha,
          modifiedReviewed: [],
        },
      },
      updatedAt: "2026-08-06T10:10:00.000Z",
    };
  });

  const result = await service.update({
    repositoryId: "github.com/ssaattww/revmem",
    identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 },
    pullRequest: pullRequest({ headSha: SHA_C }),
  });

  assert.equal(mapperCalls, 1);
  assert.equal(result.contextState.files["stable-file-id"]?.revisionId, SHA_C);
  assert.deepEqual(result.contextState.files["stable-file-id"]?.modifiedReviewed, []);
  assert.deepEqual(result.contextState.files["stable-file-id"]?.originalReviewedByDiff, context().files["stable-file-id"]?.originalReviewedByDiff);
});

test("mismatched revision mappingはfail closedで永続化しない", async () => {
  const repository = new InMemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const service = new GitHubPullRequestContextStateService(repository, async ({ current }) => current);

  await assert.rejects(() => service.update({
    repositoryId: "github.com/ssaattww/revmem",
    identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 },
    pullRequest: pullRequest({ headSha: SHA_C }),
  }), /mismatched/);
  assert.equal(repository.commits, 0);
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

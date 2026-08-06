import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubPullRequestContextIdFromRepositoryId,
  GitHubPullRequestContextStateService,
  isPullRequestDecorationEnabled,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
} from "../../src/application/github-pr-context/index.js";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import { normalizeGitRemoteUrl } from "../../src/adapters/local-git/index.js";
import {
  canonicalizeHostedGitRepositoryIdentity,
} from "../../src/core/repository-identity/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

type VisiblePullRequest = PullRequestReviewContext & { decorationEnabled?: boolean };

const pr = (overrides: Partial<VisiblePullRequest> = {}): VisiblePullRequest => ({
  host: "github.com", owner: "ssaattww", repository: "revmem", number: 48,
  state: "open", baseSha: A, headSha: B, ...overrides,
});

const context = (number = 48, overrides: Partial<ReviewContextState> = {}): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, number),
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${number}`,
  pullRequest: pr({ number }),
  files: {
    file: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: B,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 1,
      updatedAt: "2026-08-07T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  ...overrides,
});

const globalState = (revision = B): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revision,
  files: {
    file: {
      fileId: "file", currentPath: "src/example.ts", revisionId: revision,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }], updatedAt: "2026-08-07T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-07T00:00:00.000Z",
});

class MemoryRepository implements GitHubPullRequestContextRepositoryPort {
  current?: PullRequestReviewStateCommit;
  commits = 0;
  async load(): Promise<PullRequestReviewStateCommit | undefined> { return this.current === undefined ? undefined : structuredClone(this.current); }
  async create(input: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> { this.current = structuredClone(input.next); }
  async commit(input: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> { this.commits += 1; this.current = structuredClone(input.next); }
}

test("T202/T401 and T404 share one hosted repository canonicalizer", () => {
  const shared = canonicalizeHostedGitRepositoryIdentity("GitHub.COM:443", "SSAATTWW/RevMem.git");
  assert.equal(shared, REPOSITORY_ID);
  assert.equal(normalizeGitRemoteUrl("https://GitHub.COM:443/SSAATTWW/RevMem.git"), shared);
});

test("mapped snapshots reject stale or foreign file revisions and PR descriptors", async () => {
  const repository = new MemoryRepository();
  repository.current = { contextState: context(), globalState: globalState() };
  const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({
    contextState: {
      ...current.contextState,
      pullRequest: { ...nextPullRequest, owner: "other" },
      files: { file: { ...current.contextState.files.file!, revisionId: B } },
    },
    globalState: {
      ...current.globalState,
      currentRevisionId: C,
      files: { file: { ...current.globalState.files.file!, revisionId: B } },
    },
  }));
  await assert.rejects(() => service.update({
    repositoryId: REPOSITORY_ID,
    identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 },
    pullRequest: pr({ headSha: C }),
  }), /mapped|revision|descriptor|identity/i);
  assert.equal(repository.commits, 0);
});

test("explicit closed override survives metadata refresh and revision transition", async () => {
  const repository = new MemoryRepository();
  repository.current = { contextState: context(48, { pullRequest: pr({ state: "closed", decorationEnabled: true }) }), globalState: globalState() };
  const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({
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
  }));
  const identity = { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 };
  const refreshed = await service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ state: "closed", title: "refresh" }) });
  assert.equal(isPullRequestDecorationEnabled(refreshed.contextState.pullRequest!), true);
  const transitioned = await service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ state: "closed", headSha: C }) });
  assert.equal(isPullRequestDecorationEnabled(transitioned.contextState.pullRequest!), true);
});

test("filesystem persistence isolates multiple PR contexts across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-r3-"));
  const repository = new FileSystemReviewStateRepository({ globalStorageUri: { fsPath: root } });
  const service = new GitHubPullRequestContextStateService(repository, async ({ current }) => current);
  await service.create({ contextState: context(48), globalState: globalState() }, undefined);
  await service.create({ contextState: context(49, { pullRequest: pr({ number: 49 }) }), globalState: globalState() }, globalState());
  const restarted = new GitHubPullRequestContextStateService(new FileSystemReviewStateRepository({ globalStorageUri: { fsPath: root } }), async ({ current }) => current);
  assert.equal((await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }))?.contextState.pullRequest?.number, 48);
  assert.equal((await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 49 }))?.contextState.pullRequest?.number, 49);
});

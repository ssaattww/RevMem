import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FetchGitHubPullRequestLifecycleAdapter,
} from "../../src/adapters/github/index.js";
import {
  GitHubPullRequestContextStateService,
  createImmutablePullRequestRevisionMapper,
  isPullRequestDecorationEnabled,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
} from "../../src/application/github-pr-context/index.js";
import { projectReviewContexts } from "../../src/application/review-contexts/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const FILE_ID = "stable-file";
const identity = { host: "github.com", owner: "ssaattww", repository: "revmem" };

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const persistedContext = (state: "open" | "closed" | "merged" = "open"): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #52",
  pullRequest: {
    ...identity,
    number: 52,
    state,
    title: "Saved PR",
    baseSha: A,
    headSha: B,
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: B,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 2,
      contentHash: "hash:old",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const persistedGlobal = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: B,
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: "src/example.ts",
      revisionId: B,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      contentHash: "hash:old",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-16T00:00:00.000Z",
});

class MemoryPullRequestRepository implements GitHubPullRequestContextRepositoryPort {
  public current: PullRequestReviewStateCommit;

  public constructor(contextState = persistedContext(), globalState = persistedGlobal()) {
    this.current = { contextState, globalState };
  }

  public async load(): Promise<PullRequestReviewStateCommit> {
    return structuredClone(this.current);
  }

  public async create(transaction: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> {
    this.current = structuredClone(transaction.next);
  }

  public async commit(transaction: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> {
    this.current = structuredClone(transaction.next);
  }
}

test("R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity", async () => {
  let merged = false;
  const adapter = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => jsonResponse({
      number: 52,
      title: "Saved PR",
      html_url: "https://github.com/ssaattww/revmem/pull/52",
      state: "closed",
      merged_at: merged ? "2026-08-16T00:00:00Z" : null,
      base: { sha: A },
      head: { sha: B },
    }),
  });

  const closed = await adapter.fetchCurrent(identity, 52);
  assert.equal(closed.kind, "available");
  if (closed.kind === "available") assert.equal(closed.metadata.state, "closed");

  merged = true;
  const mergedResult = await adapter.fetchCurrent(identity, 52);
  assert.equal(mergedResult.kind, "available");
  if (mergedResult.kind === "available") assert.equal(mergedResult.metadata.state, "merged");
});

test("Issue #107 lifecycle metadata uses the PR branch point instead of the current base tip", async () => {
  const requestedPaths: string[] = [];
  const adapter = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedPaths.push(url.pathname);
      if (url.pathname === "/repos/ssaattww/revmem/pulls/52") {
        return jsonResponse({
          number: 52,
          title: "Saved PR",
          html_url: "https://github.com/ssaattww/revmem/pull/52",
          state: "open",
          merged_at: null,
          base: { sha: C },
          head: { sha: B },
        });
      }
      if (url.pathname === `/repos/ssaattww/revmem/compare/${C}...${B}`) {
        return jsonResponse({ merge_base_commit: { sha: A } });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
  });

  const result = await adapter.fetchCurrent(identity, 52);

  assert.equal(result.kind, "available");
  if (result.kind === "available") {
    assert.equal(result.metadata.baseSha, A);
    assert.equal(result.metadata.headSha, B);
  }
  assert.deepEqual(requestedPaths, [
    "/repos/ssaattww/revmem/pulls/52",
    `/repos/ssaattww/revmem/compare/${C}...${B}`,
  ]);
});

test("R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping", async () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const urls: string[] = [];
  const adapter = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async (input) => {
      urls.push(String(input));
      return new Response(diff, { status: 200, headers: { "content-type": "text/plain" } });
    },
  });

  const result = await adapter.compareRevisions(identity, A, B);
  assert.deepEqual(result, { kind: "available", diff });
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /\/compare\/a{40}\.\.\.b{40}$/u);
});

test("R405-1 T405 revision update maps B to C, permits layer operation, and survives restart", async () => {
  const runtimeSource = await readFile("src/t405-review-contexts-runtime.ts", "utf8");
  const detectStart = runtimeSource.indexOf("const detectPullRequest = async");
  const preparationStart = runtimeSource.indexOf("const preparePullRequestCandidateForExplicitContextSelection", detectStart);
  assert.ok(detectStart >= 0 && preparationStart > detectStart, "shared PR detection must precede the explicit Current Context preparation entry");
  const sharedDetection = runtimeSource.slice(detectStart, preparationStart);
  assert.match(sharedDetection, /await contextStateService\.update\(/u, "shared PR detection updates an existing PR revision mapping");

  const redetectStart = runtimeSource.indexOf("redetectPullRequest: async");
  const reconnectStart = runtimeSource.indexOf("reconnectGitHub: async", redetectStart);
  assert.ok(redetectStart >= 0 && reconnectStart > redetectStart, "public PR redetection must remain registered before reconnect");
  const redetect = runtimeSource.slice(redetectStart, reconnectStart);
  assert.match(redetect, /await detectPullRequest\(local, feedbackContext\);[\s\S]*await options\.refreshCurrentContext\(\);/u, "public redetection invokes shared detection before refreshing Current Context");

  const repository = new MemoryPullRequestRepository();
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -2 +2 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const mapper = createImmutablePullRequestRevisionMapper(async (evidence) => ({
    sourceBaseSha: evidence.sourceBaseSha,
    sourceHeadSha: evidence.sourceHeadSha,
    targetBaseSha: evidence.targetBaseSha,
    targetHeadSha: evidence.targetHeadSha,
    diff,
    oldTexts: { "src/example.ts": "keep\nold" },
    newFiles: {
      "src/example.ts": {
        fileId: FILE_ID,
        lineCount: 2,
        contentHash: "hash:new",
        newText: "keep\nnew",
      },
    },
    updatedAt: "2026-08-16T00:01:00.000Z",
  }));
  const service = new GitHubPullRequestContextStateService(repository, mapper);

  await service.update({
    repositoryId: REPOSITORY_ID,
    identity: { ...identity, pullRequestNumber: 52 },
    pullRequest: {
      ...persistedContext().pullRequest!,
      headSha: C,
    },
  });
  await service.update({
    repositoryId: REPOSITORY_ID,
    identity: { ...identity, pullRequestNumber: 52 },
    pullRequest: {
      ...repository.current.contextState.pullRequest!,
      decorationEnabled: false,
    },
  });

  const restarted = new GitHubPullRequestContextStateService(
    repository,
    async () => { throw new Error("restart load must not remap"); },
  );
  const restored = await restarted.load(
    REPOSITORY_ID,
    { ...identity, pullRequestNumber: 52 },
  );
  assert.equal(restored?.contextState.pullRequest?.headSha, C);
  assert.equal(restored?.globalState.currentRevisionId, C);
  assert.equal(restored?.contextState.files[FILE_ID]?.revisionId, C);
  assert.equal(restored?.globalState.files[FILE_ID]?.revisionId, C);
  assert.deepEqual(restored?.contextState.files[FILE_ID]?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
  ]);
  assert.equal(isPullRequestDecorationEnabled(restored!.contextState.pullRequest!), false);
});

test("R405-2 open PR lifecycle transition persists closed/merged saved grouping with layer OFF", async () => {
  for (const state of ["closed", "merged"] as const) {
    const repository = new MemoryPullRequestRepository();
    const service = new GitHubPullRequestContextStateService(
      repository,
      async () => { throw new Error("metadata-only lifecycle transition must not remap"); },
    );

    await service.update({
      repositoryId: REPOSITORY_ID,
      identity: { ...identity, pullRequestNumber: 52 },
      pullRequest: {
        ...persistedContext().pullRequest!,
        state,
      },
    });

    const restarted = new GitHubPullRequestContextStateService(
      repository,
      async () => { throw new Error("restart load must not remap"); },
    );
    const restored = await restarted.load(
      REPOSITORY_ID,
      { ...identity, pullRequestNumber: 52 },
    );
    assert.equal(restored?.contextState.pullRequest?.state, state);
    assert.equal(isPullRequestDecorationEnabled(restored!.contextState.pullRequest!), false);
    const items = projectReviewContexts({
      current: [],
      saved: [restored!.contextState],
      hiddenContextIds: new Set(),
    });
    assert.equal(items[0]?.group, "saved-closed-pull-request");
    assert.equal(items[0]?.layerEnabled, false);
  }
});

test("lifecycle adapter classifies rate-limit and network failures without substituting another revision", async () => {
  const rateLimited = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => new Response("", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    }),
  });
  assert.deepEqual(await rateLimited.fetchCurrent(identity, 52), {
    kind: "unavailable",
    reason: "rate-limit",
  });

  const offline = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(await offline.compareRevisions(identity, A, B), {
    kind: "unavailable",
    reason: "network",
  });
});

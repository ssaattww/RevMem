import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffAcquisitionResult,
  PullRequestRemoteMetadata
} from "../../src/application/github-pr-diff/index";
import {
  GitHubPullRequestCacheService,
  InMemoryGitHubPullRequestCacheStorage,
  type GitHubPullRequestCacheEntry,
  type PullRequestDiffAcquisitionPort
} from "../../src/application/github-pr-cache/index";
import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/index";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const OTHER_HEAD_SHA = "3333333333333333333333333333333333333333";

const request: PullRequestDiffAcquisitionRequest = {
  contextId: "github:github.com/example/review-range#42",
  repository: {
    host: "github.com",
    owner: "example",
    repository: "review-range"
  },
  number: 42,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

const metadata: PullRequestRemoteMetadata = {
  number: 42,
  title: "T403 cache",
  url: "https://github.com/example/review-range/pull/42",
  state: "open",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA
};

const snapshot: PullRequestDiffSnapshot = {
  contextId: request.contextId,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
  files: [{
    fileId: "src/value.ts",
    oldPath: "src/value.ts",
    newPath: "src/value.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    hunks: [{
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 1, text: "source-secret-old" },
        { kind: "addition", newLine: 1, text: "source-secret-new" }
      ]
    }]
  }]
};

const acquired: PullRequestDiffAcquisitionResult = {
  kind: "acquired",
  source: "github-patch",
  snapshot,
  metadata
};

class MutableAcquisition implements PullRequestDiffAcquisitionPort {
  public result: PullRequestDiffAcquisitionResult = acquired;
  public async acquire(): Promise<PullRequestDiffAcquisitionResult> {
    return this.result;
  }
}

const fixedDate = (milliseconds: number): (() => Date) => () => new Date(milliseconds);

test("live GitHub acquisition stores metadata and a source-redacted diff with explicit timestamps", async () => {
  const acquisition = new MutableAcquisition();
  const storage = new InMemoryGitHubPullRequestCacheStorage();
  const service = new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(1_000)
  });

  const result = await service.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "github-patch");
  assert.deepEqual(result.cache, {
    origin: "live",
    freshness: "fresh",
    updatedAt: "1970-01-01T00:00:01.000Z",
    expiresAt: "1970-01-01T00:01:01.000Z"
  });
  assert.equal(result.snapshot.files[0]?.hunks[0]?.lines[0]?.text, "source-secret-old");

  const stored = await storage.read(request);
  assert.equal(stored?.metadata.title, "T403 cache");
  assert.equal(stored?.snapshot.files[0]?.hunks[0]?.lines[0]?.text, "");
  assert.equal(stored?.snapshot.files[0]?.hunks[0]?.lines[1]?.text, "");
  assert.equal(JSON.stringify(stored).includes("source-secret"), false);
});

test("rate-limit failure uses an exact cached PR and marks expired data stale", async () => {
  const acquisition = new MutableAcquisition();
  const storage = new InMemoryGitHubPullRequestCacheStorage();
  const initial = new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(1_000)
  });
  await initial.acquire(request);

  acquisition.result = {
    kind: "unavailable",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "rate-limit" },
      { source: "github-content", reason: "rate-limit" }
    ]
  };
  const offline = new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(70_000)
  });

  const result = await offline.acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "offline-cache");
  assert.equal(result.metadata.title, "T403 cache");
  assert.equal(result.snapshot.files[0]?.hunks[0]?.lines[0]?.text, "");
  assert.deepEqual(result.cache, {
    origin: "offline",
    freshness: "stale",
    updatedAt: "1970-01-01T00:00:01.000Z",
    expiresAt: "1970-01-01T00:01:01.000Z"
  });
  assert.deepEqual(result.attempts, acquisition.result.attempts);
});

test("network failure uses an unexpired exact cache and marks it fresh", async () => {
  const acquisition = new MutableAcquisition();
  const storage = new InMemoryGitHubPullRequestCacheStorage();
  await new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(1_000)
  }).acquire(request);
  acquisition.result = {
    kind: "unavailable",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "network" },
      { source: "github-content", reason: "network" }
    ]
  };

  const result = await new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(2_000)
  }).acquire(request);

  assert.equal(result.kind, "acquired");
  assert.equal(result.source, "offline-cache");
  assert.deepEqual(result.cache, {
    origin: "offline",
    freshness: "fresh",
    updatedAt: "1970-01-01T00:00:01.000Z",
    expiresAt: "1970-01-01T00:01:01.000Z"
  });
});

test("non-offline API failures do not substitute cached data", async () => {
  const acquisition = new MutableAcquisition();
  const storage = new InMemoryGitHubPullRequestCacheStorage();
  await new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(1_000)
  }).acquire(request);
  acquisition.result = {
    kind: "unavailable",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "api" },
      { source: "github-content", reason: "api" }
    ]
  };

  const result = await new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(2_000)
  }).acquire(request);

  assert.deepEqual(result, acquisition.result);
});

test("cache entries are bound to the exact context, repository, PR, base, and head identity", async () => {
  const storage = new InMemoryGitHubPullRequestCacheStorage();
  const mismatchedRequest = { ...request, headSha: OTHER_HEAD_SHA };
  const entry: GitHubPullRequestCacheEntry = {
    schemaVersion: 1,
    request: mismatchedRequest,
    metadata: { ...metadata, headSha: OTHER_HEAD_SHA },
    snapshot: {
      ...snapshot,
      headSha: OTHER_HEAD_SHA,
      originalDiffId: `${BASE_SHA}..${OTHER_HEAD_SHA}`,
      files: snapshot.files.map(file => ({
        ...file,
        hunks: file.hunks.map(hunk => ({
          ...hunk,
          lines: hunk.lines.map(line => ({ ...line, text: "" }))
        }))
      }))
    },
    updatedAt: "1970-01-01T00:00:01.000Z",
    expiresAt: "1970-01-01T00:01:01.000Z"
  };
  await storage.write(entry);
  const acquisition = new MutableAcquisition();
  acquisition.result = {
    kind: "unavailable",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "network" },
      { source: "github-content", reason: "network" }
    ]
  };

  const result = await new GitHubPullRequestCacheService({
    acquisition,
    storage,
    freshnessMs: 60_000,
    now: fixedDate(2_000)
  }).acquire(request);

  assert.equal(result.kind, "unavailable");
});

test("filesystem cache publishes metadata and redacted diff through one generation pointer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t403-"));
  try {
    const storage = new NodeGitHubPullRequestCacheStorage({
      cacheDirectory: root,
      createGenerationId: () => "generation-1"
    });
    const inMemory = new InMemoryGitHubPullRequestCacheStorage();
    const acquisition = new MutableAcquisition();
    await new GitHubPullRequestCacheService({
      acquisition,
      storage: inMemory,
      freshnessMs: 60_000,
      now: fixedDate(1_000)
    }).acquire(request);
    const entry = await inMemory.read(request);
    assert.ok(entry);

    await storage.write(entry);
    const restored = await storage.read(request);

    assert.deepEqual(restored, entry);
    const jsonFiles = await collectJsonFiles(root);
    assert.ok(jsonFiles.some((file) => file.includes(`${path.sep}github${path.sep}`)));
    assert.ok(jsonFiles.some((file) => file.includes(`${path.sep}diffs${path.sep}`)));
    const persisted = (await Promise.all(jsonFiles.map((file) => readFile(file, "utf8")))).join("\n");
    assert.equal(persisted.includes("source-secret"), false);
    assert.equal(persisted.includes("test-token"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const collectJsonFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
  return files;
};

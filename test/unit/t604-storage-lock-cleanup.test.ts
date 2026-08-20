import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/node-github-pull-request-cache-storage";
import { NodeNonGitSnapshotStorage } from "../../src/adapters/non-git-snapshots/node-non-git-snapshot-adapters";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  NodeStorageRootLock,
  StorageRootLockTimeoutError,
  resolveReviewStateStorageRoute,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewHistoryEvent } from "../../src/core/contracts/index";
import type { GitHubPullRequestCacheEntry } from "../../src/application/github-pr-cache/index";
import type { PullRequestDiffAcquisitionRequest } from "../../src/application/github-pr-diff/index";

const target = (contextId: string): ReviewStateRepositoryTarget => ({
  kind: "git",
  repositoryId: "repository-t604",
  contextId
});

const createTemporaryStorage = async (): Promise<{ root: string; storageUris: ReviewStateStorageUris }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t604-"));
  return { root, storageUris: { globalStorageUri: { fsPath: path.join(root, "global") }, storageUri: { fsPath: path.join(root, "workspace") } } };
};

const commit = (value: number, contextId: string): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: "repository-t604", contextId, kind: "branch", displayName: "branch", branch: { refName: "refs/heads/main", headRevision: "revision" }, files: {}, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: `2026-08-20T00:00:0${value}.000Z` },
  globalState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: "repository-t604", currentRevisionId: "revision", files: {}, updatedAt: `2026-08-20T00:00:0${value}.000Z` }
});

const event = (eventId: string, contextId: string): ReviewHistoryEvent => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  eventId,
  occurredAt: "2026-08-20T00:00:00.000Z",
  sessionId: "session-t604",
  repositoryId: "repository-t604",
  contextId,
  revisionId: "revision",
  type: "context-created",
  reason: "created"
});

test("T604 refuses a live root lock without exposing owner or path diagnostics", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:a"));
  const diagnostics: string[] = [];
  try {
    const first = new NodeStorageRootLock({ rootPath: route.rootPath, lockPath: route.lockPath, timeoutMs: 0, leaseMs: 60_000, createOwnerToken: () => "secret-owner" });
    const release = await first.acquire();
    const second = new NodeStorageRootLock({ rootPath: route.rootPath, lockPath: route.lockPath, timeoutMs: 0, notifyDiagnostic: (value) => { diagnostics.push(JSON.stringify(value)); } });
    await assert.rejects(() => second.acquire(), StorageRootLockTimeoutError);
    assert.doesNotMatch(diagnostics.join("\n"), /secret-owner|review-range-t604|repository-t604/u);
    await release();
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 recovers only an expired root lock", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:a"));
  let now = 1_000;
  try {
    const first = new NodeStorageRootLock({ rootPath: route.rootPath, lockPath: route.lockPath, timeoutMs: 0, leaseMs: 10, now: () => now, createOwnerToken: () => "first" });
    await first.acquire();
    now = 1_011;
    const recovered: string[] = [];
    const second = new NodeStorageRootLock({ rootPath: route.rootPath, lockPath: route.lockPath, timeoutMs: 0, leaseMs: 10, now: () => now, createOwnerToken: () => "second", notifyDiagnostic: (value) => { recovered.push(value.kind); } });
    const release = await second.acquire();
    assert.deepEqual(recovered, ["stale-recovered"]);
    await release();
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 recovers a bounded stale malformed lock without taking a live valid lease", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:malformed"));
  try {
    await mkdir(route.rootPath, { recursive: true });
    await writeFile(route.lockPath, "{partial", "utf8");
    await utimes(route.lockPath, 0, 0);
    const recovered = new NodeStorageRootLock({ rootPath: route.rootPath, lockPath: route.lockPath, timeoutMs: 0, leaseMs: 1, now: () => 2_000 });
    const release = await recovered.acquire();
    await release();
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 retains independent-window Contexts and Global publication under concurrent writes", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const firstTarget = target("branch:first");
    const secondTarget = target("branch:second");
    await Promise.all([
      new FileSystemReviewStateRepository({ storageUris: temporary.storageUris }).save(firstTarget, commit(1, firstTarget.contextId)),
      new FileSystemReviewStateRepository({ storageUris: temporary.storageUris }).save(secondTarget, commit(2, secondTarget.contextId))
    ]);
    const reader = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.deepEqual((await reader.load(firstTarget))?.contextState.contextId, firstTarget.contextId);
    assert.deepEqual((await reader.load(secondTarget))?.contextState.contextId, secondTarget.contextId);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 atomically appends independent-window history events", async () => {
  const temporary = await createTemporaryStorage();
  const historyTarget = target("branch:history");
  try {
    await Promise.all([
      new JsonlReviewHistoryStore({ storageUris: temporary.storageUris }).append(historyTarget, event("event-a", historyTarget.contextId)),
      new JsonlReviewHistoryStore({ storageUris: temporary.storageUris }).append(historyTarget, event("event-b", historyTarget.contextId))
    ]);
    const route = resolveReviewStateStorageRoute(temporary.storageUris, historyTarget);
    const lines = (await readFile(path.join(route.historyDirectory, "events-2026-08.jsonl"), "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line).eventId).sort(), ["event-a", "event-b"]);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 cache cleanup retains the published generation and removes superseded immutable files", async () => {
  const temporary = await createTemporaryStorage();
  const cacheDirectory = path.join(temporary.root, "cache");
    const request: PullRequestDiffAcquisitionRequest = { contextId: "github:github.com/owner/repo#1", repository: { host: "github.com", owner: "owner", repository: "repo" }, number: 1, baseSha: "1111111111111111111111111111111111111111", headSha: "2222222222222222222222222222222222222222" };
  try {
    let generation = 0;
    const cache = new NodeGitHubPullRequestCacheStorage({ cacheDirectory, createGenerationId: () => `generation-${++generation}` });
    const entry: GitHubPullRequestCacheEntry = { schemaVersion: 1, request, metadata: { number: 1, title: "title", url: "https://github.com/owner/repo/pull/1", state: "open", baseSha: request.baseSha, headSha: request.headSha }, snapshot: { contextId: request.contextId, baseSha: request.baseSha, headSha: request.headSha, originalDiffId: `${request.baseSha}..${request.headSha}`, files: [] }, updatedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2026-08-21T00:00:00.000Z" };
    await cache.write(entry);
    await cache.write({ ...entry, updatedAt: "2026-08-20T00:01:00.000Z" });
    assert.equal((await cache.read(request))?.updatedAt, "2026-08-20T00:01:00.000Z");
    const identityDirectory = (await readdir(path.join(cacheDirectory, "github")))[0]!;
    const text = await readFile(path.join(cacheDirectory, "github", identityDirectory, "latest.json"), "utf8");
    assert.match(text, /generation-2/u);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 snapshot cleanup retains a referenced generation and removes expired unreferenced entries", async () => {
  const temporary = await createTemporaryStorage();
  const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: path.join(temporary.root, "snapshots"), retentionMs: 0, maxEntries: 1 });
  const first = "a".repeat(64);
  const second = "b".repeat(64);
  try {
    await storage.put(first, Uint8Array.of(1), 0);
    await storage.setLatest("workspace", "file", first);
    await storage.put(second, Uint8Array.of(2), 1);
    await storage.setLatest("workspace", "file", second);
    assert.equal(await storage.get(first), undefined);
    assert.deepEqual(await storage.get(second), { createdAt: 1, bytes: Uint8Array.of(2) });
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

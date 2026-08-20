import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/node-github-pull-request-cache-storage";
import { NodeNonGitSnapshotStorage } from "../../src/adapters/non-git-snapshots/node-non-git-snapshot-adapters";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  NodeStorageRootLock,
  StorageRootLeaseLostError,
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

const startLockChild = (rootPath: string, holdMs: number): { readonly child: ReturnType<typeof spawn>; readonly output: Promise<string> } => {
    const modulePath = path.join(process.cwd(), "test-dist", "src", "adapters", "state-repository", "storage-root-lock.js");
    const script = [
      `const { NodeStorageRootLock } = require(${JSON.stringify(modulePath)});`,
      `(async () => { const lock = new NodeStorageRootLock({ rootPath: process.argv[1], timeoutMs: 150, leaseMs: 1000 });`,
      "try { const release = await lock.acquire(); process.stdout.write('acquired\\n'); setTimeout(() => release().then(() => process.exit(0)), Number(process.argv[2])); }",
      "catch (error) { process.stdout.write(error.name + '\\n'); process.exit(0); } })();"
    ].join("");
    const child = spawn(process.execPath, ["-e", script, rootPath, String(holdMs)], { stdio: ["ignore", "pipe", "pipe"] });
    let outputText = "";
    const timeout = setTimeout(() => child.kill(), 3_000);
    child.stdout.on("data", (value: Buffer) => { outputText += value.toString("utf8"); });
    const output = new Promise<string>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(outputText.trim());
      } else {
        reject(new Error(`lock child exited ${String(code)}`));
      }
      });
    });
    return { child, output };
};

const runLockChild = async (rootPath: string, holdMs: number): Promise<string> =>
  startLockChild(rootPath, holdMs).output;

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

test("T604 fences a detached owner before it can publish after a successor recovery", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:fence"));
  let now = 0;
  try {
    const first = await new NodeStorageRootLock({ rootPath: route.rootPath, timeoutMs: 0, leaseMs: 1, now: () => now, createOwnerToken: () => "first" }).acquire();
    await first();
    now = 2;
    const successor = await new NodeStorageRootLock({ rootPath: route.rootPath, timeoutMs: 0, leaseMs: 10, now: () => now, createOwnerToken: () => "second" }).acquire();
    await assert.rejects(() => first.assertOwned(), StorageRootLeaseLostError);
    await successor();
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 cleans an owned partial lease after write, sync, or close acquisition failure", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:faults"));
  try {
    for (const fault of ["writeLease", "syncLease", "closeLease"] as const) {
      await rm(route.lockPath, { force: true });
      const lock = new NodeStorageRootLock({
        rootPath: route.rootPath,
        timeoutMs: 0,
        leaseMs: 10,
        [fault]: async () => { throw new Error(`injected ${fault}`); }
      });
      await assert.rejects(() => lock.acquire(), /injected/u);
      const release = await new NodeStorageRootLock({ rootPath: route.rootPath, timeoutMs: 0, leaseMs: 10 }).acquire();
      await release();
    }
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 uses an owned OS child-process lease and releases it for a successor", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:child-process"));
  try {
    const first = runLockChild(route.rootPath, 250);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await runLockChild(route.rootPath, 0), "StorageRootLockTimeoutError");
    assert.equal(await first, "acquired");
    assert.equal(await runLockChild(route.rootPath, 0), "acquired");
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 recovers a killed child lease only after its bounded expiry", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:killed-child"));
  try {
    const first = startLockChild(route.rootPath, 2_500);
    await new Promise((resolve) => setTimeout(resolve, 60));
    first.child.kill();
    await first.output.catch(() => undefined);
    assert.equal(await runLockChild(route.rootPath, 0), "StorageRootLockTimeoutError");
    await new Promise((resolve) => setTimeout(resolve, 1_020));
    assert.equal(await runLockChild(route.rootPath, 0), "acquired");
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 rejects a root-confined snapshot mutation through a symlink or Windows junction", async () => {
  const temporary = await createTemporaryStorage();
  const outside = path.join(temporary.root, "outside");
  const snapshotDirectory = path.join(temporary.root, "snapshots");
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    await mkdir(outside, { recursive: true });
    await writeFile(sentinel, "unchanged", "utf8");
    await mkdir(snapshotDirectory, { recursive: true });
    await symlink(outside, path.join(snapshotDirectory, "entries"), process.platform === "win32" ? "junction" : "dir");
    const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory });
    await assert.rejects(() => storage.put("c".repeat(64), Uint8Array.of(1), 1), /symbolic link|junction|outside/u);
    assert.equal(await readFile(sentinel, "utf8"), "unchanged");
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

test("T604 snapshot cleanup preserves every active pointer while bounding an unreferenced generation", async () => {
  const temporary = await createTemporaryStorage();
  const storage = new NodeNonGitSnapshotStorage({ snapshotDirectory: path.join(temporary.root, "snapshots"), retentionMs: 100_000, maxEntries: 128 });
  const first = "d".repeat(64);
  const second = "e".repeat(64);
  const third = "f".repeat(64);
  const unreferenced = "0".repeat(64);
  const createdAt = Date.now();
  try {
    await storage.put(first, Uint8Array.of(1), createdAt);
    await storage.put(second, Uint8Array.of(2), createdAt + 1);
    await storage.setLatest("workspace", "first", first);
    await storage.setLatest("workspace", "second", second);
    await storage.put(unreferenced, Uint8Array.of(0), createdAt + 2);
    await storage.putAndCleanup(third, Uint8Array.of(3), createdAt + 3, { maxSnapshots: 1, maxTotalCompressedBytes: 1, retentionMs: 100_000 });
    assert.notEqual(await storage.get(first), undefined);
    assert.notEqual(await storage.get(second), undefined);
    assert.notEqual(await storage.get(third), undefined);
    assert.equal(await storage.get(unreferenced), undefined);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

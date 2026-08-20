import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/node-github-pull-request-cache-storage";
import { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } from "../../src/adapters/non-git-snapshots/node-non-git-snapshot-adapters";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  NodeAtomicTextFileStore,
  NodeStorageRootLock,
  StorageRootLeaseLostError,
  StorageRootLockTimeoutError,
  resolveReviewStateStorageRoute,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewHistoryEvent } from "../../src/core/contracts/index";
import { NonGitSnapshotTracker } from "../../src/application/non-git-snapshots/index";
import type { GitHubPullRequestCacheEntry } from "../../src/application/github-pr-cache/index";
import type { PullRequestDiffAcquisitionRequest } from "../../src/application/github-pr-diff/index";
import { OperationFeedback, reportActiveStorageLockDiagnostic, setActiveOperationFeedback } from "../../src/application/operation-feedback/index";

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

/** Runs only production migration, state, history, and snapshot composition in an owned Node process. */
const runProductionPersistenceChild = (rootPath: string, action: "startup" | "writer"): Promise<string> => {
  const moduleRoot = path.join(process.cwd(), "test-dist", "src");
  const script = [
    "const nodePath = require('node:path');",
    `const state = require(${JSON.stringify(path.join(moduleRoot, "adapters", "state-repository", "index.js"))});`,
    `const { runPersistenceStartupMigration } = require(${JSON.stringify(path.join(moduleRoot, "adapters", "persistence-startup-migration.js"))});`,
    `const { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } = require(${JSON.stringify(path.join(moduleRoot, "adapters", "non-git-snapshots", "index.js"))});`,
    `const { NonGitSnapshotTracker } = require(${JSON.stringify(path.join(moduleRoot, "application", "non-git-snapshots", "index.js"))});`,
    "const root = process.argv[1]; const action = process.argv[2];",
    "const storageUris = { globalStorageUri: { fsPath: nodePath.join(root, 'global') }, storageUri: { fsPath: nodePath.join(root, 'workspace') } };",
    "const target = { kind: 'git', repositoryId: 'repository-t604-r004', contextId: 'branch:startup-race' };",
    "const commit = { schemaVersion: 1, contextState: { schemaVersion: 1, repositoryId: target.repositoryId, contextId: target.contextId, kind: 'branch', displayName: 'branch', branch: { refName: 'refs/heads/main', headRevision: 'newer-revision' }, files: {}, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:09.000Z' }, globalState: { schemaVersion: 1, repositoryId: target.repositoryId, currentRevisionId: 'newer-revision', files: {}, updatedAt: '2026-08-20T00:00:09.000Z' } };",
    "(async () => { if (action === 'startup') { await runPersistenceStartupMigration({ storageUris }); process.stdout.write('migrated'); return; }",
    "const repository = new state.FileSystemReviewStateRepository({ storageUris }); await repository.save(target, commit);",
    "await new state.JsonlReviewHistoryStore({ storageUris }).append(target, { schemaVersion: 1, eventId: 'newer-event', occurredAt: '2026-08-20T00:00:00.000Z', sessionId: 'session-t604', repositoryId: target.repositoryId, contextId: target.contextId, revisionId: 'newer-revision', type: 'context-created', reason: 'newer' });",
    "const route = state.resolveReviewStateStorageRoute(storageUris, target); const tracker = new NonGitSnapshotTracker(new NodeNonGitSnapshotStorage({ snapshotDirectory: route.snapshotDirectory }), new NodeNonGitSnapshotCodec(), { maxSnapshots: 8, maxCompressedBytes: 4096, retentionMs: 60000 });",
    "const saved = await tracker.saveLatest({ workspaceContextId: 'workspace', fileId: 'file', content: 'newer snapshot', reviewedRanges: [] }, 100); process.stdout.write(saved.snapshotId); })().catch((error) => { process.stderr.write(String(error && error.stack || error)); process.exit(1); });"
  ].join("");
  const child = spawn(process.execPath, ["-e", script, rootPath, action], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errorOutput = "";
  const timeout = setTimeout(() => child.kill(), 5_000);
  child.stdout.on("data", (value: Buffer) => { output += value.toString("utf8"); });
  child.stderr.on("data", (value: Buffer) => { errorOutput += value.toString("utf8"); });
  return new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`production persistence child exited ${String(code)}: ${errorOutput}`));
    });
  });
};

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
    const firstRelease = await first.acquire();
    await firstRelease();
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

test("T604 bounds zero, truncated, malformed, and future-invalid partial lock recovery", async () => {
  const temporary = await createTemporaryStorage();
  const route = resolveReviewStateStorageRoute(temporary.storageUris, target("branch:partial-matrix"));
  try {
    await mkdir(route.rootPath, { recursive: true });
    for (const raw of ["", "{\"ownerToken\":", "not-json", JSON.stringify({ ownerToken: "future", expiresAt: 9_999_999 })]) {
      await writeFile(route.lockPath, raw, "utf8");
      await utimes(route.lockPath, 0, 0);
      const release = await new NodeStorageRootLock({ rootPath: route.rootPath, timeoutMs: 0, leaseMs: 10, now: () => 1_000 }).acquire();
      await release();
    }
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 deduplicates pending privacy-safe diagnostics by operation scope", () => {
  const entries: Array<{ readonly message?: string }> = [];
  setActiveOperationFeedback(undefined);
  reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "scope-a" });
  reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "scope-a" });
  const feedback = new OperationFeedback({
    showBusy: () => undefined, clearBusy: () => undefined,
    appendLog: (entry) => { entries.push(entry); }, revealLog: () => undefined
  }, () => 0);
  setActiveOperationFeedback(feedback);
  reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "scope-a" });
  reportActiveStorageLockDiagnostic({ kind: "stale-recovered", operationId: "scope-b" });
  setActiveOperationFeedback(undefined);
  assert.equal(entries.length, 2);
  assert.doesNotMatch(JSON.stringify(entries), /scope-a|repository-t604|secret|path/u);
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

test("T604 runs production startup recovery against real child writers and restarts from the newer coherent state", async () => {
  const temporary = await createTemporaryStorage();
  const startupTarget = { kind: "git" as const, repositoryId: "repository-t604-r004", contextId: "branch:startup-race" };
  const route = resolveReviewStateStorageRoute(temporary.storageUris, startupTarget);
  const pointerName = createHash("sha256").update("legacy-pointer", "utf8").digest("hex");
  try {
    const initial = commit(1, startupTarget.contextId);
    await new FileSystemReviewStateRepository({ storageUris: temporary.storageUris }).save(startupTarget, {
      ...initial,
      contextState: { ...initial.contextState, repositoryId: startupTarget.repositoryId },
      globalState: { ...initial.globalState, repositoryId: startupTarget.repositoryId }
    });
    await mkdir(path.join(route.snapshotDirectory, "latest"), { recursive: true });
    // This is an interrupted pre-v1 pointer publication: startup recovery must
    // quarantine it, then never restore an earlier plan over the writer child.
    await writeFile(path.join(route.snapshotDirectory, "latest", `${pointerName}.json`), "{partial", "utf8");
    const killed = startLockChild(route.rootPath, 2_500);
    await new Promise((resolve) => setTimeout(resolve, 60));
    killed.child.kill();
    await killed.output.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_020));

    const [startup, savedSnapshotId] = await Promise.all([
      runProductionPersistenceChild(temporary.root, "startup"),
      runProductionPersistenceChild(temporary.root, "writer")
    ]);
    assert.equal(startup, "migrated");
    assert.match(savedSnapshotId, /^[0-9a-f]{64}$/u);

    const restarted = new FileSystemReviewStateRepository({ storageUris: temporary.storageUris });
    assert.equal((await restarted.load(startupTarget))?.globalState.currentRevisionId, "newer-revision");
    const history = await readFile(path.join(route.historyDirectory, "events-2026-08.jsonl"), "utf8");
    assert.match(history, /newer-event/u);
    const snapshotStorage = new NodeNonGitSnapshotStorage({ snapshotDirectory: route.snapshotDirectory });
    assert.equal(await snapshotStorage.getLatest("workspace", "file"), savedSnapshotId);
    const restored = await new NonGitSnapshotTracker(snapshotStorage, new NodeNonGitSnapshotCodec(), {
      maxSnapshots: 8, maxCompressedBytes: 4096, retentionMs: 60_000
    }).restore(savedSnapshotId, 100);
    assert.equal(restored?.content, "newer snapshot");
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("T604 keeps active snapshots above count and byte limits, publishes through cleanup failure, and converges after restart", async () => {
  const temporary = await createTemporaryStorage();
  const snapshotDirectory = path.join(temporary.root, "snapshots");
  const nodeStore = new NodeAtomicTextFileStore(temporary.root);
  let failCleanupDelete = false;
  const storage = new NodeNonGitSnapshotStorage({
    snapshotDirectory,
    atomicFileStore: {
      readText: (filePath) => nodeStore.readText(filePath),
      writeTextAtomically: (filePath, text) => nodeStore.writeTextAtomically(filePath, text),
      deleteText: async (filePath) => {
        if (failCleanupDelete) throw new Error("injected cleanup delete failure");
        await nodeStore.deleteText?.(filePath);
      }
    }
  });
  const content = (prefix: string): string => `${prefix}:${Array.from({ length: 128 }, (_, index) => createHash("sha256").update(`${prefix}-${index}`, "utf8").digest("hex")).join("")}`;
  const permissive = new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), {
    maxSnapshots: 16, maxCompressedBytes: 8_192, retentionMs: 60_000
  });
  const strictLimits = { maxSnapshots: 1, maxCompressedBytes: 8_192, retentionMs: 60_000 };
  try {
    const first = await permissive.saveLatest({ workspaceContextId: "workspace", fileId: "first", content: content("first"), reviewedRanges: [] }, 1);
    const second = await permissive.saveLatest({ workspaceContextId: "workspace", fileId: "second", content: content("second"), reviewedRanges: [] }, 2);
    assert.ok(first.compressedBytes + second.compressedBytes > strictLimits.maxCompressedBytes, "two active generations exceed the explicit byte limit");
    const raced = await permissive.save({ workspaceContextId: "workspace", fileId: "raced", content: content("raced"), reviewedRanges: [] }, 3);
    await Promise.allSettled([
      new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), strictLimits)
        .save({ workspaceContextId: "workspace", fileId: "interleaved", content: content("interleaved"), reviewedRanges: [] }, 4),
      storage.setLatest("workspace", "raced", raced.snapshotId)
    ]);
    const racedPointer = await storage.getLatest("workspace", "raced");
    if (racedPointer === raced.snapshotId) {
      assert.notEqual(await storage.get(raced.snapshotId), undefined, "an interleaved active pointer never names a deleted generation");
    }
    await permissive.save({ workspaceContextId: "workspace", fileId: "cleanup-stale", content: content("cleanup-stale"), reviewedRanges: [] }, 5);
    failCleanupDelete = true;

    const published = await new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), strictLimits)
      .save({ workspaceContextId: "workspace", fileId: "new", content: content("new"), reviewedRanges: [] }, 6);
    assert.notEqual(await storage.get(first.snapshotId), undefined);
    assert.notEqual(await storage.get(second.snapshotId), undefined);
    assert.notEqual(await storage.get(published.snapshotId), undefined);

    failCleanupDelete = false;
    const restartedStorage = new NodeNonGitSnapshotStorage({ snapshotDirectory });
    const converged = await new NonGitSnapshotTracker(restartedStorage, new NodeNonGitSnapshotCodec(), strictLimits)
      .save({ workspaceContextId: "workspace", fileId: "recovery", content: content("recovery"), reviewedRanges: [] }, 7);
    assert.notEqual(await restartedStorage.get(first.snapshotId), undefined);
    assert.notEqual(await restartedStorage.get(second.snapshotId), undefined);
    assert.notEqual(await restartedStorage.get(converged.snapshotId), undefined);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

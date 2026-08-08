import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubPullRequestContextId,
  createGitHubPullRequestContextIdFromRepositoryId,
  createImmutablePullRequestRevisionMapper,
  GitHubPullRequestContextStateService,
  isPullRequestDecorationEnabled,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
} from "../../src/application/github-pr-context/index.js";
import { createNodeGitHubPullRequestContextStateService } from "../../src/adapters/github/index.js";
import { normalizeGitRemoteUrl } from "../../src/adapters/local-git/index.js";
import { FileSystemReviewStateRepository, resolveReviewStateStorageRoute } from "../../src/adapters/state-repository/index.js";
import { canonicalizeHostedGitRepositoryIdentity } from "../../src/core/repository-identity/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

type VisiblePullRequest = PullRequestReviewContext & { decorationEnabled?: boolean };

const pr = (overrides: Partial<VisiblePullRequest> = {}): VisiblePullRequest => ({ host: "github.com", owner: "ssaattww", repository: "revmem", number: 48, state: "open", baseSha: A, headSha: B, ...overrides });
const context = (number = 48, overrides: Partial<ReviewContextState> = {}): ReviewContextState => ({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, number), kind: "pull-request", repositoryId: REPOSITORY_ID, displayName: `PR #${number}`, pullRequest: pr({ number }), files: { file: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: "file", currentPath: "src/example.ts", previousPaths: [], revisionId: B, modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }], originalReviewedByDiff: {}, lineCount: 3, updatedAt: "2026-08-07T00:00:00.000Z" } }, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z", ...overrides });
const globalState = (revision = B): RepositoryGlobalState => ({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: REPOSITORY_ID, currentRevisionId: revision, files: { file: { fileId: "file", currentPath: "src/example.ts", revisionId: revision, reviewed: [{ startLine: 0, endLineExclusive: 3 }], updatedAt: "2026-08-07T00:00:00.000Z" } }, updatedAt: "2026-08-07T00:00:00.000Z" });
class MemoryRepository implements GitHubPullRequestContextRepositoryPort { current?: PullRequestReviewStateCommit; creates = 0; commits = 0; async load(): Promise<PullRequestReviewStateCommit | undefined> { return this.current === undefined ? undefined : structuredClone(this.current); } async create(input: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> { this.creates += 1; this.current = structuredClone(input.next); } async commit(input: Parameters<GitHubPullRequestContextRepositoryPort["commit"]>[0]): Promise<void> { this.commits += 1; this.current = structuredClone(input.next); } }

test("T202/T401 and T404 share one hosted repository canonicalizer", () => { const shared = canonicalizeHostedGitRepositoryIdentity("github.com", "SSAATTWW/RevMem.git"); assert.equal(shared, REPOSITORY_ID); assert.equal(normalizeGitRemoteUrl("https://GitHub.COM:443/SSAATTWW/RevMem.git"), shared); assert.equal(createGitHubPullRequestContextId({ host: "GitHub.COM:443", owner: "SSAATTWW", repository: "RevMem.git", pullRequestNumber: 48 }), `github-pr:${shared}#48`); assert.throws(() => createGitHubPullRequestContextIdFromRepositoryId("github.com//revmem", 48), /repositoryId|repository/i); assert.throws(() => createGitHubPullRequestContextId({ host: "ghe.example:8443:443", owner: "Team", repository: "Repo", pullRequestNumber: 48 }), /authority|host|port|repository/i); });

test("immutable diff/content mapper invalidates changed reviewed lines instead of only advancing revision", async () => { const mapper = createImmutablePullRequestRevisionMapper(async (evidence) => ({ sourceBaseSha: evidence.sourceBaseSha, sourceHeadSha: evidence.sourceHeadSha, targetBaseSha: evidence.targetBaseSha, targetHeadSha: evidence.targetHeadSha, diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -2 +2 @@", "-old", "+changed", ""].join("\n"), oldTexts: { "src/example.ts": "one\nold\nthree" }, newFiles: { "src/example.ts": { fileId: "file", lineCount: 3, newText: "one\nchanged\nthree" } } })); const mapped = await mapper({ current: { contextState: context(), globalState: globalState() }, nextPullRequest: pr({ headSha: C }), evidence: Object.freeze({ repositoryId: REPOSITORY_ID, contextId: createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, 48), sourceBaseSha: A, sourceHeadSha: B, targetBaseSha: A, targetHeadSha: C }) }); assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]); assert.deepEqual(mapped.globalState.files.file?.reviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]); assert.equal(mapped.contextState.files.file?.revisionId, C); assert.equal(mapped.globalState.files.file?.revisionId, C); });

test("base-only PR transitions retain modified ranges and invalidate base-dependent original ranges", async () => {
  const mapper = createImmutablePullRequestRevisionMapper(async (evidence) => ({ sourceBaseSha: evidence.sourceBaseSha, sourceHeadSha: evidence.sourceHeadSha, targetBaseSha: evidence.targetBaseSha, targetHeadSha: evidence.targetHeadSha, diff: "", oldTexts: {}, newFiles: {}, updatedAt: "2026-08-08T00:00:00.000Z" }));
  const current = context(48, { files: { file: { ...context().files.file!, originalReviewedByDiff: { [`${A}..${B}:src/example.ts`]: [{ startLine: 0, endLineExclusive: 2 }] } } } });
  const mapped = await mapper({ current: { contextState: current, globalState: globalState() }, nextPullRequest: pr({ baseSha: C }), evidence: Object.freeze({ repositoryId: REPOSITORY_ID, contextId: current.contextId, sourceBaseSha: A, sourceHeadSha: B, targetBaseSha: C, targetHeadSha: B }) });
  assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 3 }]);
  assert.deepEqual(mapped.globalState.files.file?.reviewed, [{ startLine: 0, endLineExclusive: 3 }]);
  assert.deepEqual(mapped.contextState.files.file?.originalReviewedByDiff, {});
  assert.equal(mapped.contextState.pullRequest?.baseSha, C);
});

test("create rejects empty and existing Global snapshots not bound to the PR head before commit or history", async () => {
  const repository = new MemoryRepository();
  let historyCalls = 0;
  const service = new GitHubPullRequestContextStateService(repository, async ({ current }) => current, { recordContextCreated: async () => { historyCalls += 1; }, recordRevisionMapping: async () => { historyCalls += 1; } });
  await assert.rejects(() => service.create({ contextState: context(), globalState: { ...globalState(A), files: {} } }, undefined), /Global.*revision|revision.*Global/i);
  await assert.rejects(() => service.create({ contextState: context(), globalState: globalState(A) }, globalState(A)), /Global.*revision|revision.*Global/i);
  assert.equal(repository.creates, 0);
  assert.equal(historyCalls, 0);
});

test("Node PR context service records create and revision history across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-history-service-"));
  const storageUris = { globalStorageUri: { fsPath: root } };
  const loadEvidence = async (evidence: { readonly sourceBaseSha: string; readonly sourceHeadSha: string; readonly targetBaseSha: string; readonly targetHeadSha: string }) => {
    const changed = evidence.targetHeadSha === C ? ["old", "changed"] : ["changed", "again"];
    return { sourceBaseSha: evidence.sourceBaseSha, sourceHeadSha: evidence.sourceHeadSha, targetBaseSha: evidence.targetBaseSha, targetHeadSha: evidence.targetHeadSha, diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -2 +2 @@", `-${changed[0]}`, `+${changed[1]}`, ""].join("\n"), oldTexts: { "src/example.ts": `one\n${changed[0]}\nthree` }, newFiles: { "src/example.ts": { fileId: "file", lineCount: 3, newText: `one\n${changed[1]}\nthree` } } };
  };
  const first = createNodeGitHubPullRequestContextStateService(storageUris, loadEvidence);
  await first.create({ contextState: context(), globalState: globalState() }, undefined);
  await first.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pr({ headSha: C }) });
  const restarted = createNodeGitHubPullRequestContextStateService(storageUris, loadEvidence);
  assert.equal((await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }))?.contextState.pullRequest?.headSha, C);
  await restarted.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pr({ headSha: D }) });
  const route = resolveReviewStateStorageRoute(storageUris, { kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, 48) });
  const events = (await readFile(path.join(route.historyDirectory, "events-2026-08.jsonl"), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["context-created", "context-revision-changed", "remapped-by-diff", "context-revision-changed", "remapped-by-diff"]);
});

test("history append failure is observable after PR state commit, while metadata no-ops append nothing", async () => {
  const repository = new MemoryRepository();
  let created = 0;
  let revisions = 0;
  const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({ contextState: { ...current.contextState, pullRequest: nextPullRequest, files: { file: { ...current.contextState.files.file!, revisionId: nextPullRequest.headSha } } }, globalState: { ...current.globalState, currentRevisionId: nextPullRequest.headSha, files: { file: { ...current.globalState.files.file!, revisionId: nextPullRequest.headSha } } } }), { recordContextCreated: async () => { created += 1; }, recordRevisionMapping: async () => { revisions += 1; throw new Error("history append failed"); } });
  const identity = { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 };
  await service.create({ contextState: context(), globalState: globalState() }, undefined);
  await service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ title: "metadata only" }) });
  await assert.rejects(() => service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ headSha: C }) }), /history append failed/i);
  assert.equal(created, 1);
  assert.equal(revisions, 1);
  assert.equal(repository.current?.contextState.pullRequest?.headSha, C);
});

test("Node PR context service factory binds the immutable evidence mapper", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-factory-"));
  const service = createNodeGitHubPullRequestContextStateService(
    { globalStorageUri: { fsPath: root } },
    async (evidence) => ({
      sourceBaseSha: evidence.sourceBaseSha,
      sourceHeadSha: evidence.sourceHeadSha,
      targetBaseSha: evidence.targetBaseSha,
      targetHeadSha: evidence.targetHeadSha,
      diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -2 +2 @@", "-old", "+changed", ""].join("\n"),
      oldTexts: { "src/example.ts": "one\nold\nthree" },
      newFiles: { "src/example.ts": { fileId: "file", lineCount: 3, newText: "one\nchanged\nthree" } },
    })
  );
  await service.create({ contextState: context(), globalState: globalState() }, undefined);
  const mapped = await service.update({
    repositoryId: REPOSITORY_ID,
    identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 },
    pullRequest: pr({ headSha: C }),
  });
  assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]);
  assert.deepEqual(mapped.globalState.files.file?.reviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]);
});

test("mapped snapshots reject stale or foreign file revisions and PR descriptors", async () => { const repository = new MemoryRepository(); repository.current = { contextState: context(), globalState: globalState() }; const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({ contextState: { ...current.contextState, pullRequest: { ...nextPullRequest, owner: "other" }, files: { file: { ...current.contextState.files.file!, revisionId: B } } }, globalState: { ...current.globalState, currentRevisionId: C, files: { file: { ...current.globalState.files.file!, revisionId: B } } } })); await assert.rejects(() => service.update({ repositoryId: REPOSITORY_ID, identity: { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }, pullRequest: pr({ headSha: C }) }), /mapped|revision|descriptor|identity/i); assert.equal(repository.commits, 0); });

test("explicit closed override survives metadata refresh and revision transition", async () => { const repository = new MemoryRepository(); repository.current = { contextState: context(48, { pullRequest: pr({ state: "closed", decorationEnabled: true }) }), globalState: globalState() }; const service = new GitHubPullRequestContextStateService(repository, async ({ current, nextPullRequest }) => ({ contextState: { ...current.contextState, pullRequest: nextPullRequest, files: { file: { ...current.contextState.files.file!, revisionId: nextPullRequest.headSha } } }, globalState: { ...current.globalState, currentRevisionId: nextPullRequest.headSha, files: { file: { ...current.globalState.files.file!, revisionId: nextPullRequest.headSha } } } })); const identity = { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }; const refreshed = await service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ state: "closed", title: "refresh" }) }); assert.equal(isPullRequestDecorationEnabled(refreshed.contextState.pullRequest!), true); const transitioned = await service.update({ repositoryId: REPOSITORY_ID, identity, pullRequest: pr({ state: "closed", headSha: C }) }); assert.equal(isPullRequestDecorationEnabled(transitioned.contextState.pullRequest!), true); });

test("filesystem persistence isolates multiple PR contexts across restart", async () => { const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-r3-")); const storageUris = { globalStorageUri: { fsPath: root } }; const repository = new FileSystemReviewStateRepository({ storageUris }); const service = new GitHubPullRequestContextStateService(repository, async ({ current }) => current); await service.create({ contextState: context(48), globalState: globalState() }, undefined); await service.create({ contextState: context(49, { pullRequest: pr({ number: 49 }) }), globalState: globalState() }, globalState()); const restarted = new GitHubPullRequestContextStateService(new FileSystemReviewStateRepository({ storageUris }), async ({ current }) => current); assert.equal((await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 48 }))?.contextState.pullRequest?.number, 48); assert.equal((await restarted.load(REPOSITORY_ID, { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 49 }))?.contextState.pullRequest?.number, 49); });

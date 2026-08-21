import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import { NodeNonGitSnapshotCodec } from "../../src/adapters/non-git-snapshots/index";
import {
  GitHistoryRewriteRecoveryCoordinator,
  gitGlobalSnapshotScope
} from "../../src/application/history-rewrite-recovery/git-context-recovery";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker
} from "../../src/application/non-git-snapshots/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type GitRevisionMappingSource
} from "../../src/application/review-context/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";
const MISSING_GLOBAL_SHA = "3333333333333333333333333333333333333333";
const OCCURRED_AT = "2026-08-06T11:00:00.000Z";
const REPOSITORY_ID = "github.com/example/rewrite";
const REPOSITORY_ROOT = "/repo";
const stableHash = new NodeSha256StableHash();

class RewriteSource implements GitRevisionMappingSource {
  public oldObjectExists = false;
  public readonly missingObjectIds = new Set<string>();
  public readonly texts = new Map<string, string>();
  public readonly invalidPaths = new Set<string>();
  public readonly encodingHints: Array<readonly [string, string | undefined]> = [];
  public diffCalls = 0;

  public async objectExists(
    _repositoryRoot: string,
    objectName: string
  ): Promise<boolean> {
    return objectName === OLD_SHA
      ? this.oldObjectExists
      : !this.missingObjectIds.has(objectName);
  }

  public async diffRevisions(): Promise<string> {
    this.diffCalls += 1;
    return "";
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string,
    _semantics?: "posix" | "windows",
    _feedback?: unknown,
    _signal?: AbortSignal,
    encodingHint?: string,
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    this.encodingHints.push([repositoryRelativePath, encodingHint]);
    if (this.invalidPaths.has(repositoryRelativePath)) {
      return { kind: "invalid-encoding" as const, encoding: "utf-8" as const };
    }
    const content = this.texts.get(`${revision}\0${repositoryRelativePath}`);
    return content === undefined
      ? { kind: "missing-file" }
      : { kind: "found", content };
  }
}

const tracker = (): NonGitSnapshotTracker => new NonGitSnapshotTracker(
  new InMemoryNonGitSnapshotStorage(),
  new NodeNonGitSnapshotCodec(),
  {
    maxSnapshots: 64,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 30 * 24 * 60 * 60 * 1_000
  }
);

const contextState = (contextId: string, path = "src/example.ts"): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId: REPOSITORY_ID,
  displayName: "refs/heads/main",
  branch: {
    refName: "refs/heads/main",
    headRevision: OLD_SHA
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: path,
      previousPaths: [],
      revisionId: OLD_SHA,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
      originalReviewedByDiff: {},
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      lineCount: 3,
      updatedAt: OCCURRED_AT
    }
  },
  createdAt: OCCURRED_AT,
  updatedAt: OCCURRED_AT
});

const globalState = (path = "src/example.ts"): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: OLD_SHA,
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: path,
      revisionId: OLD_SHA,
      reviewed: [{ startLine: 0, endLineExclusive: 3 }],
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      updatedAt: OCCURRED_AT
    }
  },
  updatedAt: OCCURRED_AT
});

const setup = () => {
  const source = new RewriteSource();
  const snapshotTracker = tracker();
  const current = new GitReviewContextResolver({ stableHash }).resolve({
    repositoryId: REPOSITORY_ID,
    rootPath: REPOSITORY_ROOT,
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: NEW_SHA
  });
  const recovery = new GitHistoryRewriteRecoveryCoordinator({
    source,
    stableHash,
    snapshotTracker
  });
  const mapper = new GitContextRevisionMapper({
    source,
    stableHash,
    historyRewriteRecovery: recovery,
    now: () => new Date(OCCURRED_AT)
  });
  return { source, snapshotTracker, current, mapper };
};

const map = (
  mapper: GitContextRevisionMapper,
  current: ReturnType<GitReviewContextResolver["resolve"]>,
  context: ReviewContextState,
  global: RepositoryGlobalState,
  currentCandidatePaths: readonly string[] = []
) => mapper.map({
  current,
  contextState: context,
  globalState: global,
  fileSystemPathSemantics: "posix",
  options: {
    ignoreWhitespaceChanges: false,
    ignoreEolChanges: false
  },
  currentCandidatePaths
});

test("Git revision mapper preserves SHA-only reviewed ranges through saved snapshots when the old object is gone", async () => {
  const { source, snapshotTracker, current, mapper } = setup();
  source.texts.set(`${NEW_SHA}\0src/example.ts`, "alpha\nbeta\ngamma");
  await snapshotTracker.saveLatest({
    workspaceContextId: current.contextId,
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));
  await snapshotTracker.saveLatest({
    workspaceContextId: gitGlobalSnapshotScope(REPOSITORY_ID),
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));

  const result = await map(
    mapper,
    current,
    contextState(current.contextId),
    globalState()
  );

  assert.deepEqual(
    result.contextState.files["file-1"]?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
  assert.deepEqual(
    result.globalState.files["file-1"]?.reviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
  assert.equal(result.contextState.files["file-1"]?.revisionId, NEW_SHA);
  assert.equal(result.globalState.files["file-1"]?.revisionId, NEW_SHA);
  assert.deepEqual(result.unresolvedFileIds, []);
  assert.equal(source.diffCalls, 0);
});

test("Git revision mapper follows one snapshot-backed rename and retains the stable file identity", async () => {
  const { source, snapshotTracker, current, mapper } = setup();
  source.texts.set(`${NEW_SHA}\0src/renamed.ts`, "alpha\nbeta\ngamma");
  await snapshotTracker.saveLatest({
    workspaceContextId: current.contextId,
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));
  await snapshotTracker.saveLatest({
    workspaceContextId: gitGlobalSnapshotScope(REPOSITORY_ID),
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));

  const result = await map(
    mapper,
    current,
    contextState(current.contextId, "src/old.ts"),
    globalState("src/old.ts"),
    ["src/renamed.ts"]
  );

  assert.deepEqual(Object.keys(result.contextState.files), ["file-1"]);
  assert.equal(result.contextState.files["file-1"]?.currentPath, "src/renamed.ts");
  assert.deepEqual(result.contextState.files["file-1"]?.previousPaths, ["src/old.ts"]);
  assert.equal(result.globalState.files["file-1"]?.currentPath, "src/renamed.ts");
  assert.deepEqual(result.unresolvedFileIds, []);
});

test("Git revision mapper fails closed when multiple current paths match one saved snapshot", async () => {
  const { source, snapshotTracker, current, mapper } = setup();
  source.texts.set(`${NEW_SHA}\0src/one.ts`, "alpha\nbeta\ngamma");
  source.texts.set(`${NEW_SHA}\0src/two.ts`, "alpha\nbeta\ngamma");
  await snapshotTracker.saveLatest({
    workspaceContextId: current.contextId,
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));
  await snapshotTracker.saveLatest({
    workspaceContextId: gitGlobalSnapshotScope(REPOSITORY_ID),
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));

  const result = await map(
    mapper,
    current,
    contextState(current.contextId, "src/old.ts"),
    globalState("src/old.ts"),
    ["src/one.ts", "src/two.ts"]
  );

  assert.deepEqual(result.contextState.files, {});
  assert.deepEqual(result.globalState.files, {});
  assert.deepEqual(result.unresolvedFileIds, ["file-1"]);
});

test("Git revision mapper clears a shared file when direct Context and recovered Global disagree", async () => {
  const { source, snapshotTracker, current, mapper } = setup();
  source.oldObjectExists = true;
  source.missingObjectIds.add(MISSING_GLOBAL_SHA);
  source.texts.set(`${NEW_SHA}\0src/context.ts`, "context");
  source.texts.set(`${NEW_SHA}\0src/recovered.ts`, "global\nbeta\ngamma");
  const global = globalState("src/global.ts");
  const globalFile = global.files["file-1"];
  assert.ok(globalFile);
  global.currentRevisionId = MISSING_GLOBAL_SHA;
  global.files["file-1"] = {
    ...globalFile,
    revisionId: MISSING_GLOBAL_SHA,
    contentHash: stableHash.digest("global\nbeta\ngamma")
  };
  await snapshotTracker.saveLatest({
    workspaceContextId: `git-global:${REPOSITORY_ID}`,
    fileId: "file-1",
    content: "global\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }]
  }, Date.parse(OCCURRED_AT));

  const result = await map(
    mapper,
    current,
    contextState(current.contextId, "src/context.ts"),
    global,
    ["src/context.ts", "src/recovered.ts"]
  );

  assert.deepEqual(result.contextState.files, {});
  assert.deepEqual(result.globalState.files, {});
  assert.deepEqual(result.unresolvedFileIds, ["file-1"]);
});

test("T609-NR-003 keeps recoverable files when an opened encoded catalog file is unreadable", async () => {
  const { source, snapshotTracker, current, mapper } = setup();
  source.texts.set(`${NEW_SHA}\0src/example.ts`, "alpha\nbeta\ngamma");
  source.invalidPaths.add("src/invalid.txt");
  const context = contextState(current.contextId);
  const global = globalState();
  const invalidContext = {
    ...context.files["file-1"]!,
    fileId: "invalid-file",
    currentPath: "src/invalid.txt",
    contentHash: stableHash.digest("invalid")
  };
  const invalidGlobal = {
    ...global.files["file-1"]!,
    fileId: "invalid-file",
    currentPath: "src/invalid.txt",
    contentHash: stableHash.digest("invalid")
  };
  context.files["invalid-file"] = invalidContext;
  global.files["invalid-file"] = invalidGlobal;
  await snapshotTracker.saveLatest({
    workspaceContextId: current.contextId,
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));
  await snapshotTracker.saveLatest({
    workspaceContextId: gitGlobalSnapshotScope(REPOSITORY_ID),
    fileId: "file-1",
    content: "alpha\nbeta\ngamma",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
  }, Date.parse(OCCURRED_AT));

  const result = await mapper.map({
    current,
    contextState: context,
    globalState: global,
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    currentCandidatePaths: ["src/example.ts", "src/invalid.txt"],
    encodingHintsByPath: { "src/invalid.txt": "shift_jis" }
  });

  assert.ok(result.contextState.files["file-1"]);
  assert.ok(result.globalState.files["file-1"]);
  assert.equal(result.contextState.files["invalid-file"], undefined);
  assert.equal(result.globalState.files["invalid-file"], undefined);
  assert.deepEqual(result.unresolvedFileIds, ["invalid-file"]);
  assert.ok(source.encodingHints.some(([filePath, hint]) => filePath === "src/invalid.txt" && hint === "shift_jis"));
});

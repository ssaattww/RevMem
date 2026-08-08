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
const NOW = "2026-08-06T11:20:00.000Z";
const repositoryId = "github.com/example/tree-recovery";
const stableHash = new NodeSha256StableHash();

class TreeAwareSource implements GitRevisionMappingSource {
  public listCalls = 0;

  public async objectExists(_root: string, objectName: string): Promise<boolean> {
    return objectName !== OLD_SHA;
  }

  public async diffRevisions(): Promise<string> {
    throw new Error("old object diff must not run");
  }

  public async listFilePathsAtRevision(
    _root: string,
    revision: string
  ): Promise<readonly string[] | undefined> {
    this.listCalls += 1;
    assert.equal(revision, NEW_SHA);
    return ["src/renamed.ts"];
  }

  public async readTextFileAtRevision(
    _root: string,
    revision: string,
    path: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    return revision === NEW_SHA && path === "src/renamed.ts"
      ? { kind: "found", content: "alpha\nbeta\ngamma" }
      : { kind: "missing-file" };
  }
}

const context = (contextId: string): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: "refs/heads/main",
  branch: { refName: "refs/heads/main", headRevision: OLD_SHA },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/old.ts",
      previousPaths: [],
      revisionId: OLD_SHA,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
      originalReviewedByDiff: {},
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      lineCount: 3,
      updatedAt: NOW
    }
  },
  createdAt: NOW,
  updatedAt: NOW
});

const global = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId: OLD_SHA,
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/old.ts",
      revisionId: OLD_SHA,
      reviewed: [{ startLine: 0, endLineExclusive: 3 }],
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      updatedAt: NOW
    }
  },
  updatedAt: NOW
});

test("history rewrite mapper enumerates the current Git tree when callers do not provide rename candidates", async () => {
  const source = new TreeAwareSource();
  const tracker = new NonGitSnapshotTracker(
    new InMemoryNonGitSnapshotStorage(),
    new NodeNonGitSnapshotCodec(),
    {
      maxSnapshots: 16,
      maxCompressedBytes: 1024 * 1024,
      retentionMs: 24 * 60 * 60 * 1_000
    }
  );
  const current = new GitReviewContextResolver({ stableHash }).resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: NEW_SHA
  });
  for (const workspaceContextId of [
    current.contextId,
    gitGlobalSnapshotScope(repositoryId)
  ]) {
    await tracker.saveLatest({
      workspaceContextId,
      fileId: "file-1",
      content: "alpha\nbeta\ngamma",
      reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }]
    }, Date.parse(NOW));
  }

  const mapper = new GitContextRevisionMapper({
    source,
    stableHash,
    historyRewriteRecovery: new GitHistoryRewriteRecoveryCoordinator({
      source,
      stableHash,
      snapshotTracker: tracker
    }),
    now: () => new Date(NOW)
  });
  const result = await mapper.map({
    current,
    contextState: context(current.contextId),
    globalState: global(),
    fileSystemPathSemantics: "posix",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  assert.equal(source.listCalls, 1);
  assert.equal(result.contextState.files["file-1"]?.currentPath, "src/renamed.ts");
  assert.equal(result.globalState.files["file-1"]?.currentPath, "src/renamed.ts");
  assert.deepEqual(result.unresolvedFileIds, []);
});

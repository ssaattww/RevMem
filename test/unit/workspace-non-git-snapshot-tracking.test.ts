import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  SnapshotTrackingWorkspaceReviewStateSessionProvider,
  type WorkspaceReviewStateRepository,
} from "../../src/adapters/workspace-review-state/index";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
} from "../../src/application/non-git-snapshots/index";
import { NodeNonGitSnapshotCodec } from "../../src/adapters/non-git-snapshots/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { markReviewedRanges, unmarkReviewedRanges } from "../../src/core/review-state/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class Repository implements WorkspaceReviewStateRepository {
  public current: ReviewStateCommit | undefined;

  public async load(): Promise<ReviewStateCommit | undefined> {
    return this.current === undefined ? undefined : clone(this.current);
  }

  public async save(_target: ReviewStateRepositoryTarget, commit: ReviewStateCommit): Promise<void> {
    this.current = clone(commit);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

class FailingPublishStorage extends InMemoryNonGitSnapshotStorage {
  public failNextPublish = false;
  public override async setLatest(workspaceContextId: string, fileId: string, snapshotId: string | undefined): Promise<void> {
    if (snapshotId !== undefined && this.failNextPublish) {
      this.failNextPublish = false;
      throw new Error("simulated snapshot publish failure");
    }
    await super.setLatest(workspaceContextId, fileId, snapshotId);
  }
}

interface DescriptorWithContent {
  readonly workspaceFolderUri: { readonly scheme: string; readonly authority: string; readonly path: string };
  readonly documentUri: { readonly scheme: string; readonly authority: string; readonly path: string };
  readonly fileSystemPathSemantics: "posix";
  readonly relativePath: string;
  readonly workspaceDisplayName: string;
  readonly lineCount: number;
  readonly contentHash: string;
  readonly content: string;
}

const descriptor = (content: string, contentHash: string): DescriptorWithContent => ({
  workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" },
  documentUri: { scheme: "file", authority: "", path: "/workspace/src/example.ts" },
  fileSystemPathSemantics: "posix",
  relativePath: "src/example.ts",
  workspaceDisplayName: "Workspace",
  lineCount: content.split("\n").length,
  contentHash,
  content,
});

test("latest generation is authoritative when a post-unmark snapshot publish fails", async () => {
  const repository = new Repository();
  const storage = new FailingPublishStorage();
  let now = Date.parse("2026-08-01T15:00:00.000Z");
  const createProvider = () => new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(new NodeSha256StableHash()), repository,
    snapshotTracker: new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), { maxSnapshots: 16, maxCompressedBytes: 1024 * 1024, retentionMs: 60_000 }),
    resolveContent: (value) => (value as DescriptorWithContent).content,
    now: () => new Date(now++),
  });
  const initial = await createProvider().open(descriptor("alpha\nbeta", "hash-1"));
  const marked = markReviewedRanges({ contextState: initial.contextState, globalState: initial.globalState, target: initial.target, intervals: [{ startLine: 0, endLineExclusive: 2 }], occurredAt: "2026-08-01T15:00:00.000Z" });
  await initial.committer.commit(marked);
  const current = await createProvider().open(descriptor("alpha\nbeta", "hash-1"));
  const unmarked = unmarkReviewedRanges({ contextState: current.contextState, globalState: current.globalState, target: current.target, intervals: [{ startLine: 0, endLineExclusive: 2 }], occurredAt: "2026-08-01T15:00:01.000Z" });
  storage.failNextPublish = true;
  await assert.rejects(current.committer.commit(unmarked), /publish failure/);
  assert.equal(await storage.getLatest(current.contextState.contextId, current.target.fileId), undefined);
  const afterFailure = await createProvider().open(descriptor("alpha\nbeta", "hash-1"));
  assert.deepEqual(afterFailure.contextState.files[afterFailure.target.fileId]?.modifiedReviewed ?? [], []);
});

test("successful unmark publishes an empty latest generation for the decoration read path", async () => {
  const repository = new Repository();
  const storage = new InMemoryNonGitSnapshotStorage();
  let now = Date.parse("2026-08-01T15:00:00.000Z");
  const createProvider = () => new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(new NodeSha256StableHash()), repository,
    snapshotTracker: new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), { maxSnapshots: 16, maxCompressedBytes: 1024 * 1024, retentionMs: 60_000 }),
    resolveContent: (value) => (value as DescriptorWithContent).content,
    now: () => new Date(now++),
  });
  const initial = await createProvider().open(descriptor("alpha\nbeta", "hash-1"));
  const marked = markReviewedRanges({ contextState: initial.contextState, globalState: initial.globalState, target: initial.target, intervals: [{ startLine: 0, endLineExclusive: 2 }], occurredAt: "2026-08-01T15:00:00.000Z" });
  await initial.committer.commit(marked);
  const current = await createProvider().open(descriptor("alpha\nbeta", "hash-1"));
  const unmarked = unmarkReviewedRanges({ contextState: current.contextState, globalState: current.globalState, target: current.target, intervals: [{ startLine: 0, endLineExclusive: 2 }], occurredAt: "2026-08-01T15:00:01.000Z" });
  await current.committer.commit(unmarked);
  const snapshotId = await storage.getLatest(current.contextState.contextId, current.target.fileId);
  assert.ok(snapshotId);
  const mapped = await new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), { maxSnapshots: 16, maxCompressedBytes: 1024 * 1024, retentionMs: 60_000 }).map(snapshotId, "alpha\nbeta", now);
  assert.deepEqual(mapped, { status: "mapped", reviewedRanges: [] });
  assert.deepEqual((await createProvider().loadForDecoration(descriptor("alpha\nbeta", "hash-1")))?.contextState.files[current.target.fileId]?.modifiedReviewed ?? [], []);
});

test("workspace provider remaps reviewed ranges from persisted snapshot after provider restart", async () => {
  const repository = new Repository();
  const storage = new InMemoryNonGitSnapshotStorage();
  let now = Date.parse("2026-08-01T15:00:00.000Z");
  const createProvider = () => new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(new NodeSha256StableHash()),
    repository,
    snapshotTracker: new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), {
      maxSnapshots: 16,
      maxCompressedBytes: 1024 * 1024,
      retentionMs: 60_000,
    }),
    resolveContent: (value) => (value as DescriptorWithContent).content,
    now: () => new Date(now++),
  });

  const initial = await createProvider().open(descriptor("alpha\nbeta\ngamma", "hash-1"));
  repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...initial.contextState,
      files: {
        [initial.target.fileId]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          fileId: initial.target.fileId,
          currentPath: initial.target.currentPath,
          previousPaths: [],
          revisionId: initial.target.revisionId,
          modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
          originalReviewedByDiff: {},
          contentHash: initial.target.contentHash,
          lineCount: initial.target.lineCount,
          updatedAt: "2026-08-01T15:00:00.000Z",
        },
      },
    },
    globalState: {
      ...initial.globalState,
      files: {
        [initial.target.fileId]: {
          fileId: initial.target.fileId,
          currentPath: initial.target.currentPath,
          revisionId: initial.target.revisionId,
          reviewed: [{ startLine: 0, endLineExclusive: 3 }],
          contentHash: initial.target.contentHash,
          updatedAt: "2026-08-01T15:00:00.000Z",
        },
      },
    },
  };

  await createProvider().open(descriptor("alpha\nbeta\ngamma", "hash-1"));
  const mapped = await createProvider().open(descriptor("alpha\ninserted\nbeta\ngamma", "hash-2"));

  assert.deepEqual(mapped.contextState.files[mapped.target.fileId]?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 },
  ]);
  assert.deepEqual(mapped.globalState.files[mapped.target.fileId]?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 },
  ]);
  assert.equal(mapped.target.contentHash, "hash-2");
});

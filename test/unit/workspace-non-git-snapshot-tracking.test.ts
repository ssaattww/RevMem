import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  SnapshotTrackingWorkspaceReviewStateSessionProvider,
  type WorkspaceReviewStateRepository,
} from "../../src/adapters/workspace-review-state/index";
import type {
  ReviewStateCommit,
  ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
} from "../../src/application/non-git-snapshots/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class Repository implements WorkspaceReviewStateRepository {
  public current: ReviewStateCommit | undefined;

  public async load(): Promise<ReviewStateCommit | undefined> {
    return this.current === undefined ? undefined : clone(this.current);
  }

  public async save(_target: never, commit: ReviewStateCommit): Promise<void> {
    this.current = clone(commit);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState),
      globalState: clone(transaction.next.globalState),
    };
  }
}

const descriptor = (content: string, contentHash: string) => ({
  workspaceFolderUri: { scheme: "file", authority: "", path: "/workspace" },
  documentUri: { scheme: "file", authority: "", path: "/workspace/src/example.ts" },
  fileSystemPathSemantics: "posix" as const,
  relativePath: "src/example.ts",
  workspaceDisplayName: "Workspace",
  lineCount: content.split("\n").length,
  contentHash,
});

test("workspace provider remaps reviewed ranges from persisted snapshot after provider restart", async () => {
  const repository = new Repository();
  const storage = new InMemoryNonGitSnapshotStorage();
  const contents = new Map([
    ["hash-1", "alpha\nbeta\ngamma"],
    ["hash-2", "alpha\ninserted\nbeta\ngamma"],
  ]);
  const createProvider = () => new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(new NodeSha256StableHash()),
    repository,
    snapshotStorage: storage,
    snapshotTracker: new NonGitSnapshotTracker(storage, {
      maxSnapshots: 16,
      maxCompressedBytes: 1024 * 1024,
      retentionMs: 60_000,
    }),
    resolveContent: (value) => {
      const content = contents.get(value.contentHash);
      if (content === undefined) {
        throw new Error(`missing fixture content: ${value.contentHash}`);
      }
      return content;
    },
    now: () => new Date("2026-08-01T15:00:00.000Z"),
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
  const mapped = await createProvider().open(
    descriptor("alpha\ninserted\nbeta\ngamma", "hash-2"),
  );

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

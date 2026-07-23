import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  WorkspaceReviewStateSessionProvider,
  type WorkspaceEditorReviewDescriptor,
  type WorkspaceReviewStateRepository
} from "../../src/adapters/workspace-review-state/index";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type GlobalFileReviewState,
  type LineInterval
} from "../../src/core/contracts/index";

const now = "2026-07-23T06:45:00.000Z";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const descriptor = (
  overrides: Partial<WorkspaceEditorReviewDescriptor> = {}
): WorkspaceEditorReviewDescriptor => ({
  workspaceFolderUri: {
    scheme: "file",
    authority: "",
    path: "/workspace"
  },
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/workspace/src/example.ts"
  },
  fileSystemPathSemantics: "posix",
  relativePath: "src/example.ts",
  workspaceDisplayName: "Workspace",
  lineCount: 6,
  contentHash: "hash-1",
  ...overrides
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class FakeRepository implements WorkspaceReviewStateRepository {
  public current: ReviewStateCommit | undefined;
  public readonly loads: ReviewStateRepositoryTarget[] = [];
  public readonly saves: Array<{
    readonly target: ReviewStateRepositoryTarget;
    readonly commit: ReviewStateCommit;
  }> = [];
  public readonly transactions: ReviewStateTransactionLike[] = [];

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    this.loads.push({ ...target });
    return this.current === undefined ? undefined : clone(this.current);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.saves.push({ target: { ...target }, commit: clone(commit) });
    this.current = clone(commit);
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    this.transactions.push(clone(transaction));
  }
}

const createProvider = (repository: FakeRepository) =>
  new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(new NodeSha256StableHash()),
    repository,
    now: () => new Date(now)
  });

test("open initializes one workspace context and returns a committable mapped session", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository);

  const session = await provider.open(descriptor());

  assert.equal(repository.loads.length, 1);
  assert.equal(repository.saves.length, 1);
  assert.equal(session.committer, repository);
  assert.equal(session.contextState.kind, "workspace");
  assert.equal(session.contextState.displayName, "Workspace");
  assert.equal(
    session.contextState.workspace?.workspaceId,
    session.target.revisionId.slice("workspace-live:".length)
  );
  assert.equal(
    session.contextState.workspace?.snapshotRevision,
    session.target.revisionId
  );
  assert.equal(session.globalState.currentRevisionId, session.target.revisionId);
  assert.deepEqual(session.contextState.files, {});
  assert.deepEqual(session.globalState.files, {});
  assert.equal(session.target.currentPath, "src/example.ts");
  assert.equal(session.target.lineCount, 6);
  assert.equal(session.target.contentHash, "hash-1");
  assert.deepEqual(repository.saves[0]!.target, {
    kind: "workspace",
    repositoryId: session.contextState.repositoryId,
    contextId: session.contextState.contextId
  });
});

const contextFile = (
  fileId: string,
  currentPath: string,
  contentHash: string,
  reviewed: LineInterval[]
): FileReviewState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  fileId,
  currentPath,
  previousPaths: [],
  revisionId: "placeholder",
  modifiedReviewed: reviewed,
  originalReviewedByDiff: {},
  contentHash,
  lineCount: 6,
  updatedAt: "2026-07-23T06:40:00.000Z"
});

const globalFile = (
  fileId: string,
  currentPath: string,
  contentHash: string,
  reviewed: LineInterval[]
): GlobalFileReviewState => ({
  fileId,
  currentPath,
  revisionId: "placeholder",
  reviewed,
  contentHash,
  updatedAt: "2026-07-23T06:40:00.000Z"
});

test("open preserves mapped ranges when the current content hash is unchanged", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository);
  const initial = await provider.open(descriptor());
  const fileId = initial.target.fileId;
  const revisionId = initial.target.revisionId;

  repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...clone(initial.contextState),
      files: {
        [fileId]: {
          ...contextFile(fileId, "src/example.ts", "hash-1", [interval(1, 3)]),
          revisionId
        }
      }
    },
    globalState: {
      ...clone(initial.globalState),
      files: {
        [fileId]: {
          ...globalFile(fileId, "src/example.ts", "hash-1", [interval(1, 3)]),
          revisionId
        }
      }
    }
  };
  repository.saves.length = 0;

  const session = await provider.open(descriptor());

  assert.equal(repository.saves.length, 0);
  assert.deepEqual(
    session.contextState.files[fileId]!.modifiedReviewed,
    [interval(1, 3)]
  );
  assert.deepEqual(session.globalState.files[fileId]!.reviewed, [interval(1, 3)]);
});

test("open removes only the current file from context and Global when content changed", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository);
  const initial = await provider.open(descriptor());
  const fileId = initial.target.fileId;
  const revisionId = initial.target.revisionId;
  const otherFileId = "workspace-file:other";

  repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...clone(initial.contextState),
      files: {
        [fileId]: {
          ...contextFile(fileId, "src/example.ts", "hash-old", [interval(0, 6)]),
          revisionId
        },
        [otherFileId]: {
          ...contextFile(otherFileId, "src/other.ts", "other-hash", [interval(0, 2)]),
          currentPath: "src/other.ts",
          revisionId
        }
      }
    },
    globalState: {
      ...clone(initial.globalState),
      files: {
        [fileId]: {
          ...globalFile(fileId, "src/example.ts", "hash-old", [interval(0, 6)]),
          revisionId
        },
        [otherFileId]: {
          ...globalFile(otherFileId, "src/other.ts", "other-hash", [interval(0, 2)]),
          currentPath: "src/other.ts",
          revisionId
        }
      }
    }
  };
  repository.saves.length = 0;

  const session = await provider.open(descriptor({ contentHash: "hash-new" }));

  assert.equal(repository.saves.length, 1);
  assert.equal(session.contextState.files[fileId], undefined);
  assert.equal(session.globalState.files[fileId], undefined);
  assert.deepEqual(
    session.contextState.files[otherFileId]!.modifiedReviewed,
    [interval(0, 2)]
  );
  assert.deepEqual(
    session.globalState.files[otherFileId]!.reviewed,
    [interval(0, 2)]
  );
  assert.equal(session.target.contentHash, "hash-new");
  assert.equal(session.contextState.updatedAt, now);
  assert.equal(session.globalState.updatedAt, now);
});

test("open rejects persisted state owned by a different workspace context", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository);
  const initial = await provider.open(descriptor());

  repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...clone(initial.contextState),
      contextId: "different-context"
    },
    globalState: clone(initial.globalState)
  };
  repository.saves.length = 0;

  await assert.rejects(provider.open(descriptor()), /context identity/);
  assert.equal(repository.saves.length, 0);
});

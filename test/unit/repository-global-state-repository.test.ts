import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextKind,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type {
  ReviewStateTransaction,
  ReviewStateTransactionCommitter
} from "../../src/core/review-state/index";
import {
  RepositoryGlobalStateRepository
} from "../../src/application/repository-global-state/index";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const revision = "revision-2";
const occurredAt = "2026-08-01T14:40:00.000Z";

const contextState = (
  kind: ReviewContextKind,
  contextReviewed: LineInterval[] = []
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: `${kind}-context`,
  kind,
  repositoryId: "repository-1",
  displayName: `${kind} context`,
  ...(kind === "pull-request"
    ? {
        pullRequest: {
          host: "github.com",
          owner: "owner",
          repository: "repository",
          number: 10,
          state: "open" as const,
          baseSha: "revision-1",
          headSha: revision
        }
      }
    : kind === "branch"
      ? { branch: { refName: "refs/heads/main", headRevision: revision } }
      : kind === "workspace"
        ? { workspace: { workspaceId: "workspace-1", snapshotRevision: revision } }
        : {
            externalFile: {
              canonicalUri: "file:///tmp/example.ts",
              snapshotRevision: revision
            }
          }),
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: revision,
      modifiedReviewed: contextReviewed,
      originalReviewedByDiff: {},
      contentHash: "hash-2",
      lineCount: 12,
      updatedAt: "2026-08-01T14:30:00.000Z"
    }
  },
  createdAt: "2026-08-01T14:00:00.000Z",
  updatedAt: "2026-08-01T14:30:00.000Z"
});

const globalState = (
  reviewed: LineInterval[] = []
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: revision,
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: revision,
      reviewed,
      contentHash: "hash-2",
      updatedAt: "2026-08-01T14:30:00.000Z"
    }
  },
  updatedAt: "2026-08-01T14:30:00.000Z"
});

const target = {
  fileId: "file-1",
  currentPath: "src/example.ts",
  revisionId: revision,
  lineCount: 12,
  contentHash: "hash-2"
} as const;

const createHarness = () => {
  const committed: ReviewStateTransaction[] = [];
  const histories: ReviewStateTransaction[] = [];
  const committer: ReviewStateTransactionCommitter = {
    commit: async (transaction) => {
      committed.push(structuredClone(transaction));
    }
  };
  const repository = new RepositoryGlobalStateRepository({
    requestHistory: async (transaction) => {
      histories.push(structuredClone(transaction));
    }
  });

  return { repository, committer, committed, histories };
};

test("marking ranges in PR, branch, and workspace contexts atomically updates Global and records history", async () => {
  for (const kind of ["pull-request", "branch", "workspace"] as const) {
    const harness = createHarness();
    const result = await harness.repository.apply({
      operation: "mark-ranges-reviewed",
      contextState: contextState(kind),
      globalState: globalState(),
      target,
      intervals: [interval(2, 5)],
      occurredAt,
      committer: harness.committer
    });

    assert.equal(result.status, "applied");
    assert.equal(harness.committed.length, 1);
    assert.equal(harness.histories.length, 1);
    assert.deepEqual(
      harness.committed[0]?.next.contextState.files["file-1"]?.modifiedReviewed,
      [interval(2, 5)]
    );
    assert.deepEqual(
      harness.committed[0]?.next.globalState.files["file-1"]?.reviewed,
      [interval(2, 5)]
    );
    assert.deepEqual(harness.histories[0], harness.committed[0]);
  }
});

test("unmarking removes Global ranges even when the current context does not contain them", async () => {
  const harness = createHarness();
  const result = await harness.repository.apply({
    operation: "unmark-ranges-reviewed",
    contextState: contextState("branch", []),
    globalState: globalState([interval(1, 8)]),
    target,
    intervals: [interval(3, 6)],
    occurredAt,
    committer: harness.committer
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(
    result.transaction.next.contextState.files["file-1"]?.modifiedReviewed,
    []
  );
  assert.deepEqual(
    result.transaction.next.globalState.files["file-1"]?.reviewed,
    [interval(1, 3), interval(6, 8)]
  );
});

test("whole-file operations update both layers and semantic no-op skips commit and history", async () => {
  const harness = createHarness();
  const marked = await harness.repository.apply({
    operation: "mark-file-reviewed",
    contextState: contextState("workspace"),
    globalState: globalState(),
    target,
    occurredAt,
    committer: harness.committer
  });

  assert.equal(marked.status, "applied");
  assert.deepEqual(
    marked.transaction.next.globalState.files["file-1"]?.reviewed,
    [interval(0, 12)]
  );

  const noOpHarness = createHarness();
  const noOp = await noOpHarness.repository.apply({
    operation: "mark-file-reviewed",
    contextState: contextState("workspace", [interval(0, 12)]),
    globalState: globalState([interval(0, 12)]),
    target,
    occurredAt,
    committer: noOpHarness.committer
  });

  assert.equal(noOp.status, "no-op");
  assert.equal(noOpHarness.committed.length, 0);
  assert.equal(noOpHarness.histories.length, 0);
});

test("commit failure prevents history and propagates without a partial fallback", async () => {
  const histories: ReviewStateTransaction[] = [];
  const repository = new RepositoryGlobalStateRepository({
    requestHistory: async (transaction) => {
      histories.push(structuredClone(transaction));
    }
  });
  const failure = new Error("stale state");

  await assert.rejects(
    repository.apply({
      operation: "unmark-file-reviewed",
      contextState: contextState("pull-request", [interval(0, 12)]),
      globalState: globalState([interval(0, 12)]),
      target,
      occurredAt,
      committer: {
        commit: async () => {
          throw failure;
        }
      }
    }),
    (error: unknown) => error === failure
  );
  assert.equal(histories.length, 0);
});

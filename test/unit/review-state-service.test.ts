import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewState,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import {
  commitReviewStateTransaction,
  markFileReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkReviewedRanges,
  type ReviewStateFileTarget,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter
} from "../../src/core/review-state/index";

const occurredAt = "2026-07-23T04:30:00.000Z";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const target = (
  lineCount = 20,
  overrides: Partial<ReviewStateFileTarget> = {}
): ReviewStateFileTarget => ({
  fileId: "file-1",
  currentPath: "src/example.ts",
  revisionId: "revision-2",
  lineCount,
  contentHash: "hash-2",
  ...overrides
});

const fileState = (
  modifiedReviewed: LineInterval[],
  overrides: Partial<FileReviewState> = {}
): FileReviewState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  fileId: "file-1",
  currentPath: "src/example.ts",
  previousPaths: [],
  revisionId: "revision-1",
  modifiedReviewed,
  originalReviewedByDiff: {
    "diff-1": [interval(8, 10), interval(6, 8)]
  },
  contentHash: "hash-1",
  lineCount: 20,
  updatedAt: "2026-07-23T04:00:00.000Z",
  ...overrides
});

const contextState = (
  reviewed: LineInterval[] = [interval(2, 5)],
  overrides: Partial<ReviewContextState> = {}
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "branch",
  repositoryId: "repository-1",
  displayName: "main",
  branch: {
    refName: "refs/heads/main",
    headRevision: "revision-1"
  },
  files: {
    "file-1": fileState(reviewed)
  },
  createdAt: "2026-07-23T03:00:00.000Z",
  updatedAt: "2026-07-23T04:00:00.000Z",
  ...overrides
});

const globalState = (
  reviewed: LineInterval[] = [interval(4, 7)],
  overrides: Partial<RepositoryGlobalState> = {}
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "revision-1",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-1",
      reviewed,
      contentHash: "hash-1",
      updatedAt: "2026-07-23T04:00:00.000Z"
    }
  },
  updatedAt: "2026-07-23T04:00:00.000Z",
  ...overrides
});

const freezeState = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      freezeState(nested);
    }
  }

  return value;
};

const nextRanges = (transaction: ReviewStateTransaction): {
  context: LineInterval[];
  global: LineInterval[];
} => ({
  context: transaction.next.contextState.files["file-1"]!.modifiedReviewed,
  global: transaction.next.globalState.files["file-1"]!.reviewed
});

test("markReviewedRanges atomically prepares normalized context and Global updates", () => {
  const context = freezeState(contextState([interval(10, 12), interval(2, 5)]));
  const global = freezeState(globalState([interval(12, 15), interval(4, 7)]));

  const transaction = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: target(),
    intervals: [interval(5, 10), interval(5, 2), interval(15, 15)],
    occurredAt
  });

  assert.equal(transaction.operation, "mark-ranges-reviewed");
  assert.equal(transaction.repositoryId, "repository-1");
  assert.equal(transaction.contextId, "context-1");
  assert.equal(transaction.fileId, "file-1");
  assert.deepEqual(transaction.expected, {
    contextUpdatedAt: "2026-07-23T04:00:00.000Z",
    globalUpdatedAt: "2026-07-23T04:00:00.000Z"
  });
  assert.deepEqual(nextRanges(transaction), {
    context: [interval(2, 12)],
    global: [interval(2, 10), interval(12, 15)]
  });
  assert.deepEqual(
    transaction.next.contextState.files["file-1"]!.originalReviewedByDiff,
    { "diff-1": [interval(6, 10)] }
  );
  assert.equal(transaction.next.contextState.updatedAt, occurredAt);
  assert.equal(transaction.next.globalState.updatedAt, occurredAt);
  assert.equal(
    transaction.next.contextState.files["file-1"]!.revisionId,
    "revision-2"
  );
  assert.equal(
    transaction.next.globalState.files["file-1"]!.revisionId,
    "revision-2"
  );
  assert.deepEqual(context.files["file-1"]!.modifiedReviewed, [
    interval(10, 12),
    interval(2, 5)
  ]);
  assert.deepEqual(global.files["file-1"]!.reviewed, [
    interval(12, 15),
    interval(4, 7)
  ]);
});

test("unmarkReviewedRanges removes only requested lines and preserves split fragments", () => {
  const transaction = unmarkReviewedRanges({
    contextState: contextState([interval(0, 12), interval(15, 20)]),
    globalState: globalState([interval(1, 10), interval(12, 18)]),
    target: target(),
    intervals: [interval(4, 7), interval(16, 14)],
    occurredAt
  });

  assert.equal(transaction.operation, "unmark-ranges-reviewed");
  assert.deepEqual(nextRanges(transaction), {
    context: [interval(0, 4), interval(7, 12), interval(15, 20)],
    global: [interval(1, 4), interval(7, 10), interval(12, 14), interval(16, 18)]
  });
});

test("markFileReviewed marks every existing line and handles an empty file", () => {
  const nonEmpty = markFileReviewed({
    contextState: contextState(),
    globalState: globalState(),
    target: target(4),
    occurredAt
  });
  const empty = markFileReviewed({
    contextState: contextState([], { files: {} }),
    globalState: globalState([], { files: {} }),
    target: target(0),
    occurredAt
  });

  assert.equal(nonEmpty.operation, "mark-file-reviewed");
  assert.deepEqual(nextRanges(nonEmpty), {
    context: [interval(0, 4)],
    global: [interval(0, 4)]
  });
  assert.deepEqual(nextRanges(empty), { context: [], global: [] });
});

test("unmarkFileReviewed clears context and Global while retaining original-side evidence", () => {
  const transaction = unmarkFileReviewed({
    contextState: contextState([interval(0, 20)]),
    globalState: globalState([interval(0, 20)]),
    target: target(),
    occurredAt
  });

  assert.equal(transaction.operation, "unmark-file-reviewed");
  assert.deepEqual(nextRanges(transaction), { context: [], global: [] });
  assert.deepEqual(
    transaction.next.contextState.files["file-1"]!.originalReviewedByDiff,
    { "diff-1": [interval(6, 10)] }
  );
});

test("validation failure cannot partially update either input state", () => {
  const context = freezeState(contextState());
  const global = freezeState(globalState([], { repositoryId: "repository-2" }));

  assert.throws(
    () =>
      markReviewedRanges({
        contextState: context,
        globalState: global,
        target: target(),
        intervals: [interval(0, 1)],
        occurredAt
      }),
    /same repository/
  );

  assert.deepEqual(context.files["file-1"]!.modifiedReviewed, [interval(2, 5)]);
  assert.deepEqual(global.files["file-1"]!.reviewed, []);
});

test("out-of-file ranges fail before a transaction is returned", () => {
  assert.throws(
    () =>
      markReviewedRanges({
        contextState: contextState(),
        globalState: globalState(),
        target: target(5),
        intervals: [interval(4, 6)],
        occurredAt
      }),
    RangeError
  );
});

test("commitReviewStateTransaction delegates one composite atomic commit", async () => {
  const transaction = markReviewedRanges({
    contextState: contextState(),
    globalState: globalState(),
    target: target(),
    intervals: [interval(7, 9)],
    occurredAt
  });
  const committed: ReviewStateTransaction[] = [];
  const committer: ReviewStateTransactionCommitter = {
    commit: async (candidate) => {
      committed.push(candidate);
    }
  };

  await commitReviewStateTransaction(transaction, committer);

  assert.deepEqual(committed, [transaction]);
});

test("commit failure is propagated without a context-only or Global-only fallback write", async () => {
  const transaction = markReviewedRanges({
    contextState: contextState(),
    globalState: globalState(),
    target: target(),
    intervals: [interval(7, 9)],
    occurredAt
  });
  let commitCalls = 0;
  const committer: ReviewStateTransactionCommitter = {
    commit: async () => {
      commitCalls += 1;
      throw new Error("atomic store rejected transaction");
    }
  };

  await assert.rejects(
    commitReviewStateTransaction(transaction, committer),
    /atomic store rejected transaction/
  );
  assert.equal(commitCalls, 1);
});

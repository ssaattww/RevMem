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
  type DeepReadonly,
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
  revisionId: "revision-2",
  modifiedReviewed,
  originalReviewedByDiff: {
    "diff-1": [interval(8, 10), interval(6, 8)]
  },
  contentHash: "hash-2",
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
    headRevision: "revision-2"
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
  currentRevisionId: "revision-2",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-2",
      reviewed,
      contentHash: "hash-2",
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
  context: readonly LineInterval[];
  global: readonly LineInterval[];
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
    contextState: context,
    globalState: global
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
    context: [interval(0, 4), interval(7, 12), interval(16, 20)],
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

test("unmarkFileReviewed clears modified, Global, and original-side reviewed ranges", () => {
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
    {}
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

test("review-state operations reject each context descriptor when it is not mapped to the target revision", () => {
  const pullRequest = contextState([], {
    kind: "pull-request",
    branch: undefined,
    pullRequest: {
      host: "github.com",
      owner: "owner",
      repository: "repository",
      number: 1,
      state: "open",
      baseSha: "base-1",
      headSha: "revision-1"
    }
  });
  const branch = contextState([], {
    branch: { refName: "refs/heads/main", headRevision: "revision-1" }
  });
  const workspace = contextState([], {
    kind: "workspace",
    branch: undefined,
    workspace: { workspaceId: "workspace-1", snapshotRevision: "revision-1" }
  });

  for (const context of [pullRequest, branch, workspace]) {
    assert.throws(
      () =>
        markFileReviewed({
          contextState: context,
          globalState: globalState([], { files: {} }),
          target: target(),
          occurredAt
        }),
      /mapped to the target revision/
    );
  }
});

test("review-state operations reject context and Global revision mismatches", () => {
  const cases: readonly [string, ReviewContextState, RepositoryGlobalState][] = [
    [
      "context file",
      contextState([], { files: { "file-1": fileState([], { revisionId: "revision-1" }) } }),
      globalState([], { files: {} })
    ],
    [
      "Global current revision",
      contextState([], { files: {} }),
      globalState([], { currentRevisionId: "revision-1", files: {} })
    ],
    [
      "Global file",
      contextState([], { files: {} }),
      globalState([], {
        files: {
          "file-1": {
            ...globalState().files["file-1"]!,
            fileId: "file-1",
            currentPath: "src/example.ts",
            revisionId: "revision-1",
            reviewed: [],
            updatedAt: occurredAt
          }
        }
      })
    ]
  ];

  for (const [name, context, global] of cases) {
    assert.throws(
      () =>
        markFileReviewed({
          contextState: context,
          globalState: global,
          target: target(),
          occurredAt
        }),
      new RegExp(`${name}.*target revision`, "i")
    );
  }
});

test("review-state operations reject a conflicting content hash and omit an unspecified target hash", () => {
  assert.throws(
    () =>
      markFileReviewed({
        contextState: contextState([], {
          files: { "file-1": fileState([], { contentHash: "other-hash" }) }
        }),
        globalState: globalState([], { files: {} }),
        target: target(),
        occurredAt
      }),
    /content hash.*target/i
  );

  const transaction = markFileReviewed({
    contextState: contextState(),
    globalState: globalState(),
    target: target(20, { contentHash: undefined }),
    occurredAt
  });

  assert.equal(
    transaction.next.contextState.files["file-1"]!.contentHash,
    undefined
  );
  assert.equal(transaction.next.globalState.files["file-1"]!.contentHash, undefined);
});

test("transactions retain detached full snapshots when callers mutate non-target nested state", () => {
  const context = contextState([], {
    files: {
      "file-1": fileState([]),
      "file-2": fileState([interval(10, 12)], {
        fileId: "file-2",
        currentPath: "src/other.ts",
        originalReviewedByDiff: { "diff-2": [interval(1, 2)] }
      })
    }
  });
  const global = globalState([], {
    files: {
      "file-1": globalState().files["file-1"]!,
      "file-2": {
        ...globalState().files["file-1"]!,
        fileId: "file-2",
        currentPath: "src/other.ts",
        reviewed: [interval(10, 12)]
      }
    }
  });
  const expectedContext = structuredClone(context);
  const expectedGlobal = structuredClone(global);
  const transaction = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: target(),
    intervals: [interval(3, 4)],
    occurredAt
  });

  context.branch!.headRevision = "changed-after-creation";
  context.files["file-2"]!.modifiedReviewed.push(interval(14, 15));
  context.files["file-2"]!.originalReviewedByDiff["diff-2"]!.push(interval(2, 3));
  global.files["file-2"]!.reviewed.push(interval(14, 15));

  assert.deepEqual(transaction.expected, {
    contextState: expectedContext,
    globalState: expectedGlobal
  });
  assert.deepEqual(
    transaction.next.contextState.files["file-2"],
    expectedContext.files["file-2"]
  );
  assert.equal(
    transaction.next.contextState.branch!.headRevision,
    expectedContext.branch!.headRevision
  );
  assert.deepEqual(transaction.next.globalState.files["file-2"], expectedGlobal.files["file-2"]);
});

test("a full-snapshot compare-and-replace committer rejects a stale same-timestamp transaction", async () => {
  const context = contextState();
  const global = globalState();
  const first = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: target(),
    intervals: [interval(7, 9)],
    occurredAt
  });
  const second = unmarkReviewedRanges({
    contextState: context,
    globalState: global,
    target: target(),
    intervals: [interval(2, 3)],
    occurredAt
  });
  let persisted: {
    contextState: DeepReadonly<ReviewContextState>;
    globalState: DeepReadonly<RepositoryGlobalState>;
  } = { contextState: structuredClone(context), globalState: structuredClone(global) };
  const committer: ReviewStateTransactionCommitter = {
    commit: async (candidate) => {
      assert.deepEqual(candidate.expected, persisted, "full expected snapshot must match");
      persisted = structuredClone(candidate.next);
    }
  };

  await commitReviewStateTransaction(first, committer);
  await assert.rejects(
    commitReviewStateTransaction(second, committer),
    /full expected snapshot must match/
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

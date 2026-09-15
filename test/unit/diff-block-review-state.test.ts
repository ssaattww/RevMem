import assert from "node:assert/strict";
import test from "node:test";

import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewHistoryEvent,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState,
  type ReviewHistoryEvent,
} from "../../src/core/contracts/index";
import {
  commitReviewStateTransaction,
  hasReviewStateSemanticChange,
  markDiffBlockReviewed,
  unmarkDiffBlockReviewed,
  type DiffBlockReviewRangeMutationInput,
  type ReviewStateTransaction,
} from "../../src/core/review-state/index";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive,
});

const diffId = "base-revision..head-revision";
const occurredAt = "2026-09-15T12:00:00.000Z";
const block = interval(1, 3);

type ComponentState = "unreviewed" | "partial" | "reviewed";
const componentStates: readonly ComponentState[] = ["unreviewed", "partial", "reviewed"];
const rangesFor = (state: ComponentState): LineInterval[] => {
  if (state === "unreviewed") return [];
  if (state === "partial") return [interval(1, 2)];
  return [block];
};

const contextState = (
  modifiedReviewed: readonly LineInterval[],
  originalReviewed: readonly LineInterval[] | undefined,
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "context-1",
  kind: "pull-request",
  repositoryId: "repository-1",
  displayName: "PR",
  pullRequest: {
    host: "github.com",
    owner: "owner",
    repository: "repository",
    number: 1,
    state: "open",
    baseSha: "base-revision",
    headSha: "head-revision",
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "head-revision",
      modifiedReviewed: modifiedReviewed.map((range) => ({ ...range })),
      originalReviewedByDiff: originalReviewed === undefined
        ? {}
        : { [diffId]: originalReviewed.map((range) => ({ ...range })) },
      contentHash: "hash",
      lineCount: 4,
      updatedAt: "2026-09-15T11:00:00.000Z",
    },
  },
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T11:00:00.000Z",
});

const globalState = (
  reviewed: readonly LineInterval[] | undefined,
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "head-revision",
  files: reviewed === undefined ? {} : {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "head-revision",
      reviewed: reviewed.map((range) => ({ ...range })),
      contentHash: "hash",
      updatedAt: "2026-09-15T11:00:00.000Z",
    },
  },
  updatedAt: "2026-09-15T11:00:00.000Z",
});
const inputFor = (options: {
  readonly original?: ComponentState;
  readonly modified?: ComponentState;
  readonly global?: ComponentState;
  readonly invokedFrom: "original" | "modified";
  readonly originalIntervals: readonly LineInterval[];
  readonly modifiedIntervals: readonly LineInterval[];
}): DiffBlockReviewRangeMutationInput => ({
  contextState: contextState(
    options.modified === undefined ? [] : rangesFor(options.modified),
    options.original === undefined ? undefined : rangesFor(options.original),
  ),
  globalState: globalState(options.global === undefined ? undefined : rangesFor(options.global)),
  target: {
    fileId: "file-1",
    currentPath: "src/example.ts",
    revisionId: "head-revision",
    lineCount: 4,
    contentHash: "hash",
  },
  diffId,
  originalLineCount: 4,
  invokedFrom: options.invokedFrom,
  originalIntervals: options.originalIntervals,
  modifiedIntervals: options.modifiedIntervals,
  occurredAt,
});

const eventsFor = async (transaction: ReviewStateTransaction): Promise<ReviewHistoryEvent[]> => {
  const events: ReviewHistoryEvent[] = [];
  let id = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session-1",
    createEventId: () => `event-${++id}`,
    appender: { append: async (_target, event) => { events.push(event); } },
  });
  await recorder.recordTransaction(transaction, "user-selection");
  return events;
};
const expectedStateAfter = (state: ComponentState, operation: "mark" | "unmark"): ComponentState =>
  operation === "mark" ? "reviewed" : "unreviewed";

const changedBy = (state: ComponentState, operation: "mark" | "unmark"): boolean =>
  state !== expectedStateAfter(state, operation);

const applyBlock = (
  operation: "mark" | "unmark",
  input: DiffBlockReviewRangeMutationInput,
): ReviewStateTransaction => operation === "mark"
  ? markDiffBlockReviewed(input)
  : unmarkDiffBlockReviewed(input);

const contextFile = (transaction: ReviewStateTransaction) =>
  transaction.next.contextState.files["file-1"]!;

const globalFile = (transaction: ReviewStateTransaction) =>
  transaction.next.globalState.files["file-1"];

test("replacement block state product drives one atomic change and ordered history", async () => {
  let caseCount = 0;
  for (const original of componentStates) {
    for (const modified of componentStates) {
      for (const global of componentStates) {
        for (const operation of ["mark", "unmark"] as const) {
          for (const invokedFrom of ["original", "modified"] as const) {
            const transaction = applyBlock(operation, inputFor({
              original,
              modified,
              global,
              invokedFrom,
              originalIntervals: [block],
              modifiedIntervals: [block],
            }));
            caseCount += 1;
            assert.equal(transaction.operation, operation === "mark" ? "mark-diff-block-reviewed" : "unmark-diff-block-reviewed");
            assert.equal(transaction.invokedFrom, invokedFrom);
            assert.deepEqual(contextFile(transaction).originalReviewedByDiff[diffId] ?? [], rangesFor(expectedStateAfter(original, operation)));
            assert.deepEqual(contextFile(transaction).modifiedReviewed, rangesFor(expectedStateAfter(modified, operation)));
            assert.deepEqual(globalFile(transaction)?.reviewed ?? [], rangesFor(expectedStateAfter(global, operation)));

            const originalChanged = changedBy(original, operation);
            const modifiedChanged = changedBy(modified, operation);
            const globalChanged = changedBy(global, operation);
            assert.equal(hasReviewStateSemanticChange(transaction), originalChanged || modifiedChanged || globalChanged);

            const events = await eventsFor(transaction);
            assert.deepEqual(
              events.map((event) => (event as FileReviewHistoryEvent).diffSide),
              [
                ...(modifiedChanged || globalChanged ? ["modified" as const] : []),
                ...(originalChanged ? ["original" as const] : []),
              ],
            );
          }
        }
      }
    }
  }
  assert.equal(caseCount, 108);
});

test("addition-only block covers the modified Context and Global state product without creating original state", async () => {
  let caseCount = 0;
  for (const modified of componentStates) {
    for (const global of componentStates) {
      for (const operation of ["mark", "unmark"] as const) {
        const transaction = applyBlock(operation, inputFor({
          modified,
          global,
          invokedFrom: "modified",
          originalIntervals: [],
          modifiedIntervals: [block],
        }));
        caseCount += 1;
        assert.equal(Object.hasOwn(contextFile(transaction).originalReviewedByDiff, diffId), false);
        assert.deepEqual(contextFile(transaction).modifiedReviewed, rangesFor(expectedStateAfter(modified, operation)));
        assert.deepEqual(globalFile(transaction)?.reviewed ?? [], rangesFor(expectedStateAfter(global, operation)));
        const changed = changedBy(modified, operation) || changedBy(global, operation);
        assert.equal(hasReviewStateSemanticChange(transaction), changed);
        const events = await eventsFor(transaction);
        assert.deepEqual(events.map((event) => (event as FileReviewHistoryEvent).diffSide), changed ? ["modified"] : []);
      }
    }
  }
  assert.equal(caseCount, 18);
});

test("deletion-only block covers the original state product without creating modified Global state", async () => {
  let caseCount = 0;
  for (const original of componentStates) {
    for (const operation of ["mark", "unmark"] as const) {
      const transaction = applyBlock(operation, inputFor({
        original,
        invokedFrom: "original",
        originalIntervals: [block],
        modifiedIntervals: [],
      }));
      caseCount += 1;
      assert.deepEqual(contextFile(transaction).originalReviewedByDiff[diffId] ?? [], rangesFor(expectedStateAfter(original, operation)));
      assert.deepEqual(contextFile(transaction).modifiedReviewed, []);
      assert.equal(globalFile(transaction), undefined);
      assert.equal(hasReviewStateSemanticChange(transaction), changedBy(original, operation));
      const events = await eventsFor(transaction);
      assert.deepEqual(events.map((event) => (event as FileReviewHistoryEvent).diffSide), changedBy(original, operation) ? ["original"] : []);
    }
  }
  assert.equal(caseCount, 6);
});
test("Global-only change records one modified event with both Context and Global evidence", async () => {
  const transaction = markDiffBlockReviewed(inputFor({
    original: "reviewed",
    modified: "reviewed",
    global: "unreviewed",
    invokedFrom: "original",
    originalIntervals: [block],
    modifiedIntervals: [block],
  }));
  const events = await eventsFor(transaction);
  assert.equal(events.length, 1);
  const event = events[0] as FileReviewHistoryEvent;
  assert.equal(event.diffSide, "modified");
  assert.deepEqual(event.previousRanges, [block]);
  assert.deepEqual(event.nextRanges, [block]);
  assert.equal(event.rangeRepresentation, "context-and-global");
  assert.deepEqual(event.globalPreviousRanges, []);
  assert.deepEqual(event.globalNextRanges, [block]);
});

test("original and Global changes record modified before original even when invoked from modified", async () => {
  const transaction = markDiffBlockReviewed(inputFor({
    original: "unreviewed",
    modified: "reviewed",
    global: "unreviewed",
    invokedFrom: "modified",
    originalIntervals: [block],
    modifiedIntervals: [block],
  }));
  const events = await eventsFor(transaction);
  assert.deepEqual(events.map((event) => (event as FileReviewHistoryEvent).diffSide), ["modified", "original"]);
  assert.equal((events[1] as FileReviewHistoryEvent).diffId, diffId);
});

test("one-line block has only unreviewed and reviewed outcomes and preserves ranges outside the block", () => {
  const oneLine = interval(1, 2);
  const base = inputFor({
    original: "unreviewed",
    modified: "unreviewed",
    global: "unreviewed",
    invokedFrom: "modified",
    originalIntervals: [oneLine],
    modifiedIntervals: [oneLine],
  });
  const withOutside = {
    ...base,
    contextState: contextState([interval(0, 1)], [interval(0, 1)]),
    globalState: globalState([interval(0, 1)]),
  };
  const marked = markDiffBlockReviewed(withOutside);
  assert.deepEqual(contextFile(marked).modifiedReviewed, [interval(0, 2)]);
  assert.deepEqual(contextFile(marked).originalReviewedByDiff[diffId], [interval(0, 2)]);
  assert.deepEqual(globalFile(marked)?.reviewed, [interval(0, 2)]);

  const unmarked = unmarkDiffBlockReviewed({
    ...withOutside,
    contextState: marked.next.contextState,
    globalState: marked.next.globalState,
  });
  assert.deepEqual(contextFile(unmarked).modifiedReviewed, [interval(0, 1)]);
  assert.deepEqual(contextFile(unmarked).originalReviewedByDiff[diffId], [interval(0, 1)]);
  assert.deepEqual(globalFile(unmarked)?.reviewed, [interval(0, 1)]);
});

test("timestamp-only differences are no-op while persisted metadata differences remain semantic", () => {
  const transaction = markDiffBlockReviewed(inputFor({
    original: "reviewed",
    modified: "reviewed",
    global: "reviewed",
    invokedFrom: "original",
    originalIntervals: [block],
    modifiedIntervals: [block],
  }));
  assert.equal(hasReviewStateSemanticChange(transaction), false);

  const changedPath: ReviewStateTransaction = {
    ...transaction,
    next: {
      ...transaction.next,
      contextState: {
        ...transaction.next.contextState,
        files: {
          ...transaction.next.contextState.files,
          "file-1": { ...contextFile(transaction), currentPath: "src/renamed.ts" },
        },
      },
    },
  };
  assert.equal(hasReviewStateSemanticChange(changedPath), true);
});
test("failed persistence leaves no history event", async () => {
  const transaction = markDiffBlockReviewed(inputFor({
    original: "unreviewed",
    modified: "unreviewed",
    global: "unreviewed",
    invokedFrom: "original",
    originalIntervals: [block],
    modifiedIntervals: [block],
  }));
  const events: ReviewHistoryEvent[] = [];
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session-1",
    createEventId: () => "event-1",
    appender: { append: async (_target, event) => { events.push(event); } },
  });

  await assert.rejects(async () => {
    await commitReviewStateTransaction(transaction, {
      commit: async () => { throw new Error("store rejected"); },
    });
    await recorder.recordTransaction(transaction, "user-selection");
  }, /store rejected/);
  assert.deepEqual(events, []);
});

test("empty block targets do not create missing side state", async () => {
  const transaction = markDiffBlockReviewed(inputFor({
    invokedFrom: "modified",
    originalIntervals: [],
    modifiedIntervals: [],
  }));
  assert.equal(hasReviewStateSemanticChange(transaction), false);
  assert.equal(Object.hasOwn(contextFile(transaction).originalReviewedByDiff, diffId), false);
  assert.equal(globalFile(transaction), undefined);
  assert.deepEqual(await eventsFor(transaction), []);
});
test("pull-request block updates the HEAD Global snapshot when the owner current revision differs", async () => {
  const base = inputFor({
    original: "reviewed",
    modified: "reviewed",
    global: "unreviewed",
    invokedFrom: "modified",
    originalIntervals: [block],
    modifiedIntervals: [block],
  });
  const headGlobalFile = base.globalState.files["file-1"]!;
  const ownerGlobal: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "repository-1",
    currentRevisionId: "owner-current",
    files: {},
    revisionSnapshots: {
      "head-revision": {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        revisionId: "head-revision",
        files: { "file-1": { ...headGlobalFile, reviewed: [] } },
        updatedAt: "2026-09-15T11:00:00.000Z",
      },
    },
    updatedAt: "2026-09-15T11:00:00.000Z",
  };
  const transaction = markDiffBlockReviewed({ ...base, globalState: ownerGlobal });
  assert.equal(transaction.next.globalState.currentRevisionId, "owner-current");
  assert.deepEqual(
    transaction.next.globalState.revisionSnapshots?.["head-revision"]?.files["file-1"]?.reviewed,
    [block],
  );
  assert.equal(hasReviewStateSemanticChange(transaction), true);
  const events = await eventsFor(transaction);
  assert.deepEqual(events.map((event) => (event as FileReviewHistoryEvent).diffSide), ["modified"]);
  assert.deepEqual((events[0] as FileReviewHistoryEvent).globalPreviousRanges, []);
  assert.deepEqual((events[0] as FileReviewHistoryEvent).globalNextRanges, [block]);
});
test("original-only block does not create a missing HEAD Global snapshot", () => {
  const base = inputFor({
    original: "unreviewed",
    invokedFrom: "original",
    originalIntervals: [block],
    modifiedIntervals: [],
  });
  const ownerGlobal: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "repository-1",
    currentRevisionId: "owner-current",
    files: {},
    updatedAt: "2026-09-15T11:00:00.000Z",
  };
  const transaction = markDiffBlockReviewed({ ...base, globalState: ownerGlobal });
  assert.deepEqual(transaction.next.globalState, ownerGlobal);
  assert.equal(transaction.next.globalState.revisionSnapshots, undefined);
  assert.equal(hasReviewStateSemanticChange(transaction), true);
});
test("Global-only unmark records history when Context has no file entry", async () => {
  const base = inputFor({
    invokedFrom: "modified",
    originalIntervals: [],
    modifiedIntervals: [block],
  });
  const transaction = unmarkDiffBlockReviewed({
    ...base,
    contextState: { ...base.contextState, files: {} },
    globalState: globalState([block]),
  });
  assert.equal(transaction.next.contextState.files["file-1"], undefined);
  assert.deepEqual(transaction.next.globalState.files["file-1"]?.reviewed, []);
  assert.equal(hasReviewStateSemanticChange(transaction), true);
  const events = await eventsFor(transaction);
  assert.equal(events.length, 1);
  const event = events[0] as FileReviewHistoryEvent;
  assert.equal(event.diffSide, "modified");
  assert.equal(event.filePath, "src/example.ts");
  assert.equal(event.occurredAt, occurredAt);
  assert.deepEqual(event.previousRanges, []);
  assert.deepEqual(event.nextRanges, []);
  assert.deepEqual(event.globalPreviousRanges, [block]);
  assert.deepEqual(event.globalNextRanges, []);
});

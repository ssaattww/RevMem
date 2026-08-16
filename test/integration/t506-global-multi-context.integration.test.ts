import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "../../src/adapters/state-repository/index";
import {
  mapRepositoryGlobalStateThroughDocumentChanges
} from "../../src/application/global-review-mapping/index";
import {
  RepositoryGlobalStateRepository
} from "../../src/application/repository-global-state/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import {
  calculateRepositoryGlobalUnderstandingProgress
} from "../../src/core/global-understanding/index";
import {
  calculatePullRequestDiffProgress,
  type PullRequestDiffSnapshot
} from "../../src/core/pr-progress/index";

const REPOSITORY_ID = "github.com/ssaattww/revmem-t506-fixture";
const HEAD_REVISION = "head-revision";
const FILE_ID = "file-1";
const FILE_PATH = "src/example.ts";
const CONTENT_HASH = "head-hash";
const INITIAL_TIME = "2026-08-16T05:50:00.000Z";

const interval = (startLine: number, endLineExclusive: number) => ({
  startLine,
  endLineExclusive
});

const createStorage = async (): Promise<{
  readonly root: string;
  readonly storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t506-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

const createTarget = (contextId: string): ReviewStateRepositoryTarget => ({
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  contextId
});

const createContext = (
  contextId: string,
  baseSha: string,
  number: number
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${number}`,
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem-t506-fixture",
    number,
    state: "open",
    baseSha,
    headSha: HEAD_REVISION
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: FILE_PATH,
      previousPaths: [],
      revisionId: HEAD_REVISION,
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      contentHash: CONTENT_HASH,
      lineCount: 4,
      updatedAt: INITIAL_TIME
    }
  },
  createdAt: INITIAL_TIME,
  updatedAt: INITIAL_TIME
});

const createEmptyGlobal = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: HEAD_REVISION,
  files: {},
  updatedAt: INITIAL_TIME
});

const createCommit = (
  contextId: string,
  baseSha: string,
  number: number
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: createContext(contextId, baseSha, number),
  globalState: createEmptyGlobal()
});

const targetFile = {
  fileId: FILE_ID,
  currentPath: FILE_PATH,
  revisionId: HEAD_REVISION,
  lineCount: 4,
  contentHash: CONTENT_HASH
} as const;

const understandingFor = (globalState: RepositoryGlobalState) =>
  calculateRepositoryGlobalUnderstandingProgress({
    repositoryId: REPOSITORY_ID,
    currentRevisionId: globalState.currentRevisionId,
    globalState,
    files: [{
      path: FILE_PATH,
      revisionId: globalState.currentRevisionId,
      lineCount: 4,
      nonEmptyLines: [0, 1, 2, 3],
      contentHash: CONTENT_HASH
    }]
  });

const contextBDiff = (): PullRequestDiffSnapshot => ({
  contextId: "context-b",
  baseSha: "base-b",
  headSha: HEAD_REVISION,
  originalDiffId: `base-b..${HEAD_REVISION}`,
  files: [{
    fileId: FILE_ID,
    oldPath: FILE_PATH,
    newPath: FILE_PATH,
    status: "modified",
    additions: 1,
    deletions: 0,
    hunks: [{
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      lines: [{ kind: "addition", newLine: 1, text: "changed" }]
    }]
  }]
});

test("T506 shares Global across contexts, isolates PR progress, survives restart, and maps edits", async () => {
  const storage = await createStorage();
  const contextATarget = createTarget("context-a");
  const contextBTarget = createTarget("context-b");
  const operations = new RepositoryGlobalStateRepository({
    requestHistory: async () => undefined
  });

  try {
    const persistence = new FileSystemReviewStateRepository({
      storageUris: storage.storageUris
    });
    await persistence.save(
      contextATarget,
      createCommit("context-a", "base-a", 101)
    );
    const initialA = await persistence.load(contextATarget);
    assert.ok(initialA);

    const markedA = await operations.apply({
      operation: "mark-file-reviewed",
      contextState: initialA.contextState,
      globalState: initialA.globalState,
      target: targetFile,
      occurredAt: "2026-08-16T05:51:00.000Z",
      committer: persistence
    });
    assert.equal(markedA.status, "applied");
    if (markedA.status !== "applied") throw new Error("context A mark must apply");
    assert.deepEqual(
      markedA.transaction.next.contextState.files[FILE_ID]?.modifiedReviewed,
      [interval(0, 4)]
    );
    assert.deepEqual(
      markedA.transaction.next.globalState.files[FILE_ID]?.reviewed,
      [interval(0, 4)]
    );

    const beforeRestart = understandingFor(markedA.transaction.next.globalState);
    assert.equal(beforeRestart.progress, 1);

    const restarted = new FileSystemReviewStateRepository({
      storageUris: storage.storageUris
    });
    const restoredA = await restarted.load(contextATarget);
    assert.ok(restoredA);
    assert.deepEqual(
      understandingFor(restoredA.globalState),
      beforeRestart,
      "A new repository instance must restore the same Global understanding result."
    );

    await restarted.save(
      contextBTarget,
      createCommit("context-b", "base-b", 102)
    );
    const restoredB = await restarted.load(contextBTarget);
    assert.ok(restoredB);
    assert.deepEqual(
      restoredB.contextState.files[FILE_ID]?.modifiedReviewed,
      [],
      "A newly created context must not inherit another context's reviewed ranges."
    );
    assert.deepEqual(
      restoredB.globalState.files[FILE_ID]?.reviewed,
      [interval(0, 4)],
      "A newly created context at the same owner revision must inherit owner-wide Global state."
    );

    const prProgress = calculatePullRequestDiffProgress({
      diff: contextBDiff(),
      reviewContext: restoredB.contextState,
      exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
    });
    assert.equal(prProgress.reviewedLineCount, 0);
    assert.equal(prProgress.totalLineCount, 1);
    assert.equal(
      prProgress.progress,
      0,
      "Global reviewed ranges must not be counted as current PR progress."
    );

    const unmarkedFromB = await operations.apply({
      operation: "unmark-ranges-reviewed",
      contextState: restoredB.contextState,
      globalState: restoredB.globalState,
      target: targetFile,
      intervals: [interval(1, 3)],
      occurredAt: "2026-08-16T05:52:00.000Z",
      committer: restarted
    });
    assert.equal(unmarkedFromB.status, "applied");
    if (unmarkedFromB.status !== "applied") throw new Error("context B unmark must apply");
    assert.deepEqual(
      unmarkedFromB.transaction.next.contextState.files[FILE_ID]?.modifiedReviewed,
      [],
      "Global-only unmark must not invent context-local reviewed state."
    );
    assert.deepEqual(
      unmarkedFromB.transaction.next.globalState.files[FILE_ID]?.reviewed,
      [interval(0, 1), interval(3, 4)]
    );

    const secondRestart = new FileSystemReviewStateRepository({
      storageUris: storage.storageUris
    });
    const restoredAAfterB = await secondRestart.load(contextATarget);
    assert.ok(restoredAAfterB);
    assert.deepEqual(
      restoredAAfterB.contextState.files[FILE_ID]?.modifiedReviewed,
      [interval(0, 4)],
      "Context A review state must remain context-local after context B changes Global."
    );
    assert.deepEqual(
      restoredAAfterB.globalState.files[FILE_ID]?.reviewed,
      [interval(0, 1), interval(3, 4)],
      "Context A reload must observe the owner-wide Global change made from context B."
    );

    const mapped = mapRepositoryGlobalStateThroughDocumentChanges({
      globalState: restoredAAfterB.globalState,
      fileId: FILE_ID,
      beforeText: "a\nb\nc\nd",
      changes: [{
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 }
        },
        rangeOffset: 2,
        rangeLength: 2,
        text: "changed\ninserted\n"
      }],
      newRevisionId: "new-revision",
      newContentHash: "new-hash",
      updatedAt: "2026-08-16T05:53:00.000Z",
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    });
    assert.deepEqual(
      mapped.files[FILE_ID]?.reviewed,
      [interval(0, 1), interval(4, 5)],
      "Changed and inserted lines must become unreviewed while unchanged reviewed suffixes shift."
    );

    const mappedUnderstanding = calculateRepositoryGlobalUnderstandingProgress({
      repositoryId: REPOSITORY_ID,
      currentRevisionId: "new-revision",
      globalState: mapped,
      files: [{
        path: FILE_PATH,
        revisionId: "new-revision",
        lineCount: 5,
        nonEmptyLines: [0, 1, 2, 3, 4],
        contentHash: "new-hash"
      }]
    });
    assert.equal(mappedUnderstanding.reviewedNonEmptyLineCount, 2);
    assert.equal(mappedUnderstanding.totalNonEmptyLineCount, 5);
    assert.equal(mappedUnderstanding.progress, 0.4);
  } finally {
    await rm(storage.root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { createNormalEditorDecorationModel } from "../../src/application/editor-decoration/index";
import {
  mapRepositoryGlobalStateThroughDocumentChanges,
  mapRepositoryGlobalStateThroughGitDiff
} from "../../src/application/global-review-mapping/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";

const UPDATED_AT = "2026-08-02T11:00:00.000Z";

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "old-revision",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "old-revision",
      reviewed: [{ startLine: 0, endLineExclusive: 4 }],
      contentHash: "old-hash",
      updatedAt: UPDATED_AT
    }
  },
  updatedAt: UPDATED_AT
});

const addUnchangedGlobalFile = (state: RepositoryGlobalState): void => {
  state.files["file-2"] = {
    fileId: "file-2",
    currentPath: "src/unchanged.ts",
    revisionId: "old-revision",
    reviewed: [{ startLine: 0, endLineExclusive: 2 }],
    contentHash: "unchanged-hash",
    updatedAt: UPDATED_AT
  };
};

test("document edits map Global reviewed ranges and invalidate changed lines", () => {
  const state = globalState();
  addUnchangedGlobalFile(state);
  const result = mapRepositoryGlobalStateThroughDocumentChanges({
    globalState: state,
    fileId: "file-1",
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
    updatedAt: "2026-08-02T11:01:00.000Z",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  assert.equal(result.currentRevisionId, "new-revision");
  assert.deepEqual(result.files["file-1"]?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 3, endLineExclusive: 5 }
  ]);
  assert.equal(result.files["file-1"]?.contentHash, "new-hash");
  assert.equal(result.files["file-2"]?.revisionId, "new-revision");
  assert.deepEqual(result.files["file-2"]?.reviewed, [
    { startLine: 0, endLineExclusive: 2 }
  ]);
});

test("ordinary modified Git files use interval mapping and advance every retained file revision", () => {
  const state = globalState();
  addUnchangedGlobalFile(state);
  const result = mapRepositoryGlobalStateThroughGitDiff({
    globalState: state,
    diff: [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -2 +2 @@",
      "-b",
      "+changed",
      ""
    ].join("\n"),
    newRevisionId: "new-revision",
    updatedAt: "2026-08-02T11:01:30.000Z",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    },
    oldLineCounts: {
      "file-1": 4,
      "file-2": 2
    },
    newFiles: {
      "src/example.ts": {
        fileId: "file-1",
        lineCount: 4,
        contentHash: "new-hash"
      }
    }
  });

  assert.deepEqual(result.files["file-1"]?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
  assert.equal(result.files["file-1"]?.revisionId, "new-revision");
  assert.equal(result.files["file-1"]?.contentHash, "new-hash");
  assert.equal(result.files["file-2"]?.revisionId, "new-revision");
  assert.deepEqual(result.files["file-2"]?.reviewed, [
    { startLine: 0, endLineExclusive: 2 }
  ]);
});

test("Git rename keeps the stable Global file ID and maps unchanged ranges", () => {
  const result = mapRepositoryGlobalStateThroughGitDiff({
    globalState: globalState(),
    diff: [
      "diff --git a/src/example.ts b/src/renamed.ts",
      "similarity index 100%",
      "rename from src/example.ts",
      "rename to src/renamed.ts",
      ""
    ].join("\n"),
    newRevisionId: "new-revision",
    updatedAt: "2026-08-02T11:02:00.000Z",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    },
    newFiles: {
      "src/renamed.ts": {
        fileId: "file-1",
        lineCount: 4,
        contentHash: "old-hash"
      }
    }
  });

  assert.equal(result.currentRevisionId, "new-revision");
  assert.equal(result.files["file-1"]?.currentPath, "src/renamed.ts");
  assert.equal(result.files["file-1"]?.revisionId, "new-revision");
  assert.deepEqual(result.files["file-1"]?.reviewed, [
    { startLine: 0, endLineExclusive: 4 }
  ]);
});

const pullRequestContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "pr-context",
  kind: "pull-request",
  repositoryId: "repository-1",
  displayName: "PR #50",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 50,
    state: "open",
    baseSha: "base-revision",
    headSha: "new-revision"
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "new-revision",
      modifiedReviewed: [{ startLine: 1, endLineExclusive: 2 }],
      originalReviewedByDiff: {},
      contentHash: "new-hash",
      lineCount: 4,
      updatedAt: UPDATED_AT
    }
  },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT
});

const currentDiff = (): PullRequestDiffSnapshot => ({
  contextId: "pr-context",
  baseSha: "base-revision",
  headSha: "new-revision",
  originalDiffId: "base-revision..new-revision",
  files: [{
    fileId: "file-1",
    oldPath: "src/example.ts",
    newPath: "src/example.ts",
    status: "modified",
    additions: 2,
    deletions: 0,
    hunks: [{
      oldStart: 1,
      oldCount: 0,
      newStart: 1,
      newCount: 2,
      lines: [
        { kind: "addition", newLine: 1, text: "changed" },
        { kind: "addition", newLine: 2, text: "reviewed change" }
      ]
    }]
  }]
});

const currentGlobalState = (): RepositoryGlobalState => {
  const global = globalState();
  global.currentRevisionId = "new-revision";
  global.files["file-1"]!.revisionId = "new-revision";
  global.files["file-1"]!.contentHash = "new-hash";
  return global;
};

test("current PR unreviewed changed lines suppress Global and other-context decoration", () => {
  const otherContext = pullRequestContext();
  otherContext.contextId = "other-context";
  otherContext.files["file-1"]!.modifiedReviewed = [
    { startLine: 0, endLineExclusive: 4 }
  ];

  const model = createNormalEditorDecorationModel({
    contextState: pullRequestContext(),
    otherContextStates: [otherContext],
    currentPullRequestDiff: currentDiff(),
    globalState: currentGlobalState(),
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "new-revision",
      lineCount: 4,
      contentHash: "new-hash"
    },
    showGlobalReviewed: true
  });

  assert.deepEqual(model.map(({ interval, source }) => ({ interval, source })), [
    {
      interval: { startLine: 1, endLineExclusive: 2 },
      source: "context"
    },
    {
      interval: { startLine: 2, endLineExclusive: 4 },
      source: "other-context"
    }
  ]);
});

test("missing or stale current PR diff fails closed for lower-priority layers", () => {
  const otherContext = pullRequestContext();
  otherContext.contextId = "other-context";
  otherContext.files["file-1"]!.modifiedReviewed = [
    { startLine: 0, endLineExclusive: 4 }
  ];

  for (const diff of [undefined, { ...currentDiff(), headSha: "stale-head" }]) {
    const model = createNormalEditorDecorationModel({
      contextState: pullRequestContext(),
      otherContextStates: [otherContext],
      ...(diff === undefined ? {} : { currentPullRequestDiff: diff }),
      globalState: currentGlobalState(),
      target: {
        fileId: "file-1",
        currentPath: "src/example.ts",
        revisionId: "new-revision",
        lineCount: 4,
        contentHash: "new-hash"
      },
      showGlobalReviewed: true
    });

    assert.deepEqual(model.map(({ interval, source }) => ({ interval, source })), [
      {
        interval: { startLine: 1, endLineExclusive: 2 },
        source: "context"
      }
    ]);
  }
});

test("other-context intervals split where Global activity changes", () => {
  const current = pullRequestContext();
  current.files["file-1"]!.modifiedReviewed = [];
  const otherContext = pullRequestContext();
  otherContext.contextId = "other-context";
  otherContext.files["file-1"]!.modifiedReviewed = [
    { startLine: 0, endLineExclusive: 4 }
  ];
  const global = currentGlobalState();
  global.files["file-1"]!.reviewed = [
    { startLine: 1, endLineExclusive: 3 }
  ];
  const diff = currentDiff();
  diff.files = [];

  const model = createNormalEditorDecorationModel({
    contextState: current,
    otherContextStates: [otherContext],
    currentPullRequestDiff: diff,
    globalState: global,
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "new-revision",
      lineCount: 4,
      contentHash: "new-hash"
    },
    showGlobalReviewed: true
  });

  assert.deepEqual(model.map(({ interval, source, globalActive }) => ({
    interval,
    source,
    globalActive
  })), [
    {
      interval: { startLine: 0, endLineExclusive: 1 },
      source: "other-context",
      globalActive: false
    },
    {
      interval: { startLine: 1, endLineExclusive: 3 },
      source: "other-context",
      globalActive: true
    },
    {
      interval: { startLine: 3, endLineExclusive: 4 },
      source: "other-context",
      globalActive: false
    }
  ]);
});

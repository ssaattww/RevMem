import assert from "node:assert/strict";
import test from "node:test";

import {
  createNormalEditorDecorationModel
} from "../../src/application/editor-decoration/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import type { ReviewStateFileTarget } from "../../src/core/review-state/index";

const CONTEXT_UPDATED_AT = "2026-07-23T09:30:00.000Z";
const GLOBAL_UPDATED_AT = "2026-07-23T09:25:00.000Z";

const createFixture = (): {
  contextState: ReviewContextState;
  globalState: RepositoryGlobalState;
  target: ReviewStateFileTarget;
} => ({
  contextState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: "context-1",
    kind: "workspace",
    repositoryId: "repository-1",
    displayName: "Workspace review",
    workspace: {
      workspaceId: "workspace-1",
      snapshotRevision: "revision-1"
    },
    files: {
      "file-1": {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: "file-1",
        currentPath: "src/example.ts",
        previousPaths: [],
        revisionId: "revision-1",
        modifiedReviewed: [
          { startLine: 1, endLineExclusive: 3 }
        ],
        originalReviewedByDiff: {},
        contentHash: "hash-1",
        lineCount: 6,
        updatedAt: CONTEXT_UPDATED_AT
      }
    },
    createdAt: "2026-07-23T09:00:00.000Z",
    updatedAt: CONTEXT_UPDATED_AT
  },
  globalState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "repository-1",
    currentRevisionId: "revision-1",
    files: {
      "file-1": {
        fileId: "file-1",
        currentPath: "src/example.ts",
        revisionId: "revision-1",
        reviewed: [
          { startLine: 0, endLineExclusive: 5 }
        ],
        contentHash: "hash-1",
        updatedAt: GLOBAL_UPDATED_AT
      }
    },
    updatedAt: GLOBAL_UPDATED_AT
  },
  target: {
    fileId: "file-1",
    currentPath: "src/example.ts",
    revisionId: "revision-1",
    lineCount: 6,
    contentHash: "hash-1"
  }
});

test("decoration model gives the current context priority over Global ranges", () => {
  const fixture = createFixture();

  const model = createNormalEditorDecorationModel({
    ...fixture,
    showGlobalReviewed: true
  });

  assert.deepEqual(model, [
    {
      interval: { startLine: 0, endLineExclusive: 1 },
      source: "global",
      contextLabel: "Global",
      reviewedAt: GLOBAL_UPDATED_AT,
      globalActive: true
    },
    {
      interval: { startLine: 1, endLineExclusive: 3 },
      source: "context",
      contextLabel: "Workspace review",
      reviewedAt: CONTEXT_UPDATED_AT,
      globalActive: true
    },
    {
      interval: { startLine: 3, endLineExclusive: 5 },
      source: "global",
      contextLabel: "Global",
      reviewedAt: GLOBAL_UPDATED_AT,
      globalActive: true
    }
  ]);
});

test("decoration model can hide Global-only ranges without hiding context ranges", () => {
  const fixture = createFixture();

  const model = createNormalEditorDecorationModel({
    ...fixture,
    showGlobalReviewed: false
  });

  assert.deepEqual(model, [
    {
      interval: { startLine: 1, endLineExclusive: 3 },
      source: "context",
      contextLabel: "Workspace review",
      reviewedAt: CONTEXT_UPDATED_AT,
      globalActive: false
    }
  ]);
});

test("decoration model refuses uncertain context state and falls back to valid Global state", () => {
  const fixture = createFixture();
  fixture.contextState.files["file-1"]!.contentHash = "stale-hash";

  const model = createNormalEditorDecorationModel({
    ...fixture,
    showGlobalReviewed: true
  });

  assert.deepEqual(model, [
    {
      interval: { startLine: 0, endLineExclusive: 5 },
      source: "global",
      contextLabel: "Global",
      reviewedAt: GLOBAL_UPDATED_AT,
      globalActive: true
    }
  ]);
});

test("decoration model returns normal background when no certain reviewed range exists", () => {
  const fixture = createFixture();
  fixture.contextState.files["file-1"]!.revisionId = "stale-revision";
  fixture.globalState.files["file-1"]!.currentPath = "src/old-example.ts";

  const model = createNormalEditorDecorationModel({
    ...fixture,
    showGlobalReviewed: true
  });

  assert.deepEqual(model, []);
});

test("decoration model labels pull-request and branch contexts for hover", () => {
  const pullRequestFixture = createFixture();
  pullRequestFixture.contextState.kind = "pull-request";
  pullRequestFixture.contextState.workspace = undefined;
  pullRequestFixture.contextState.pullRequest = {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 106,
    state: "open",
    title: "Decoration",
    baseSha: "base",
    headSha: "revision-1"
  };

  const pullRequestModel = createNormalEditorDecorationModel({
    ...pullRequestFixture,
    showGlobalReviewed: false
  });
  assert.equal(pullRequestModel[0]?.contextLabel, "PR #106: Decoration");

  const branchFixture = createFixture();
  branchFixture.contextState.kind = "branch";
  branchFixture.contextState.workspace = undefined;
  branchFixture.contextState.branch = {
    refName: "refs/heads/task/t106",
    headRevision: "revision-1"
  };

  const branchModel = createNormalEditorDecorationModel({
    ...branchFixture,
    showGlobalReviewed: false
  });
  assert.equal(branchModel[0]?.contextLabel, "refs/heads/task/t106");
});

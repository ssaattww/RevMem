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

const contextState: ReviewContextState = {
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
      modifiedReviewed: [{ startLine: 1, endLineExclusive: 5 }],
      originalReviewedByDiff: {},
      contentHash: "hash-1",
      lineCount: 6,
      updatedAt: "2026-07-23T09:30:00.000Z"
    }
  },
  createdAt: "2026-07-23T09:00:00.000Z",
  updatedAt: "2026-07-23T09:30:00.000Z"
};

const globalState: RepositoryGlobalState = {
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: "revision-1",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-1",
      reviewed: [{ startLine: 3, endLineExclusive: 6 }],
      contentHash: "hash-1",
      updatedAt: "2026-07-23T09:25:00.000Z"
    }
  },
  updatedAt: "2026-07-23T09:25:00.000Z"
};

test("decoration model splits context ranges when Global is active only on part", () => {
  const model = createNormalEditorDecorationModel({
    contextState,
    globalState,
    target: {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "revision-1",
      lineCount: 6,
      contentHash: "hash-1"
    },
    showGlobalReviewed: true
  });

  assert.deepEqual(model, [
    {
      interval: { startLine: 1, endLineExclusive: 3 },
      source: "context",
      contextLabel: "Workspace review",
      reviewedAt: "2026-07-23T09:30:00.000Z",
      globalActive: false
    },
    {
      interval: { startLine: 3, endLineExclusive: 5 },
      source: "context",
      contextLabel: "Workspace review",
      reviewedAt: "2026-07-23T09:30:00.000Z",
      globalActive: true
    },
    {
      interval: { startLine: 5, endLineExclusive: 6 },
      source: "global",
      contextLabel: "Global",
      reviewedAt: "2026-07-23T09:25:00.000Z",
      globalActive: true
    }
  ]);
});

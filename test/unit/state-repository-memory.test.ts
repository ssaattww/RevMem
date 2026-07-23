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
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";

const timestamp = "2026-07-23T05:00:00.000Z";

const createContextState = (
  repositoryId: string,
  contextId: string,
  reviewedEndLineExclusive: number
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: contextId,
  branch: {
    refName: `refs/heads/${contextId}`,
    headRevision: "abc123"
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: "abc123",
      modifiedReviewed: [
        {
          startLine: 0,
          endLineExclusive: reviewedEndLineExclusive
        }
      ],
      originalReviewedByDiff: {},
      lineCount: 10,
      updatedAt: timestamp
    }
  },
  createdAt: timestamp,
  updatedAt: timestamp
});

const createGlobalState = (
  repositoryId: string,
  reviewedEndLineExclusive: number
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId: "abc123",
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: "abc123",
      reviewed: [
        {
          startLine: 0,
          endLineExclusive: reviewedEndLineExclusive
        }
      ],
      updatedAt: timestamp
    }
  },
  updatedAt: timestamp
});

const createCommit = (
  target: ReviewStateRepositoryTarget,
  reviewedEndLineExclusive: number
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: createContextState(
    target.repositoryId,
    target.contextId,
    reviewedEndLineExclusive
  ),
  globalState: createGlobalState(
    target.repositoryId,
    reviewedEndLineExclusive
  )
});

test("saving one context refreshes repository-wide Global for every current context", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-state-memory-"));
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(root, "global") },
    storageUri: { fsPath: path.join(root, "workspace") }
  };
  const firstTarget: ReviewStateRepositoryTarget = {
    kind: "git",
    repositoryId: "github.com/example/review-range",
    contextId: "branch:main"
  };
  const secondTarget: ReviewStateRepositoryTarget = {
    kind: "git",
    repositoryId: firstTarget.repositoryId,
    contextId: "branch:feature"
  };

  try {
    const repository = new FileSystemReviewStateRepository({ storageUris });

    await repository.save(firstTarget, createCommit(firstTarget, 2));
    await repository.save(secondTarget, createCommit(secondTarget, 7));

    assert.deepEqual(
      repository.getCurrent(firstTarget)?.contextState,
      createContextState(firstTarget.repositoryId, firstTarget.contextId, 2)
    );
    assert.deepEqual(
      repository.getCurrent(firstTarget)?.globalState,
      createGlobalState(firstTarget.repositoryId, 7)
    );
    assert.deepEqual(
      repository.getCurrent(secondTarget),
      createCommit(secondTarget, 7)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

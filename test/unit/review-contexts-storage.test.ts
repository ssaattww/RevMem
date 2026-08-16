import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

const branchContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "branch:refs/heads/main",
  kind: "branch",
  repositoryId: REPOSITORY_ID,
  displayName: "main",
  branch: { refName: "refs/heads/main", headRevision: SHA_B },
  files: {},
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const pullRequestContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: "github-pr:github.com/ssaattww/revmem#52",
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #52",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "closed",
    title: "Saved PR",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
  files: {},
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: SHA_B,
  files: {},
  updatedAt: "2026-08-16T00:00:00.000Z",
});

test("repository manifest can enumerate every persisted context after restart without deleting or rewriting them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t405-context-list-"));
  const storageUris = { globalStorageUri: { fsPath: root } };
  try {
    const first = new FileSystemReviewStateRepository({ storageUris });
    await first.save(
      { kind: "git", repositoryId: REPOSITORY_ID, contextId: branchContext().contextId },
      { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState: branchContext(), globalState: globalState() },
    );
    await first.save(
      { kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: pullRequestContext().contextId },
      { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState: pullRequestContext(), globalState: globalState() },
    );

    const restarted = new FileSystemReviewStateRepository({ storageUris });
    const contexts = await restarted.listRepositoryContexts(REPOSITORY_ID);

    assert.deepEqual(contexts.map((contextState) => [contextState.kind, contextState.contextId]), [
      ["branch", branchContext().contextId],
      ["pull-request", pullRequestContext().contextId],
    ]);
    assert.deepEqual(
      await restarted.load({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: pullRequestContext().contextId }),
      { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState: pullRequestContext(), globalState: globalState() },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

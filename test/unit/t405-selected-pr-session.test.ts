import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index.js";
import {
  DocumentReviewStateSessionProvider,
  type DocumentReviewStateRepository,
} from "../../src/adapters/document-review-state/index.js";
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index.js";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index.js";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index.js";
import type { SelectedReviewContext } from "../../src/application/review-context/index.js";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../src/core/contracts/index.js";

const B = "b".repeat(40);
const REPOSITORY_ID = "github.com/example/project";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const ROOT = path.resolve("/repo");
const FILE_ID = "file-pr";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class MemoryRepository implements DocumentReviewStateRepository {
  public readonly data = new Map<string, ReviewStateCommit>();
  public readonly saves: ReviewStateRepositoryTarget[] = [];

  public async load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined> {
    const value = this.data.get(key(target));
    return value === undefined ? undefined : clone(value);
  }
  public async save(target: ReviewStateRepositoryTarget, commit: ReviewStateCommit): Promise<void> {
    this.saves.push({ ...target });
    this.data.set(key(target), clone(commit));
  }
  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    const target = { kind: "pull-request" as const, repositoryId: transaction.repositoryId, contextId: transaction.contextId };
    this.data.set(key(target), {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState),
      globalState: clone(transaction.next.globalState),
    });
  }
}

const inspection = (): LocalGitRepositoryInspection => ({
  kind: "repository",
  repository: {
    gitVersion: "2.50.0",
    rootPath: ROOT,
    repositoryId: REPOSITORY_ID,
    remote: {
      name: "origin",
      rawUrl: "https://github.com/example/project.git",
      normalizedUrl: REPOSITORY_ID,
    },
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: B,
  },
});

const persisted = (): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: CONTEXT_ID,
    kind: "pull-request",
    repositoryId: REPOSITORY_ID,
    displayName: "PR #52",
    pullRequest: {
      host: "github.com",
      owner: "example",
      repository: "project",
      number: 52,
      state: "open",
      baseSha: "a".repeat(40),
      headSha: B,
    },
    files: {
      [FILE_ID]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: FILE_ID,
        currentPath: "src/example.ts",
        previousPaths: [],
        revisionId: B,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
        originalReviewedByDiff: {},
        lineCount: 1,
        contentHash: "hash-current",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    },
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  },
  globalState: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: REPOSITORY_ID,
    currentRevisionId: B,
    files: {
      [FILE_ID]: {
        fileId: FILE_ID,
        currentPath: "src/example.ts",
        revisionId: B,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: "hash-current",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    },
    updatedAt: "2026-08-16T00:00:00.000Z",
  },
});

const selection = (overrides: Partial<Extract<SelectedReviewContext, { kind: "pull-request" }>> = {}): Extract<SelectedReviewContext, { kind: "pull-request" }> => ({
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  repositoryRoot: ROOT,
  contextId: CONTEXT_ID,
  pullRequestNumber: 52,
  headRevision: B,
  ...overrides,
});

test("R405-7 selected PR owns normal-editor command and decoration sessions without branch initialization", async () => {
  const repository = new MemoryRepository();
  repository.data.set(key({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: CONTEXT_ID }), persisted());
  const stableHash = new NodeSha256StableHash();
  const workspaceProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
  });
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: { inspectRepository: async () => inspection() },
    repository,
    workspaceProvider,
    stableHash,
  });
  const descriptor = {
    documentUri: { scheme: "file", authority: "", path: "/repo/src/example.ts" },
    documentFsPath: path.resolve("/repo/src/example.ts"),
    fileSystemPathSemantics: "posix" as const,
    lineCount: 1,
    contentHash: "hash-current",
  };

  const writable = await provider.open(descriptor, selection());
  const decoration = await provider.loadForDecoration(descriptor, selection());

  assert.equal(writable.owner, "git");
  assert.equal(writable.contextState.kind, "pull-request");
  assert.equal(writable.contextState.contextId, CONTEXT_ID);
  assert.equal(writable.target.fileId, FILE_ID);
  assert.equal(decoration?.contextState.kind, "pull-request");
  assert.equal(decoration?.contextState.contextId, CONTEXT_ID);
  assert.deepEqual(repository.saves, []);
  provider.dispose();
});

test("selected PR rejects a foreign repository or stale head without creating state", async () => {
  const repository = new MemoryRepository();
  repository.data.set(key({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: CONTEXT_ID }), persisted());
  const stableHash = new NodeSha256StableHash();
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: { inspectRepository: async () => inspection() },
    repository,
    workspaceProvider: new WorkspaceReviewStateSessionProvider({
      identityService: new WorkspaceIdentityService(stableHash),
      repository,
    }),
    stableHash,
  });
  const descriptor = {
    documentUri: { scheme: "file", authority: "", path: "/repo/src/example.ts" },
    documentFsPath: path.resolve("/repo/src/example.ts"),
    fileSystemPathSemantics: "posix" as const,
    lineCount: 1,
    contentHash: "hash-current",
  };

  await assert.rejects(() => provider.open(descriptor, selection({ headRevision: "c".repeat(40) })), /pull-request|selected|head|revision/i);
  assert.equal(await provider.loadForDecoration(descriptor, selection({ repositoryRoot: path.resolve("/other") })), undefined);
  assert.deepEqual(repository.saves, []);
  provider.dispose();
});

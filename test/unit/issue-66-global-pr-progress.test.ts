import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
  ReviewStateStorageUris,
} from "../../src/adapters/state-repository/index.js";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/t405-pull-request-review-runtime.js";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const A = "a".repeat(40);
const B = "b".repeat(40);
const REPOSITORY_ID = "github.com/example/issue-66";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#66`;
const LEGACY_FILE_ID = "repository-file:legacy-normal-editor-id";
const RAW_WINDOWS_PATH = "Src/Example.ts";
const CANONICAL_WINDOWS_PATH = "src/example.ts";
const CONTENT = "new\n";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const pullRequestContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #66",
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "issue-66",
    number: 66,
    state: "open",
    baseSha: A,
    headSha: B,
  },
  files: {
    [LEGACY_FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: LEGACY_FILE_ID,
      currentPath: CANONICAL_WINDOWS_PATH,
      previousPaths: [],
      revisionId: B,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 1,
      contentHash: sha256(CONTENT),
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
});

const pullRequestGlobal = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: B,
  files: {
    [LEGACY_FILE_ID]: {
      fileId: LEGACY_FILE_ID,
      currentPath: CANONICAL_WINDOWS_PATH,
      revisionId: B,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      contentHash: sha256(CONTENT),
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-19T00:00:00.000Z",
});

const windowsDiff: PullRequestDiffSnapshot = {
  contextId: CONTEXT_ID,
  baseSha: A,
  headSha: B,
  originalDiffId: `${A}..${B}`,
  files: [{
    fileId: RAW_WINDOWS_PATH,
    oldPath: RAW_WINDOWS_PATH,
    newPath: RAW_WINDOWS_PATH,
    status: "modified",
    additions: 1,
    deletions: 1,
    hunks: [{
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 1, text: "old" },
        { kind: "addition", newLine: 1, text: "new" },
      ],
    }],
  }],
};

class MemoryPullRequestRepository implements PullRequestReviewRuntimeRepository {
  public current: ReviewStateCommit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: pullRequestContext(),
    globalState: pullRequestGlobal(),
  };

  public async load(
    _target: ReviewStateRepositoryTarget,
  ): Promise<ReviewStateCommit> {
    void _target;
    return clone(this.current);
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>,
  ): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

test("Issue #66 Windows Global evidence uses the same case-insensitive path identity as persisted review state", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-issue-66-global-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(root, "global-storage") },
    storageUri: { fsPath: path.join(root, "workspace-storage") },
  };
  const sourceText = "reviewed\nsecond\n";
  await mkdir(path.join(repositoryRoot, "Src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "Src", "Untracked.ts"), sourceText, "utf8");

  const repositoryId = "repository-issue-66-global";
  const contextId = "branch-context-issue-66";
  const revisionId = "revision-issue-66";
  const occurredAt = "2026-08-19T00:00:00.000Z";
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "branch",
    repositoryId,
    displayName: "refs/heads/main",
    branch: { refName: "refs/heads/main", headRevision: revisionId },
    files: {},
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: revisionId,
    files: {
      reviewed: {
        fileId: "reviewed",
        currentPath: "src/untracked.ts",
        revisionId,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: sha256(sourceText),
        updatedAt: occurredAt,
      },
    },
    updatedAt: occurredAt,
  };
  await new FileSystemReviewStateRepository({ storageUris }).save(
    { kind: "git", repositoryId, contextId },
    { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState },
  );

  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => [{
      path: "Src/Untracked.ts",
      revisionId,
      lineCount: 3,
      nonEmptyLines: [0, 1],
      contentHash: sha256(sourceText),
      cacheKey: `issue-66:${sha256(sourceText)}`,
    }],
    fileSystemPathSemantics: "windows",
    yieldControl: () => undefined,
  });
  source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: revisionId,
      selection: {
        kind: "branch",
        repositoryId,
        repositoryRoot,
        branchRef: "refs/heads/main",
      },
    },
    progress: undefined,
  });

  const snapshot = await source.recalculate();
  assert.ok(snapshot);
  assert.equal(snapshot.progress.files.length, 1);
  assert.equal(snapshot.progress.files[0]?.path, "src/untracked.ts");
  assert.equal(snapshot.progress.files[0]?.state, "current");
  assert.equal(snapshot.progress.files[0]?.reviewedNonEmptyLineCount, 1);
  assert.equal(snapshot.progress.files[0]?.totalNonEmptyLineCount, 2);
  assert.equal(snapshot.progress.progress, 0.5);
});

test("Issue #66 PR progress resolves a normal-editor persisted file identity by canonical Windows path", async () => {
  const repository = new MemoryPullRequestRepository();
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => {
        opened.push({ original, modified });
      },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "C:\\repo",
    fileSystemPathSemantics: "windows",
    snapshot: windowsDiff,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old\n" : CONTENT,
    }),
  });

  assert.deepEqual(await runtime.getProgress(CONTEXT_ID), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
  });

  await runtime.openReviewDiff(CONTEXT_ID, RAW_WINDOWS_PATH, RAW_WINDOWS_PATH);
  assert.equal(opened.length, 1);
  const session = await runtime.openSession(opened[0]!.modified);
  assert.equal(session.target.fileId, LEGACY_FILE_ID);
  assert.equal(session.target.currentPath, CANONICAL_WINDOWS_PATH);
});

test("Issue #66 PR runtime publishes the active GitHub PR snapshot to the dedicated PR Progress tree", async () => {
  const repository = new MemoryPullRequestRepository();
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "C:\\repo",
    fileSystemPathSemantics: "windows",
    snapshot: windowsDiff,
    readTextContent: async () => ({ kind: "found", content: CONTENT }),
  });

  await runtime.activateProgress(CONTEXT_ID);
  const projected = runtime.progress.getEffectiveProgress();
  assert.equal(projected.reviewedLineCount, 1);
  assert.equal(projected.totalLineCount, 2);
  assert.equal(projected.progress, 0.5);
});

test("Issue #66 production composition switches the contributed PR Progress view to the GitHub PR runtime", async () => {
  const treeRuntime = await readFile(
    "src/ui/pr-progress/vscode-pull-request-progress-tree.ts",
    "utf8"
  );
  const composition = await readFile("src/t305-extension.ts", "utf8");

  assert.match(treeRuntime, /export const setPullRequestProgressSource/u);
  assert.match(treeRuntime, /export const refreshPullRequestProgressTree/u);
  assert.match(composition, /setPullRequestProgressSource\(pullRequestReviewRuntime\.progress\)/u);
  assert.match(composition, /pullRequestReviewRuntime\.activateProgress/u);
  assert.match(composition, /refreshPullRequestProgressTree/u);
});

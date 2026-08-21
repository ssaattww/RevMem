import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index.js";
import {
  DocumentReviewStateSessionProvider,
  type DocumentReviewStateRepository,
} from "../../src/adapters/document-review-state/index.js";
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index.js";
import {
  FileSystemReviewStateRepository,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris,
  type ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index.js";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index.js";
import { createNormalEditorDecorationModel } from "../../src/application/editor-decoration/index.js";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service.js";
import type { RevisionTextContentReadResult } from "../../src/application/diff-document/index.js";
import type { SelectedReviewContext } from "../../src/application/review-context/index.js";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index.js";
import { OperationCancelledError } from "../../src/application/operation-feedback/index.js";
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

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/example/pr68-review";
const CONTEXT_A = `github-pr:${REPOSITORY_ID}#68`;
const CONTEXT_B = `github-pr:${REPOSITORY_ID}#69`;
const RAW_PATH_A = "Src/Example.ts";
const RAW_PATH_B = "Src/Second.ts";
const CANONICAL_PATH_A = "src/example.ts";
const CONTENT_A = "new-a";
const CONTENT_B = "new-b";
const OCCURRED_AT = "2026-08-19T00:00:00.000Z";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

const diffSnapshot = (
  contextId: string,
  repositoryPath: string,
  baseSha = A,
  headSha = B,
): PullRequestDiffSnapshot => ({
  contextId,
  baseSha,
  headSha,
  originalDiffId: `${baseSha}..${headSha}`,
  files: [{
    fileId: repositoryPath,
    oldPath: repositoryPath,
    newPath: repositoryPath,
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
});

const pullRequestContext = (
  contextId: string,
  pullRequestNumber: number,
  files: ReviewContextState["files"] = {},
  baseSha = A,
  headSha = B,
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${pullRequestNumber}`,
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "pr68-review",
    number: pullRequestNumber,
    state: "open",
    baseSha,
    headSha,
  },
  files,
  createdAt: OCCURRED_AT,
  updatedAt: OCCURRED_AT,
});

const globalState = (
  files: RepositoryGlobalState["files"] = {},
  revisionId = B,
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revisionId,
  files,
  updatedAt: OCCURRED_AT,
});

const commitFor = (
  contextId: string,
  pullRequestNumber: number,
  contextFiles: ReviewContextState["files"] = {},
  globalFiles: RepositoryGlobalState["files"] = {},
  baseSha = A,
  headSha = B,
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: pullRequestContext(contextId, pullRequestNumber, contextFiles, baseSha, headSha),
  globalState: globalState(globalFiles, headSha),
});

class MemoryReviewRepository
implements PullRequestReviewRuntimeRepository, DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();

  public setPullRequest(contextId: string, commit: ReviewStateCommit): void {
    this.commits.set(targetKey({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId,
    }), clone(commit));
  }

  public async load(
    target: ReviewStateRepositoryTarget,
  ): Promise<ReviewStateCommit | undefined> {
    const value = this.commits.get(targetKey(target));
    return value === undefined ? undefined : clone(value);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit,
  ): Promise<void> {
    this.commits.set(targetKey(target), clone(commit));
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>,
  ): Promise<void> {
    this.setPullRequest(transaction.contextId, {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState,
    });
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const registerRuntimeContext = (
  runtime: PullRequestReviewRuntime<string>,
  contextId: string,
  repositoryPath: string,
  readTextContent: (descriptor: Parameters<Parameters<PullRequestReviewRuntime<string>["register"]>[0]["readTextContent"]>[0]) => Promise<RevisionTextContentReadResult>,
): void => {
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "C:\\repo",
    fileSystemPathSemantics: "windows",
    snapshot: diffSnapshot(contextId, repositoryPath),
    readTextContent,
  });
};

const createRuntime = (
  repository: MemoryReviewRepository,
  opened: Array<{ original: string; modified: string }> = [],
): PullRequestReviewRuntime<string> => new PullRequestReviewRuntime<string>({
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

const windowsInspection = (): LocalGitRepositoryInspection => ({
  kind: "repository",
  repository: {
    gitVersion: "2.50.0",
    rootPath: "C:\\repo",
    repositoryId: REPOSITORY_ID,
    remote: {
      name: "origin",
      rawUrl: "https://github.com/example/pr68-review.git",
      normalizedUrl: REPOSITORY_ID,
    },
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: B,
  },
});

const selectedPullRequest = (
  repositoryRoot = "C:\\repo",
): Extract<SelectedReviewContext, { kind: "pull-request" }> => ({
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  repositoryRoot,
  contextId: CONTEXT_A,
  pullRequestNumber: 68,
  headRevision: B,
});

test("PR68-R001 mixed-case Windows PR-diff-first review remains readable by PR Progress", async () => {
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(CONTEXT_A, 68));
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = createRuntime(repository, opened);
  registerRuntimeContext(runtime, CONTEXT_A, RAW_PATH_A, async (descriptor) => ({
    kind: "found",
    content: descriptor.side === "original" ? "old-a" : CONTENT_A,
  }));

  await runtime.openReviewDiff(CONTEXT_A, RAW_PATH_A, RAW_PATH_A);
  assert.equal(opened.length, 1);
  const commands = runtime.createCommandService<{ readonly uri: string; readonly side: "original" | "modified" }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => [{
      anchor: { line: 0, character: 0 },
      active: { line: 0, character: 0 },
    }],
    confirmWholeFileOperation: async () => true,
  });

  assert.equal(await commands.markSelectionReviewed({
    uri: opened[0]!.modified,
    side: "modified",
  }), "applied");
  assert.deepEqual(await runtime.getProgress(CONTEXT_A), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
  });
});

test("PR68-R002 pre-fix mixed-case Windows Global state remains current after upgrade", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-pr68-r002-global-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const storageUris: ReviewStateStorageUris = {
    globalStorageUri: { fsPath: path.join(root, "global-storage") },
    storageUri: { fsPath: path.join(root, "workspace-storage") },
  };
  await mkdir(path.join(repositoryRoot, "Src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "Src", "Example.ts"), CONTENT_A, "utf8");

  await new FileSystemReviewStateRepository({ storageUris }).save(
    { kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: CONTEXT_A },
    commitFor(
      CONTEXT_A,
      68,
      {
        [RAW_PATH_A]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          fileId: RAW_PATH_A,
          currentPath: RAW_PATH_A,
          previousPaths: [],
          revisionId: B,
          modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
          originalReviewedByDiff: {},
          lineCount: 1,
          contentHash: sha256(CONTENT_A),
          updatedAt: OCCURRED_AT,
        },
      },
      {
        [RAW_PATH_A]: {
          fileId: RAW_PATH_A,
          currentPath: RAW_PATH_A,
          revisionId: B,
          reviewed: [{ startLine: 0, endLineExclusive: 1 }],
          contentHash: sha256(CONTENT_A),
          updatedAt: OCCURRED_AT,
        },
      },
    ),
  );

  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => [{
      path: RAW_PATH_A,
      revisionId: B,
      lineCount: 1,
      nonEmptyLines: [0],
      contentHash: sha256(CONTENT_A),
      cacheKey: `r002:${sha256(CONTENT_A)}`,
    }],
    fileSystemPathSemantics: "windows",
    yieldControl: () => undefined,
  });
  source.setContext({
    context: {
      kind: "pull-request",
      label: "#68",
      detail: repositoryRoot,
      headRevision: B,
      selection: selectedPullRequest(repositoryRoot),
    },
    progress: undefined,
  });

  const snapshot = await source.recalculate();
  assert.ok(snapshot);
  assert.equal(snapshot.progress.files[0]?.path, CANONICAL_PATH_A);
  assert.equal(snapshot.progress.files[0]?.state, "current");
  assert.equal(snapshot.progress.files[0]?.reviewedNonEmptyLineCount, 1);
  assert.equal(snapshot.progress.progress, 1);
});

test("PR68-R002 selected normal editor preserves legacy case identity for decoration, Progress, and diff open", async () => {
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(
    CONTEXT_A,
    68,
    {
      [RAW_PATH_A]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: RAW_PATH_A,
        currentPath: RAW_PATH_A,
        previousPaths: [],
        revisionId: B,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
        originalReviewedByDiff: {},
        lineCount: 1,
        contentHash: sha256(CONTENT_A),
        updatedAt: OCCURRED_AT,
      },
    },
    {
      [RAW_PATH_A]: {
        fileId: RAW_PATH_A,
        currentPath: RAW_PATH_A,
        revisionId: B,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: sha256(CONTENT_A),
        updatedAt: OCCURRED_AT,
      },
    },
  ));
  const stableHash = new NodeSha256StableHash();
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: { inspectRepository: async () => windowsInspection() },
    repository,
    workspaceProvider: new WorkspaceReviewStateSessionProvider({
      identityService: new WorkspaceIdentityService(stableHash),
      repository,
    }),
    stableHash,
  });
  const descriptor = {
    documentUri: {
      scheme: "file",
      authority: "",
      path: "/C:/repo/Src/Example.ts",
    },
    documentFsPath: "C:\\repo\\Src\\Example.ts",
    fileSystemPathSemantics: "windows" as const,
    lineCount: 1,
    contentHash: sha256(CONTENT_A),
  };

  const decorationState = await provider.loadForDecoration(descriptor, selectedPullRequest());
  assert.ok(decorationState);
  assert.equal(decorationState.target.fileId, RAW_PATH_A);
  assert.equal(decorationState.target.currentPath, RAW_PATH_A);
  assert.deepEqual(
    createNormalEditorDecorationModel({
      ...decorationState,
      currentPullRequestDiff: diffSnapshot(CONTEXT_A, RAW_PATH_A),
      showGlobalReviewed: true,
    }).map((decoration) => decoration.interval),
    [{ startLine: 0, endLineExclusive: 1 }],
  );

  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = createRuntime(repository, opened);
  registerRuntimeContext(runtime, CONTEXT_A, RAW_PATH_A, async (revision) => ({
    kind: "found",
    content: revision.side === "original" ? "old" : CONTENT_A,
  }));
  assert.deepEqual(await runtime.getProgress(CONTEXT_A), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
  });
  await runtime.openReviewDiff(CONTEXT_A, RAW_PATH_A, RAW_PATH_A);
  assert.equal(opened.length, 1);
  provider.dispose();
});

test("PR68-IFR001 rejects a Windows case-colliding PR snapshot before Progress or diff sessions can reuse reviewed state", async () => {
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(
    CONTEXT_A,
    68,
    {
      [RAW_PATH_A]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: RAW_PATH_A,
        currentPath: RAW_PATH_A,
        previousPaths: [],
        revisionId: B,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
        originalReviewedByDiff: {},
        lineCount: 1,
        contentHash: sha256(CONTENT_A),
        updatedAt: OCCURRED_AT,
      },
    },
  ));
  const runtime = createRuntime(repository);
  const first = diffSnapshot(CONTEXT_A, RAW_PATH_A);
  const second = diffSnapshot(CONTEXT_A, CANONICAL_PATH_A);
  const snapshot: PullRequestDiffSnapshot = {
    ...first,
    files: [first.files[0]!, second.files[0]!],
  };

  assert.throws(
    () => runtime.register({
      repositoryId: REPOSITORY_ID,
      repositoryRoot: "C:\\repo",
      fileSystemPathSemantics: "windows",
      snapshot,
      readTextContent: async (descriptor) => ({
        kind: "found",
        content: descriptor.side === "original" ? "old" : CONTENT_A,
      }),
    }),
    /case-colliding|conflicting PR diff file identities/i,
  );
  assert.equal(runtime.hasContext(CONTEXT_A), false);
  await assert.rejects(runtime.getProgress(CONTEXT_A), /not registered/i);
  await assert.rejects(
    runtime.openReviewDiff(CONTEXT_A, CANONICAL_PATH_A, CANONICAL_PATH_A),
    /not registered/i,
  );
});

test("PR68-IFR001 accepts copied files that share one exact original source while current identities remain distinct", async () => {
  const sourcePath = "Src/Source.ts";
  const firstCopyPath = "Src/FirstCopy.ts";
  const secondCopyPath = "Src/SecondCopy.ts";
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(
    CONTEXT_A,
    68,
    {
      [sourcePath]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: sourcePath,
        currentPath: sourcePath,
        previousPaths: [],
        revisionId: B,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
        originalReviewedByDiff: {},
        lineCount: 1,
        contentHash: sha256(CONTENT_A),
        updatedAt: OCCURRED_AT,
      },
    },
  ));
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = createRuntime(repository, opened);
  const source = diffSnapshot(CONTEXT_A, sourcePath).files[0]!;
  const firstCopy = {
    ...diffSnapshot(CONTEXT_A, firstCopyPath).files[0]!,
    oldPath: sourcePath,
    newPath: firstCopyPath,
    status: "copied" as const,
  };
  const secondCopy = {
    ...diffSnapshot(CONTEXT_A, secondCopyPath).files[0]!,
    oldPath: sourcePath,
    newPath: secondCopyPath,
    status: "copied" as const,
  };
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "C:\\repo",
    fileSystemPathSemantics: "windows",
    snapshot: {
      ...diffSnapshot(CONTEXT_A, sourcePath),
      files: [source, firstCopy, secondCopy],
    },
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.side === "original" ? "old" : CONTENT_A,
    }),
  });

  assert.deepEqual(await runtime.getProgress(CONTEXT_A), {
    reviewedLineCount: 1,
    totalLineCount: 6,
    progress: 1 / 6,
  });
  await runtime.openReviewDiff(CONTEXT_A, firstCopyPath, firstCopyPath);
  assert.equal(opened.length, 1);
});

const createConcurrentRuntime = () => {
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(CONTEXT_A, 68));
  repository.setPullRequest(CONTEXT_B, commitFor(CONTEXT_B, 69));
  const runtime = createRuntime(repository);
  const aText = deferred<RevisionTextContentReadResult>();
  const bText = deferred<RevisionTextContentReadResult>();
  registerRuntimeContext(runtime, CONTEXT_A, RAW_PATH_A, async () => aText.promise);
  registerRuntimeContext(runtime, CONTEXT_B, RAW_PATH_B, async () => bText.promise);
  return { runtime, aText, bText };
};

const activeProgressFileId = (runtime: PullRequestReviewRuntime<string>): string | undefined =>
  runtime.progress.getEffectiveProgress().files[0]?.raw.fileId;

test("PR68-R003 stale PR A success cannot overwrite newer PR B progress", async () => {
  const { runtime, aText, bText } = createConcurrentRuntime();
  const aActivation = runtime.activateProgress(CONTEXT_A);
  const bActivation = runtime.activateProgress(CONTEXT_B);

  bText.resolve({ kind: "found", content: CONTENT_B });
  await bActivation;
  assert.equal(activeProgressFileId(runtime), RAW_PATH_B);

  aText.resolve({ kind: "found", content: CONTENT_A });
  await assert.rejects(aActivation, OperationCancelledError);
  assert.equal(activeProgressFileId(runtime), RAW_PATH_B);
});

test("PR68-R003 stale PR A failure cannot clear newer PR B progress", async () => {
  const { runtime, aText, bText } = createConcurrentRuntime();
  const aActivation = runtime.activateProgress(CONTEXT_A).then(
    () => "resolved" as const,
    () => "rejected" as const,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const bActivation = runtime.activateProgress(CONTEXT_B);

  bText.resolve({ kind: "found", content: CONTENT_B });
  await bActivation;
  assert.equal(activeProgressFileId(runtime), RAW_PATH_B);

  aText.reject(new Error("stale A failure"));
  assert.equal(await aActivation, "rejected");
  assert.equal(activeProgressFileId(runtime), RAW_PATH_B);
});

test("PR68-R003 leaving the PR context invalidates a pending PR activation", async () => {
  const { runtime, aText } = createConcurrentRuntime();
  const aActivation = runtime.activateProgress(CONTEXT_A);

  runtime.clearProgress();
  aText.resolve({ kind: "found", content: CONTENT_A });
  await assert.rejects(aActivation, OperationCancelledError);

  const progress = runtime.progress.getEffectiveProgress();
  assert.equal(progress.files.length, 0);
  assert.equal(progress.reviewedLineCount, 0);
  assert.equal(progress.totalLineCount, 0);
});

test("PR68-R003 same-context re-registration prevents an old revision from publishing after newer activation", async () => {
  const repository = new MemoryReviewRepository();
  repository.setPullRequest(CONTEXT_A, commitFor(CONTEXT_A, 68));
  const runtime = createRuntime(repository);
  const oldText = deferred<RevisionTextContentReadResult>();
  const newText = deferred<RevisionTextContentReadResult>();
  registerRuntimeContext(runtime, CONTEXT_A, RAW_PATH_A, async () => oldText.promise);

  const oldActivation = runtime.activateProgress(CONTEXT_A);
  repository.setPullRequest(CONTEXT_A, commitFor(CONTEXT_A, 68, {}, {}, A, C));
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "C:\\repo",
    fileSystemPathSemantics: "windows",
    snapshot: diffSnapshot(CONTEXT_A, RAW_PATH_B, A, C),
    readTextContent: async () => newText.promise,
  });
  oldText.resolve({ kind: "found", content: CONTENT_A });
  await assert.rejects(oldActivation, OperationCancelledError);
  assert.equal(runtime.progress.getEffectiveProgress().files.length, 0);

  const newActivation = runtime.activateProgress(CONTEXT_A);
  newText.resolve({ kind: "found", content: CONTENT_B });
  await newActivation;
  assert.equal(activeProgressFileId(runtime), RAW_PATH_B);
});

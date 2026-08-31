import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { restoreImmutableRevisionSnapshots } from "../../src/core/review-state/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import {
  createImmutablePullRequestRevisionMapper,
  GitHubPullRequestContextStateService,
  type GitHubPullRequestContextRepositoryPort,
} from "../../src/application/github-pr-context/index.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/t405-pull-request-review-runtime.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const FILE_ID = "file-1";
const contentHash = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");

const contextState = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
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
    baseSha: A,
    headSha: B,
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: B,
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      contentHash: contentHash("new"),
      lineCount: 1,
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: B,
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: "src/example.ts",
      revisionId: B,
      reviewed: [],
      contentHash: contentHash("new"),
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const snapshot: PullRequestDiffSnapshot = {
  contextId: CONTEXT_ID,
  baseSha: A,
  headSha: B,
  originalDiffId: `${A}..${B}`,
  files: [{
    fileId: FILE_ID,
    oldPath: "src/example.ts",
    newPath: "src/example.ts",
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

class MemoryRepository implements PullRequestReviewRuntimeRepository, GitHubPullRequestContextRepositoryPort {
  public current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(),
    globalState: globalState(),
  };

  public async load(): Promise<typeof this.current> {
    return structuredClone(this.current);
  }

  public async create(transaction: Parameters<GitHubPullRequestContextRepositoryPort["create"]>[0]): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: structuredClone(transaction.next.contextState),
      globalState: structuredClone(transaction.next.globalState),
    };
  }

  public async commit(transaction: Parameters<PullRequestReviewRuntimeRepository["commit"]>[0]): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: structuredClone(transaction.next.contextState) as ReviewContextState,
      globalState: structuredClone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

test("PR runtime command snapshot survives immutable PR A-to-B-to-A store restoration with hashes", async () => {
  const repository = new MemoryRepository();
  const initialPullRequest = {
    ...repository.current.contextState.pullRequest!,
    baseSha: C,
    headSha: A,
  };
  repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...repository.current.contextState,
      pullRequest: initialPullRequest,
      files: {
        [FILE_ID]: {
          ...repository.current.contextState.files[FILE_ID]!,
          revisionId: A,
          contentHash: contentHash("alpha"),
          modifiedReviewed: [],
          originalReviewedByDiff: {},
        },
      },
    },
    globalState: {
      ...repository.current.globalState,
      currentRevisionId: A,
      files: {
        [FILE_ID]: {
          ...repository.current.globalState.files[FILE_ID]!,
          revisionId: A,
          contentHash: contentHash("alpha"),
          reviewed: [],
        },
      },
    },
  };
  const commandHistory: string[] = [];
  const storeHistory: string[] = [];
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => { commandHistory.push("runtime-command"); },
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => { opened.push({ original, modified }); },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  const atA: PullRequestDiffSnapshot = {
    ...snapshot,
    baseSha: C,
    headSha: A,
    originalDiffId: `${C}..${A}`,
  };
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot: atA,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "alpha" : "base",
    }),
  });
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID);
  const commands = runtime.createCommandService<{ readonly uri: string; readonly side: "modified" }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
    confirmWholeFileOperation: async () => true,
  });
  assert.equal(await commands.markSelectionReviewed({ uri: opened[0]!.modified, side: "modified" }), "applied");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(repository.current.contextState.revisionSnapshots?.[A]?.files[FILE_ID]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.equal(repository.current.contextState.revisionSnapshots?.[A]?.files[FILE_ID]?.contentHash, contentHash("alpha"));
  assert.equal(repository.current.globalState.revisionSnapshots?.[A]?.files[FILE_ID]?.contentHash, contentHash("alpha"));

  const immutableMapper = createImmutablePullRequestRevisionMapper(async (evidence) => {
    const targetIsB = evidence.targetHeadSha === B;
    return {
      sourceBaseSha: evidence.sourceBaseSha,
      sourceHeadSha: evidence.sourceHeadSha,
      targetBaseSha: evidence.targetBaseSha,
      targetHeadSha: evidence.targetHeadSha,
      diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -1 +1 @@", targetIsB ? "-alpha" : "-beta", targetIsB ? "+beta" : "+alpha", ""].join("\n"),
      oldTexts: { "src/example.ts": targetIsB ? "alpha" : "beta" },
      newFiles: {
        "src/example.ts": {
          fileId: FILE_ID,
          newText: targetIsB ? "beta" : "alpha",
          lineCount: 1,
          contentHash: contentHash(targetIsB ? "beta" : "alpha"),
        },
      },
    };
  });
  const store = new GitHubPullRequestContextStateService(repository, immutableMapper, {
    recordContextCreated: async () => undefined,
    recordRevisionMapping: async (_previous, _next, reason) => { storeHistory.push(reason ?? ""); },
  });
  const identity = { host: "github.com", owner: "ssaattww", repository: "revmem", pullRequestNumber: 52 };
  const advanced = await store.update({
    repositoryId: REPOSITORY_ID,
    identity,
    pullRequest: { ...initialPullRequest, headSha: B },
  });
  assert.deepEqual(advanced.contextState.revisionSnapshots?.[A]?.files[FILE_ID]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(advanced.globalState.revisionSnapshots?.[A]?.files[FILE_ID]?.reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  const restored = await store.update({
    repositoryId: REPOSITORY_ID,
    identity,
    pullRequest: initialPullRequest,
  });

  assert.equal(restored.mappingDisposition, "restored");
  assert.deepEqual(restored.contextState.files[FILE_ID]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(restored.globalState.files[FILE_ID]?.reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.equal(restored.contextState.files[FILE_ID]?.contentHash, contentHash("alpha"));
  assert.equal(restored.globalState.files[FILE_ID]?.contentHash, contentHash("alpha"));
  assert.deepEqual(commandHistory, ["runtime-command"]);
  assert.deepEqual(storeHistory, ["git-revision-mapped", "exact-revision-snapshot-restored"]);
});

test("R405-3 saved/closed PR opens through the canonical T302 review-range-diff identity", async () => {
  const opened: Array<{ original: string; modified: string; title: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified, title) => {
        opened.push({ original, modified, title });
      },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old" : "new",
    }),
  });

  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID, "src/example.ts");

  assert.equal(opened.length, 1);
  assert.match(opened[0]!.original, /^review-range-diff:\/\/document\/v1\//u);
  assert.match(opened[0]!.modified, /^review-range-diff:\/\/document\/v1\//u);
  assert.notEqual(opened[0]!.original, opened[0]!.modified);
});

test("R405-3 Review Contexts canonical original/modified commands persist mark and unmark", async () => {
  const repository = new MemoryRepository();
  const opened: Array<{ original: string; modified: string; title: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified, title) => {
        opened.push({ original, modified, title });
      },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old" : "new",
    }),
  });
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID, "src/example.ts");
  const diff = opened[0]!;

  interface Editor {
    readonly uri: string;
    readonly side: "original" | "modified";
  }
  const selection = [{
    anchor: { line: 0, character: 0 },
    active: { line: 0, character: 0 },
  }];
  const commands = runtime.createCommandService<Editor>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => selection,
    confirmWholeFileOperation: async () => true,
  });
  const original = { uri: diff.original, side: "original" as const };
  const modified = { uri: diff.modified, side: "modified" as const };
  const assertCurrentHeadSnapshots = () => {
    assert.deepEqual(
      repository.current.contextState.revisionSnapshots?.[B]?.files,
      repository.current.contextState.files,
    );
    assert.deepEqual(
      repository.current.globalState.revisionSnapshots?.[B]?.files,
      repository.current.globalState.files,
    );
    assert.equal(repository.current.contextState.files[FILE_ID]?.contentHash, contentHash("new"));
    assert.equal(repository.current.globalState.files[FILE_ID]?.contentHash, contentHash("new"));
  };

  assert.equal(await commands.markSelectionReviewed(original), "applied");
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]?.originalReviewedByDiff,
    { [`${A}..${B}`]: [{ startLine: 0, endLineExclusive: 1 }] },
  );
  assertCurrentHeadSnapshots();

  assert.equal(await commands.markSelectionReviewed(modified), "applied");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
  ]);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
  ]);
  assertCurrentHeadSnapshots();

  assert.equal(await commands.unmarkSelectionReviewed(original), "applied");
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]?.originalReviewedByDiff,
    { [`${A}..${B}`]: [] },
  );
  assertCurrentHeadSnapshots();
  assert.equal(await commands.unmarkSelectionReviewed(modified), "applied");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, []);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, []);
  assertCurrentHeadSnapshots();

  assert.equal(await commands.markFileReviewed(modified), "applied");
  assertCurrentHeadSnapshots();
  assert.equal(await commands.unmarkFileReviewed(modified), "applied");
  assertCurrentHeadSnapshots();

  const restored = restoreImmutableRevisionSnapshots({
    contextState: repository.current.contextState,
    globalState: repository.current.globalState,
    evidence: {
      revisionId: B,
      contextFiles: {
        [FILE_ID]: {
          fileId: FILE_ID,
          currentPath: "src/example.ts",
          lineCount: 1,
          contentHash: contentHash("new"),
        },
      },
      globalFiles: {
        [FILE_ID]: {
          fileId: FILE_ID,
          currentPath: "src/example.ts",
          lineCount: 1,
          contentHash: contentHash("new"),
        },
      },
    },
  });
  assert.equal(restored.context.kind, "hit");
  assert.equal(restored.global.kind, "hit");
});

test("PR runtime command fails closed before commit when persisted hashes do not match authoritative HEAD content", async () => {
  const repository = new MemoryRepository();
  repository.current.contextState.files[FILE_ID] = {
    ...repository.current.contextState.files[FILE_ID]!,
    contentHash: "stale-context-hash",
  };
  repository.current.globalState.files[FILE_ID] = {
    ...repository.current.globalState.files[FILE_ID]!,
    contentHash: "stale-global-hash",
  };
  let historyCalls = 0;
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => { historyCalls += 1; },
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => { opened.push({ original, modified }); },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old" : "new",
    }),
  });
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID);
  const commands = runtime.createCommandService<{ readonly uri: string; readonly side: "modified" }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
    confirmWholeFileOperation: async () => true,
  });

  await assert.rejects(
    () => commands.markSelectionReviewed({ uri: opened[0]!.modified, side: "modified" }),
    /content hash/i,
  );
  assert.equal(repository.current.contextState.revisionSnapshots, undefined);
  assert.equal(repository.current.globalState.revisionSnapshots, undefined);
  assert.equal(historyCalls, 0);
});

test("PR mutation no-op, cancellation, and failed commit publish neither snapshots nor history", async () => {
  const repository = new MemoryRepository();
  let historyCalls = 0;
  let selections: readonly { readonly anchor: { readonly line: number; readonly character: number }; readonly active: { readonly line: number; readonly character: number } }[] = [];
  const confirmed = false;
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => { historyCalls += 1; },
    diffHost: { parseUri: (value) => value, openDiff: async (original, modified) => { opened.push({ original, modified }); } },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({ kind: "found", content: descriptor.revision === A ? "old" : "new" }),
  });
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID);
  const commands = runtime.createCommandService<{ readonly uri: string; readonly side: "modified" }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 1,
    getSelections: () => selections,
    confirmWholeFileOperation: async () => confirmed,
  });
  const modified = { uri: opened[0]!.modified, side: "modified" as const };

  assert.equal(await commands.markSelectionReviewed(modified), "no-op");
  assert.equal(await commands.markFileReviewed(modified), "cancelled");
  assert.equal(repository.current.contextState.revisionSnapshots, undefined);
  assert.equal(repository.current.globalState.revisionSnapshots, undefined);

  selections = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }];
  repository.commit = async () => { throw new Error("CAS rejected"); };
  await assert.rejects(() => commands.markSelectionReviewed(modified), /CAS rejected/u);
  assert.equal(repository.current.contextState.revisionSnapshots, undefined);
  assert.equal(repository.current.globalState.revisionSnapshots, undefined);
  assert.equal(historyCalls, 0);
});

test("R405-5 PR runtime exposes T304 progress for Review Contexts", async () => {
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async () => ({ kind: "found", content: "new" }),
  });

  assert.deepEqual(await runtime.getProgress(CONTEXT_ID), {
    reviewedLineCount: 0,
    totalLineCount: 2,
    progress: 0,
  });
});

test("R405-3 binary PR changes are not opened as text review diffs", async () => {
  const binarySnapshot: PullRequestDiffSnapshot = {
    ...snapshot,
    files: [{
      fileId: "binary",
      oldPath: "binary.bin",
      newPath: "binary.bin",
      status: "binary",
      additions: 0,
      deletions: 0,
      hunks: [],
    }],
  };
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot: binarySnapshot,
    readTextContent: async () => ({ kind: "invalid-encoding", encoding: "utf-8" }),
  });

  await assert.rejects(
    () => runtime.openReviewDiff(CONTEXT_ID, "binary", "binary.bin"),
    /line review|binary|unsupported/i,
  );
});

test("Issue #59 PR full scan reads complete current-side files once and reuses immutable revision caches", async () => {
  const fullSnapshot: PullRequestDiffSnapshot = {
    ...snapshot,
    files: [
      snapshot.files[0]!,
      {
        fileId: "file-2",
        oldPath: "src/second.ts",
        newPath: "src/second.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        hunks: [{
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 1,
          lines: [
            { kind: "deletion", oldLine: 1, text: "old-second" },
            { kind: "addition", newLine: 1, text: "new-second" },
          ],
        }],
      },
      {
        fileId: "deleted",
        oldPath: "src/deleted.ts",
        status: "deleted",
        additions: 0,
        deletions: 1,
        hunks: [{
          oldStart: 1,
          oldCount: 1,
          newStart: 0,
          newCount: 0,
          lines: [{ kind: "deletion", oldLine: 1, text: "deleted" }],
        }],
      },
    ],
  };
  const reads: string[] = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot: fullSnapshot,
    readTextContent: async (descriptor) => {
      reads.push(`${descriptor.revision}:${descriptor.filePath}`);
      if (descriptor.filePath === "src/example.ts") {
        return { kind: "found", content: "first\n\nthird\n" };
      }
      if (descriptor.filePath === "src/second.ts") {
        return { kind: "found", content: "alpha\nbeta\n" };
      }
      if (descriptor.filePath === "src/deleted.ts" && descriptor.revision === A) {
        return { kind: "found", content: "deleted\nfile\n" };
      }
      return { kind: "missing-file" };
    },
  });

  type GlobalHeadFile = { readonly path: string; readonly revisionId: string; readonly content: string };
  const candidate = runtime as unknown as {
    readGlobalHeadFiles?: (
      contextId: string,
      candidatePaths: ReadonlySet<string>,
    ) => Promise<readonly GlobalHeadFile[]>;
  };
  assert.equal(typeof candidate.readGlobalHeadFiles, "function");

  const paths = new Set(["src/example.ts", "src/second.ts", "src/deleted.ts"]);
  const first = await candidate.readGlobalHeadFiles!(CONTEXT_ID, paths);
  const second = await candidate.readGlobalHeadFiles!(CONTEXT_ID, paths);

  assert.deepEqual(first, [
    { path: "src/example.ts", revisionId: B, content: "first\n\nthird\n" },
    { path: "src/second.ts", revisionId: B, content: "alpha\nbeta\n" },
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(reads, [
    `${B}:src/example.ts`,
    `${B}:src/second.ts`,
    `${A}:src/deleted.ts`,
  ]);
});


test("PR69-R001 Global PR open uses the exact immutable HEAD document and rejects a superseded head", async () => {
  const addedSnapshot: PullRequestDiffSnapshot = {
    ...snapshot,
    files: [{
      fileId: "added-only",
      newPath: "src/added-only.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      hunks: [{
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 1,
        lines: [{ kind: "addition", newLine: 1, text: "immutable-head" }]
      }]
    }]
  };
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/working-tree-without-added-file",
    fileSystemPathSemantics: "posix",
    snapshot: addedSnapshot,
    readTextContent: async (descriptor) => {
      assert.equal(descriptor.filePath, "src/added-only.ts");
      assert.equal(descriptor.revision, B);
      assert.equal(descriptor.side, "modified");
      return { kind: "found", content: "immutable-head\n" };
    },
  });

  const candidate = runtime as unknown as {
    createHeadFileDocumentUri?: (contextId: string, repositoryPath: string, revisionId: string) => string;
  };
  assert.equal(typeof candidate.createHeadFileDocumentUri, "function");
  const uri = candidate.createHeadFileDocumentUri!(CONTEXT_ID, "src/added-only.ts", B);
  assert.match(uri, /^review-range-diff:\/\/document\/v1\//u);
  const content = await runtime.documentContentProvider.provideTextDocumentContent({
    toString: () => uri
  } as never);
  assert.equal(content, "immutable-head\n");

  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/working-tree-without-added-file",
    fileSystemPathSemantics: "posix",
    snapshot: { ...addedSnapshot, headSha: "c".repeat(40), originalDiffId: `${A}..${"c".repeat(40)}` },
    readTextContent: async () => ({ kind: "found", content: "newer-head\n" }),
  });
  assert.throws(
    () => candidate.createHeadFileDocumentUri!(CONTEXT_ID, "src/added-only.ts", B),
    /stale|head|revision/i
  );
});

test("PR Progress original-side selection projects unchanged lines and retains original-only lines atomically", async () => {
  const projectionSnapshot: PullRequestDiffSnapshot = {
    contextId: CONTEXT_ID,
    baseSha: A,
    headSha: B,
    originalDiffId: `${A}..${B}`,
    files: [{
      fileId: FILE_ID,
      oldPath: "src/example.ts",
      newPath: "src/example.ts",
      status: "modified",
      additions: 3,
      deletions: 2,
      hunks: [
        {
          oldStart: 3,
          oldCount: 1,
          newStart: 3,
          newCount: 1,
          lines: [
            { kind: "deletion", oldLine: 3, text: "old-three" },
            { kind: "addition", newLine: 3, text: "new-three" }
          ]
        },
        {
          oldStart: 6,
          oldCount: 3,
          newStart: 6,
          newCount: 4,
          lines: [
            { kind: "context", oldLine: 6, newLine: 6, text: "same-six" },
            { kind: "deletion", oldLine: 7, text: "old-seven" },
            { kind: "addition", newLine: 7, text: "new-seven" },
            { kind: "addition", newLine: 8, text: "new-eight" },
            { kind: "context", oldLine: 8, newLine: 9, text: "same-eight" }
          ]
        }
      ]
    }]
  };
  const repository = new MemoryRepository();
  const projectionModifiedText = Array.from(
    { length: 11 },
    (_, index) => `modified-${String(index + 1)}`
  ).join("\n");
  repository.current.contextState = {
    ...repository.current.contextState,
    files: {
      [FILE_ID]: {
        ...repository.current.contextState.files[FILE_ID]!,
        lineCount: 11,
        contentHash: contentHash(projectionModifiedText),
      }
    }
  };
  repository.current.globalState = {
    ...repository.current.globalState,
    files: {
      [FILE_ID]: {
        ...repository.current.globalState.files[FILE_ID]!,
        contentHash: contentHash(projectionModifiedText),
      },
    },
  };
  const commits: unknown[] = [];
  const originalCommit = repository.commit.bind(repository);
  repository.commit = async (transaction) => {
    commits.push(transaction);
    await originalCommit(transaction);
  };
  const opened: Array<{ original: string; modified: string; title: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified, title) => {
        opened.push({ original, modified, title });
      }
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot: projectionSnapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.side === "original"
        ? Array.from({ length: 10 }, (_, index) => `original-${String(index + 1)}`).join("\n")
        : projectionModifiedText
    })
  });
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID, "src/example.ts");
  const diff = opened[0]!;

  interface Editor {
    readonly uri: string;
    readonly side: "original" | "modified";
  }
  const selectedLines = [1, 2, 5, 6, 7];
  const commands = runtime.createCommandService<Editor>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => editor.side,
    getLineCount: () => 10,
    getSelections: () => selectedLines.map((line) => ({
      anchor: { line, character: 0 },
      active: { line, character: 0 }
    })),
    confirmWholeFileOperation: async () => true
  });

  assert.equal(await commands.markSelectionReviewed({
    uri: diff.original,
    side: "original"
  }), "applied");

  assert.equal(commits.length, 1, "mixed original selection is committed atomically");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, [
    { startLine: 1, endLineExclusive: 2 },
    { startLine: 5, endLineExclusive: 6 },
    { startLine: 8, endLineExclusive: 9 }
  ]);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, [
    { startLine: 1, endLineExclusive: 2 },
    { startLine: 5, endLineExclusive: 6 },
    { startLine: 8, endLineExclusive: 9 }
  ]);
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]?.originalReviewedByDiff,
    { [`${A}..${B}`]: [
      { startLine: 2, endLineExclusive: 3 },
      { startLine: 6, endLineExclusive: 7 }
    ] }
  );
});

test("PR Progress command rejects an old diff URI pair after BASE or HEAD changes", async () => {
  const opened: Array<{ original: string; modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => { opened.push({ original, modified }); }
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const registration = {
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix" as const,
    snapshot,
    readTextContent: async () => ({ kind: "found" as const, content: "text" })
  };
  runtime.register(registration);
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID, "src/example.ts");
  const oldPair = opened[0]!;

  assert.doesNotThrow(() => runtime.validateDiffDocumentPair(oldPair.original, oldPair.modified));

  runtime.register({
    ...registration,
    snapshot: {
      ...snapshot,
      baseSha: C,
      originalDiffId: `${C}..${B}`
    }
  });
  assert.throws(
    () => runtime.validateDiffDocumentPair(oldPair.original, oldPair.modified),
    /stale|base|revision|snapshot/i
  );

  runtime.register({
    ...registration,
    snapshot: {
      ...snapshot,
      headSha: C,
      originalDiffId: `${A}..${C}`
    }
  });
  assert.throws(
    () => runtime.validateDiffDocumentPair(oldPair.original, oldPair.modified),
    /stale|head|revision|snapshot/i
  );
});


test("production command routing validates the active immutable diff URI pair before mutation", async () => {
  const source = await readFile("src/t305-extension.ts", "utf8");

  assert.match(source, /TabInputTextDiff/u);
  assert.match(source, /validateDiffDocumentPair/u);
  assert.match(source, /tab\.input\.original/u);
  assert.match(source, /tab\.input\.modified/u);
});

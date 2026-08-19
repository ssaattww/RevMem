import assert from "node:assert/strict";
import test from "node:test";

import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/t405-pull-request-review-runtime.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const FILE_ID = "file-1";

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
  files: {},
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

class MemoryRepository implements PullRequestReviewRuntimeRepository {
  public current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(),
    globalState: globalState(),
  };

  public async load(): Promise<typeof this.current> {
    return structuredClone(this.current);
  }

  public async commit(transaction: Parameters<PullRequestReviewRuntimeRepository["commit"]>[0]): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: structuredClone(transaction.next.contextState) as ReviewContextState,
      globalState: structuredClone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

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

  assert.equal(await commands.markSelectionReviewed(original), "applied");
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]?.originalReviewedByDiff,
    { [`${A}..${B}`]: [{ startLine: 0, endLineExclusive: 1 }] },
  );

  assert.equal(await commands.markSelectionReviewed(modified), "applied");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
  ]);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, [
    { startLine: 0, endLineExclusive: 1 },
  ]);

  assert.equal(await commands.unmarkSelectionReviewed(original), "applied");
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]?.originalReviewedByDiff,
    { [`${A}..${B}`]: [] },
  );
  assert.equal(await commands.unmarkSelectionReviewed(modified), "applied");
  assert.deepEqual(repository.current.contextState.files[FILE_ID]?.modifiedReviewed, []);
  assert.deepEqual(repository.current.globalState.files[FILE_ID]?.reviewed, []);
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
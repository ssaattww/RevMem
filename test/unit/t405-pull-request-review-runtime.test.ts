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

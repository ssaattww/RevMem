import assert from "node:assert/strict";
import test from "node:test";

import {
  PullRequestRevisionEvidenceLoader,
} from "../../src/application/review-contexts/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const FILE_ID = "stable-file";

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
    state: "open",
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
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
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
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: "src/example.ts",
      revisionId: B,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-16T00:00:00.000Z",
});

const transition = {
  repositoryId: REPOSITORY_ID,
  contextId: CONTEXT_ID,
  sourceBaseSha: A,
  sourceHeadSha: B,
  targetBaseSha: A,
  targetHeadSha: C,
};

test("R405-1 revision evidence supplies exact diff and old/new text for tracked files", async () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const reads: string[] = [];
  const loader = new PullRequestRevisionEvidenceLoader({
    loadCurrent: async () => ({ contextState: contextState(), globalState: globalState() }),
    loadDiff: async (request) => {
      assert.deepEqual(request, transition);
      return diff;
    },
    readText: async (revision, path) => {
      reads.push(`${revision}:${path}`);
      return { kind: "found" as const, content: revision === B ? "old" : "new" };
    },
    createFileId: (_repositoryId, path) => `new:${path}`,
    hashText: (text) => `hash:${text}`,
    now: () => new Date("2026-08-16T00:01:00.000Z"),
  });

  const evidence = await loader.load(transition);

  assert.equal(evidence.diff, diff);
  assert.equal(evidence.oldTexts["src/example.ts"], "old");
  assert.deepEqual(evidence.newFiles["src/example.ts"], {
    fileId: FILE_ID,
    lineCount: 1,
    contentHash: "hash:new",
    newText: "new",
  });
  assert.deepEqual(reads, [
    `${B}:src/example.ts`,
    `${C}:src/example.ts`,
  ]);
  assert.equal(evidence.updatedAt, "2026-08-16T00:01:00.000Z");
});

test("base-only PR transition does not invent a head diff", async () => {
  let diffCalls = 0;
  const loader = new PullRequestRevisionEvidenceLoader({
    loadCurrent: async () => ({ contextState: contextState(), globalState: globalState() }),
    loadDiff: async () => {
      diffCalls += 1;
      return "unexpected";
    },
    readText: async () => ({ kind: "found" as const, content: "unused" }),
    createFileId: (_repositoryId, path) => `new:${path}`,
    hashText: (text) => `hash:${text}`,
  });

  const evidence = await loader.load({
    ...transition,
    targetBaseSha: C,
    targetHeadSha: B,
  });

  assert.equal(evidence.diff, "");
  assert.deepEqual(evidence.oldTexts, {});
  assert.deepEqual(evidence.newFiles, {});
  assert.equal(diffCalls, 0);
});

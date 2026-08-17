import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ReviewStateCommit, ReviewStateRepositoryTarget, ReviewStateTransactionLike } from "../../src/adapters/state-repository/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index";
import { DocumentReviewEditRuntime, type DocumentReviewEditSnapshot } from "../../src/document-review-edit-runtime";

const repositoryId = "github.com/example/t506-selected-pr";
const head = "0123456789abcdef0123456789abcdef01234567";
const contextId = "github-pr:github.com/example/t506-selected-pr#506";
const beforeText = "const first = 1;\nconst second = 2;";
const afterText = "const first = 1;\nconst inserted = 9;\nconst second = 2;";
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

const snapshot = (text: string): DocumentReviewEditSnapshot => ({
  documentKey: "file:///repo/src/review.ts",
  documentUri: { scheme: "file", authority: "", path: "/repo/src/review.ts", query: "", fragment: "" },
  documentFsPath: "/repo/src/review.ts",
  fileSystemPathSemantics: "posix",
  text,
  lineCount: text.split("\n").length,
  contentHash: hash(text)
});

const initial = (): ReviewStateCommit => {
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId, kind: "pull-request", repositoryId,
    displayName: "PR #506", pullRequest: { host: "github.com", owner: "example", repository: "t506-selected-pr", number: 506, state: "open", baseSha: "base", headSha: head },
    files: { file: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: "file", currentPath: "src/review.ts", previousPaths: [], revisionId: head, modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }], originalReviewedByDiff: {}, contentHash: hash(beforeText), lineCount: 2, updatedAt: "2026-08-17T00:00:00.000Z" } },
    createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z"
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId, currentRevisionId: head,
    files: { file: { fileId: "file", currentPath: "src/review.ts", revisionId: head, reviewed: [{ startLine: 0, endLineExclusive: 2 }], contentHash: hash(beforeText), updatedAt: "2026-08-17T00:00:00.000Z" } }, updatedAt: "2026-08-17T00:00:00.000Z"
  };
  return { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState };
};

test("T506 maps a live edit into the accepted saved pull-request owner", async () => {
  let current = initial();
  const target: ReviewStateRepositoryTarget = { kind: "pull-request", repositoryId, contextId };
  const runtime = new DocumentReviewEditRuntime({
    storageUris: { globalStorageUri: { fsPath: "/unused" }, storageUri: { fsPath: "/unused" } },
    repository: {
      load: async (value: ReviewStateRepositoryTarget) => value.kind === target.kind && value.repositoryId === target.repositoryId && value.contextId === target.contextId ? current : undefined,
      commit: async (transaction: Readonly<ReviewStateTransactionLike>) => { current = transaction.next as ReviewStateCommit; }
    },
    historyRecorder: { recordDocumentEditMapping: async () => undefined },
    gitInspector: { inspectRepository: async () => ({ kind: "repository" as const, repository: { gitVersion: "2.50.0", rootPath: "/repo", repositoryId, branch: { kind: "branch" as const, fullRef: "refs/heads/main" }, head } }) },
    stableHash: { digest: hash }, now: () => new Date("2026-08-17T00:01:00.000Z")
  } as never);
  runtime.observe(snapshot(beforeText));
  assert.equal(await runtime.apply({
    after: snapshot(afterText),
    changes: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, rangeOffset: beforeText.indexOf("const second"), rangeLength: 0, text: "const inserted = 9;\n" }],
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    selectedContext: { kind: "pull-request", repositoryId, repositoryRoot: "/repo", contextId, pullRequestNumber: 506, headRevision: head }
  }), "applied");
  assert.deepEqual(current.contextState.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]);
  assert.deepEqual(current.globalState.files.file?.reviewed, [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]);
});

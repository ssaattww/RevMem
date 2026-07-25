import assert from "node:assert/strict";
import test from "node:test";

import type { DiffHunk, DiffLine, PullRequestFileChange, ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import { calculatePullRequestDiffProgress } from "../../src/core/pr-progress/index";

const line = (kind: DiffLine["kind"], oldLine?: number, newLine?: number): DiffLine => ({ kind, oldLine, newLine, text: kind });
const hunk = (oldStart: number, newStart: number, lines: readonly DiffLine[]): DiffHunk => ({
  oldStart,
  oldCount: lines.filter(({ kind }) => kind !== "addition").length,
  newStart,
  newCount: lines.filter(({ kind }) => kind !== "deletion").length,
  lines: [...lines]
});
const file = (
  fileId: string,
  status: PullRequestFileChange["status"],
  oldPath: string | undefined,
  newPath: string | undefined,
  hunks: readonly DiffHunk[],
  additions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "addition").length,
  deletions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "deletion").length
): PullRequestFileChange => ({ fileId, status, oldPath, newPath, additions, deletions, hunks: [...hunks] });

const context = (
  baseSha = "base",
  headSha = "head",
  modified: Record<string, Array<[number, number]>> = {},
  original: Record<string, Array<[number, number]>> = {}
): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "pr-context",
  kind: "pull-request",
  repositoryId: "repo",
  displayName: "PR #25",
  pullRequest: { host: "github.com", owner: "ssaattww", repository: "RevMem", number: 25, state: "open", baseSha, headSha },
  files: Object.fromEntries([...new Set([...Object.keys(modified), ...Object.keys(original)])].map((fileId) => [fileId, {
    schemaVersion: 1,
    fileId,
    currentPath: `${fileId}.ts`,
    previousPaths: [],
    revisionId: headSha,
    modifiedReviewed: (modified[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive })),
    originalReviewedByDiff: { [`${baseSha}..${headSha}`]: (original[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive })) },
    lineCount: 100,
    updatedAt: "2026-07-25T00:00:00Z"
  }])),
  createdAt: "2026-07-25T00:00:00Z",
  updatedAt: "2026-07-25T00:00:00Z"
});

const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });
const calculate = (files: readonly PullRequestFileChange[], reviewContext = context()) => calculatePullRequestDiffProgress({
  files,
  reviewContext,
  expectedContext: { contextId: "pr-context", baseSha: "base", headSha: "head", originalDiffId: "base..head" },
  exclusionPolicy: policy
});

test("counts only actual changed lines from the current PR context", () => {
  const change = file("a", "modified", "src/a.ts", "src/a.ts", [hunk(1, 1, [
    line("context", 1, 1), line("deletion", 2), line("addition", undefined, 2), line("addition", undefined, 3), line("context", 3, 4)
  ])]);
  const result = calculate([change], context("base", "head", { a: [[0, 3]] }, { a: [[0, 2]] }));
  assert.equal(result.reviewedLineCount, 3);
  assert.equal(result.totalLineCount, 3);
  assert.equal(result.progress, 1);
});

test("rejects statistics that do not exactly match unique hunk coordinates", () => {
  const oneAddition = [hunk(1, 1, [line("addition", undefined, 1)])];
  assert.throws(() => calculate([file("too-many", "modified", "a.ts", "a.ts", oneAddition, 2, 0)]), /addition statistics mismatch/);
  assert.throws(() => calculate([file("too-few", "modified", "a.ts", "a.ts", oneAddition, 0, 0)]), /addition statistics mismatch/);
  const duplicate = [hunk(1, 1, [line("addition", undefined, 1)]), hunk(1, 1, [line("addition", undefined, 1)])];
  assert.throws(() => calculate([file("duplicate", "modified", "a.ts", "a.ts", duplicate, 2, 0)]), /duplicate addition coordinate/);
  assert.throws(() => calculate([file("missing", "modified", "a.ts", "a.ts", [hunk(1, 1, [{ kind: "addition", text: "x" }])], 1, 0)]), /missing newLine/);
});

test("rejects non-PR, wrong context and stale revision state", () => {
  const change = file("a", "added", undefined, "a.ts", [hunk(0, 1, [line("addition", undefined, 1)])]);
  assert.throws(() => calculatePullRequestDiffProgress({ files: [change], reviewContext: { ...context(), kind: "branch", pullRequest: undefined }, expectedContext: { contextId: "pr-context", baseSha: "base", headSha: "head", originalDiffId: "base..head" }, exclusionPolicy: policy }), /pull-request context/);
  assert.throws(() => calculatePullRequestDiffProgress({ files: [change], reviewContext: context(), expectedContext: { contextId: "other", baseSha: "base", headSha: "head", originalDiffId: "base..head" }, exclusionPolicy: policy }), /contextId mismatch/);
  assert.throws(() => calculate([change], context("old-base", "old-head")), /revision mismatch/);
});

test("preserves additions, deletions and rename-only classification in file results", () => {
  const changed = file("mod", "modified", "a.ts", "a.ts", [hunk(7, 7, [line("deletion", 7), line("addition", undefined, 7)])]);
  const renamed = file("rename", "renamed", "old.ts", "new.ts", []);
  const result = calculate([changed, renamed], context("base", "head", { mod: [[6, 7]] }, { mod: [[6, 7]] }));
  assert.deepEqual(result.files.map(({ additions, deletions, status }) => ({ additions, deletions, status })), [
    { additions: 1, deletions: 1, status: "modified" },
    { additions: 0, deletions: 0, status: "renamed" }
  ]);
});

test("excludes configured and binary files without erasing source counts", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("generated", "modified", "generated/a.ts", "generated/a.ts", [hunk(1, 1, [line("addition", undefined, 1)])]), file("binary", "binary", "logo.png", "logo.png", [], 10, 3)],
    reviewContext: context(),
    expectedContext: { contextId: "pr-context", baseSha: "base", headSha: "head", originalDiffId: "base..head" },
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] })
  });
  assert.equal(result.totalLineCount, 0);
  assert.deepEqual(result.files.map(({ additions, deletions, excluded }) => ({ additions, deletions, excluded })), [
    { additions: 1, deletions: 0, excluded: true },
    { additions: 10, deletions: 3, excluded: true }
  ]);
});
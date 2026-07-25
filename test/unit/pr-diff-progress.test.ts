import assert from "node:assert/strict";
import test from "node:test";

import type { DiffHunk, DiffLine, PullRequestFileChange, ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import {
  calculatePullRequestDiffProgress,
  type PullRequestDiffSnapshot
} from "../../src/core/pr-progress/index";

const line = (kind: DiffLine["kind"], oldLine?: number, newLine?: number): DiffLine => ({
  kind,
  oldLine,
  newLine,
  text: kind
});

const hunk = (
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
  lines: readonly DiffLine[]
): DiffHunk => ({ oldStart, oldCount, newStart, newCount, lines: [...lines] });

const file = (
  fileId: string,
  status: PullRequestFileChange["status"],
  oldPath: string | undefined,
  newPath: string | undefined,
  hunks: readonly DiffHunk[],
  additions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "addition").length,
  deletions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "deletion").length
): PullRequestFileChange => ({ fileId, status, oldPath, newPath, additions, deletions, hunks: [...hunks] });

const snapshot = (
  files: readonly PullRequestFileChange[],
  baseSha = "base",
  headSha = "head",
  contextId = "pr-context"
): PullRequestDiffSnapshot => ({
  contextId,
  baseSha,
  headSha,
  originalDiffId: `${baseSha}..${headSha}`,
  files
});

const context = (
  baseSha = "base",
  headSha = "head",
  modified: Record<string, Array<[number, number]>> = {},
  original: Record<string, Array<[number, number]>> = {},
  kind: ReviewContextState["kind"] = "pull-request"
): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "pr-context",
  kind,
  repositoryId: "repo",
  displayName: "PR #25",
  pullRequest: kind === "pull-request" ? {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 25,
    state: "open",
    baseSha,
    headSha
  } : undefined,
  files: Object.fromEntries([...new Set([...Object.keys(modified), ...Object.keys(original)])].map((fileId) => [fileId, {
    schemaVersion: 1,
    fileId,
    currentPath: `${fileId}.ts`,
    previousPaths: [],
    revisionId: headSha,
    modifiedReviewed: (modified[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive })),
    originalReviewedByDiff: {
      [`${baseSha}..${headSha}`]: (original[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive }))
    },
    lineCount: 100,
    updatedAt: "2026-07-25T00:00:00Z"
  }])),
  createdAt: "2026-07-25T00:00:00Z",
  updatedAt: "2026-07-25T00:00:00Z"
});

const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });
const calculate = (diff: PullRequestDiffSnapshot, reviewContext = context()) => calculatePullRequestDiffProgress({
  diff,
  reviewContext,
  exclusionPolicy: policy
});

test("counts valid addition, deletion and replacement lines from the current PR snapshot", () => {
  const added = file("add", "added", undefined, "add.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 1)])
  ]);
  const deleted = file("del", "deleted", "del.ts", undefined, [
    hunk(1, 1, 0, 0, [line("deletion", 1)])
  ]);
  const replaced = file("mod", "modified", "mod.ts", "mod.ts", [
    hunk(7, 1, 7, 1, [line("deletion", 7), line("addition", undefined, 7)])
  ]);
  const result = calculate(snapshot([added, deleted, replaced]), context(
    "base",
    "head",
    { add: [[0, 1]], mod: [[6, 7]] },
    { del: [[0, 1]], mod: [[6, 7]] }
  ));

  assert.equal(result.reviewedLineCount, 4);
  assert.equal(result.totalLineCount, 4);
  assert.equal(result.progress, 1);
});

test("accepts a valid later hunk after zero-count addition and deletion hunks", () => {
  const afterAddition = file("add-gap", "modified", "a.ts", "a.ts", [
    hunk(1, 0, 2, 1, [line("addition", undefined, 2)]),
    hunk(4, 1, 5, 1, [line("deletion", 4), line("addition", undefined, 5)])
  ]);
  const afterDeletion = file("del-gap", "modified", "d.ts", "d.ts", [
    hunk(2, 1, 1, 0, [line("deletion", 2)]),
    hunk(5, 1, 4, 1, [line("deletion", 5), line("addition", undefined, 4)])
  ]);

  assert.equal(calculate(snapshot([afterAddition, afterDeletion])).totalLineCount, 6);
});

test("rejects first-hunk delta mismatches and malformed hunk anchors", () => {
  const wrongFirstDelta = file("delta", "modified", "a.ts", "a.ts", [
    hunk(4, 1, 5, 1, [line("deletion", 4), line("addition", undefined, 5)])
  ]);
  const zeroZero = file("noop", "modified", "n.ts", "n.ts", [hunk(0, 0, 0, 0, [])]);

  assert.throws(() => calculate(snapshot([wrongFirstDelta])), /hunk delta mismatch/);
  assert.throws(() => calculate(snapshot([zeroZero])), /zero-zero/);
});

test("rejects stale diff snapshots, non-PR contexts and stale or mismatched file state", () => {
  const change = file("a", "added", undefined, "a.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 1)])
  ]);
  assert.throws(() => calculate(snapshot([change], "old-base", "old-head"), context()), /revision mismatch/);
  assert.throws(() => calculate(snapshot([change]), context("base", "head", {}, {}, "branch")), /pull-request context/);

  const stale = context("base", "head", { a: [[0, 1]] });
  stale.files.a!.revisionId = "stale";
  assert.throws(() => calculate(snapshot([change]), stale), /File review revision mismatch/);

  const mismatched = context("base", "head", { a: [[0, 1]] });
  mismatched.files.a!.fileId = "b";
  assert.throws(() => calculate(snapshot([change]), mismatched), /File review identity mismatch/);
});

test("rejects invalid diff statistics, duplicate file IDs and malformed coordinates", () => {
  const oneAddition = [hunk(0, 0, 1, 1, [line("addition", undefined, 1)])];
  assert.throws(() => calculate(snapshot([file("too-many", "added", undefined, "a.ts", oneAddition, 2, 0)])), /addition statistics mismatch/);
  assert.throws(() => calculate(snapshot([file("too-few", "added", undefined, "a.ts", oneAddition, 0, 0)])), /addition statistics mismatch/);
  assert.throws(() => calculate(snapshot([
    file("same", "added", undefined, "a.ts", oneAddition),
    file("same", "added", undefined, "b.ts", oneAddition)
  ])), /Duplicate PR diff file/);

  const wrongCoordinate = file("wrong", "added", undefined, "wrong.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 99)])
  ]);
  assert.throws(() => calculate(snapshot([wrongCoordinate])), /coordinate mismatch/);
});

test("preserves source counts and returns one hundred percent for a zero denominator", () => {
  const renamed = file("rename", "renamed", "old.ts", "new.ts", []);
  const result = calculate(snapshot([renamed]));

  assert.equal(result.progress, 1);
  assert.equal(result.files[0]?.progress, 1);
  assert.equal(result.files[0]?.totalLineCount, 0);
});

test("preserves exclusion reasons for user-glob and binary files", () => {
  const generated = file("generated", "added", undefined, "generated/a.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 1)])
  ]);
  const binary = file("binary", "binary", "logo.png", "logo.png", [], 10, 3);
  const result = calculatePullRequestDiffProgress({
    diff: snapshot([generated, binary]),
    reviewContext: context(),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] })
  });

  assert.deepEqual(result.files[0]?.exclusionReason, { kind: "user-glob", pattern: "generated/**" });
  assert.deepEqual(result.files[1]?.exclusionReason, { kind: "binary" });
  assert.equal(result.files[1]?.additions, 10);
  assert.equal(result.files[1]?.deletions, 3);
});

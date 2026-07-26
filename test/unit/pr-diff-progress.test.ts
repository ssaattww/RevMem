import assert from "node:assert/strict";
import test from "node:test";

import type { DiffHunk, DiffLine, PullRequestFileChange, ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import { calculatePullRequestDiffProgress, type PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";

const line = (kind: DiffLine["kind"], oldLine?: number, newLine?: number): DiffLine => ({ kind, oldLine, newLine, text: kind });
const hunk = (oldStart: number, oldCount: number, newStart: number, newCount: number, lines: readonly DiffLine[]): DiffHunk => ({ oldStart, oldCount, newStart, newCount, lines: [...lines] });
const file = (fileId: string, status: PullRequestFileChange["status"], oldPath: string | undefined, newPath: string | undefined, hunks: readonly DiffHunk[], additions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "addition").length, deletions = hunks.flatMap(({ lines }) => lines).filter(({ kind }) => kind === "deletion").length): PullRequestFileChange => ({ fileId, status, oldPath, newPath, additions, deletions, hunks: [...hunks] });
const snapshot = (files: readonly PullRequestFileChange[], baseSha = "base", headSha = "head", contextId = "pr-context"): PullRequestDiffSnapshot => ({ contextId, baseSha, headSha, originalDiffId: `${baseSha}..${headSha}`, files });
const context = (baseSha = "base", headSha = "head", modified: Record<string, Array<[number, number]>> = {}, original: Record<string, Array<[number, number]>> = {}, kind: ReviewContextState["kind"] = "pull-request"): ReviewContextState => ({
  schemaVersion: 1, contextId: "pr-context", kind, repositoryId: "repo", displayName: "PR #25",
  pullRequest: kind === "pull-request" ? { host: "github.com", owner: "ssaattww", repository: "RevMem", number: 25, state: "open", baseSha, headSha } : undefined,
  files: Object.fromEntries([...new Set([...Object.keys(modified), ...Object.keys(original)])].map((fileId) => [fileId, { schemaVersion: 1, fileId, currentPath: `${fileId}.ts`, previousPaths: [], revisionId: headSha, modifiedReviewed: (modified[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive })), originalReviewedByDiff: { [`${baseSha}..${headSha}`]: (original[fileId] ?? []).map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive })) }, lineCount: 100, updatedAt: "2026-07-25T00:00:00Z" }])),
  createdAt: "2026-07-25T00:00:00Z", updatedAt: "2026-07-25T00:00:00Z"
});
const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });
const calculate = (diff: PullRequestDiffSnapshot, reviewContext = context()) => calculatePullRequestDiffProgress({ diff, reviewContext, exclusionPolicy: policy });
const addition = (id = "add", path = "add.ts", count = 1) => file(id, "added", undefined, path, count === 0 ? [] : [hunk(0, 0, 1, count, Array.from({ length: count }, (_, index) => line("addition", undefined, index + 1)))]);
const deletion = (id = "del", path = "del.ts", count = 1) => file(id, "deleted", path, undefined, count === 0 ? [] : [hunk(1, count, 0, 0, Array.from({ length: count }, (_, index) => line("deletion", index + 1)))]);

test("reports file and aggregate partial progress", () => {
  const added = addition("add", "add.ts", 2);
  const deleted = deletion();
  const result = calculate(snapshot([added, deleted]), context("base", "head", { add: [[0, 1]] }));
  assert.deepEqual(result.files.map(({ reviewedLineCount, totalLineCount, progress }) => ({ reviewedLineCount, totalLineCount, progress })), [
    { reviewedLineCount: 1, totalLineCount: 2, progress: 0.5 },
    { reviewedLineCount: 0, totalLineCount: 1, progress: 0 }
  ]);
  assert.deepEqual({ reviewed: result.reviewedLineCount, total: result.totalLineCount, progress: result.progress }, { reviewed: 1, total: 3, progress: 1 / 3 });
});

test("rejects partial added and deleted file patches", () => {
  const partialAdded = file("added", "added", undefined, "added.ts", [hunk(99, 0, 100, 1, [line("addition", undefined, 100)])]);
  const partialDeleted = file("deleted", "deleted", "deleted.ts", undefined, [hunk(100, 1, 99, 0, [line("deletion", 100)])]);
  assert.throws(() => calculate(snapshot([partialAdded])), /complete|status matrix/);
  assert.throws(() => calculate(snapshot([partialDeleted])), /complete|status matrix/);
});

test("binds complete modified-side hunk extent to state lineCount", () => {
  const deletionOnly = file("a", "modified", "a.ts", "a.ts", [hunk(100, 1, 99, 0, [line("deletion", 100)])]);
  const state = context("base", "head", { a: [] });
  state.files.a!.currentPath = "a.ts";
  state.files.a!.lineCount = 1;
  assert.throws(() => calculate(snapshot([deletionOnly]), state), /lineCount/);
});

test("rejects misrouted currentPath and validates excluded state", () => {
  const change = addition("a", "src/a.ts");
  const wrongPath = context("base", "head", { a: [[0, 1]] });
  wrongPath.files.a!.currentPath = "src/other.ts";
  assert.throws(() => calculate(snapshot([change]), wrongPath), /currentPath/);

  const excludedState = context("base", "head", { generated: [[0, 1]] });
  excludedState.files.generated!.currentPath = "generated/a.ts";
  excludedState.files.generated!.revisionId = "stale";
  assert.throws(() => calculatePullRequestDiffProgress({ diff: snapshot([addition("generated", "generated/a.ts")]), reviewContext: excludedState, exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) }), /revision mismatch/);
});

test("handles huge reviewed intervals without expanding every line", () => {
  const change = addition("a", "a.ts");
  const state = context("base", "head", { a: [[0, Number.MAX_SAFE_INTEGER]] });
  state.files.a!.currentPath = "a.ts";
  state.files.a!.lineCount = Number.MAX_SAFE_INTEGER;
  const result = calculate(snapshot([change]), state);
  assert.equal(result.reviewedLineCount, 1);
});

test("validates malformed nonbinary files even when excluded", () => {
  const malformed = file("generated", "added", undefined, "generated/a.ts", [hunk(0, 0, 1, 1, [{ kind: "future", newLine: 1, text: "x" } as unknown as DiffLine])]);
  assert.throws(() => calculatePullRequestDiffProgress({ diff: snapshot([malformed]), reviewContext: context(), exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) }), /Unknown diff line kind/);
});

test("enforces status path and hunk-side invariants", () => {
  assert.throws(() => calculate(snapshot([file("modified-path", "modified", "old.ts", "new.ts", [hunk(1, 1, 1, 1, [line("deletion", 1), line("addition", undefined, 1)])])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("rename-same", "renamed", "same.ts", "./same.ts", [])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("copy-same", "copied", "same.ts", "same.ts", [])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("secondary-path", "modified", "../outside.ts", "../outside.ts", [])])), /path|repository/i);
});

test("retains context, state, runtime union and hunk regressions", () => {
  const change = addition("a", "a.ts");
  assert.throws(() => calculate({ ...snapshot([change]), contextId: "other" }), /contextId mismatch/);
  assert.throws(() => calculate({ ...snapshot([change]), originalDiffId: "other" }), /originalDiffId/);
  assert.throws(() => calculate(snapshot([change]), context("base", "head", {}, {}, "branch")), /pull-request context/);
  const stale = context("base", "head", { a: [[0, 1]] }); stale.files.a!.revisionId = "stale";
  assert.throws(() => calculate(snapshot([change]), stale), /revision mismatch/);
  const unknownStatus = { ...change, status: "future" } as unknown as PullRequestFileChange;
  assert.throws(() => calculate(snapshot([unknownStatus])), /Unknown PR file status/);
  assert.throws(() => calculate(snapshot([file("context-only", "modified", "a.ts", "a.ts", [hunk(1, 1, 1, 1, [line("context", 1, 1)])])])), /changed line/);
  assert.throws(() => calculate(snapshot([file("zero", "modified", "a.ts", "a.ts", [hunk(0, 0, 0, 0, [])])])), /changed line|zero-zero/);
  assert.throws(() => calculate(snapshot([file("stats", "added", undefined, "a.ts", [hunk(0, 0, 1, 1, [line("addition", undefined, 1)])], 2, 0)])), /statistics|complete/);
  assert.throws(() => calculate(snapshot([addition("same", "a.ts"), addition("same", "b.ts")])), /Duplicate PR diff file/);
  assert.throws(() => calculate(snapshot([addition("one", "./src/a.ts"), addition("two", "src/a.ts")])), /Duplicate PR diff path/);
});

test("preserves rename zero denominator and exclusion contracts", () => {
  const renamed = file("rename", "renamed", "old.ts", "new.ts", []);
  const included = addition("included", "src/a.ts");
  const generated = addition("generated", "generated/a.ts");
  const binary = file("binary", "binary", "logo.png", "logo.png", [], 10, 3);
  const state = context("base", "head", { included: [[0, 1]] });
  state.files.included!.currentPath = "src/a.ts";
  const result = calculatePullRequestDiffProgress({ diff: snapshot([renamed, included, generated, binary]), reviewContext: state, exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) });
  assert.equal(result.files[0]?.progress, 1);
  assert.deepEqual(result.files[2]?.exclusionReason, { kind: "user-glob", pattern: "generated/**" });
  assert.deepEqual(result.files[3]?.exclusionReason, { kind: "binary" });
  assert.deepEqual({ reviewed: result.reviewedLineCount, total: result.totalLineCount, progress: result.progress }, { reviewed: 1, total: 1, progress: 1 });
});

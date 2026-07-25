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
const addition = (id = "add", path = "add.ts", coordinate = 1) => file(id, "added", undefined, path, [hunk(0, 0, coordinate, 1, [line("addition", undefined, coordinate)])]);

test("reports file and aggregate partial progress", () => {
  const added = file("add", "added", undefined, "add.ts", [hunk(0, 0, 1, 2, [line("addition", undefined, 1), line("addition", undefined, 2)])]);
  const deleted = file("del", "deleted", "del.ts", undefined, [hunk(1, 1, 0, 0, [line("deletion", 1)])]);
  const result = calculate(snapshot([added, deleted]), context("base", "head", { add: [[0, 1]] }));
  assert.deepEqual(result.files.map(({ reviewedLineCount, totalLineCount, progress }) => ({ reviewedLineCount, totalLineCount, progress })), [
    { reviewedLineCount: 1, totalLineCount: 2, progress: 0.5 },
    { reviewedLineCount: 0, totalLineCount: 1, progress: 0 }
  ]);
  assert.deepEqual({ reviewed: result.reviewedLineCount, total: result.totalLineCount, progress: result.progress }, { reviewed: 1, total: 3, progress: 1 / 3 });
});

test("validates malformed nonbinary files even when excluded", () => {
  const malformed = file("generated", "added", undefined, "generated/a.ts", [hunk(0, 0, 1, 1, [{ kind: "future", newLine: 1, text: "x" } as unknown as DiffLine])]);
  assert.throws(() => calculatePullRequestDiffProgress({ diff: snapshot([malformed]), reviewContext: context(), exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) }), /Unknown diff line kind/);
});

test("enforces status path and hunk-side invariants", () => {
  assert.throws(() => calculate(snapshot([file("modified-path", "modified", "old.ts", "new.ts", [hunk(1, 1, 1, 1, [line("deletion", 1), line("addition", undefined, 1)])])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("rename-same", "renamed", "same.ts", "./same.ts", [])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("copy-same", "copied", "same.ts", "same.ts", [])])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("added-old-side", "added", undefined, "a.ts", [hunk(1, 1, 1, 1, [line("context", 1, 1), line("addition", undefined, 2)])], 1, 0)])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("deleted-new-side", "deleted", "a.ts", undefined, [hunk(1, 1, 1, 1, [line("context", 1, 1), line("deletion", 2)])], 0, 1)])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("secondary-path", "modified", "../outside.ts", "../outside.ts", [])])), /path|repository/i);
});

test("rejects modified diff coordinates beyond review-state lineCount", () => {
  const change = addition("a", "a.ts", 100);
  const state = context("base", "head", { a: [] });
  state.files.a!.lineCount = 1;
  assert.throws(() => calculate(snapshot([change]), state), /lineCount/);
});

test("reports excluded files without affecting aggregate counts", () => {
  const included = addition("included", "src/a.ts");
  const generated = addition("generated", "generated/a.ts");
  const binary = file("binary", "binary", "logo.png", "logo.png", [], 10, 3);
  const result = calculatePullRequestDiffProgress({ diff: snapshot([included, generated, binary]), reviewContext: context("base", "head", { included: [[0, 1]] }), exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) });
  assert.deepEqual({ reviewed: result.reviewedLineCount, total: result.totalLineCount, progress: result.progress }, { reviewed: 1, total: 1, progress: 1 });
  assert.deepEqual(result.files.map(({ excluded, reviewedLineCount, totalLineCount, progress }) => ({ excluded, reviewedLineCount, totalLineCount, progress })), [
    { excluded: false, reviewedLineCount: 1, totalLineCount: 1, progress: 1 },
    { excluded: true, reviewedLineCount: 0, totalLineCount: 0, progress: 1 },
    { excluded: true, reviewedLineCount: 0, totalLineCount: 0, progress: 1 }
  ]);
});

test("retains cumulative identity, coordinate, hunk and duplicate regressions", () => {
  const change = addition("a", "a.ts");
  assert.throws(() => calculate({ ...snapshot([change]), contextId: "other" }), /contextId mismatch/);
  assert.throws(() => calculate({ ...snapshot([change]), originalDiffId: "other" }), /originalDiffId/);
  assert.throws(() => calculate(snapshot([file("opposite", "added", undefined, "a.ts", [hunk(0, 0, 1, 1, [line("addition", 1, 1)])])])), /must not have oldLine/);
  assert.throws(() => calculate(snapshot([file("context", "modified", "a.ts", "a.ts", [hunk(1, 1, 1, 1, [line("context", 1, 2), line("deletion", 2), line("addition", undefined, 2)])])])), /coordinate mismatch|header\/body/);
  const wrongGap = file("gap", "modified", "a.ts", "a.ts", [hunk(1, 0, 2, 1, [line("addition", undefined, 2)]), hunk(4, 1, 6, 1, [line("deletion", 4), line("addition", undefined, 6)])]);
  assert.throws(() => calculate(snapshot([wrongGap])), /delta mismatch|gap mismatch/);
  const duplicate = file("dup", "modified", "a.ts", "a.ts", [hunk(1, 0, 2, 1, [line("addition", undefined, 2)]), hunk(1, 0, 2, 1, [line("addition", undefined, 2)])], 2, 0);
  assert.throws(() => calculate(snapshot([duplicate])), /duplicate addition|order mismatch/i);
});

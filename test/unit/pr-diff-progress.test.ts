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
const addition = (id = "add", path = "add.ts") => file(id, "added", undefined, path, [hunk(0, 0, 1, 1, [line("addition", undefined, 1)])]);

test("counts valid addition, deletion and replacement lines", () => {
  const added = addition();
  const deleted = file("del", "deleted", "del.ts", undefined, [hunk(1, 1, 0, 0, [line("deletion", 1)])]);
  const replaced = file("mod", "modified", "mod.ts", "mod.ts", [hunk(7, 1, 7, 1, [line("deletion", 7), line("addition", undefined, 7)])]);
  const result = calculate(snapshot([added, deleted, replaced]), context("base", "head", { add: [[0, 1]], mod: [[6, 7]] }, { del: [[0, 1]], mod: [[6, 7]] }));
  assert.equal(result.reviewedLineCount, 4);
  assert.equal(result.totalLineCount, 4);
});

test("accepts cumulative delta across zero-count addition and deletion hunks", () => {
  const afterAddition = file("add-gap", "modified", "a.ts", "a.ts", [hunk(1, 0, 2, 1, [line("addition", undefined, 2)]), hunk(4, 1, 5, 1, [line("deletion", 4), line("addition", undefined, 5)])]);
  const afterDeletion = file("del-gap", "modified", "d.ts", "d.ts", [hunk(2, 1, 1, 0, [line("deletion", 2)]), hunk(5, 1, 4, 1, [line("deletion", 5), line("addition", undefined, 4)])]);
  assert.equal(calculate(snapshot([afterAddition, afterDeletion])).totalLineCount, 6);
});

test("rejects identity, context and state corruption", () => {
  const change = addition("a", "a.ts");
  assert.throws(() => calculate({ ...snapshot([change]), contextId: "other" }), /contextId mismatch/);
  assert.throws(() => calculate({ ...snapshot([change]), originalDiffId: "other" }), /originalDiffId/);
  assert.throws(() => calculate(snapshot([change], "old", "stale")), /revision mismatch/);
  assert.throws(() => calculate(snapshot([change]), context("base", "head", {}, {}, "branch")), /pull-request context/);
  const stale = context("base", "head", { a: [[0, 1]] }); stale.files.a!.revisionId = "stale";
  assert.throws(() => calculate(snapshot([change]), stale), /revision mismatch/);
  const mismatched = context("base", "head", { a: [[0, 1]] }); mismatched.files.a!.fileId = "b";
  assert.throws(() => calculate(snapshot([change]), mismatched), /identity mismatch/);
  const outOfBounds = context("base", "head", { a: [[99, 100]] }); outOfBounds.files.a!.lineCount = 1;
  assert.throws(() => calculate(snapshot([change]), outOfBounds), /lineCount/);
});

test("rejects unknown runtime unions and invalid status matrices", () => {
  const unknownKind = addition() as PullRequestFileChange;
  (unknownKind.hunks[0]!.lines[0] as { kind: string }).kind = "future";
  assert.throws(() => calculate(snapshot([unknownKind])), /Unknown diff line kind/);
  const unknownStatus = { ...addition(), status: "future" } as unknown as PullRequestFileChange;
  assert.throws(() => calculate(snapshot([unknownStatus])), /Unknown PR file status/);
  assert.throws(() => calculate(snapshot([file("bad-added", "added", "old.ts", "new.ts", [], 0, 0)])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("bad-deleted", "deleted", "old.ts", "new.ts", [], 0, 0)])), /status matrix/);
  assert.throws(() => calculate(snapshot([file("bad-mod", "modified", undefined, "new.ts", [], 0, 0)])), /status matrix/);
});

test("rejects malformed hunks and coordinates cumulatively", () => {
  assert.throws(() => calculate(snapshot([file("context-only", "modified", "a.ts", "a.ts", [hunk(1, 1, 1, 1, [line("context", 1, 1)])])])), /changed line/);
  assert.throws(() => calculate(snapshot([file("zero", "modified", "a.ts", "a.ts", [hunk(0, 0, 0, 0, [])])])), /changed line|zero-zero/);
  assert.throws(() => calculate(snapshot([file("wrong", "added", undefined, "a.ts", [hunk(0, 0, 1, 1, [line("addition", undefined, 99)])])])), /coordinate mismatch/);
  assert.throws(() => calculate(snapshot([file("opposite", "added", undefined, "a.ts", [hunk(0, 0, 1, 1, [line("addition", 1, 1)])])])), /must not have oldLine/);
  assert.throws(() => calculate(snapshot([file("context", "modified", "a.ts", "a.ts", [hunk(1, 1, 1, 1, [line("context", 1, 2), line("deletion", 2), line("addition", undefined, 2)])])])), /coordinate mismatch|header\/body/);
  assert.throws(() => calculate(snapshot([file("delta", "modified", "a.ts", "a.ts", [hunk(4, 1, 5, 1, [line("deletion", 4), line("addition", undefined, 5)])])])), /delta mismatch/);
  const duplicate = file("dup", "modified", "a.ts", "a.ts", [hunk(1, 0, 2, 1, [line("addition", undefined, 2)]), hunk(1, 0, 2, 1, [line("addition", undefined, 2)])], 2, 0);
  assert.throws(() => calculate(snapshot([duplicate])), /duplicate addition|order mismatch/i);
});

test("rejects statistics, duplicate identities and canonical paths", () => {
  const one = [hunk(0, 0, 1, 1, [line("addition", undefined, 1)])];
  assert.throws(() => calculate(snapshot([file("many", "added", undefined, "a.ts", one, 2, 0)])), /statistics mismatch/);
  assert.throws(() => calculate(snapshot([addition("same", "a.ts"), addition("same", "b.ts")])), /Duplicate PR diff file/);
  assert.throws(() => calculate(snapshot([addition("a", "./src/a.ts"), addition("b", "src/a.ts")])), /Duplicate PR diff path/);
});

test("preserves zero denominator and exclusion contracts", () => {
  const renamed = file("rename", "renamed", "old.ts", "new.ts", []);
  const generated = addition("generated", "generated/a.ts");
  const binary = file("binary", "binary", "logo.png", "logo.png", [], 10, 3);
  const result = calculatePullRequestDiffProgress({ diff: snapshot([renamed, generated, binary]), reviewContext: context(), exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] }) });
  assert.equal(result.files[0]?.progress, 1);
  assert.deepEqual(result.files[1]?.exclusionReason, { kind: "user-glob", pattern: "generated/**" });
  assert.deepEqual(result.files[2]?.exclusionReason, { kind: "binary" });
  assert.equal(result.files[2]?.additions, 10);
});
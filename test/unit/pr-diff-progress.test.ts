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
  original: Record<string, Array<[number, number]>> = {}
): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "pr-context",
  kind: "pull-request",
  repositoryId: "repo",
  displayName: "PR #25",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 25,
    state: "open",
    baseSha,
    headSha
  },
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

test("rejects stale diff snapshots even when the caller supplies current review state", () => {
  const change = file("a", "added", undefined, "a.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 1)])
  ]);
  assert.throws(() => calculate(snapshot([change], "old-base", "old-head"), context()), /revision mismatch/);
  assert.throws(() => calculate({ ...snapshot([change]), contextId: "other" }, context()), /contextId mismatch/);
  assert.throws(() => calculate({ ...snapshot([change]), originalDiffId: "unrelated" }, context()), /originalDiffId/);
});

test("validates line coordinates, opposite-side absence and source-order cursors", () => {
  const wrongCoordinate = file("wrong", "added", undefined, "wrong.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 99)])
  ]);
  const oppositeSide = file("opposite", "added", undefined, "opposite.ts", [
    hunk(0, 0, 1, 1, [line("addition", 1, 1)])
  ]);
  const wrongContext = file("context", "modified", "context.ts", "context.ts", [
    hunk(1, 1, 1, 1, [line("context", 1, 2)])
  ]);

  assert.throws(() => calculate(snapshot([wrongCoordinate])), /coordinate mismatch/);
  assert.throws(() => calculate(snapshot([oppositeSide])), /must not have oldLine/);
  assert.throws(() => calculate(snapshot([wrongContext])), /coordinate mismatch/);
});

test("validates multiple-hunk ordering, unchanged gaps and duplicate actual coordinates", () => {
  const valid = file("valid", "modified", "valid.ts", "valid.ts", [
    hunk(1, 2, 1, 2, [line("context", 1, 1), line("deletion", 2), line("addition", undefined, 2)]),
    hunk(5, 2, 5, 3, [line("context", 5, 5), line("addition", undefined, 6), line("context", 6, 7)])
  ]);
  assert.equal(calculate(snapshot([valid])).totalLineCount, 3);

  const wrongGap = file("gap", "modified", "gap.ts", "gap.ts", [
    hunk(1, 2, 1, 2, [line("context", 1, 1), line("deletion", 2), line("addition", undefined, 2)]),
    hunk(5, 1, 6, 1, [line("context", 5, 6)])
  ]);
  assert.throws(() => calculate(snapshot([wrongGap])), /hunk gap mismatch/);

  const duplicate = file("duplicate", "modified", "duplicate.ts", "duplicate.ts", [
    hunk(1, 0, 1, 1, [line("addition", undefined, 1)]),
    hunk(1, 0, 1, 1, [line("addition", undefined, 1)])
  ], 2, 0);
  assert.throws(() => calculate(snapshot([duplicate])), /duplicate addition coordinate/i);
});

test("preserves source counts and returns one hundred percent for a zero denominator", () => {
  const renamed = file("rename", "renamed", "old.ts", "new.ts", []);
  const result = calculate(snapshot([renamed]));

  assert.equal(result.progress, 1);
  assert.deepEqual(result.files[0], {
    fileId: "rename",
    oldPath: "old.ts",
    newPath: "new.ts",
    status: "renamed",
    path: "new.ts",
    additions: 0,
    deletions: 0,
    reviewedLineCount: 0,
    totalLineCount: 0,
    progress: 1,
    excluded: false
  });
});

test("preserves source counts and exclusion reason for excluded files", () => {
  const generated = file("generated", "added", undefined, "generated/a.ts", [
    hunk(0, 0, 1, 1, [line("addition", undefined, 1)])
  ]);
  const result = calculatePullRequestDiffProgress({
    diff: snapshot([generated]),
    reviewContext: context(),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] })
  });

  assert.equal(result.totalLineCount, 0);
  assert.deepEqual(result.files[0]?.exclusionReason, { kind: "user-glob", pattern: "generated/**" });
  assert.equal(result.files[0]?.additions, 1);
});

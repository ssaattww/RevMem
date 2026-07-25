import assert from "node:assert/strict";
import test from "node:test";

import type { DiffLine, PullRequestFileChange } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import {
  calculatePullRequestDiffProgress,
  type ReviewedPullRequestDiffLines
} from "../../src/core/pr-progress/index";

const line = (kind: DiffLine["kind"], oldLine?: number, newLine?: number): DiffLine => ({
  kind,
  oldLine,
  newLine,
  text: kind
});

const file = (
  fileId: string,
  status: PullRequestFileChange["status"],
  oldPath: string | undefined,
  newPath: string | undefined,
  lines: readonly DiffLine[],
  additions = lines.filter(({ kind }) => kind === "addition").length,
  deletions = lines.filter(({ kind }) => kind === "deletion").length
): PullRequestFileChange => ({
  fileId,
  status,
  oldPath,
  newPath,
  additions,
  deletions,
  hunks: lines.length === 0 ? [] : [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [...lines] }]
});

const reviewed = (
  fileId: string,
  addedLines: readonly number[] = [],
  deletedLines: readonly number[] = []
): ReviewedPullRequestDiffLines => ({ fileId, addedLines, deletedLines });

const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });

test("counts only reviewed coordinates that are actual additions or deletions", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("a", "modified", "src/a.ts", "src/a.ts", [
      line("context", 1, 1),
      line("deletion", 2),
      line("addition", undefined, 2),
      line("addition", undefined, 3),
      line("context", 3, 4)
    ])],
    reviewedLines: [reviewed("a", [1, 2, 99], [1, 2, 99])],
    exclusionPolicy: policy
  });

  assert.equal(result.reviewedLineCount, 2);
  assert.equal(result.totalLineCount, 3);
  assert.equal(result.progress, 2 / 3);
});

test("covers addition-only, deletion-only, replacement, context and PR-only review state", () => {
  const result = calculatePullRequestDiffProgress({
    files: [
      file("add", "added", undefined, "src/add.ts", [line("addition", undefined, 1)]),
      file("del", "deleted", "src/del.ts", undefined, [line("deletion", 4)]),
      file("mod", "modified", "src/mod.ts", "src/mod.ts", [line("deletion", 7), line("addition", undefined, 8), line("context", 8, 9)])
    ],
    reviewedLines: [reviewed("add", [1]), reviewed("del", [], [4]), reviewed("mod", [8, 9], [7])],
    exclusionPolicy: policy
  });

  assert.equal(result.reviewedLineCount, 4);
  assert.equal(result.totalLineCount, 4);
  assert.equal(result.progress, 1);
});

test("retains rename-only classification and returns one hundred percent for zero changed lines", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("rename", "renamed", "src/old.ts", "src/new.ts", [])],
    reviewedLines: [],
    exclusionPolicy: policy
  });

  assert.deepEqual(result.files[0], {
    fileId: "rename",
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    status: "renamed",
    path: "src/new.ts",
    reviewedLineCount: 0,
    totalLineCount: 0,
    progress: 1,
    excluded: false
  });
});

test("applies user glob and binary exclusions while preserving reasons", () => {
  const result = calculatePullRequestDiffProgress({
    files: [
      file("generated", "modified", "generated/a.ts", "generated/a.ts", [line("addition", undefined, 1)]),
      file("binary", "binary", "assets/logo.png", "assets/logo.png", [])
    ],
    reviewedLines: [reviewed("generated", [1])],
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: ["generated/**"] })
  });

  assert.equal(result.totalLineCount, 0);
  assert.deepEqual(result.files[0]?.exclusionReason, { kind: "user-glob", pattern: "generated/**" });
  assert.deepEqual(result.files[1]?.exclusionReason, { kind: "binary" });
});

test("rejects duplicate file identities and invalid diff statistics", () => {
  assert.throws(() => calculatePullRequestDiffProgress({
    files: [file("same", "modified", "a.ts", "a.ts", []), file("same", "modified", "b.ts", "b.ts", [])],
    reviewedLines: [],
    exclusionPolicy: policy
  }), /Duplicate PR diff file/);
  assert.throws(() => calculatePullRequestDiffProgress({
    files: [file("bad", "modified", "a.ts", "a.ts", [], -1, 0)],
    reviewedLines: [],
    exclusionPolicy: policy
  }), /non-negative integer/);
});

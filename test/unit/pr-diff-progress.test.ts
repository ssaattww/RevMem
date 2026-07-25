import assert from "node:assert/strict";
import test from "node:test";

import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import {
  calculatePullRequestDiffProgress,
  type PullRequestDiffFile,
  type ReviewedPullRequestDiffLines
} from "../../src/core/pr-progress/index";

const file = (
  path: string,
  additions: number,
  deletions: number,
  isBinary = false
): PullRequestDiffFile => ({ path, additions, deletions, isBinary });

const reviewed = (
  path: string,
  addedLines: readonly number[] = [],
  deletedLines: readonly number[] = []
): ReviewedPullRequestDiffLines => ({ path, addedLines, deletedLines });

test("uses only added and deleted PR lines as the denominator", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("src/a.ts", 3, 2), file("src/b.ts", 1, 4)],
    reviewedLines: [reviewed("src/a.ts", [2, 4], [8]), reviewed("src/b.ts", [1], [3, 5])],
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });

  assert.equal(result.reviewedLineCount, 6);
  assert.equal(result.totalLineCount, 10);
  assert.equal(result.progress, 0.6);
  assert.deepEqual(result.files.map(({ path, progress }) => [path, progress]), [
    ["src/a.ts", 0.6],
    ["src/b.ts", 0.6]
  ]);
});

test("deduplicates reviewed line numbers and clamps unknown lines to each diff-side total", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("src/a.ts", 2, 1)],
    reviewedLines: [reviewed("src/a.ts", [4, 4, 7], [2, 9])],
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });

  assert.equal(result.reviewedLineCount, 3);
  assert.equal(result.totalLineCount, 3);
  assert.equal(result.progress, 1);
});

test("omits excluded files from numerator and denominator while retaining the exclusion reason", () => {
  const result = calculatePullRequestDiffProgress({
    files: [file("src/a.ts", 2, 2), file("dist/bundle.js", 100, 20), file("assets/logo.png", 10, 0, true)],
    reviewedLines: [reviewed("src/a.ts", [1], [1]), reviewed("dist/bundle.js", [1, 2, 3], [1]), reviewed("assets/logo.png", [1])],
    exclusionPolicy: new ReviewFileExclusionPolicy()
  });

  assert.equal(result.reviewedLineCount, 2);
  assert.equal(result.totalLineCount, 4);
  assert.equal(result.progress, 0.5);
  assert.deepEqual(result.files[1], {
    path: "dist/bundle.js",
    reviewedLineCount: 0,
    totalLineCount: 0,
    progress: 1,
    excluded: true,
    exclusionReason: { kind: "default-glob", pattern: "**/dist/**" }
  });
  assert.deepEqual(result.files[2]?.exclusionReason, { kind: "binary" });
});

test("returns one hundred percent when the included denominator is zero", () => {
  const empty = calculatePullRequestDiffProgress({
    files: [],
    reviewedLines: [],
    exclusionPolicy: new ReviewFileExclusionPolicy()
  });
  const onlyExcluded = calculatePullRequestDiffProgress({
    files: [file("dist/bundle.js", 10, 5)],
    reviewedLines: [],
    exclusionPolicy: new ReviewFileExclusionPolicy()
  });
  const metadataOnly = calculatePullRequestDiffProgress({
    files: [file("src/a.ts", 0, 0)],
    reviewedLines: [],
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });

  assert.equal(empty.progress, 1);
  assert.equal(onlyExcluded.progress, 1);
  assert.equal(metadataOnly.progress, 1);
  assert.equal(metadataOnly.files[0]?.progress, 1);
});

test("rejects duplicate file entries and invalid diff counts instead of guessing", () => {
  const policy = new ReviewFileExclusionPolicy({ userGlobs: [] });
  assert.throws(() => calculatePullRequestDiffProgress({
    files: [file("src/a.ts", 1, 0), file("src/a.ts", 0, 1)],
    reviewedLines: [],
    exclusionPolicy: policy
  }), /Duplicate PR diff file/);
  assert.throws(() => calculatePullRequestDiffProgress({
    files: [file("src/a.ts", -1, 0)],
    reviewedLines: [],
    exclusionPolicy: policy
  }), /non-negative integer/);
});

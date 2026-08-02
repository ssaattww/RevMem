import assert from "node:assert/strict";
import test from "node:test";

import type { PullRequestDiffFileProgress, PullRequestDiffProgress } from "../../src/core/pr-progress/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeFileNode
} from "../../src/ui/pr-progress/index";

const progressFile = (
  fileId: string,
  path: string,
  options: Partial<PullRequestDiffFileProgress> = {}
): PullRequestDiffFileProgress => ({
  fileId,
  oldPath: path,
  newPath: path,
  status: "modified",
  path,
  additions: 2,
  deletions: 1,
  reviewedLineCount: 0,
  totalLineCount: 3,
  progress: 0,
  excluded: false,
  ...options
});

const progress = (files: readonly PullRequestDiffFileProgress[]): PullRequestDiffProgress => {
  const included = files.filter((file) => !file.excluded);
  const reviewedLineCount = included.reduce((sum, file) => sum + file.reviewedLineCount, 0);
  const totalLineCount = included.reduce((sum, file) => sum + file.totalLineCount, 0);
  return {
    reviewedLineCount,
    totalLineCount,
    progress: totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount,
    files
  };
};

const categories = (
  provider: PullRequestProgressTreeDataProvider
): readonly PullRequestProgressTreeCategoryNode[] =>
  provider.getChildren().map((node) => {
    assert.equal(node.kind, "category");
    return node as PullRequestProgressTreeCategoryNode;
  });

const files = (
  provider: PullRequestProgressTreeDataProvider,
  category: PullRequestProgressTreeCategoryNode
): readonly PullRequestProgressTreeFileNode[] =>
  provider.getChildren(category).map((node) => {
    assert.equal(node.kind, "file");
    return node as PullRequestProgressTreeFileNode;
  });

test("classifies every PR progress file and retains counts and reasons", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  provider.replaceProgress(progress([
    progressFile("pending", "src/pending.ts", { reviewedLineCount: 1, totalLineCount: 3, progress: 1 / 3 }),
    progressFile("done", "src/done.ts", { reviewedLineCount: 3, totalLineCount: 3, progress: 1 }),
    progressFile("excluded", "generated/a.ts", {
      reviewedLineCount: 0,
      totalLineCount: 0,
      progress: 1,
      excluded: true,
      exclusionReason: { kind: "user-glob", pattern: "generated/**" }
    }),
    progressFile("rename", "src/new-name.ts", {
      oldPath: "src/old-name.ts",
      newPath: "src/new-name.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      totalLineCount: 0,
      progress: 1
    }),
    progressFile("binary", "assets/logo.png", {
      status: "binary",
      additions: 0,
      deletions: 0,
      reviewedLineCount: 0,
      totalLineCount: 0,
      progress: 1,
      excluded: true,
      exclusionReason: { kind: "binary" }
    })
  ]));

  const roots = categories(provider);
  assert.deepEqual(
    roots.map(({ category, label, fileCount }) => ({ category, label, fileCount })),
    [
      { category: "unreviewed", label: "未確認変更が残るファイル", fileCount: 1 },
      { category: "completed", label: "確認完了したファイル", fileCount: 1 },
      { category: "excluded", label: "除外されたファイル", fileCount: 1 },
      { category: "non-line-change", label: "行以外の変更", fileCount: 1 },
      { category: "line-review-unsupported", label: "行単位レビュー対象外", fileCount: 1 }
    ]
  );

  const pending = files(provider, roots[0]!)[0]!;
  assert.deepEqual(
    {
      path: pending.path,
      reviewed: pending.reviewedLineCount,
      total: pending.totalLineCount,
      progress: pending.progress,
      additions: pending.additions,
      deletions: pending.deletions,
      remaining: pending.unreviewedLineCount
    },
    {
      path: "src/pending.ts",
      reviewed: 1,
      total: 3,
      progress: 1 / 3,
      additions: 2,
      deletions: 1,
      remaining: 2
    }
  );

  assert.equal(files(provider, roots[2]!)[0]!.reason, "ユーザー除外: generated/**");
  assert.equal(files(provider, roots[4]!)[0]!.reason, "バイナリファイル");
});

test("sorts files by remaining line count descending and path ascending", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  provider.replaceProgress(progress([
    progressFile("b", "src/b.ts", { reviewedLineCount: 1, totalLineCount: 5, progress: 0.2 }),
    progressFile("a", "src/a.ts", { reviewedLineCount: 0, totalLineCount: 4, progress: 0 }),
    progressFile("z", "src/z.ts", { reviewedLineCount: 1, totalLineCount: 6, progress: 1 / 6 })
  ]));

  const unreviewed = categories(provider)[0]!;
  assert.deepEqual(
    files(provider, unreviewed).map(({ path, unreviewedLineCount }) => ({ path, unreviewedLineCount })),
    [
      { path: "src/z.ts", unreviewedLineCount: 5 },
      { path: "src/a.ts", unreviewedLineCount: 4 },
      { path: "src/b.ts", unreviewedLineCount: 4 }
    ]
  );
});

test("selecting a file delegates diff opening with the original progress record", async () => {
  const opened: PullRequestDiffFileProgress[] = [];
  const source = progressFile("pending", "src/pending.ts");
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (file) => {
      opened.push(file);
    }
  });
  provider.replaceProgress(progress([source]));

  const pending = files(provider, categories(provider)[0]!)[0]!;
  await provider.select(pending);

  assert.equal(opened.length, 1);
  assert.equal(opened[0], source);
});

test("rejects inconsistent progress records before rendering", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const invalid = progressFile("invalid", "src/invalid.ts", {
    reviewedLineCount: 4,
    totalLineCount: 3,
    progress: 4 / 3
  });

  assert.throws(() => provider.replaceProgress(progress([invalid])), /reviewedLineCount|progress/i);
});

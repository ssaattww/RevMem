import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentReadResult,
  type RevisionTextContentSource
} from "../../src/application/diff-document/index";
import type { PullRequestDiffFileProgress, PullRequestDiffProgress } from "../../src/core/pr-progress/index";
import { ReviewDiffEditorController } from "../../src/ui/diff-editor/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestLineReviewability,
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

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

const defaultReviewability = (
  files: readonly PullRequestDiffFileProgress[]
): Readonly<Record<string, PullRequestLineReviewability>> =>
  Object.fromEntries(files.map((file) => [
    file.fileId,
    file.status === "binary"
      ? { kind: "unsupported", reason: { kind: "binary" } }
      : { kind: "reviewable" }
  ]));

const snapshot = (
  files: readonly PullRequestDiffFileProgress[],
  options: Partial<Omit<PullRequestProgressTreeSnapshot, "progress">> = {}
): PullRequestProgressTreeSnapshot => {
  const baseSha = options.baseSha ?? BASE_SHA;
  const headSha = options.headSha ?? HEAD_SHA;
  return {
    snapshotId: "snapshot-1",
    contextId: "github.com/ssaattww/RevMem#38",
    baseSha,
    headSha,
    originalDiffId: `${baseSha}..${headSha}`,
    fileSystemPathSemantics: "posix",
    lineReviewabilityByFileId: defaultReviewability(files),
    ...options,
    progress: progress(files)
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

class RecordingContentSource implements RevisionTextContentSource {
  public readonly requests: ReviewDiffDocumentDescriptor[] = [];

  public async readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult> {
    this.requests.push({ ...descriptor });
    if (descriptor.filePath === "src/added.ts" && descriptor.side === "modified") {
      return { kind: "found", content: "added\n" };
    }
    if (descriptor.filePath === "src/deleted.ts" && descriptor.side === "original") {
      return { kind: "found", content: "deleted\n" };
    }
    throw new Error(`Unexpected non-empty content request: ${descriptor.side} ${descriptor.filePath}`);
  }
}

test("classifies every PR progress file and retains counts and reasons", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const changedFiles = [
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
  ] as const;

  provider.replaceSnapshot(snapshot(changedFiles));

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

test("projects nonzero encoding-unsupported changes out of the effective PR denominator", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const invalidUtf8 = progressFile("invalid", "data/invalid.txt", {
    additions: 2,
    deletions: 1,
    reviewedLineCount: 1,
    totalLineCount: 3,
    progress: 1 / 3
  });
  const reviewable = progressFile("reviewable", "src/reviewable.ts", {
    additions: 1,
    deletions: 1,
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5
  });

  provider.replaceSnapshot(snapshot([invalidUtf8, reviewable], {
    lineReviewabilityByFileId: {
      invalid: {
        kind: "unsupported",
        reason: { kind: "invalid-encoding", encoding: "UTF-8" }
      },
      reviewable: { kind: "reviewable" }
    }
  }));

  const unsupportedNode = files(provider, categories(provider)[4]!)[0]!;
  assert.deepEqual(
    {
      path: unsupportedNode.path,
      reason: unsupportedNode.reason,
      additions: unsupportedNode.additions,
      deletions: unsupportedNode.deletions,
      reviewed: unsupportedNode.reviewedLineCount,
      total: unsupportedNode.totalLineCount,
      progress: unsupportedNode.progress
    },
    {
      path: "data/invalid.txt",
      reason: "不正な文字エンコーディング: UTF-8",
      additions: 2,
      deletions: 1,
      reviewed: 0,
      total: 0,
      progress: 1
    }
  );
  assert.deepEqual(provider.getEffectiveProgress(), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
    files: [
      {
        raw: invalidUtf8,
        reviewability: {
          kind: "unsupported",
          reason: { kind: "invalid-encoding", encoding: "UTF-8" }
        },
        category: "line-review-unsupported",
        effectiveReason: "不正な文字エンコーディング: UTF-8",
        reviewedLineCount: 0,
        totalLineCount: 0,
        progress: 1
      },
      {
        raw: reviewable,
        reviewability: { kind: "reviewable" },
        category: "unreviewed",
        reviewedLineCount: 1,
        totalLineCount: 2,
        progress: 0.5
      }
    ]
  });
});

test("sorts files by remaining line count descending and path ascending", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const changedFiles = [
    progressFile("b", "src/b.ts", { reviewedLineCount: 1, totalLineCount: 5, progress: 0.2 }),
    progressFile("a", "src/a.ts", { reviewedLineCount: 0, totalLineCount: 4, progress: 0 }),
    progressFile("z", "src/z.ts", { reviewedLineCount: 1, totalLineCount: 6, progress: 1 / 6 })
  ];

  provider.replaceSnapshot(snapshot(changedFiles));

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

test("selection carries immutable context and revision identity", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const renamed = progressFile("rename", "src/new.ts", {
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    status: "renamed"
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => {
      opened.push(target);
    }
  });
  provider.replaceSnapshot(snapshot([renamed], {
    snapshotId: "snapshot-renamed",
    contextId: "github.com/ssaattww/RevMem#38",
    fileSystemPathSemantics: "windows"
  }));

  const node = files(provider, categories(provider)[0]!)[0]!;
  await provider.select(node);

  assert.deepEqual(opened, [{
    snapshotId: "snapshot-renamed",
    contextId: "github.com/ssaattww/RevMem#38",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
    fileSystemPathSemantics: "windows",
    file: renamed,
    original: { kind: "present", filePath: "src/old.ts", revision: BASE_SHA },
    modified: { kind: "present", filePath: "src/new.ts", revision: HEAD_SHA }
  }]);
});

test("added and deleted selections open immutable empty missing sides through T303 and T302", async () => {
  const codec = new ReviewDiffUriCodec();
  const source = new RecordingContentSource();
  const contentProvider = new RevisionTextContentProvider(codec, source);
  const openedContents: Array<readonly [string, string]> = [];
  const editorController = new ReviewDiffEditorController(codec, {
    parseUri: (value) => value,
    openDiff: async (original, modified) => {
      openedContents.push([
        await contentProvider.provideTextDocumentContent(original),
        await contentProvider.provideTextDocumentContent(modified)
      ]);
    }
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => editorController.openReviewDiff({
      contextId: target.contextId,
      fileSystemPathSemantics: target.fileSystemPathSemantics,
      original: target.original,
      modified: target.modified,
      title: target.file.path
    })
  });
  const added = progressFile("added", "src/added.ts", {
    oldPath: undefined,
    newPath: "src/added.ts",
    status: "added"
  });
  const deleted = progressFile("deleted", "src/deleted.ts", {
    oldPath: "src/deleted.ts",
    newPath: undefined,
    status: "deleted"
  });
  provider.replaceSnapshot(snapshot([added, deleted]));

  const unreviewed = files(provider, categories(provider)[0]!);
  for (const node of unreviewed) await provider.select(node);

  assert.deepEqual(
    unreviewed.map(({ openTarget }) => ({
      fileId: openTarget.file.fileId,
      original: openTarget.original,
      modified: openTarget.modified
    })),
    [
      {
        fileId: "added",
        original: { kind: "absent", filePath: "src/added.ts", revision: BASE_SHA },
        modified: { kind: "present", filePath: "src/added.ts", revision: HEAD_SHA }
      },
      {
        fileId: "deleted",
        original: { kind: "present", filePath: "src/deleted.ts", revision: BASE_SHA },
        modified: { kind: "absent", filePath: "src/deleted.ts", revision: HEAD_SHA }
      }
    ]
  );
  assert.deepEqual(openedContents, [["", "added\n"], ["deleted\n", ""]]);
  assert.deepEqual(
    source.requests.map(({ revisionSource, side, filePath }) => ({ revisionSource, side, filePath })),
    [
      { revisionSource: "git-commit", side: "modified", filePath: "src/added.ts" },
      { revisionSource: "git-commit", side: "original", filePath: "src/deleted.ts" }
    ]
  );
});

test("rejects stale nodes after revision or context refresh", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const source = progressFile("same", "src/same.ts");
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => {
      opened.push(target);
    }
  });

  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-head-1",
    contextId: "context-a"
  }));
  const staleByRevision = files(provider, categories(provider)[0]!)[0]!;

  const nextHead = "c".repeat(40);
  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-head-2",
    contextId: "context-a",
    headSha: nextHead,
    originalDiffId: `${BASE_SHA}..${nextHead}`
  }));
  await assert.rejects(provider.select(staleByRevision), /stale|current snapshot/i);

  const staleByContext = files(provider, categories(provider)[0]!)[0]!;
  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-context-b",
    contextId: "context-b",
    headSha: nextHead,
    originalDiffId: `${BASE_SHA}..${nextHead}`
  }));
  await assert.rejects(provider.select(staleByContext), /stale|current snapshot/i);
  assert.equal(opened.length, 0);
});

test("rejects missing or inconsistent line-review availability", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const source = progressFile("a", "src/a.ts");

  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], { lineReviewabilityByFileId: {} })),
    /line reviewability|missing/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], {
      lineReviewabilityByFileId: {
        a: {
          kind: "unsupported",
          reason: { kind: "unsupported-encoding", encoding: "" }
        }
      }
    })),
    /encoding|reason/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], {
      lineReviewabilityByFileId: {
        a: { kind: "reviewable" },
        foreign: { kind: "reviewable" }
      }
    })),
    /unknown|foreign/i
  );
});

test("rejects inconsistent snapshot and progress records before rendering", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined });
  const invalid = progressFile("invalid", "src/invalid.ts", {
    reviewedLineCount: 4,
    totalLineCount: 3,
    progress: 4 / 3
  });

  assert.throws(
    () => provider.replaceSnapshot(snapshot([invalid])),
    /reviewedLineCount|progress/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([progressFile("a", "src/a.ts")], {
      originalDiffId: "other"
    })),
    /originalDiffId|snapshot/i
  );
});

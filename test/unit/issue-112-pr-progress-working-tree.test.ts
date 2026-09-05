import assert from "node:assert/strict";
import test from "node:test";

import type {
  PullRequestDiffFileProgress,
  PullRequestDiffProgress
} from "../../src/core/pr-progress/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode,
  type PullRequestProgressTreeHost,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/pull-request-progress-tree-data-provider";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

type WorkingTreeProvider = PullRequestProgressTreeDataProvider & {
  openWorkingTreeFile(node: PullRequestProgressTreeFileNode): Promise<void>;
};

const progressFile = (
  fileId: string,
  repositoryPath: string,
  options: Partial<PullRequestDiffFileProgress> = {}
): PullRequestDiffFileProgress => ({
  fileId,
  oldPath: repositoryPath,
  newPath: repositoryPath,
  status: "modified",
  path: repositoryPath,
  additions: 1,
  deletions: 1,
  reviewedLineCount: 0,
  totalLineCount: 2,
  progress: 0,
  excluded: false,
  ...options
});

const progress = (file: PullRequestDiffFileProgress): PullRequestDiffProgress => ({
  reviewedLineCount: file.reviewedLineCount,
  totalLineCount: file.totalLineCount,
  progress: file.progress,
  files: [file]
});

const snapshot = (
  file: PullRequestDiffFileProgress,
  snapshotId = "snapshot-1"
): PullRequestProgressTreeSnapshot => ({
  snapshotId,
  contextId: "github.com/ssaattww/RevMem#112",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
  fileSystemPathSemantics: "posix",
  lineReviewabilityByFileId: {
    [file.fileId]: { kind: "reviewable" }
  },
  progress: progress(file)
});

const currentFileNode = (
  provider: PullRequestProgressTreeDataProvider
): PullRequestProgressTreeFileNode => {
  const category = provider.getChildren().find(
    (node): node is PullRequestProgressTreeCategoryNode =>
      node.kind === "category" && node.category === "unreviewed"
  );
  assert.ok(category);
  const node = provider.getChildren(category).find(
    (candidate): candidate is PullRequestProgressTreeFileNode =>
      candidate.kind === "file"
  );
  assert.ok(node);
  return node;
};

const createProvider = (
  openWorkingTreeFile: (target: PullRequestProgressTreeDiffTarget) => Promise<void>
): WorkingTreeProvider => new PullRequestProgressTreeDataProvider({
  openDiff: async () => undefined,
  openFile: async () => undefined,
  openWorkingTreeFile
} as unknown as PullRequestProgressTreeHost) as WorkingTreeProvider;

test("opens the current working-tree destination for a current non-deleted PR Progress node", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const provider = createProvider(async (target) => {
    opened.push(target);
  });
  const renamed = progressFile("renamed", "src/new-name.ts", {
    oldPath: "src/old-name.ts",
    newPath: "src/new-name.ts",
    status: "renamed"
  });
  provider.replaceSnapshot(snapshot(renamed));

  await provider.openWorkingTreeFile(currentFileNode(provider));

  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.file.fileId, "renamed");
  assert.equal(opened[0]?.file.newPath, "src/new-name.ts");
});

test("working-tree opens reject deleted and stale PR Progress nodes before invoking the host", async () => {
  let openCount = 0;
  const provider = createProvider(async () => {
    openCount += 1;
  });
  const deleted = progressFile("deleted", "src/deleted.ts", {
    newPath: undefined,
    status: "deleted",
    additions: 0,
    deletions: 1,
    totalLineCount: 1,
    progress: 0
  });
  provider.replaceSnapshot(snapshot(deleted));
  const deletedNode = currentFileNode(provider);

  await assert.rejects(
    provider.openWorkingTreeFile(deletedNode),
    /deleted|working tree|does not exist/i
  );

  const current = progressFile("current", "src/current.ts");
  provider.replaceSnapshot(snapshot(current, "snapshot-2"));
  await assert.rejects(
    provider.openWorkingTreeFile(deletedNode),
    /stale|current snapshot/i
  );
  assert.equal(openCount, 0);
});

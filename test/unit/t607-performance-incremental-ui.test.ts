import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { RepositoryGlobalUnderstandingProgress } from "../../src/core/global-understanding/index";
import type { GlobalFileReviewState } from "../../src/core/contracts/index";
import { calculateGlobalUnderstandingFileProgressCooperatively } from "../../src/application/global-understanding/cooperative-global-understanding-calculation";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";
import {
  createGlobalUnderstandingTreeModelIncrementally,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";

const snapshot = (fileCount: number): GlobalUnderstandingTreeSnapshot => {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/${String(fileCount - index).padStart(5, "0")}.ts`,
    state: "current" as const,
    reviewedNonEmptyLineCount: index,
    totalNonEmptyLineCount: fileCount,
    progress: index / fileCount
  }));
  const progress: RepositoryGlobalUnderstandingProgress = {
    reviewedNonEmptyLineCount: files.reduce((total, file) => total + file.reviewedNonEmptyLineCount, 0),
    totalNonEmptyLineCount: files.reduce((total, file) => total + file.totalNonEmptyLineCount, 0),
    progress: (fileCount - 1) / 2 / fileCount,
    files
  };
  return { progress, openedFileCount: fileCount, unopenedFileCount: 0, excludedFileCount: 0, prunedExcludedDirectoryCount: 0 };
};

test("T607 publishes a large Global Tree in deterministic bounded stages", async () => {
  const published: Array<{ readonly count: number; readonly complete: boolean }> = [];
  let yields = 0;
  const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot(257), {
    maxFilesPerStage: 64,
    yieldControl: () => { yields += 1; },
    onStage: (next, complete) => { published.push({ count: next.files.length, complete }); }
  });

  assert.ok(model);
  assert.deepEqual(published, [
    { count: 64, complete: false }, { count: 128, complete: false },
    { count: 192, complete: false }, { count: 256, complete: false },
    { count: 257, complete: true }
  ]);
  assert.equal(yields, 8);
  assert.equal(model.files[0]?.path, "src/00001.ts");
  assert.equal(model.files.at(-1)?.path, "src/00257.ts");
});

test("T607 never publishes a stale Tree stage after its generation is invalidated", async () => {
  let current = true;
  const published: number[] = [];
  const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot(130), {
    maxFilesPerStage: 64,
    yieldControl: () => undefined,
    isCurrent: () => current,
    onStage: (next) => { published.push(next.files.length); current = false; }
  });

  assert.equal(model, undefined);
  assert.deepEqual(published, [64]);
});

test("T607 keeps a 10,000 changed-line PR projection deterministic without a wall-clock gate", () => {
  const files = Array.from({ length: 100 }, (_, index) => ({
    fileId: `file-${index}`,
    oldPath: `src/${index}.ts`,
    newPath: `src/${index}.ts`,
    status: "modified" as const,
    path: `src/${index}.ts`,
    additions: 100,
    deletions: 0,
    reviewedLineCount: 0,
    totalLineCount: 100,
    progress: 0,
    excluded: false
  }));
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const tree = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined,
    openFile: async () => undefined
  });
  const projection: PullRequestProgressTreeSnapshot = {
    snapshotId: "t607-10k",
    contextId: "github-pr:example#79",
    baseSha,
    headSha,
    originalDiffId: `${baseSha}..${headSha}`,
    fileSystemPathSemantics: "posix",
    progress: { reviewedLineCount: 0, totalLineCount: 10_000, progress: 0, files },
    lineReviewabilityByFileId: Object.fromEntries(files.map((file) => [file.fileId, { kind: "reviewable" as const }]))
  };

  tree.replaceSnapshot(projection);
  const effective = tree.getEffectiveProgress();
  assert.equal(effective.reviewedLineCount, 0);
  assert.equal(effective.totalLineCount, 10_000);
  assert.equal(effective.progress, 0);
  assert.equal(effective.files.length, 100);
  assert.equal(tree.getChildren()[0]?.kind, "category");
  assert.equal((tree.getChildren()[0] as { readonly fileCount: number }).fileCount, 100);
});

test("T607 yields deterministically while normalizing many reviewed intervals", async () => {
  let yields = 0;
  const reviewed = Array.from({ length: 2_048 }, (_, index) => ({
    startLine: index * 2,
    endLineExclusive: index * 2 + 1
  }));
  const globalFile: GlobalFileReviewState = {
    fileId: "t607-many-intervals",
    currentPath: "src/intervals.ts",
    revisionId: "t607-revision",
    contentHash: "t607-hash",
    reviewed,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const result = await calculateGlobalUnderstandingFileProgressCooperatively({
    path: "src/intervals.ts",
    revisionId: "t607-revision",
    contentHash: "t607-hash",
    lineCount: 4_096,
    nonEmptyLines: Array.from({ length: 4_096 }, (_, index) => index)
  }, globalFile, {
    maxWorkItems: 128,
    yieldControl: () => { yields += 1; }
  });

  assert.equal(result.reviewedNonEmptyLineCount, 2_048);
  assert.equal(result.totalNonEmptyLineCount, 4_096);
  assert.ok(yields >= 32, "the work budget, rather than elapsed time, governs scheduler checkpoints");
});

test("T607 focused workload harness is wired through the diagnostic CI runner", async () => {
  const root = path.resolve(__dirname, "../../..");
  const [manifestText, workflow] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8")
  ]);
  const scripts = (JSON.parse(manifestText) as { readonly scripts?: Record<string, string> }).scripts ?? {};
  assert.match(scripts["test:t607"] ?? "", /t607-performance-incremental-ui\.test\.js/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs test-t607 npm run test:t607/u);
});

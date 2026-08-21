import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { RepositoryGlobalUnderstandingProgress } from "../../src/core/global-understanding/index";
import type { DiffLine, GlobalFileReviewState, PullRequestFileChange, ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import { calculatePullRequestDiffProgress, type PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";
import { calculateGlobalUnderstandingFileProgressCooperatively } from "../../src/application/global-understanding/cooperative-global-understanding-calculation";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";
import {
  createGlobalUnderstandingTreeModelIncrementally,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";

const changedLine = (newLine: number): DiffLine => ({ kind: "addition", newLine, text: `line ${newLine}` });
const t301Context = (baseSha: string, headSha: string): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "github-pr:example#79",
  kind: "pull-request",
  repositoryId: "github.com/ssaattww/RevMem",
  displayName: "PR #79",
  pullRequest: { host: "github.com", owner: "ssaattww", repository: "RevMem", number: 79, state: "open", baseSha, headSha },
  files: {},
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
});

const tenThousandLineT301Snapshot = (): PullRequestDiffSnapshot => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const files: PullRequestFileChange[] = Array.from({ length: 100 }, (_, fileIndex) => {
    const lines = Array.from({ length: 100 }, (_, lineIndex) => changedLine(lineIndex + 1));
    return {
      fileId: `t607-${fileIndex}`,
      status: "added",
      newPath: `src/t607-${String(fileIndex).padStart(3, "0")}.ts`,
      additions: lines.length,
      deletions: 0,
      hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, lines }]
    };
  });
  return { contextId: "github-pr:example#79", baseSha, headSha, originalDiffId: `${baseSha}..${headSha}`, files };
};

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
  assert.ok(yields >= 8, "validation, cooperative sorting, and staged publication all yield within the item budget");
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

test("T607 aggregates actual 10,000 changed T301 lines and publishes only the complete current Tree", async () => {
  const diff = tenThousandLineT301Snapshot();
  const progress = calculatePullRequestDiffProgress({
    diff,
    reviewContext: t301Context(diff.baseSha, diff.headSha),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const tree = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined,
    openFile: async () => undefined
  });
  const projection: PullRequestProgressTreeSnapshot = {
    snapshotId: "t607-10k",
    contextId: diff.contextId,
    baseSha: diff.baseSha,
    headSha: diff.headSha,
    originalDiffId: diff.originalDiffId,
    fileSystemPathSemantics: "posix",
    progress,
    lineReviewabilityByFileId: Object.fromEntries(progress.files.map((file) => [file.fileId, { kind: "reviewable" as const }]))
  };
  const stages: Array<readonly [number, number]> = [];
  let yields = 0;
  const published = await tree.replaceSnapshotIncrementally(projection, {
    maxFilesPerStage: 16,
    yieldControl: () => { yields += 1; },
    onStage: (prepared, total) => { stages.push([prepared, total]); }
  });

  assert.equal(published, true);
  const effective = tree.getEffectiveProgress();
  assert.equal(effective.reviewedLineCount, 0);
  assert.equal(effective.totalLineCount, 10_000);
  assert.equal(effective.progress, 0);
  assert.equal(effective.files.length, 100);
  assert.equal(tree.getChildren()[0]?.kind, "category");
  assert.equal((tree.getChildren()[0] as { readonly fileCount: number }).fileCount, 100);
  assert.deepEqual(stages, [[16, 100], [32, 100], [48, 100], [64, 100], [80, 100], [96, 100], [100, 100]]);
  assert.ok(yields >= stages.length, "T301 validation and final category projection use deterministic work checkpoints");
});

test("T607 stale or cancelled PR Tree preparation preserves the last complete projection", async () => {
  const diff = tenThousandLineT301Snapshot();
  const progress = calculatePullRequestDiffProgress({
    diff,
    reviewContext: t301Context(diff.baseSha, diff.headSha),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const tree = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const baseline = { ...progress, files: progress.files.slice(0, 1), totalLineCount: 100, reviewedLineCount: 0, progress: 0 };
  const baselineSnapshot: PullRequestProgressTreeSnapshot = {
    snapshotId: "baseline", contextId: diff.contextId, baseSha: diff.baseSha, headSha: diff.headSha,
    originalDiffId: diff.originalDiffId, fileSystemPathSemantics: "posix", progress: baseline,
    lineReviewabilityByFileId: { [baseline.files[0]!.fileId]: { kind: "reviewable" } }
  };
  tree.replaceSnapshot(baselineSnapshot);
  let current = true;
  const completed = await tree.replaceSnapshotIncrementally({
    ...baselineSnapshot, snapshotId: "stale", progress,
    lineReviewabilityByFileId: Object.fromEntries(progress.files.map((file) => [file.fileId, { kind: "reviewable" as const }]))
  }, {
    maxFilesPerStage: 16,
    yieldControl: () => { current = false; },
    isCurrent: () => current
  });
  assert.equal(completed, false);
  assert.equal(tree.getEffectiveProgress().files.length, 1, "cancelled work neither clears nor partially publishes the prior Tree");
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

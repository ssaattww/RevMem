import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type GlobalFileReviewState,
  type RepositoryGlobalState
} from "../../src/core/contracts/index";
import {
  calculateGlobalUnderstandingFileProgress,
  type GlobalUnderstandingFileSnapshot
} from "../../src/core/global-understanding/index";
import {
  GlobalUnderstandingBackgroundRecalculator,
  InMemoryGlobalUnderstandingProgressCache,
  type GlobalUnderstandingFileSource,
  type LoadedGlobalUnderstandingFile
} from "../../src/application/global-understanding/index";
import {
  NodeGlobalUnderstandingFileSource
} from "../../src/adapters/repository-files/node-global-understanding-file-source";

const revision = "revision-2";

const globalFile = (
  fileId: string,
  currentPath: string,
  reviewed: GlobalFileReviewState["reviewed"],
  overrides: Partial<GlobalFileReviewState> = {}
): GlobalFileReviewState => ({
  fileId,
  currentPath,
  revisionId: revision,
  reviewed,
  contentHash: `${fileId}-hash`,
  updatedAt: "2026-08-02T12:50:00.000Z",
  ...overrides
});

const globalState = (
  files: readonly GlobalFileReviewState[]
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: revision,
  files: Object.fromEntries(files.map((file) => [file.fileId, file])),
  updatedAt: "2026-08-02T12:50:00.000Z"
});

const snapshot = (
  repositoryPath: string,
  nonEmptyLines: readonly number[],
  options: Partial<GlobalUnderstandingFileSnapshot> = {}
): GlobalUnderstandingFileSnapshot => ({
  path: repositoryPath,
  revisionId: revision,
  lineCount: nonEmptyLines.length === 0 ? 1 : Math.max(...nonEmptyLines) + 1,
  nonEmptyLines,
  contentHash: `${repositoryPath}-hash`,
  ...options
});

interface CooperativeLoadOptions {
  readonly maxWorkBytes: number;
  readonly yieldControl: () => void | Promise<void>;
}

test("T504-R1-P1 treats either missing content hash as stale evidence", () => {
  const currentSnapshot = snapshot("src/hash.ts", [0], {
    lineCount: 1,
    contentHash: "current-hash"
  });
  const missingGlobalHash = calculateGlobalUnderstandingFileProgress({
    snapshot: currentSnapshot,
    globalFile: globalFile(
      "hash",
      "src/hash.ts",
      [{ startLine: 0, endLineExclusive: 1 }],
      { contentHash: undefined }
    )
  });
  const missingSnapshotHash = calculateGlobalUnderstandingFileProgress({
    snapshot: { ...currentSnapshot, contentHash: undefined },
    globalFile: globalFile(
      "hash",
      "src/hash.ts",
      [{ startLine: 0, endLineExclusive: 1 }],
      { contentHash: "current-hash" }
    )
  });

  for (const result of [missingGlobalHash, missingSnapshotHash]) {
    assert.equal(result.state, "stale");
    assert.equal(result.reviewedNonEmptyLineCount, 0);
    assert.equal(result.totalNonEmptyLineCount, 1);
    assert.equal(result.progress, 0);
  }
});

test("T504-R1-P2 keeps a zero-byte file compatible with current editor Global state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t504-empty-"));
  await writeFile(path.join(root, "empty.ts"), Buffer.alloc(0));
  const source = new NodeGlobalUnderstandingFileSource(root, "posix");
  const loaded = await source.load("empty.ts", revision);

  assert.equal(loaded.lineCount, 1);
  assert.deepEqual(loaded.nonEmptyLines, []);

  const progress = calculateGlobalUnderstandingFileProgress({
    snapshot: loaded,
    globalFile: globalFile(
      "empty",
      "empty.ts",
      [{ startLine: 0, endLineExclusive: 1 }],
      { contentHash: loaded.contentHash }
    )
  });
  assert.deepEqual(progress, {
    path: "empty.ts",
    state: "current",
    reviewedNonEmptyLineCount: 0,
    totalNonEmptyLineCount: 0,
    progress: 1
  });
});

test("T504-R1-P3 forwards a bounded single-file work budget to the final file", async () => {
  let observedOptions: CooperativeLoadOptions | undefined;
  const yields: number[] = [];
  const fileSnapshot = snapshot("src/large.ts", [0], {
    lineCount: 1,
    contentHash: "large-hash"
  });
  const source: GlobalUnderstandingFileSource = {
    load: async (
      repositoryPath: string,
      requestedRevision: string,
      options?: CooperativeLoadOptions
    ): Promise<LoadedGlobalUnderstandingFile> => {
      assert.equal(repositoryPath, "src/large.ts");
      assert.equal(requestedRevision, revision);
      observedOptions = options;
      await options?.yieldControl();
      return { ...fileSnapshot, cacheKey: "large-v1" };
    }
  };
  const recalculator = new GlobalUnderstandingBackgroundRecalculator({
    source,
    cache: new InMemoryGlobalUnderstandingProgressCache(),
    yieldControl: async () => { yields.push(1); }
  });
  const request = {
    globalState: globalState([
      globalFile(
        "large",
        "src/large.ts",
        [{ startLine: 0, endLineExclusive: 1 }],
        { contentHash: "large-hash" }
      )
    ]),
    included: [{ path: "src/large.ts", nonEmptyLineCount: 1 }],
    configurationKey: "config-v1",
    chunkSize: 1,
    fileWorkChunkBytes: 4
  };

  const result = await recalculator.recalculate(request);

  assert.equal(observedOptions?.maxWorkBytes, 4);
  assert.deepEqual(yields, [1]);
  assert.equal(result.complete, true);
  assert.equal(result.processedFileCount, 1);
});

test("T504-R1-P3 yields while decoding, scanning, and hashing one large final file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t504-large-"));
  const content = "α\r\nbeta\n".repeat(16);
  await writeFile(path.join(root, "large.ts"), content, "utf8");
  const source = new NodeGlobalUnderstandingFileSource(root, "posix");
  const yields: number[] = [];
  const loadWithOptions = source.load.bind(source) as (
    repositoryPath: string,
    requestedRevision: string,
    options?: CooperativeLoadOptions
  ) => Promise<LoadedGlobalUnderstandingFile>;

  const loaded = await loadWithOptions("large.ts", revision, {
    maxWorkBytes: 5,
    yieldControl: async () => { yields.push(1); }
  });

  assert.ok(yields.length > 0);
  assert.equal(loaded.lineCount, 33);
  assert.equal(loaded.nonEmptyLines.length, 32);
  assert.equal(loaded.nonEmptyLines[0], 0);
  assert.equal(loaded.nonEmptyLines.at(-1), 31);
  assert.equal(loaded.contentHash?.length, 64);
});

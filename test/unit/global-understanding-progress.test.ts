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
  aggregateRepositoryGlobalUnderstandingProgress,
  calculateGlobalUnderstandingFileProgress,
  calculateRepositoryGlobalUnderstandingProgress,
  type GlobalUnderstandingFileSnapshot
} from "../../src/core/global-understanding/index";
import {
  GlobalUnderstandingBackgroundRecalculator,
  InMemoryGlobalUnderstandingProgressCache,
  type GlobalUnderstandingFileSource
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
  updatedAt: "2026-08-02T11:00:00.000Z",
  ...overrides
});

const globalState = (
  files: readonly GlobalFileReviewState[]
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-1",
  currentRevisionId: revision,
  files: Object.fromEntries(files.map((file) => [file.fileId, file])),
  updatedAt: "2026-08-02T11:00:00.000Z"
});

const snapshot = (
  path: string,
  nonEmptyLines: readonly number[],
  options: Partial<GlobalUnderstandingFileSnapshot> = {}
): GlobalUnderstandingFileSnapshot => ({
  path,
  revisionId: revision,
  lineCount: nonEmptyLines.length === 0 ? 0 : Math.max(...nonEmptyLines) + 1,
  nonEmptyLines,
  contentHash: `${path}-hash`,
  ...options
});

test("file and repository calculators count only reviewed non-empty included lines", () => {
  const openFile = snapshot("src/open.ts", [0, 2, 4], {
    lineCount: 5,
    contentHash: "open-hash"
  });
  const emptyFile = snapshot("src/empty.ts", [], { contentHash: "empty-hash" });
  const staleFile = snapshot("src/stale.ts", [0, 1], {
    lineCount: 2,
    contentHash: "current-hash"
  });
  const state = globalState([
    globalFile("open", "src/open.ts", [{ startLine: 0, endLineExclusive: 4 }], {
      contentHash: "open-hash"
    }),
    globalFile("stale", "src/stale.ts", [{ startLine: 0, endLineExclusive: 2 }], {
      revisionId: "revision-1",
      contentHash: "old-hash"
    }),
    globalFile("excluded", "dist/excluded.ts", [{ startLine: 0, endLineExclusive: 10 }])
  ]);

  const result = calculateRepositoryGlobalUnderstandingProgress({
    repositoryId: "repository-1",
    currentRevisionId: revision,
    globalState: state,
    files: [staleFile, openFile, emptyFile]
  });

  assert.deepEqual(result.files.map((file) => file.path), [
    "src/empty.ts",
    "src/open.ts",
    "src/stale.ts"
  ]);
  assert.deepEqual(result.files.map((file) => ({
    path: file.path,
    state: file.state,
    reviewed: file.reviewedNonEmptyLineCount,
    total: file.totalNonEmptyLineCount,
    progress: file.progress
  })), [
    { path: "src/empty.ts", state: "missing", reviewed: 0, total: 0, progress: 1 },
    { path: "src/open.ts", state: "current", reviewed: 2, total: 3, progress: 2 / 3 },
    { path: "src/stale.ts", state: "stale", reviewed: 0, total: 2, progress: 0 }
  ]);
  assert.equal(result.reviewedNonEmptyLineCount, 2);
  assert.equal(result.totalNonEmptyLineCount, 5);
  assert.equal(result.progress, 0.4);

  const direct = calculateGlobalUnderstandingFileProgress({
    snapshot: openFile,
    globalFile: state.files.open
  });
  assert.equal(direct.reviewedNonEmptyLineCount, 2);
  assert.deepEqual(aggregateRepositoryGlobalUnderstandingProgress([direct]), {
    reviewedNonEmptyLineCount: 2,
    totalNonEmptyLineCount: 3,
    progress: 2 / 3,
    files: [direct]
  });
});

test("calculator rejects corrupt coordinates and ambiguous Global path identities", () => {
  assert.throws(() => calculateGlobalUnderstandingFileProgress({
    snapshot: snapshot("src/out-of-range.ts", [0, 3], { lineCount: 3 }),
    globalFile: undefined
  }), /nonEmptyLines/u);

  assert.throws(() => calculateGlobalUnderstandingFileProgress({
    snapshot: snapshot("src/invalid-state.ts", [0], { lineCount: 1 }),
    globalFile: globalFile("invalid", "src/invalid-state.ts", [
      { startLine: 0, endLineExclusive: 2 }
    ], { contentHash: "src/invalid-state.ts-hash" })
  }), /reviewed/u);

  const duplicatePathState = globalState([
    globalFile("one", "src/shared.ts", []),
    globalFile("two", "src/shared.ts", [])
  ]);
  assert.throws(() => calculateRepositoryGlobalUnderstandingProgress({
    repositoryId: "repository-1",
    currentRevisionId: revision,
    globalState: duplicatePathState,
    files: [snapshot("src/shared.ts", [0], { contentHash: "one-hash" })]
  }), /duplicate Global currentPath/u);
});

interface SourceFixture {
  readonly cacheKey: string;
  readonly snapshot: GlobalUnderstandingFileSnapshot;
}

const sourceFrom = (
  fixtures: Readonly<Record<string, SourceFixture>>,
  loadOrder: string[]
): GlobalUnderstandingFileSource => ({
  load: async (repositoryPath, requestedRevision) => {
    loadOrder.push(repositoryPath);
    const fixture = fixtures[repositoryPath];
    if (fixture === undefined) throw new Error(`missing fixture: ${repositoryPath}`);
    assert.equal(requestedRevision, revision);
    return { ...fixture.snapshot, cacheKey: fixture.cacheKey };
  }
});

test("background recalculation prioritizes open files, yields between chunks, and ignores excluded identities", async () => {
  const loadOrder: string[] = [];
  const yields: number[] = [];
  const progressEvents: Array<{ processed: number; total: number; complete: boolean }> = [];
  const files = Object.fromEntries(["a", "b", "c", "d"].map((name) => [
    `src/${name}.ts`,
    {
      cacheKey: `${name}-v1`,
      snapshot: snapshot(`src/${name}.ts`, [0], {
        lineCount: 1,
        contentHash: `${name}-hash`
      })
    }
  ]));
  const recalculator = new GlobalUnderstandingBackgroundRecalculator({
    source: sourceFrom(files, loadOrder),
    cache: new InMemoryGlobalUnderstandingProgressCache(),
    yieldControl: async () => { yields.push(loadOrder.length); }
  });

  const result = await recalculator.recalculate({
    globalState: globalState([
      globalFile("a", "src/a.ts", [{ startLine: 0, endLineExclusive: 1 }], { contentHash: "a-hash" }),
      globalFile("c", "src/c.ts", [{ startLine: 0, endLineExclusive: 1 }], { contentHash: "c-hash" }),
      globalFile("excluded", "dist/excluded.ts", [{ startLine: 0, endLineExclusive: 1 }])
    ]),
    included: [
      { path: "src/a.ts", nonEmptyLineCount: 1 },
      { path: "src/b.ts", nonEmptyLineCount: 1 },
      { path: "src/c.ts", nonEmptyLineCount: 1 },
      { path: "src/d.ts", nonEmptyLineCount: 1 }
    ],
    openFilePaths: ["src/c.ts", "src/a.ts", "dist/excluded.ts", "src/c.ts"],
    configurationKey: "exclude-defaults",
    chunkSize: 2,
    onProgress: async (event) => {
      progressEvents.push({
        processed: event.processedFileCount,
        total: event.totalFileCount,
        complete: event.complete
      });
    }
  });

  assert.deepEqual(loadOrder, ["src/c.ts", "src/a.ts", "src/b.ts", "src/d.ts"]);
  assert.deepEqual(yields, [2]);
  assert.deepEqual(progressEvents, [
    { processed: 2, total: 4, complete: false },
    { processed: 4, total: 4, complete: true }
  ]);
  assert.equal(result.progress.reviewedNonEmptyLineCount, 2);
  assert.equal(result.progress.totalNonEmptyLineCount, 4);
  assert.equal(result.cacheHitCount, 0);
  assert.equal(result.calculatedFileCount, 4);
});

test("progress cache reuses exact file evidence and setting or Global changes force recalculation", async () => {
  const loadOrder: string[] = [];
  const fixtures: Readonly<Record<string, SourceFixture>> = {
    "src/a.ts": {
      cacheKey: "a-v1",
      snapshot: snapshot("src/a.ts", [0, 2], { lineCount: 3, contentHash: "a-hash" })
    },
    "src/b.ts": {
      cacheKey: "b-v1",
      snapshot: snapshot("src/b.ts", [0], { lineCount: 1, contentHash: "b-hash" })
    }
  };
  const cache = new InMemoryGlobalUnderstandingProgressCache();
  const recalculator = new GlobalUnderstandingBackgroundRecalculator({
    source: sourceFrom(fixtures, loadOrder),
    cache,
    yieldControl: async () => {}
  });
  const included = [
    { path: "src/a.ts", nonEmptyLineCount: 2 },
    { path: "src/b.ts", nonEmptyLineCount: 1 }
  ] as const;
  const initialGlobal = globalState([
    globalFile("a", "src/a.ts", [{ startLine: 0, endLineExclusive: 1 }], { contentHash: "a-hash" }),
    globalFile("b", "src/b.ts", [], { contentHash: "b-hash" })
  ]);

  const first = await recalculator.recalculate({
    globalState: initialGlobal,
    included,
    configurationKey: "config-v1",
    chunkSize: 10
  });
  const second = await recalculator.recalculate({
    globalState: initialGlobal,
    included,
    configurationKey: "config-v1",
    chunkSize: 10
  });
  const changedConfiguration = await recalculator.recalculate({
    globalState: initialGlobal,
    included,
    configurationKey: "config-v2",
    chunkSize: 10
  });

  const changedGlobal = structuredClone(initialGlobal);
  changedGlobal.files.a!.reviewed = [{ startLine: 0, endLineExclusive: 3 }];
  const changedState = await recalculator.recalculate({
    globalState: changedGlobal,
    included,
    configurationKey: "config-v2",
    chunkSize: 10
  });

  assert.equal(first.cacheHitCount, 0);
  assert.equal(first.calculatedFileCount, 2);
  assert.equal(second.cacheHitCount, 2);
  assert.equal(second.calculatedFileCount, 0);
  assert.equal(changedConfiguration.cacheHitCount, 0);
  assert.equal(changedConfiguration.calculatedFileCount, 2);
  assert.equal(changedState.cacheHitCount, 1);
  assert.equal(changedState.calculatedFileCount, 1);
  assert.equal(changedState.progress.reviewedNonEmptyLineCount, 2);
  assert.equal(loadOrder.length, 8);
});

test("background recalculation rejects enumeration and file snapshot races", async () => {
  const recalculator = new GlobalUnderstandingBackgroundRecalculator({
    source: sourceFrom({
      "src/race.ts": {
        cacheKey: "race-v2",
        snapshot: snapshot("src/race.ts", [0, 1], { lineCount: 2, contentHash: "race-hash" })
      }
    }, []),
    cache: new InMemoryGlobalUnderstandingProgressCache(),
    yieldControl: async () => {}
  });

  await assert.rejects(recalculator.recalculate({
    globalState: globalState([]),
    included: [{ path: "src/race.ts", nonEmptyLineCount: 1 }],
    configurationKey: "config-v1"
  }), /enumerated non-empty line count/u);
});

test("Node file source preserves CRLF, LF, CR and changes its cache evidence with content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t504-"));
  const filePath = path.join(root, "mixed.ts");
  await writeFile(filePath, "first\r\n\rsecond\n  \rthird\r", "utf8");
  const source = new NodeGlobalUnderstandingFileSource(root, "posix");

  const first = await source.load("mixed.ts", revision);
  assert.equal(first.path, "mixed.ts");
  assert.equal(first.revisionId, revision);
  assert.equal(first.lineCount, 6);
  assert.deepEqual(first.nonEmptyLines, [0, 2, 4]);
  assert.equal(first.contentHash?.length, 64);
  assert.equal(first.cacheKey, first.contentHash);

  await writeFile(filePath, "first\nchanged\n", "utf8");
  const second = await source.load("mixed.ts", revision);
  assert.notEqual(second.cacheKey, first.cacheKey);
  assert.deepEqual(second.nonEmptyLines, [0, 1]);

  await assert.rejects(source.load("../outside.ts", revision), /repositoryRelativePath/u);
});

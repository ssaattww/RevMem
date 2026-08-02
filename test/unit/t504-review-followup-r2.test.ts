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
  GlobalUnderstandingBackgroundRecalculator,
  InMemoryGlobalUnderstandingProgressCache,
  type GlobalUnderstandingFileSource,
  type LoadedGlobalUnderstandingFile
} from "../../src/application/global-understanding/index";
import {
  NodeGlobalUnderstandingFileSource
} from "../../src/adapters/repository-files/node-global-understanding-file-source";

const revision = "revision-r2";

const globalFile = (
  reviewed: GlobalFileReviewState["reviewed"]
): GlobalFileReviewState => ({
  fileId: "large-file",
  currentPath: "src/large.ts",
  revisionId: revision,
  reviewed,
  contentHash: "large-hash",
  updatedAt: "2026-08-02T13:20:00.000Z"
});

const globalState = (
  file: GlobalFileReviewState
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: "repository-r2",
  currentRevisionId: revision,
  files: { [file.fileId]: file },
  updatedAt: "2026-08-02T13:20:00.000Z"
});

test("T504-R2-P1 rejects a file changed during cooperative content analysis", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t504-r2-race-"));
  const filePath = path.join(root, "race.ts");
  await writeFile(filePath, "before\n".repeat(32), "utf8");
  const source = new NodeGlobalUnderstandingFileSource(root, "posix");
  let changed = false;

  await assert.rejects(source.load("race.ts", revision, {
    maxWorkBytes: 4,
    yieldControl: async () => {
      if (!changed) {
        changed = true;
        await writeFile(filePath, "after-content-with-different-size\n", "utf8");
      }
    }
  }), /changed while reading or analyzing/u);
  assert.equal(changed, true);
});

test("T504-R2-P2 yields during post-load evidence and interval calculation for one final file", async () => {
  const lineCount = 256;
  const nonEmptyLines = Array.from({ length: lineCount }, (_, index) => index);
  const reviewed = Array.from({ length: lineCount / 2 }, (_, index) => ({
    startLine: index * 2,
    endLineExclusive: index * 2 + 1
  }));
  const loaded: LoadedGlobalUnderstandingFile = {
    path: "src/large.ts",
    revisionId: revision,
    lineCount,
    nonEmptyLines,
    contentHash: "large-hash",
    cacheKey: "large-hash"
  };
  const source: GlobalUnderstandingFileSource = {
    load: async () => loaded
  };
  const yields: number[] = [];
  const recalculator = new GlobalUnderstandingBackgroundRecalculator({
    source,
    cache: new InMemoryGlobalUnderstandingProgressCache(),
    yieldControl: async () => { yields.push(yields.length + 1); }
  });
  const request: Parameters<GlobalUnderstandingBackgroundRecalculator["recalculate"]>[0] & {
    readonly calculationWorkChunkItems: number;
  } = {
    globalState: globalState(globalFile(reviewed)),
    included: [{ path: "src/large.ts", nonEmptyLineCount: lineCount }],
    configurationKey: "config-r2",
    chunkSize: 1,
    fileWorkChunkBytes: 1024,
    calculationWorkChunkItems: 4
  };

  const result = await recalculator.recalculate(request);

  assert.ok(yields.length > 0);
  assert.equal(result.complete, true);
  assert.equal(result.progress.reviewedNonEmptyLineCount, lineCount / 2);
  assert.equal(result.progress.totalNonEmptyLineCount, lineCount);
});

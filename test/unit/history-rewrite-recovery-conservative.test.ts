import assert from "node:assert/strict";
import test from "node:test";

import type { FileReviewState } from "../../src/core/contracts/index";
import {
  HistoryRewriteRecoveryService,
  type HistoryRewriteCurrentFile,
  type HistoryRewriteGitObjectPort,
  type HistoryRewriteGitObjectResult,
  type HistoryRewriteSnapshotPort,
  type HistoryRewriteSnapshotResult
} from "../../src/application/history-rewrite-recovery/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

const fileState = (): FileReviewState => ({
  schemaVersion: 1,
  fileId: "file-a",
  currentPath: "src/a.ts",
  previousPaths: [],
  revisionId: OLD_SHA,
  modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
  originalReviewedByDiff: {},
  contentHash: "hash-a",
  lineCount: 3,
  updatedAt: "2026-08-06T09:00:00.000Z"
});

const current = (
  path: string,
  contentHash: string,
  content = "one\ntwo\nthree"
): HistoryRewriteCurrentFile => ({
  fileId: `current:${path}`,
  path,
  lineCount: 3,
  contentHash,
  content
});

class FixedGit implements HistoryRewriteGitObjectPort {
  public constructor(private readonly result: HistoryRewriteGitObjectResult) {}
  public async diff(): Promise<HistoryRewriteGitObjectResult> {
    return this.result;
  }
}

class RecordingSnapshots implements HistoryRewriteSnapshotPort {
  public readonly paths: string[] = [];
  public constructor(
    private readonly result: (file: HistoryRewriteCurrentFile) => HistoryRewriteSnapshotResult
  ) {}
  public async map(
    _snapshotId: string,
    file: HistoryRewriteCurrentFile
  ): Promise<HistoryRewriteSnapshotResult> {
    this.paths.push(file.path);
    return this.result(file);
  }
}

const recover = (
  git: HistoryRewriteGitObjectResult,
  snapshots: RecordingSnapshots,
  currentFiles: readonly HistoryRewriteCurrentFile[]
) => new HistoryRewriteRecoveryService(new FixedGit(git), snapshots).recover({
  file: fileState(),
  newRevisionId: NEW_SHA,
  updatedAt: "2026-08-06T10:10:00.000Z",
  currentFiles,
  snapshotId: "snapshot-a",
  now: 2_000,
  options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
});

test("snapshot recovery rejects a same-path candidate when another candidate also preserves reviewed evidence", async () => {
  const snapshots = new RecordingSnapshots(() => ({
    kind: "mapped",
    reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }]
  }));

  const result = await recover(
    { kind: "missing-old-revision" },
    snapshots,
    [
      current("src/a.ts", "hash-current"),
      current("src/renamed.ts", "hash-renamed")
    ]
  );

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "ambiguous-file-mapping",
    reviewedRanges: []
  });
  assert.deepEqual(snapshots.paths, ["src/a.ts", "src/renamed.ts"]);
});

test("an authoritative empty same-path snapshot mapping remains unreviewed instead of restoring by hash", async () => {
  const snapshots = new RecordingSnapshots(() => ({
    kind: "mapped",
    reviewedRanges: []
  }));

  const result = await recover(
    { kind: "missing-old-revision" },
    snapshots,
    [current("src/a.ts", "hash-a")]
  );

  assert.equal(result.status, "recovered");
  assert.equal(result.source, "snapshot-diff");
  assert.deepEqual(result.file.modifiedReviewed, []);
});

test("direct Git evidence is rejected when complete old text contradicts persisted line count", async () => {
  const snapshots = new RecordingSnapshots(() => {
    throw new Error("snapshot fallback must not run");
  });
  const diff = [
    "diff --git a/src/a.ts b/src/renamed.ts",
    "similarity index 100%",
    "rename from src/a.ts",
    "rename to src/renamed.ts",
    ""
  ].join("\n");

  const result = await recover({
    kind: "diff",
    oldPath: "src/a.ts",
    newPath: "src/renamed.ts",
    diff,
    oldText: "one",
    newText: "one\ntwo\nthree"
  }, snapshots, [current("src/renamed.ts", "hash-new")]);

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "invalid-git-diff",
    reviewedRanges: []
  });
  assert.deepEqual(snapshots.paths, []);
});

test("snapshot recovery never chooses identity from reviewed-range survival alone", async () => {
  const snapshots = new RecordingSnapshots((candidate) => ({
    kind: "mapped",
    reviewedRanges: candidate.path === "src/actual.ts"
      ? []
      : [{ startLine: 1, endLineExclusive: 2 }]
  }));

  const result = await recover(
    { kind: "missing-old-revision" },
    snapshots,
    [
      current("src/actual.ts", "changed-actual", "changed\nall\nlines"),
      current("src/unrelated.ts", "unrelated", "zero\ntwo\nother")
    ]
  );

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "ambiguous-file-mapping",
    reviewedRanges: []
  });
});

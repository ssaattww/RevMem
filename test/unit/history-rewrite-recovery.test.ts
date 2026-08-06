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
const UPDATED_AT = "2026-08-06T09:50:00.000Z";
const OPTIONS = { ignoreWhitespaceChanges: false, ignoreEolChanges: false } as const;

function state(overrides: Partial<FileReviewState> = {}): FileReviewState {
  return {
    schemaVersion: 1,
    fileId: "file-a",
    currentPath: "src/a.ts",
    previousPaths: [],
    revisionId: OLD_SHA,
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
    originalReviewedByDiff: {},
    contentHash: "hash-a",
    lineCount: 3,
    updatedAt: "2026-08-06T09:00:00.000Z",
    ...overrides
  };
}

function current(overrides: Partial<HistoryRewriteCurrentFile> = {}): HistoryRewriteCurrentFile {
  return {
    fileId: "current-a",
    path: "src/a.ts",
    lineCount: 3,
    contentHash: "hash-a",
    content: "one\ntwo\nthree",
    ...overrides
  };
}

class StubGitObjectPort implements HistoryRewriteGitObjectPort {
  public calls = 0;

  public constructor(public result: HistoryRewriteGitObjectResult) {}

  public async diff(): Promise<HistoryRewriteGitObjectResult> {
    this.calls += 1;
    return this.result;
  }
}

class StubSnapshotPort implements HistoryRewriteSnapshotPort {
  public readonly calls: HistoryRewriteCurrentFile[] = [];

  public constructor(
    private readonly mapper: (file: HistoryRewriteCurrentFile) => HistoryRewriteSnapshotResult
  ) {}

  public async map(
    _snapshotId: string,
    file: HistoryRewriteCurrentFile
  ): Promise<HistoryRewriteSnapshotResult> {
    this.calls.push(file);
    return this.mapper(file);
  }
}

function service(
  gitResult: HistoryRewriteGitObjectResult,
  snapshotMapper: (file: HistoryRewriteCurrentFile) => HistoryRewriteSnapshotResult = () => ({ kind: "missing" })
): {
  readonly recovery: HistoryRewriteRecoveryService;
  readonly git: StubGitObjectPort;
  readonly snapshots: StubSnapshotPort;
} {
  const git = new StubGitObjectPort(gitResult);
  const snapshots = new StubSnapshotPort(snapshotMapper);
  return {
    recovery: new HistoryRewriteRecoveryService(git, snapshots),
    git,
    snapshots
  };
}

const recover = (
  recovery: HistoryRewriteRecoveryService,
  currentFiles: readonly HistoryRewriteCurrentFile[],
  overrides: Partial<Parameters<HistoryRewriteRecoveryService["recover"]>[0]> = {}
) => recovery.recover({
  file: state(),
  newRevisionId: NEW_SHA,
  updatedAt: UPDATED_AT,
  currentFiles,
  snapshotId: "snapshot-a",
  now: 1_000,
  options: OPTIONS,
  ...overrides
});

test("uses old Git object evidence before snapshot and preserves review on a SHA-only rewrite", async () => {
  const { recovery, git, snapshots } = service({ kind: "unchanged", newPath: "src/a.ts" }, () => {
    throw new Error("snapshot fallback must not run");
  });

  const result = await recover(recovery, [current()]);

  assert.equal(result.status, "recovered");
  assert.equal(result.source, "git-object-diff");
  assert.equal(git.calls, 1);
  assert.equal(snapshots.calls.length, 0);
  assert.equal(result.file.revisionId, NEW_SHA);
  assert.deepEqual(result.file.modifiedReviewed, [{ startLine: 0, endLineExclusive: 3 }]);
});

test("maps direct Git object diffs and invalidates only changed old lines", async () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -2 +2,2 @@",
    "-two",
    "+two changed",
    "+inserted",
    ""
  ].join("\n");
  const { recovery } = service({
    kind: "diff",
    oldPath: "src/a.ts",
    newPath: "src/a.ts",
    diff,
    oldText: "one\ntwo\nthree",
    newText: "one\ntwo changed\ninserted\nthree"
  });

  const result = await recover(recovery, [current({
    lineCount: 4,
    contentHash: "hash-b",
    content: "one\ntwo changed\ninserted\nthree"
  })]);

  assert.equal(result.status, "recovered");
  assert.equal(result.source, "git-object-diff");
  assert.deepEqual(result.file.modifiedReviewed, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 3, endLineExclusive: 4 }
  ]);
});

test("uses snapshot diff only after the old Git object is missing", async () => {
  const { recovery, snapshots } = service(
    { kind: "missing-old-revision" },
    () => ({ kind: "mapped", reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }] })
  );

  const result = await recover(recovery, [current({ contentHash: "hash-b" })]);

  assert.equal(result.status, "recovered");
  assert.equal(result.source, "snapshot-diff");
  assert.equal(snapshots.calls.length, 1);
  assert.deepEqual(result.file.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
});

test("uses a unique exact-content mapping for a renamed file after snapshot diff has no surviving evidence", async () => {
  const { recovery, snapshots } = service(
    { kind: "missing-old-revision" },
    () => ({ kind: "mapped", reviewedRanges: [] })
  );

  const result = await recover(recovery, [current({
    fileId: "renamed",
    path: "src/renamed.ts",
    contentHash: "hash-a"
  })]);

  assert.equal(result.status, "recovered");
  assert.equal(result.source, "unique-content");
  assert.equal(snapshots.calls.length, 1);
  assert.equal(result.file.fileId, "file-a");
  assert.equal(result.file.currentPath, "src/renamed.ts");
  assert.deepEqual(result.file.previousPaths, ["src/a.ts"]);
  assert.deepEqual(result.file.modifiedReviewed, [{ startLine: 0, endLineExclusive: 3 }]);
});

test("does not invent review state when exact-content rename candidates are duplicated", async () => {
  const { recovery } = service(
    { kind: "missing-old-revision" },
    () => ({ kind: "mapped", reviewedRanges: [] })
  );

  const result = await recover(recovery, [
    current({ fileId: "one", path: "src/one.ts", contentHash: "hash-a" }),
    current({ fileId: "two", path: "src/two.ts", contentHash: "hash-a" })
  ]);

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "ambiguous-file-mapping",
    reviewedRanges: []
  });
});

test("does not use snapshot evidence after a non-missing Git failure", async () => {
  const { recovery, snapshots } = service(
    { kind: "failure", reason: "permission-denied" },
    () => ({ kind: "mapped", reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }] })
  );

  const result = await recover(recovery, [current()]);

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "git-failure",
    reviewedRanges: []
  });
  assert.equal(snapshots.calls.length, 0);
});

test("rejects multiple snapshot candidates with surviving reviewed evidence", async () => {
  const { recovery } = service(
    { kind: "missing-old-revision" },
    () => ({ kind: "mapped", reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }] })
  );

  const result = await recover(recovery, [
    current({ fileId: "one", path: "src/one.ts", contentHash: "hash-one" }),
    current({ fileId: "two", path: "src/two.ts", contentHash: "hash-two" })
  ], { file: state({ contentHash: "hash-old" }) });

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "ambiguous-file-mapping",
    reviewedRanges: []
  });
});

test("fails closed when direct Git diff evidence is malformed", async () => {
  const { recovery, snapshots } = service({
    kind: "diff",
    oldPath: "src/a.ts",
    newPath: "src/a.ts",
    diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n"
  }, () => ({ kind: "mapped", reviewedRanges: [{ startLine: 0, endLineExclusive: 3 }] }));

  const result = await recover(recovery, [current()]);

  assert.deepEqual(result, {
    status: "unresolved",
    source: "unreviewed",
    reason: "invalid-git-diff",
    reviewedRanges: []
  });
  assert.equal(snapshots.calls.length, 0);
});

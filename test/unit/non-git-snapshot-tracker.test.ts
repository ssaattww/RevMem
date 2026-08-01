import assert from "node:assert/strict";
import { test } from "node:test";

import "./workspace-non-git-snapshot-tracking.test";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
  type NonGitTrackedFileState,
} from "../../src/application/non-git-snapshots/index";

function state(content: string): NonGitTrackedFileState {
  return {
    workspaceContextId: "workspace-context",
    fileId: "src/example.ts",
    content,
    reviewedRanges: [{ startLine: 0, endLineExclusive: content.split("\n").length }],
  };
}

test("compressed snapshot round-trips without storing plaintext", async () => {
  const storage = new InMemoryNonGitSnapshotStorage();
  const tracker = new NonGitSnapshotTracker(storage, {
    maxSnapshots: 8,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 60_000,
  });

  const saved = await tracker.save(state("alpha\nbeta\ngamma"), 1_000);
  const raw = storage.inspect(saved.snapshotId);

  assert.ok(raw);
  assert.equal(raw.includes(Buffer.from("alpha\nbeta\ngamma", "utf8")), false);
  assert.deepEqual(await tracker.restore(saved.snapshotId, 1_001), state("alpha\nbeta\ngamma"));
});

test("unique line mapping preserves unchanged reviewed lines and invalidates inserted lines", async () => {
  const tracker = new NonGitSnapshotTracker(new InMemoryNonGitSnapshotStorage(), {
    maxSnapshots: 8,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 60_000,
  });
  const saved = await tracker.save(state("alpha\nbeta\ngamma"), 1_000);

  const mapped = await tracker.map(saved.snapshotId, "alpha\ninserted\nbeta\ngamma", 1_001);

  assert.equal(mapped.status, "mapped");
  assert.deepEqual(mapped.reviewedRanges, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 },
  ]);
});

test("ambiguous duplicate-line mapping does not invent reviewed evidence", async () => {
  const tracker = new NonGitSnapshotTracker(new InMemoryNonGitSnapshotStorage(), {
    maxSnapshots: 8,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 60_000,
  });
  const saved = await tracker.save(state("same\nanchor\nsame"), 1_000);

  const mapped = await tracker.map(saved.snapshotId, "same\nsame\nanchor\nsame", 1_001);

  assert.equal(mapped.status, "ambiguous");
  assert.deepEqual(mapped.reviewedRanges, []);
});

test("missing, corrupt, and expired snapshots return unreviewed state", async () => {
  const storage = new InMemoryNonGitSnapshotStorage();
  const tracker = new NonGitSnapshotTracker(storage, {
    maxSnapshots: 8,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 10,
  });
  const saved = await tracker.save(state("alpha\nbeta"), 1_000);

  assert.deepEqual(await tracker.map("missing", "alpha\nbeta", 1_001), {
    status: "missing",
    reviewedRanges: [],
  });

  storage.overwrite(saved.snapshotId, Buffer.from("not-gzip"));
  assert.deepEqual(await tracker.map(saved.snapshotId, "alpha\nbeta", 1_001), {
    status: "corrupt",
    reviewedRanges: [],
  });

  const expired = await tracker.save(state("alpha\nbeta"), 2_000);
  assert.deepEqual(await tracker.map(expired.snapshotId, "alpha\nbeta", 2_011), {
    status: "expired",
    reviewedRanges: [],
  });
});

test("snapshot cleanup enforces count and compressed-byte limits oldest-first", async () => {
  const countStorage = new InMemoryNonGitSnapshotStorage();
  const countTracker = new NonGitSnapshotTracker(countStorage, {
    maxSnapshots: 2,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 60_000,
  });

  const first = await countTracker.save(state("first"), 1_000);
  await countTracker.save(state("second"), 1_001);
  const third = await countTracker.save(state("third"), 1_002);

  assert.equal(countStorage.has(first.snapshotId), false);
  assert.equal(countStorage.has(third.snapshotId), true);
  assert.equal(countStorage.count(), 2);

  const byteStorage = new InMemoryNonGitSnapshotStorage();
  const sizingTracker = new NonGitSnapshotTracker(byteStorage, {
    maxSnapshots: 8,
    maxCompressedBytes: 1024 * 1024,
    retentionMs: 60_000,
  });
  const byteFirst = await sizingTracker.save(state("byte-first"), 2_000);
  const byteLimit = byteFirst.compressedBytes * 2 - 1;
  const byteTracker = new NonGitSnapshotTracker(byteStorage, {
    maxSnapshots: 8,
    maxCompressedBytes: byteLimit,
    retentionMs: 60_000,
  });
  const byteSecond = await byteTracker.save(state("byte-second"), 2_001);

  assert.equal(byteStorage.has(byteFirst.snapshotId), false);
  assert.equal(byteStorage.has(byteSecond.snapshotId), true);
  assert.ok(byteStorage.totalBytes() <= byteLimit);
});

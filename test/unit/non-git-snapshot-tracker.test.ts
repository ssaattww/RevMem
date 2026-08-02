import assert from "node:assert/strict";
import { test } from "node:test";

import "./workspace-non-git-snapshot-tracking.test";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
  type NonGitTrackedFileState,
} from "../../src/application/non-git-snapshots/index";
import { NodeNonGitSnapshotCodec } from "../../src/adapters/non-git-snapshots/index";

const tracker = (storage: InMemoryNonGitSnapshotStorage, retentionMs = 60_000) => new NonGitSnapshotTracker(storage, new NodeNonGitSnapshotCodec(), {
  maxSnapshots: 8,
  maxCompressedBytes: 1024 * 1024,
  retentionMs,
});

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
  const snapshots = tracker(storage);

  const saved = await snapshots.save(state("alpha\nbeta\ngamma"), 1_000);
  const raw = await storage.inspect(saved.snapshotId);

  assert.ok(raw);
  assert.equal(Buffer.from(raw).includes(Buffer.from("alpha\nbeta\ngamma", "utf8")), false);
  assert.deepEqual(await snapshots.restore(saved.snapshotId, 1_001), state("alpha\nbeta\ngamma"));
});

test("unique line mapping preserves unchanged reviewed lines and invalidates inserted lines", async () => {
  const snapshots = tracker(new InMemoryNonGitSnapshotStorage());
  const saved = await snapshots.save(state("alpha\nbeta\ngamma"), 1_000);

  const mapped = await snapshots.map(saved.snapshotId, "alpha\ninserted\nbeta\ngamma", 1_001);

  assert.equal(mapped.status, "mapped");
  assert.deepEqual(mapped.reviewedRanges, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 },
  ]);
});

test("ambiguous duplicate-line mapping does not invent reviewed evidence", async () => {
  const snapshots = tracker(new InMemoryNonGitSnapshotStorage());
  const saved = await snapshots.save(state("same\nanchor\nsame"), 1_000);

  const mapped = await snapshots.map(saved.snapshotId, "same\nsame\nanchor\nsame", 1_001);

  assert.equal(mapped.status, "ambiguous");
  assert.deepEqual(mapped.reviewedRanges, []);
});

test("duplicate-line reorder with unchanged multiplicity remains ambiguous", async () => {
  const snapshots = tracker(new InMemoryNonGitSnapshotStorage());
  const saved = await snapshots.save(state("A\nX\nA"), 1_000);

  const mapped = await snapshots.map(saved.snapshotId, "A\nA\nX", 1_001);

  assert.equal(mapped.status, "ambiguous");
  assert.deepEqual(mapped.reviewedRanges, []);
});

test("equal diagonal does not hide an alternate longest duplicate mapping", async () => {
  const snapshots = tracker(new InMemoryNonGitSnapshotStorage());
  const saved = await snapshots.save(state("A\nA\nB\nB"), 1_000);

  const mapped = await snapshots.map(saved.snapshotId, "A\nB\nB\nA", 1_001);

  assert.equal(mapped.status, "ambiguous");
  assert.deepEqual(mapped.reviewedRanges, []);
});

test("missing, corrupt, and expired snapshots return unreviewed state", async () => {
  const storage = new InMemoryNonGitSnapshotStorage();
  const snapshots = tracker(storage, 10);
  const saved = await snapshots.save(state("alpha\nbeta"), 1_000);

  assert.deepEqual(await snapshots.map("missing", "alpha\nbeta", 1_001), {
    status: "missing",
    reviewedRanges: [],
  });

  await storage.overwrite(saved.snapshotId, Buffer.from("not-gzip"));
  assert.deepEqual(await snapshots.map(saved.snapshotId, "alpha\nbeta", 1_001), {
    status: "corrupt",
    reviewedRanges: [],
  });

  const expired = await snapshots.save(state("alpha\nbeta"), 2_000);
  assert.deepEqual(await snapshots.map(expired.snapshotId, "alpha\nbeta", 2_011), {
    status: "expired",
    reviewedRanges: [],
  });
});

test("snapshot cleanup enforces count and compressed-byte limits oldest-first", async () => {
  const countStorage = new InMemoryNonGitSnapshotStorage();
  const countTracker = new NonGitSnapshotTracker(countStorage, new NodeNonGitSnapshotCodec(), { maxSnapshots: 2, maxCompressedBytes: 1024 * 1024, retentionMs: 60_000 });

  const first = await countTracker.save(state("first"), 1_000);
  await countTracker.save(state("second"), 1_001);
  const third = await countTracker.save(state("third"), 1_002);

  assert.equal(await countStorage.has(first.snapshotId), false);
  assert.equal(await countStorage.has(third.snapshotId), true);
  assert.equal(await countStorage.count(), 2);

  const byteStorage = new InMemoryNonGitSnapshotStorage();
  const sizingTracker = tracker(byteStorage);
  const byteFirst = await sizingTracker.save(state("byte-first"), 2_000);
  const byteLimit = byteFirst.compressedBytes * 2 - 1;
  const byteTracker = new NonGitSnapshotTracker(byteStorage, new NodeNonGitSnapshotCodec(), { maxSnapshots: 8, maxCompressedBytes: byteLimit, retentionMs: 60_000 });
  const byteSecond = await byteTracker.save(state("byte-second"), 2_001);

  assert.equal(await byteStorage.has(byteFirst.snapshotId), false);
  assert.equal(await byteStorage.has(byteSecond.snapshotId), true);
  assert.ok(await byteStorage.totalBytes() <= byteLimit);
});

test("EOL changes, terminal newline changes, CR, and empty content invalidate the changed line evidence", async () => {
  const snapshots = tracker(new InMemoryNonGitSnapshotStorage());
  for (const [before, after, expected] of [["alpha\r\nbeta", "alpha\nbeta", [{ startLine: 1, endLineExclusive: 2 }]], ["alpha\rbeta", "alpha\nbeta", []], ["alpha\n", "alpha", []], ["", "\n", []]] as const) {
    const saved = await snapshots.save(state(before), 1_000);
    const mapped = await snapshots.map(saved.snapshotId, after, 1_001);
    assert.deepEqual(mapped.reviewedRanges, expected, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

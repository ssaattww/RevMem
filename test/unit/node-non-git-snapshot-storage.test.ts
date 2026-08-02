import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } from "../../src/adapters/non-git-snapshots/index";
import { NonGitSnapshotTracker } from "../../src/application/non-git-snapshots/index";

test("local extension snapshot storage restores the authoritative generation after adapter restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-range-t601-"));
  try {
    const limits = { maxSnapshots: 8, maxCompressedBytes: 1024 * 1024, retentionMs: 60_000 };
    const first = new NonGitSnapshotTracker(new NodeNonGitSnapshotStorage({ snapshotDirectory: root }), new NodeNonGitSnapshotCodec(), limits);
    await first.saveLatest({ workspaceContextId: "workspace", fileId: "src/example.ts", content: "alpha\nbeta", reviewedRanges: [{ startLine: 0, endLineExclusive: 2 }] }, 1_000);
    const restarted = new NonGitSnapshotTracker(new NodeNonGitSnapshotStorage({ snapshotDirectory: root }), new NodeNonGitSnapshotCodec(), limits);
    const snapshotId = await restarted.latestSnapshotId("workspace", "src/example.ts");
    assert.ok(snapshotId);
    assert.deepEqual(await restarted.map(snapshotId, "alpha\ninserted\nbeta", 1_001), { status: "mapped", reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

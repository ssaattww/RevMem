import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeNonGitSnapshotCodec } from "../../src/adapters/non-git-snapshots/index";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
  type NonGitSnapshotLimits,
  type NonGitTrackedFileState
} from "../../src/application/non-git-snapshots/index";
import {
  DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
  resolveConfiguredNonGitSnapshotLimits
} from "../../src/application/non-git-snapshots/non-git-snapshot-settings";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source";

const incompleteSplitLimits = {
  maxSnapshots: 1,
  maxSnapshotCompressedBytes: 1024,
  retentionMs: 1_000
};
// @ts-expect-error T505-R002: the split limit contract requires both per-snapshot and aggregate limits.
const rejectedIncompleteSplitLimits: NonGitSnapshotLimits = incompleteSplitLimits;
void rejectedIncompleteSplitLimits;

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const branchContext = (
  repositoryId: string,
  contextId: string,
  revisionId: string,
  occurredAt: string
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: "refs/heads/main",
  branch: { refName: "refs/heads/main", headRevision: revisionId },
  files: {},
  createdAt: occurredAt,
  updatedAt: occurredAt
});

const selectBranch = (
  source: T505GlobalUnderstandingSource,
  repositoryId: string,
  repositoryRoot: string,
  revisionId: string
): void => {
  source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: revisionId,
      selection: {
        kind: "branch",
        repositoryId,
        repositoryRoot,
        branchRef: "refs/heads/main"
      }
    },
    progress: undefined
  });
};

test("T505-R001 prefers immutable open-document evidence and switches to disk after save and close", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t505-r001-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const globalStorage = path.join(root, "global-storage");
  const workspaceStorage = path.join(root, "workspace-storage");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });

  const diskText = "disk\n";
  const liveText = "reviewed\n\nlive\n";
  await writeFile(path.join(repositoryRoot, "src", "a.ts"), diskText, "utf8");

  const repositoryId = "repository-r001";
  const contextId = "branch-context-r001";
  const revisionId = "revision-r001";
  const occurredAt = "2026-08-06T11:00:00.000Z";
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: revisionId,
    files: {
      "file-1": {
        fileId: "file-1",
        currentPath: "src/a.ts",
        revisionId,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: sha256(liveText),
        updatedAt: occurredAt
      }
    },
    updatedAt: occurredAt
  };
  const storageUris = {
    globalStorageUri: { fsPath: globalStorage },
    storageUri: { fsPath: workspaceStorage }
  };
  await new FileSystemReviewStateRepository({ storageUris }).save(
    { kind: "git", repositoryId, contextId },
    {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: branchContext(repositoryId, contextId, revisionId, occurredAt),
      globalState
    }
  );

  let openDocuments = [{
    path: "src/a.ts",
    revisionId,
    lineCount: 4,
    nonEmptyLines: [0, 2],
    contentHash: sha256(liveText),
    cacheKey: `open:1:${sha256(liveText)}`,
    validateCurrent: async () => undefined
  }];
  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => openDocuments,
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  selectBranch(source, repositoryId, repositoryRoot, revisionId);

  const live = await source.recalculate();
  assert.equal(live?.progress.reviewedNonEmptyLineCount, 1);
  assert.equal(live?.progress.totalNonEmptyLineCount, 2);
  assert.equal(live?.progress.files[0]?.state, "current");

  await writeFile(path.join(repositoryRoot, "src", "a.ts"), liveText, "utf8");
  openDocuments = [];
  const savedAndClosed = await source.recalculate();
  assert.equal(savedAndClosed?.progress.reviewedNonEmptyLineCount, 1);
  assert.equal(savedAndClosed?.progress.totalNonEmptyLineCount, 2);
  assert.equal(savedAndClosed?.progress.files[0]?.state, "current");
});

test("T505-R001 wires change, save, and close events to Global evidence refresh", async () => {
  const composition = await readFile("src/t305-extension.ts", "utf8");
  assert.match(composition, /onDidChangeTextDocument/u);
  assert.match(composition, /onDidSaveTextDocument/u);
  assert.match(composition, /onDidCloseTextDocument/u);
});

const snapshotState = (fileId: string, content: string): NonGitTrackedFileState => ({
  workspaceContextId: "workspace-context",
  fileId,
  content,
  reviewedRanges: [{ startLine: 0, endLineExclusive: 1 }]
});

const snapshotIdFor = (
  codec: NodeNonGitSnapshotCodec,
  state: NonGitTrackedFileState,
  now: number
): string => codec.sha256(JSON.stringify({
  schemaVersion: 1,
  createdAt: now,
  workspaceContextId: state.workspaceContextId,
  fileId: state.fileId,
  content: state.content,
  reviewedRanges: state.reviewedRanges
}));

test("T505-R002 keeps individually valid snapshots when only their combined size exceeds the per-snapshot limit", async () => {
  const storage = new InMemoryNonGitSnapshotStorage();
  const codec = new NodeNonGitSnapshotCodec();
  const permissive = new NonGitSnapshotTracker(storage, codec, {
    maxSnapshots: 8,
    maxSnapshotCompressedBytes: 1024 * 1024,
    maxTotalCompressedBytes: 8 * 1024 * 1024,
    retentionMs: 60_000
  });
  const first = await permissive.save(snapshotState("first.ts", "first-content"), 1_000);
  const perSnapshotLimit = first.compressedBytes + 32;
  const separated = new NonGitSnapshotTracker(storage, codec, {
    maxSnapshots: 8,
    maxSnapshotCompressedBytes: perSnapshotLimit,
    maxTotalCompressedBytes: perSnapshotLimit * 4,
    retentionMs: 60_000
  });
  const second = await separated.save(snapshotState("second.ts", "second-content"), 1_001);

  assert.ok(first.compressedBytes <= perSnapshotLimit);
  assert.ok(second.compressedBytes <= perSnapshotLimit);
  assert.ok(await storage.totalBytes() > perSnapshotLimit);
  assert.equal(await storage.has(first.snapshotId), true);
  assert.equal(await storage.has(second.snapshotId), true);
});

test("T505-R002 rejects aggregate limits below the per-snapshot limit and never publishes a removed latest snapshot", async () => {
  const codec = new NodeNonGitSnapshotCodec();
  assert.throws(
    () => new NonGitSnapshotTracker(
      new InMemoryNonGitSnapshotStorage(),
      codec,
      {
        maxSnapshots: 8,
        maxSnapshotCompressedBytes: 1024,
        maxTotalCompressedBytes: 512,
        retentionMs: 60_000
      }
    ),
    /maxTotalCompressedBytes.*maxSnapshotCompressedBytes/u
  );

  const configuredPerSnapshot = DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES + 1;
  const resolved = resolveConfiguredNonGitSnapshotLimits({
    maxSnapshotFileSizeBytes: configuredPerSnapshot
  });
  assert.equal(resolved.maxSnapshotCompressedBytes, configuredPerSnapshot);
  assert.ok(resolved.maxTotalCompressedBytes >= configuredPerSnapshot);

  const storage = new InMemoryNonGitSnapshotStorage();
  const tracker = new NonGitSnapshotTracker(storage, codec, {
    maxSnapshots: 1,
    maxSnapshotCompressedBytes: 1024 * 1024,
    maxTotalCompressedBytes: 1024 * 1024,
    retentionMs: 60_000
  });
  const now = 2_000;
  const first = await tracker.save(snapshotState("first.ts", "first-content"), now);
  let candidate: NonGitTrackedFileState | undefined;
  for (let index = 0; index < 100_000; index += 1) {
    const current = snapshotState(`candidate-${index}.ts`, `candidate-content-${index}`);
    if (snapshotIdFor(codec, current, now) < first.snapshotId) {
      candidate = current;
      break;
    }
  }
  assert.ok(candidate, "a lexicographically earlier same-timestamp snapshot fixture must be found");

  const latest = await tracker.saveLatest(candidate, now);
  assert.equal(await storage.has(latest.snapshotId), true);
  assert.equal(
    await tracker.latestSnapshotId(candidate.workspaceContextId, candidate.fileId),
    latest.snapshotId
  );
  assert.deepEqual(await tracker.restore(latest.snapshotId, now), candidate);
});

test("T505-R003 reuses the shared last-valid exclusion policy after an invalid setting", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t505-r003-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(path.join(repositoryRoot, "ignored"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "visible.ts"), "visible\n", "utf8");
  await writeFile(path.join(repositoryRoot, "ignored", "hidden.ts"), "hidden\n", "utf8");

  const policy = new ReviewFileExclusionPolicyService({ userGlobs: ["ignored/**"] });
  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global-storage") },
      storageUri: { fsPath: path.join(root, "workspace-storage") }
    },
    exclusionPolicy: policy,
    readOpenDocuments: () => [],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  selectBranch(source, "repository-r003", repositoryRoot, "revision-r003");

  const beforeInvalid = await source.recalculate();
  assert.equal(beforeInvalid?.progress.totalNonEmptyLineCount, 1);
  assert.equal(beforeInvalid?.prunedExcludedDirectoryCount, 1);
  assert.throws(() => policy.updateUserGlobs(["!ignored/**"]));

  const afterInvalid = await source.recalculate();
  assert.equal(afterInvalid?.progress.totalNonEmptyLineCount, 1);
  assert.equal(afterInvalid?.prunedExcludedDirectoryCount, 1);
});

test("T505-R004 invalid snapshot settings fall back without throwing and the manifest caps safe integers", async () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(resolveConfiguredNonGitSnapshotLimits({
      maxSnapshotFileSizeBytes: invalid
    }), {
      maxSnapshots: 128,
      maxSnapshotCompressedBytes: DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
      maxTotalCompressedBytes: DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
      retentionMs: 30 * 24 * 60 * 60 * 1_000
    });
  }

  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes: {
      configuration: {
        properties: Record<string, { maximum?: number }>;
      };
    };
  };
  assert.equal(
    manifest.contributes.configuration.properties[
      "reviewRange.maxSnapshotFileSizeBytes"
    ]?.maximum,
    Number.MAX_SAFE_INTEGER
  );
});

test("T505-R006 focused validation executes the review-finding suite exactly once", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const focused = manifest.scripts["test:t505"] ?? "";
  assert.equal(
    focused.match(/test-dist\/test\/unit\/t505-review-findings\.test\.js/gu)?.length ?? 0,
    1
  );
});

test("T505-R007 follow-up handoff uses the required schema v3 top-level packet and preserves the original payload", async () => {
  const handoff = await readFile(
    "handoffs/issue-1-t505-review-followup-20260806210039.yaml",
    "utf8"
  );
  for (const key of [
    "producer",
    "repository",
    "issue_or_pr",
    "task_id",
    "target",
    "authorized_actions",
    "write_boundary",
    "commands",
    "tests",
    "ci",
    "implementation",
    "review",
    "report",
    "source_payloads",
    "next_action",
    "transport"
  ]) {
    assert.match(handoff, new RegExp(`^${key}:`, "mu"), `missing top-level ${key}`);
  }
  assert.doesNotMatch(handoff, /^handoff:/mu);
  assert.match(handoff, /output_contract_version: legacy-nonconformant-schema3/u);
  assert.match(handoff, /payload: \|-/u);
});

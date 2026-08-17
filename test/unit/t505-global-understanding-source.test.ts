import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileSystemReviewStateRepository
} from "../../src/adapters/state-repository/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

test("T505 source joins persisted Global state with included files and separate exclusion diagnostics", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t505-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const globalStorage = path.join(root, "global-storage");
  const workspaceStorage = path.join(root, "workspace-storage");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "dist"), { recursive: true });
  const sourceText = "reviewed\n\nunreviewed\n";
  await writeFile(path.join(repositoryRoot, "src", "a.ts"), sourceText, "utf8");
  await writeFile(path.join(repositoryRoot, "binary.dat"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(repositoryRoot, "dist", "generated.js"), "generated\n", "utf8");

  const repositoryId = "repository-1";
  const contextId = "branch-context";
  const revisionId = "revision-1";
  const occurredAt = "2026-08-06T08:00:00.000Z";
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "branch",
    repositoryId,
    displayName: "refs/heads/main",
    branch: { refName: "refs/heads/main", headRevision: revisionId },
    files: {},
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
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
        contentHash: sha256(sourceText),
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
    { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState }
  );

  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => [],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
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

  const current = await source.recalculate();
  assert.deepEqual(current, {
    progress: {
      reviewedNonEmptyLineCount: 1,
      totalNonEmptyLineCount: 2,
      progress: 1 / 2,
      files: [{
        path: "src/a.ts",
        state: "current",
        reviewedNonEmptyLineCount: 1,
        totalNonEmptyLineCount: 2,
        progress: 1 / 2
      }]
    },
    excludedFileCount: 1,
    prunedExcludedDirectoryCount: 1
  });

  source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: "revision-2",
      selection: {
        kind: "branch",
        repositoryId,
        repositoryRoot,
        branchRef: "refs/heads/main"
      }
    },
    progress: undefined
  });
  const staleRevision = await source.recalculate();
  assert.equal(staleRevision?.progress.reviewedNonEmptyLineCount, 0);
  assert.equal(staleRevision?.progress.totalNonEmptyLineCount, 2);
  assert.equal(staleRevision?.progress.files[0]?.state, "missing");
});

test("Issue #59 uses only previously opened files for Global line progress and reports unopened files separately", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-issue-59-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const globalStorage = path.join(root, "global-storage");
  const workspaceStorage = path.join(root, "workspace-storage");
  await mkdir(repositoryRoot, { recursive: true });
  const openedText = "reviewed\n\nunreviewed\n";
  await writeFile(path.join(repositoryRoot, "opened.ts"), openedText, "utf8");
  await writeFile(path.join(repositoryRoot, "unopened.ts"), "never\nopened\n", "utf8");

  const repositoryId = "repository-issue-59";
  const contextId = "branch-context";
  const revisionId = "revision-1";
  const occurredAt = "2026-08-17T06:00:00.000Z";
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "branch",
    repositoryId,
    displayName: "refs/heads/main",
    branch: { refName: "refs/heads/main", headRevision: revisionId },
    files: {},
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: revisionId,
    files: {
      opened: {
        fileId: "opened",
        currentPath: "opened.ts",
        revisionId,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: sha256(openedText),
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
    { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState }
  );

  let open = true;
  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => open ? [{
      path: "opened.ts",
      revisionId,
      lineCount: 3,
      nonEmptyLines: [0, 2],
      contentHash: sha256(openedText),
      cacheKey: `test:${sha256(openedText)}`
    }] : [],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
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

  const whileOpen = await source.recalculate();
  assert.equal(whileOpen?.progress.reviewedNonEmptyLineCount, 1);
  assert.equal(whileOpen?.progress.totalNonEmptyLineCount, 2);
  assert.deepEqual(whileOpen?.progress.files.map((file) => file.path), ["opened.ts"]);
  const whileOpenCounts = whileOpen as typeof whileOpen & {
    openedFileCount?: number;
    unopenedFileCount?: number;
  };
  assert.equal(whileOpenCounts?.openedFileCount, 1);
  assert.equal(whileOpenCounts?.unopenedFileCount, 1);

  open = false;
  const afterClose = await source.recalculate();
  assert.equal(afterClose?.progress.reviewedNonEmptyLineCount, 1);
  assert.equal(afterClose?.progress.totalNonEmptyLineCount, 2);
  assert.deepEqual(afterClose?.progress.files.map((file) => file.path), ["opened.ts"]);
  const afterCloseCounts = afterClose as typeof afterClose & {
    openedFileCount?: number;
    unopenedFileCount?: number;
  };
  assert.equal(afterCloseCounts?.openedFileCount, 1);
  assert.equal(afterCloseCounts?.unopenedFileCount, 1);
});

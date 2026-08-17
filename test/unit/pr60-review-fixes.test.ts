import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/t405-pull-request-review-runtime.js";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const NEXT = "c".repeat(40);

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const noOpRepository: PullRequestReviewRuntimeRepository = {
  load: async () => undefined,
  commit: async () => undefined,
};

test("R60-001 immutable PR HEAD remains authoritative when the working-tree candidate set omits the file", async () => {
  const contextId = "github-pr:repository-r60-001#60";
  const snapshot: PullRequestDiffSnapshot = {
    contextId,
    baseSha: BASE,
    headSha: HEAD,
    originalDiffId: `${BASE}..${HEAD}`,
    files: [{
      fileId: "immutable",
      oldPath: "src/immutable.ts",
      newPath: "src/immutable.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      hunks: [{
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { kind: "deletion", oldLine: 1, text: "old" },
          { kind: "addition", newLine: 1, text: "new" },
        ],
      }],
    }],
  };
  const reads: string[] = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: noOpRepository,
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: "repository-r60-001",
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => {
      reads.push(`${descriptor.revision}:${descriptor.filePath}`);
      return { kind: "found", content: "reviewed\nsecond\n" };
    },
  });

  const scanned = await runtime.readGlobalHeadFiles(contextId, new Set());

  assert.deepEqual(scanned, [{
    path: "src/immutable.ts",
    revisionId: HEAD,
    content: "reviewed\nsecond\n",
  }]);
  assert.deepEqual(reads, [`${HEAD}:src/immutable.ts`]);
});

test("R60-001 Global promotes immutable PR HEAD evidence even when the working tree no longer contains that path", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-r60-001-global-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(repositoryRoot, { recursive: true });
  await writeFile(path.join(repositoryRoot, "local.ts"), "local\n", "utf8");

  const repositoryId = "repository-r60-001-global";
  const contextId = "github-pr:repository-r60-001-global#60";
  const immutableText = "reviewed\nsecond\n";
  const occurredAt = "2026-08-18T00:00:00.000Z";
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "pull-request",
    repositoryId,
    displayName: "PR #60",
    pullRequest: {
      host: "github.com",
      owner: "ssaattww",
      repository: "RevMem",
      number: 60,
      state: "open",
      baseSha: BASE,
      headSha: HEAD,
    },
    files: {},
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: HEAD,
    files: {
      immutable: {
        fileId: "immutable",
        currentPath: "src/immutable.ts",
        revisionId: HEAD,
        reviewed: [{ startLine: 0, endLineExclusive: 1 }],
        contentHash: sha256(immutableText),
        updatedAt: occurredAt,
      },
    },
    updatedAt: occurredAt,
  };
  const storageUris = {
    globalStorageUri: { fsPath: path.join(root, "global-storage") },
    storageUri: { fsPath: path.join(root, "workspace-storage") },
  };
  await new FileSystemReviewStateRepository({ storageUris }).save(
    { kind: "pull-request", repositoryId, contextId },
    { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState },
  );

  const source = new T505GlobalUnderstandingSource({
    storageUris,
    exclusionPolicy: new ReviewFileExclusionPolicyService({ userGlobs: [] }),
    readOpenDocuments: () => [],
    readPullRequestHeadFiles: async (_owner, candidatePaths) => {
      assert.equal(candidatePaths.has("src/immutable.ts"), false);
      return [{ path: "src/immutable.ts", revisionId: HEAD, content: immutableText }];
    },
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined,
  });
  source.setContext({
    context: {
      kind: "pull-request",
      label: "#60",
      detail: "review",
      baseRevision: BASE,
      headRevision: HEAD,
      selection: {
        kind: "pull-request",
        repositoryId,
        repositoryRoot,
        contextId,
        pullRequestNumber: 60,
        headRevision: HEAD,
      },
    },
    progress: undefined,
  });

  const result = await source.recalculate();
  assert.equal(result?.progress.reviewedNonEmptyLineCount, 1);
  assert.equal(result?.progress.totalNonEmptyLineCount, 2);
  assert.deepEqual(result?.progress.files.map((file) => file.path), ["src/immutable.ts"]);
  assert.equal(result?.openedFileCount, 1);
  assert.equal(result?.unopenedFileCount, 1);
});

test("R60-003 superseded owner revisions evict retained Global evidence instead of reviving it later", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-r60-003-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(repositoryRoot, { recursive: true });
  await writeFile(path.join(repositoryRoot, "tracked.ts"), "tracked\n", "utf8");

  const repositoryId = "repository-r60-003";
  let openRevision: string | undefined = HEAD;
  const source = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global-storage") },
      storageUri: { fsPath: path.join(root, "workspace-storage") },
    },
    exclusionPolicy: new ReviewFileExclusionPolicyService({ userGlobs: [] }),
    readOpenDocuments: (owner) => openRevision === owner.currentRevisionId ? [{
      path: "tracked.ts",
      revisionId: owner.currentRevisionId,
      lineCount: 2,
      nonEmptyLines: [0],
      contentHash: sha256("tracked\n"),
      cacheKey: `open:${owner.currentRevisionId}`,
    }] : [],
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined,
  });
  const select = (revisionId: string): void => source.setContext({
    context: {
      kind: "branch",
      label: "main",
      detail: repositoryRoot,
      headRevision: revisionId,
      selection: {
        kind: "branch",
        repositoryId,
        repositoryRoot,
        branchRef: "refs/heads/main",
      },
    },
    progress: undefined,
  });

  select(HEAD);
  assert.equal((await source.recalculate())?.progress.totalNonEmptyLineCount, 1);
  openRevision = undefined;
  select(NEXT);
  assert.equal((await source.recalculate())?.progress.totalNonEmptyLineCount, 0);
  select(HEAD);
  const returnedToSupersededRevision = await source.recalculate();
  assert.equal(returnedToSupersededRevision?.progress.totalNonEmptyLineCount, 0);
  assert.equal(returnedToSupersededRevision?.openedFileCount, 0);
});

test("R60-002 authoritative design specifies opened-only ordinary Global semantics and the immutable PR full-scan exception", async () => {
  const design = await readFile("doc/design/vscode-review-range-tracker-design.md", "utf8");
  for (const fragment of [
    "通常コンテキストでは、一度でも開いたことがあるfile",
    "immutableなPR snapshot",
    "作業ツリーの存在有無をPR HEAD fileの採否条件にしない",
    "deleted fileはBASE側全文",
    "Global分母にはHEAD側",
  ]) {
    assert.match(design, new RegExp(fragment, "u"), `missing design requirement: ${fragment}`);
  }
});

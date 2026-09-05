import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { NormalEditorReviewedDecoration } from "../../src/application/editor-decoration/index.js";
import type { ReviewStateCommit } from "../../src/adapters/state-repository/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeOptions,
  type PullRequestReviewRuntimeRepository
} from "../../src/t405-pull-request-review-runtime.js";
import type {
  PullRequestProgressTreeCategoryNode,
  PullRequestProgressTreeFileNode
} from "../../src/ui/pr-progress/index.js";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `${REPOSITORY_ID}#112`;
const FILE_ID = "file-112";
const ORIGINAL_PATH = "src/old-name.ts";
const MODIFIED_PATH = "src/new-name.ts";
const DIFF_ID = `${BASE_SHA}..${HEAD_SHA}`;
const UPDATED_AT = "2026-09-04T00:00:00.000Z";

const contentHash = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

const snapshot: PullRequestDiffSnapshot = {
  contextId: CONTEXT_ID,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: DIFF_ID,
  files: [{
    fileId: FILE_ID,
    oldPath: ORIGINAL_PATH,
    newPath: MODIFIED_PATH,
    status: "renamed",
    additions: 1,
    deletions: 1,
    hunks: [{
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "a" },
        { kind: "deletion", oldLine: 2, text: "b" },
        { kind: "addition", newLine: 2, text: "d" },
        { kind: "context", oldLine: 3, newLine: 3, text: "c" }
      ]
    }]
  }]
};

const contextState = (currentPath = MODIFIED_PATH): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #112",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "RevMem",
    number: 112,
    state: "open",
    title: "Issue 112",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath,
      previousPaths: [ORIGINAL_PATH],
      revisionId: HEAD_SHA,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {
        [DIFF_ID]: [{ startLine: 1, endLineExclusive: 2 }]
      },
      contentHash: contentHash("a\nd\nc"),
      lineCount: 3,
      updatedAt: UPDATED_AT
    }
  },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: HEAD_SHA,
  files: {},
  updatedAt: UPDATED_AT
});

class MemoryRepository implements PullRequestReviewRuntimeRepository {
  public current: ReviewStateCommit;

  public constructor(initialContextState = contextState()) {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: initialContextState,
      globalState: globalState()
    };
  }

  public async load(): Promise<typeof this.current> {
    return structuredClone(this.current);
  }

  public async commit(
    transaction: Parameters<PullRequestReviewRuntimeRepository["commit"]>[0]
  ): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: structuredClone(transaction.next.contextState) as ReviewContextState,
      globalState: structuredClone(transaction.next.globalState) as RepositoryGlobalState
    };
  }
}

interface Issue112Runtime {
  loadReviewedDecorations(uri: string): Promise<readonly NormalEditorReviewedDecoration[]>;
}

interface WorkingTreeOpenTarget {
  readonly repositoryRoot: string;
  readonly repositoryPath: string;
  readonly fileSystemPathSemantics: "posix" | "windows";
}

const createRuntime = (
  openedWorkingTreeFiles: WorkingTreeOpenTarget[] = []
): PullRequestReviewRuntime<string> => {
  const options = {
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value: string) => value,
      openDiff: async () => undefined
    },
    openWorkingTreeFile: async (target: WorkingTreeOpenTarget) => {
      openedWorkingTreeFiles.push({ ...target });
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  } as unknown as PullRequestReviewRuntimeOptions<string>;
  const runtime = new PullRequestReviewRuntime(options);
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/workspace/RevMem",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.side === "original" ? "a\nb\nc" : "a\nd\nc"
    })
  });
  return runtime;
};

const currentFileNode = (
  runtime: PullRequestReviewRuntime<string>
): PullRequestProgressTreeFileNode => {
  const category = runtime.progress.getChildren().find(
    (node): node is PullRequestProgressTreeCategoryNode =>
      node.kind === "category" && node.category === "unreviewed"
  );
  assert.ok(category);
  const node = runtime.progress.getChildren(category).find(
    (candidate): candidate is PullRequestProgressTreeFileNode => candidate.kind === "file"
  );
  assert.ok(node);
  return node;
};

test("PR diff decorations project current modified ranges and mapped original ranges", async () => {
  const opened: Array<{ readonly original: string; readonly modified: string }> = [];
  const recordingRuntime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(),
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => {
        opened.push({ original, modified });
      }
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  recordingRuntime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/workspace/RevMem",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.side === "original" ? "a\nb\nc" : "a\nd\nc"
    })
  });
  await recordingRuntime.openReviewDiff(CONTEXT_ID, FILE_ID);
  assert.equal(opened.length, 1);

  const issueRuntime = recordingRuntime as unknown as Issue112Runtime;
  const modified = await issueRuntime.loadReviewedDecorations(opened[0]!.modified);
  const original = await issueRuntime.loadReviewedDecorations(opened[0]!.original);

  assert.deepEqual(
    modified.map((decoration) => decoration.interval),
    [{ startLine: 0, endLineExclusive: 1 }]
  );
  assert.deepEqual(
    original.map((decoration) => decoration.interval),
    [{ startLine: 0, endLineExclusive: 2 }]
  );
  assert.ok([...modified, ...original].every((decoration) =>
    decoration.contextLabel === "PR #112: Issue 112" &&
    decoration.reviewedAt === UPDATED_AT &&
    decoration.source === "context"
  ));
});

test("PR Progress working-tree opens use the registered repository root and current renamed path", async () => {
  const openedWorkingTreeFiles: WorkingTreeOpenTarget[] = [];
  const runtime = createRuntime(openedWorkingTreeFiles);
  await runtime.activateProgress(CONTEXT_ID);

  await runtime.progress.openWorkingTreeFile(currentFileNode(runtime));

  assert.deepEqual(openedWorkingTreeFiles, [{
    repositoryRoot: "/workspace/RevMem",
    repositoryPath: MODIFIED_PATH,
    fileSystemPathSemantics: "posix"
  }]);
});

test("a PR A node is rejected for a working-tree open after PR B becomes active", async () => {
  const pullRequestBContextId = `${REPOSITORY_ID}#113`;
  const pullRequestBFileId = "file-113";
  const pullRequestBOldPath = "src/pr-b-old.ts";
  const pullRequestBPath = "src/pr-b.ts";
  const pullRequestBSnapshot: PullRequestDiffSnapshot = {
    ...snapshot,
    contextId: pullRequestBContextId,
    files: snapshot.files.map((file) => ({
      ...file,
      fileId: pullRequestBFileId,
      oldPath: pullRequestBOldPath,
      newPath: pullRequestBPath
    }))
  };
  const pullRequestACommit: ReviewStateCommit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(),
    globalState: globalState()
  };
  const pullRequestBState = contextState(pullRequestBPath);
  const pullRequestBCommit: ReviewStateCommit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...pullRequestBState,
      contextId: pullRequestBContextId,
      displayName: "PR #113",
      pullRequest: { ...pullRequestBState.pullRequest!, number: 113 },
      files: {
        [pullRequestBFileId]: {
          ...pullRequestBState.files[FILE_ID]!,
          fileId: pullRequestBFileId,
          currentPath: pullRequestBPath,
          previousPaths: [pullRequestBOldPath]
        }
      }
    },
    globalState: globalState()
  };
  const commits = new Map<string, ReviewStateCommit>([
    [CONTEXT_ID, pullRequestACommit],
    [pullRequestBContextId, pullRequestBCommit]
  ]);
  const opened: WorkingTreeOpenTarget[] = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: {
      load: async (target) => {
        const commit = commits.get(target.contextId);
        return commit === undefined ? undefined : structuredClone(commit);
      },
      commit: async (transaction) => {
        commits.set(transaction.contextId, {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          contextState: structuredClone(transaction.next.contextState) as ReviewContextState,
          globalState: structuredClone(transaction.next.globalState) as RepositoryGlobalState
        });
      }
    },
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    openWorkingTreeFile: async (target: WorkingTreeOpenTarget) => { opened.push(target); },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  } as PullRequestReviewRuntimeOptions<string> & {
    readonly openWorkingTreeFile: (target: WorkingTreeOpenTarget) => Promise<void>;
  });
  const registration = (snapshotInput: PullRequestDiffSnapshot) => ({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/workspace/RevMem",
    fileSystemPathSemantics: "posix" as const,
    snapshot: snapshotInput,
    readTextContent: async (descriptor: { readonly side: "original" | "modified" }) => ({
      kind: "found" as const,
      content: descriptor.side === "original" ? "a\nb\nc" : "a\nd\nc"
    })
  });
  runtime.register(registration(snapshot));
  runtime.register(registration(pullRequestBSnapshot));

  await runtime.activateProgress(CONTEXT_ID);
  const pullRequestANode = currentFileNode(runtime);
  await runtime.activateProgress(pullRequestBContextId);

  await assert.rejects(
    runtime.progress.openWorkingTreeFile(pullRequestANode),
    /stale|current snapshot/i
  );
  assert.equal(opened.length, 0);
});

const assertReviewCommandSessionRoute = async (filePath: string): Promise<void> => {
  const opened: Array<{ readonly original: string; readonly modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository: new MemoryRepository(contextState(filePath)),
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => { opened.push({ original, modified }); }
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const runtimeSnapshot = {
    ...snapshot,
    files: snapshot.files.map((file) => ({
      ...file,
      oldPath: filePath,
      newPath: filePath
    }))
  };
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/workspace/RevMem",
    fileSystemPathSemantics: "posix",
    snapshot: runtimeSnapshot,
    readTextContent: async () => ({ kind: "found", content: "a\nd\nc" })
  });

  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID);
  const modifiedUri = opened[0]?.modified;
  assert.ok(modifiedUri);
  assert.equal((await runtime.openSession(modifiedUri)).target.currentPath, filePath);

  const service = runtime.createCommandService<{ readonly uri: string }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: () => "modified",
    getLineCount: () => 3,
    getSelections: () => [],
    confirmWholeFileOperation: async () => true
  });
  assert.equal(await service.markFileReviewed({ uri: modifiedUri }), "applied");
};

test("review command and session route a path with spaces and Japanese segments", async () => {
  await assertReviewCommandSessionRoute("src/日本語/space name.ts");
});

test("review command and session route a path containing a literal percent", async () => {
  await assertReviewCommandSessionRoute("src/literal%name.ts");
});

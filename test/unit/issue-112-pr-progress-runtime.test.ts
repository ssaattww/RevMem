import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Module, { createRequire } from "node:module";
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
import type { PullRequestProgressTreeSource } from
  "../../src/ui/pr-progress/vscode-pull-request-progress-tree.js";

const runtimeRequire = createRequire(__filename);
const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode"
    ? vscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve(moduleName);
  delete runtimeRequire.cache[modulePath];
  const loaded = runtimeRequire(modulePath) as T;
  loader._load = originalLoad;
  return loaded;
};

const vscodeTreeStub = (
  visibleTextEditors: unknown[] = [],
  workspaceFolders: unknown[] = [],
  executeCommand: (...values: unknown[]) => Promise<unknown> = async () => undefined
) => {
  class EventEmitter<T> {
    public readonly event = (): { dispose(): void } => ({ dispose(): void {} });
    public fire(value: T): void { void value; }
    public dispose(): void {}
  }
  return {
    EventEmitter,
    ThemeColor: class { public constructor(value: string) { void value; } },
    Range: class { public constructor(...values: unknown[]) { void values; } },
    TreeItem: class { public constructor(...values: unknown[]) { void values; } },
    TreeItemCollapsibleState: { None: 0, Expanded: 1 },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    window: {
      visibleTextEditors,
      createTextEditorDecorationType: () => ({ dispose(): void {} })
    },
    workspace: { workspaceFolders },
    Uri: {
      from: (value: unknown) => value,
      joinPath: (base: { readonly path: string }, ...segments: string[]) => ({
        ...base,
        path: [base.path, ...segments].join("/")
      })
    },
    commands: { executeCommand }
  };
};

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

test("a PR A node is rejected through the runtime and VS Code working-tree routes after PR B becomes active", async () => {
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

  const openedByVscodeHost: unknown[][] = [];
  const workspaceUri = {
    scheme: "file",
    authority: "",
    path: "/workspace",
    query: "",
    fragment: "",
    fsPath: "/workspace"
  };
  const { VscodePullRequestProgressTreeDataProvider } = loadWithVscode<
    typeof import("../../src/ui/pr-progress/vscode-pull-request-progress-tree.js")
  >(
    "../../src/ui/pr-progress/vscode-pull-request-progress-tree.js",
    vscodeTreeStub([], [{ uri: workspaceUri }], async (...values) => {
      openedByVscodeHost.push(values);
    })
  );
  const tree = new VscodePullRequestProgressTreeDataProvider(runtime.progress);

  await assert.rejects(
    tree.openWorkingTreeFile(pullRequestANode),
    /stale|current snapshot/i
  );
  assert.equal(openedByVscodeHost.length, 0);
});

test("Vscode PR Progress rejects stale source-A decorations and reports projection rejection", async () => {
  let releaseSourceA: ((value: readonly NormalEditorReviewedDecoration[]) => void) | undefined;
  const sourceAStarted = new Promise<void>((resolve) => {
    const resolveSourceA = resolve;
    releaseSourceA = (value) => {
      resolveSourceA();
      sourceAResult(value);
    };
  });
  let sourceAResult: (value: readonly NormalEditorReviewedDecoration[]) => void = () => undefined;
  const sourceADecorations = new Promise<readonly NormalEditorReviewedDecoration[]>((resolve) => {
    sourceAResult = resolve;
  });
  const appliedDecorationCounts: number[] = [];
  const editor = {
    document: { uri: { toString: () => "review-range-diff://source-a" } },
    setDecorations: (_type: unknown, values: readonly unknown[]) => {
      appliedDecorationCounts.push(values.length);
    }
  };
  const sourceA = {
    getChildren: () => [],
    select: async () => { throw new Error("selection is outside this fixture"); },
    ownsReviewDiffDocumentUri: () => true,
    loadReviewedDecorations: async () => {
      await sourceAStarted;
      return sourceADecorations;
    }
  } as unknown as PullRequestProgressTreeSource;
  const sourceB = {
    getChildren: () => [],
    select: async () => { throw new Error("selection is outside this fixture"); },
    ownsReviewDiffDocumentUri: () => true,
    loadReviewedDecorations: async () => []
  } as unknown as PullRequestProgressTreeSource;
  let emitProjectionChange: (() => void | Promise<void>) | undefined;
  let rejectProjection = false;
  const sourceWithRejectedProjection = {
    ...sourceB,
    onDidChangeReviewProjection: (listener: () => void | Promise<void>) => {
      emitProjectionChange = listener;
      return { dispose: () => undefined };
    },
    loadReviewedDecorations: async () => {
      if (rejectProjection) throw new Error("decoration refresh failed");
      return [];
    }
  } as PullRequestProgressTreeSource;
  const reported: unknown[] = [];
  const { VscodePullRequestProgressTreeDataProvider } = loadWithVscode<
    typeof import("../../src/ui/pr-progress/vscode-pull-request-progress-tree.js")
  >(
    "../../src/ui/pr-progress/vscode-pull-request-progress-tree.js",
    vscodeTreeStub([editor])
  );
  const tree = new VscodePullRequestProgressTreeDataProvider(sourceA, (error) => {
    reported.push(error);
  });

  const pendingSourceARefresh = tree.refreshReviewDiffDecorations();
  tree.setPullRequestProgressSource(sourceB);
  releaseSourceA?.([{
    interval: { startLine: 0, endLineExclusive: 1 },
    source: "context",
    contextLabel: "PR A",
    reviewedAt: UPDATED_AT,
    globalActive: false
  }]);
  await pendingSourceARefresh;
  assert.ok(!appliedDecorationCounts.includes(1));

  tree.setPullRequestProgressSource(sourceWithRejectedProjection);
  await new Promise<void>((resolve) => setImmediate(resolve));
  rejectProjection = true;
  emitProjectionChange?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reported.length, 1);
  assert.ok(reported[0] instanceof Error);
  assert.match(reported[0].message, /decoration refresh failed/);
});

test("runtime command keeps its durable result, projects after progress failure, and reports it", async () => {
  const repository = new MemoryRepository();
  const reported: unknown[] = [];
  const lifecycle: string[] = [];
  const openedDiffs: Array<{ readonly original: string; readonly modified: string }> = [];
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (original, modified) => { openedDiffs.push({ original, modified }); }
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    reportDerivedProjectionError: (error: unknown) => {
      lifecycle.push("reported");
      reported.push(error);
    }
  } as PullRequestReviewRuntimeOptions<string> & {
    readonly reportDerivedProjectionError: (error: unknown) => void;
  });
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
  let projectionAttempts = 0;
  runtime.onDidChangeReviewProjection(() => {
    lifecycle.push("owned-projection");
    projectionAttempts += 1;
  });
  runtime.refreshActiveProgress = async () => {
    lifecycle.push("progress-refresh");
    throw new Error("progress refresh failed");
  };
  await runtime.openReviewDiff(CONTEXT_ID, FILE_ID);
  const commandService = runtime.createCommandService<{ readonly uri: string }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: () => "modified",
    getLineCount: () => 3,
    getSelections: () => [],
    confirmWholeFileOperation: async () => true
  });

  assert.equal(await commandService.markFileReviewed({ uri: openedDiffs[0]!.modified }), "applied");
  assert.deepEqual(
    repository.current.contextState.files[FILE_ID]!.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
  assert.equal(projectionAttempts, 1);
  assert.equal(reported.length, 1);
  assert.ok(reported[0] instanceof Error);
  assert.match(reported[0].message, /progress refresh failed/);
  assert.deepEqual(lifecycle, ["progress-refresh", "reported", "owned-projection"]);
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
  const originalUri = opened[0]?.original;
  const modifiedUri = opened[0]?.modified;
  assert.ok(originalUri);
  assert.ok(modifiedUri);
  const vscodeUriAdapter = (uri: string) => ({
    toString: (skipEncoding?: boolean) => skipEncoding === true ? decodeURIComponent(uri) : uri
  });
  const originalDocumentUri = vscodeUriAdapter(originalUri);
  const modifiedDocumentUri = vscodeUriAdapter(modifiedUri);
  const canonicalOriginalUri = originalDocumentUri.toString();
  const canonicalModifiedUri = modifiedDocumentUri.toString();
  assert.notEqual(canonicalModifiedUri, modifiedDocumentUri.toString(true));
  runtime.validateDiffDocumentPair(canonicalOriginalUri, canonicalModifiedUri);
  assert.equal((await runtime.openSession(canonicalModifiedUri)).target.currentPath, filePath);
  assert.equal(runtime.sideForDiffDocumentUri(canonicalModifiedUri), "modified");

  const service = runtime.createCommandService<{ readonly uri: string }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: () => "modified",
    getLineCount: () => 3,
    getSelections: () => [],
    confirmWholeFileOperation: async () => true
  });
  assert.equal(await service.markFileReviewed({ uri: canonicalModifiedUri }), "applied");
};

test("review command and session route a path with spaces and Japanese segments", async () => {
  await assertReviewCommandSessionRoute("src/日本語/space name.ts");
});

test("review command and session route a path containing a literal percent", async () => {
  await assertReviewCommandSessionRoute("src/literal%name.ts");
});

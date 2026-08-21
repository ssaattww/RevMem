import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createNormalEditorDecorationModelIncrementally } from "../../src/application/editor-decoration/index";
import { NodeSha256StableHash } from "../../src/adapters/crypto/node-sha256-stable-hash";
import type { RepositoryGlobalUnderstandingProgress } from "../../src/core/global-understanding/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type DiffLine, type GlobalFileReviewState, type PullRequestFileChange, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index";
import { calculatePullRequestDiffProgress, calculatePullRequestDiffProgressCooperatively, type PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";
import { calculateGlobalUnderstandingFileProgressCooperatively } from "../../src/application/global-understanding/cooperative-global-understanding-calculation";
import { OperationFeedback, setActiveOperationFeedback } from "../../src/application/operation-feedback/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";
import {
  createGlobalUnderstandingTreeModelIncrementally,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";
import { NormalEditorDecorationController, type DecorationDisposable, type NormalEditorDecorationHost, type NormalEditorDecorationSettings } from "../../src/ui/normal-editor/index";
import type { ReviewStateFileTarget } from "../../src/core/review-state/index";

const runtimeRequire = createRequire(__filename);
const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
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

const changedLine = (newLine: number): DiffLine => ({ kind: "addition", newLine, text: `line ${newLine}` });
const t301Context = (baseSha: string, headSha: string): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "github-pr:example#79",
  kind: "pull-request",
  repositoryId: "github.com/ssaattww/RevMem",
  displayName: "PR #79",
  pullRequest: { host: "github.com", owner: "ssaattww", repository: "RevMem", number: 79, state: "open", baseSha, headSha },
  files: {},
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
});

const tenThousandLineT301Snapshot = (): PullRequestDiffSnapshot => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const files: PullRequestFileChange[] = Array.from({ length: 100 }, (_, fileIndex) => {
    const lines = Array.from({ length: 100 }, (_, lineIndex) => changedLine(lineIndex + 1));
    return {
      fileId: `t607-${fileIndex}`,
      status: "added",
      newPath: `src/t607-${String(fileIndex).padStart(3, "0")}.ts`,
      additions: lines.length,
      deletions: 0,
      hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, lines }]
    };
  });
  return { contextId: "github-pr:example#79", baseSha, headSha, originalDiffId: `${baseSha}..${headSha}`, files };
};

const snapshot = (fileCount: number): GlobalUnderstandingTreeSnapshot => {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/${String(fileCount - index).padStart(5, "0")}.ts`,
    state: "current" as const,
    reviewedNonEmptyLineCount: index,
    totalNonEmptyLineCount: fileCount,
    progress: index / fileCount
  }));
  const progress: RepositoryGlobalUnderstandingProgress = {
    reviewedNonEmptyLineCount: files.reduce((total, file) => total + file.reviewedNonEmptyLineCount, 0),
    totalNonEmptyLineCount: files.reduce((total, file) => total + file.totalNonEmptyLineCount, 0),
    progress: (fileCount - 1) / 2 / fileCount,
    files
  };
  return { progress, openedFileCount: fileCount, unopenedFileCount: 0, excludedFileCount: 0, prunedExcludedDirectoryCount: 0 };
};

test("T607 publishes a large Global Tree in deterministic bounded stages", async () => {
  const published: Array<{ readonly count: number; readonly complete: boolean }> = [];
  let yields = 0;
  const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot(257), {
    maxFilesPerStage: 64,
    yieldControl: () => { yields += 1; },
    onStage: (next, complete) => { published.push({ count: next.files.length, complete }); }
  });

  assert.ok(model);
  assert.deepEqual(published, [
    { count: 64, complete: false }, { count: 128, complete: false },
    { count: 192, complete: false }, { count: 256, complete: false },
    { count: 257, complete: true }
  ]);
  assert.ok(yields >= 8, "validation, cooperative sorting, and staged publication all yield within the item budget");
  assert.equal(model.files[0]?.path, "src/00001.ts");
  assert.equal(model.files.at(-1)?.path, "src/00257.ts");
});

test("T607 accounts for 10,000-file projection work without a model prefix double-copy", async () => {
  const accounts: Array<{
    readonly kind: string;
    readonly count: number;
    readonly stageFileCount: number;
    readonly modelRetainsInputArray?: boolean;
  }> = [];
  const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot(10_000), {
    maxFilesPerStage: 128,
    yieldControl: () => undefined,
    accountWork: (entry) => { accounts.push(entry); }
  });

  assert.ok(model);
  assert.equal(model.files.length, 10_000);
  assert.equal(accounts.filter((entry) => entry.kind === "validated-open-target").length, 0);
  assert.equal(accounts.filter((entry) => entry.kind === "built-file-node").length, 10_000);
  const publications = accounts.filter((entry) => entry.kind === "published-stage");
  assert.equal(publications.at(-1)?.stageFileCount, 10_000);
  assert.ok(publications.every((entry) => entry.modelRetainsInputArray === true), "each published model retains its single prepared prefix array instead of copying it again");
  assert.ok(accounts.every((entry) => entry.count <= 128), "each accounted operation remains within the deterministic work budget");
});

test("T607 never publishes a stale Tree stage after its generation is invalidated", async () => {
  let current = true;
  const published: number[] = [];
  const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot(130), {
    maxFilesPerStage: 64,
    yieldControl: () => undefined,
    isCurrent: () => current,
    onStage: (next) => { published.push(next.files.length); current = false; }
  });

  assert.equal(model, undefined);
  assert.deepEqual(published, [64]);
});

test("T607 production VS Code Global runtime fences partial publication on invalidate and dispose", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  let provider: { getChildren(node?: { readonly kind: string }): readonly { readonly kind: string }[] } | undefined;
  let registered: { refresh(): Promise<void>; invalidate(): void; dispose(): void } | undefined;
  let staleNode: unknown;
  let interrupted = false;
  let statusShows = 0;
  const signals: AbortSignal[] = [];
  const opened: unknown[] = [];
  const reported: unknown[] = [];
  const vscode = {
    EventEmitter: class {
      public readonly event = () => undefined;
      public fire(): void {
        if (interrupted || registered === undefined || provider === undefined) return;
        const group = provider.getChildren().find((node) => node.kind === "files-group");
        staleNode = group === undefined ? undefined : provider.getChildren(group).find((node) => node.kind === "file");
        interrupted = true;
        registered.invalidate();
        registered.dispose();
      }
      public dispose(): void {}
    },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0, Expanded: 1 },
    StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void { statusShows += 1; }, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: (_id: string, next: typeof provider) => { provider = next; return { dispose(): void {} }; }
    },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
    workspace: { onDidChangeConfiguration: () => ({ dispose(): void {} }) }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>(
    "../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode
  );
  const feedback = new OperationFeedback({ showBusy(): void {}, clearBusy(): void {}, appendLog(): void {}, revealLog(): void {} });
  setActiveOperationFeedback(feedback);
  try {
    const sourceSnapshot = snapshot(129);
    const targets = sourceSnapshot.progress.files.map((file) => ({ kind: "working-tree" as const, repositoryId: "repo", contextId: "context", revisionId: "revision", repositoryPath: file.path, filePath: `/repo/${file.path}` }));
    registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
      source: { recalculate: async (signal) => { signals.push(signal!); return { ...sourceSnapshot, fileOpenTargets: targets }; } },
      readGlobalLayerEnabled: () => false,
      writeGlobalLayerEnabled: async () => undefined,
      refreshDecorations: async () => undefined,
      openFile: async (target) => { opened.push(target); },
      reportError: async (error) => { reported.push(error); }
    });
    await registered.refresh();
    assert.equal(interrupted, true, "the VS Code Tree runtime observed one actual partial publication before invalidation");
    assert.equal(signals[0]?.aborted, true, "invalidation and disposal abort the registered refresh owner");
    assert.equal(statusShows, 0, "a generation invalidated during Tree publication cannot emit a stale terminal presentation");
    await commands.get(runtime.OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID)!(staleNode);
    assert.equal(opened.length, 0, "a node captured from the partial Tree cannot reach the file-open host after invalidation");
    assert.equal(reported.length, 1, "the registered command owns stale-node rejection at its normal error boundary");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T607 production Global runtime supersedes old/new refreshes and gives each feedback operation one terminal", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  let provider: { getChildren(node?: { readonly kind: string }): readonly { readonly kind: string }[] } | undefined;
  const signals: AbortSignal[] = [];
  const deferred = <T>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((complete) => { resolve = complete; }), resolve }; };
  const old = deferred<GlobalUnderstandingTreeSnapshot>();
  const invalidated = deferred<GlobalUnderstandingTreeSnapshot>();
  const disposed = deferred<GlobalUnderstandingTreeSnapshot>();
  let call = 0;
  const logs: Array<{ readonly event: string }> = [];
  const opened: unknown[] = [];
  const reported: unknown[] = [];
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0, Expanded: 1 }, StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: (_id: string, next: typeof provider) => { provider = next; return { dispose(): void {} }; }
    },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
    workspace: { onDidChangeConfiguration: () => ({ dispose(): void {} }) }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  const feedback = new OperationFeedback({ showBusy(): void {}, clearBusy(): void {}, appendLog(entry): void { logs.push({ event: entry.event }); }, revealLog(): void {} });
  const current = snapshot(129);
  const withTargets = (value: GlobalUnderstandingTreeSnapshot): GlobalUnderstandingTreeSnapshot => ({ ...value, fileOpenTargets: value.progress.files.map((file) => ({ kind: "working-tree" as const, repositoryId: "repo", contextId: "context", revisionId: "revision", repositoryPath: file.path, filePath: `/repo/${file.path}` })) });
  setActiveOperationFeedback(feedback);
  try {
    const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
      source: { recalculate: async (signal) => { signals.push(signal!); return call++ === 0 ? old.promise : call === 2 ? withTargets(current) : call === 3 ? invalidated.promise : disposed.promise; } },
      readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined,
      openFile: async (target) => { opened.push(target); }, reportError: async (error) => { reported.push(error); }
    });
    const oldRefresh = registered.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    const newRefresh = registered.refresh();
    await newRefresh;
    assert.equal(signals[0]?.aborted, true, "the new production refresh aborts the old owner before old publication");
    old.resolve(withTargets(current));
    await oldRefresh;
    const group = provider!.getChildren().find((node) => node.kind === "files-group");
    const staleNode = provider!.getChildren(group).find((node) => node.kind === "file");
    const invalidateRefresh = registered.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    registered.invalidate();
    assert.equal(signals[2]?.aborted, true, "invalidate-only aborts its distinct in-flight refresh");
    invalidated.resolve(withTargets(current));
    await invalidateRefresh;
    await commands.get(runtime.OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID)!(staleNode);
    assert.equal(opened.length, 0, "an old node cannot open after invalidate-only clears the production model");
    assert.equal(reported.length, 1);
    const disposeRefresh = registered.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    registered.dispose();
    assert.equal(signals[3]?.aborted, true, "dispose aborts a distinct in-flight refresh");
    disposed.resolve(withTargets(current));
    await disposeRefresh;
    const starts = logs.filter((entry) => entry.event === "started").length;
    const terminals = logs.filter((entry) => entry.event === "succeeded" || entry.event === "failed").length;
    assert.equal(starts, 5, "four refreshes plus the stale-node command each enter the shared production feedback boundary");
    assert.equal(terminals, starts, "every relevant production operation has exactly one feedback terminal");
  } finally { setActiveOperationFeedback(undefined); }
});

test("T607 aggregates actual 10,000 changed T301 lines and publishes only the complete current Tree", async () => {
  const diff = tenThousandLineT301Snapshot();
  const progress = calculatePullRequestDiffProgress({
    diff,
    reviewContext: t301Context(diff.baseSha, diff.headSha),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const tree = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined,
    openFile: async () => undefined
  });
  const projection: PullRequestProgressTreeSnapshot = {
    snapshotId: "t607-10k",
    contextId: diff.contextId,
    baseSha: diff.baseSha,
    headSha: diff.headSha,
    originalDiffId: diff.originalDiffId,
    fileSystemPathSemantics: "posix",
    progress,
    lineReviewabilityByFileId: Object.fromEntries(progress.files.map((file) => [file.fileId, { kind: "reviewable" as const }]))
  };
  const stages: Array<readonly [number, number]> = [];
  let yields = 0;
  const published = await tree.replaceSnapshotIncrementally(projection, {
    maxFilesPerStage: 16,
    yieldControl: () => { yields += 1; },
    onStage: (prepared, total) => { stages.push([prepared, total]); }
  });

  assert.equal(published, true);
  const effective = tree.getEffectiveProgress();
  assert.equal(effective.reviewedLineCount, 0);
  assert.equal(effective.totalLineCount, 10_000);
  assert.equal(effective.progress, 0);
  assert.equal(effective.files.length, 100);
  assert.equal(tree.getChildren()[0]?.kind, "category");
  assert.equal((tree.getChildren()[0] as { readonly fileCount: number }).fileCount, 100);
  assert.deepEqual(stages, [[16, 100], [32, 100], [48, 100], [64, 100], [80, 100], [96, 100], [100, 100]]);
  assert.ok(yields >= stages.length, "T301 validation and final category projection use deterministic work checkpoints");
});

test("T607 cooperatively calculates all 10,000 production PR hunk lines and fences supersession", async () => {
  const diff = tenThousandLineT301Snapshot();
  const input = { diff, reviewContext: t301Context(diff.baseSha, diff.headSha), exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] }) };
  let yields = 0;
  const complete = await calculatePullRequestDiffProgressCooperatively(input, {
    maxWorkItems: 128,
    yieldControl: () => { yields += 1; },
    isCurrent: () => true
  });
  assert.equal(complete?.totalLineCount, 10_000);
  assert.ok(yields >= 78, "actual hunk-line validation yields no later than 128 items");
  let current = true;
  const stale = await calculatePullRequestDiffProgressCooperatively(input, {
    maxWorkItems: 128,
    yieldControl: () => { current = false; },
    isCurrent: () => current
  });
  assert.equal(stale, undefined, "a superseded PR calculation has no result to publish");
});

test("T607 stale or cancelled PR Tree preparation preserves the last complete projection", async () => {
  const diff = tenThousandLineT301Snapshot();
  const progress = calculatePullRequestDiffProgress({
    diff,
    reviewContext: t301Context(diff.baseSha, diff.headSha),
    exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] })
  });
  const tree = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const baseline = { ...progress, files: progress.files.slice(0, 1), totalLineCount: 100, reviewedLineCount: 0, progress: 0 };
  const baselineSnapshot: PullRequestProgressTreeSnapshot = {
    snapshotId: "baseline", contextId: diff.contextId, baseSha: diff.baseSha, headSha: diff.headSha,
    originalDiffId: diff.originalDiffId, fileSystemPathSemantics: "posix", progress: baseline,
    lineReviewabilityByFileId: { [baseline.files[0]!.fileId]: { kind: "reviewable" } }
  };
  tree.replaceSnapshot(baselineSnapshot);
  let current = true;
  const completed = await tree.replaceSnapshotIncrementally({
    ...baselineSnapshot, snapshotId: "stale", progress,
    lineReviewabilityByFileId: Object.fromEntries(progress.files.map((file) => [file.fileId, { kind: "reviewable" as const }]))
  }, {
    maxFilesPerStage: 16,
    yieldControl: () => { current = false; },
    isCurrent: () => current
  });
  assert.equal(completed, false);
  assert.equal(tree.getEffectiveProgress().files.length, 1, "cancelled work neither clears nor partially publishes the prior Tree");
});

test("T607 yields deterministically while normalizing many reviewed intervals", async () => {
  let yields = 0;
  const reviewed = Array.from({ length: 2_048 }, (_, index) => ({
    startLine: index * 2,
    endLineExclusive: index * 2 + 1
  }));
  const globalFile: GlobalFileReviewState = {
    fileId: "t607-many-intervals",
    currentPath: "src/intervals.ts",
    revisionId: "t607-revision",
    contentHash: "t607-hash",
    reviewed,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const result = await calculateGlobalUnderstandingFileProgressCooperatively({
    path: "src/intervals.ts",
    revisionId: "t607-revision",
    contentHash: "t607-hash",
    lineCount: 4_096,
    nonEmptyLines: Array.from({ length: 4_096 }, (_, index) => index)
  }, globalFile, {
    maxWorkItems: 128,
    yieldControl: () => { yields += 1; }
  });

  assert.equal(result.reviewedNonEmptyLineCount, 2_048);
  assert.equal(result.totalNonEmptyLineCount, 4_096);
  assert.ok(yields >= 32, "the work budget, rather than elapsed time, governs scheduler checkpoints");
});

test("T607 extension decoration composition carries descriptor hash through state, interval/options, split apply, and supersession", async () => {
  interface Editor { readonly id: string; readonly uri: string; readonly contentHash: string; }
  class DecorationType implements DecorationDisposable { public dispose(): void {} }
  const intervals = Array.from({ length: 2_048 }, (_, index) => ({ startLine: index * 2, endLineExclusive: index * 2 + 1 }));
  const target: ReviewStateFileTarget = { fileId: "large-file", currentPath: "src/large.ts", revisionId: "r607", lineCount: 4_096, contentHash: "sha256:t607-large" };
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: "workspace:t607", kind: "workspace", repositoryId: "repo:t607", displayName: "T607 workspace",
    workspace: { workspaceId: "workspace:t607", snapshotRevision: "r607" },
    files: { [target.fileId]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: target.fileId, currentPath: target.currentPath, previousPaths: [], revisionId: target.revisionId, modifiedReviewed: intervals, originalReviewedByDiff: {}, contentHash: target.contentHash, lineCount: target.lineCount, updatedAt: "2026-08-21T00:00:00.000Z" } },
    createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const globalState: RepositoryGlobalState = { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: contextState.repositoryId, currentRevisionId: target.revisionId, files: {}, updatedAt: contextState.updatedAt };
  const first: Editor = { id: "split-a", uri: "file:///repo/src/large.ts", contentHash: target.contentHash! };
  const second: Editor = { id: "split-b", uri: first.uri, contentHash: target.contentHash! };
  const descriptors: Array<{ readonly documentUri: string; readonly contentHash: string }> = [];
  const stateLoads: string[] = [];
  const applies: Array<{ readonly editor: string; readonly decorationCount: number; readonly optionCount: number }> = [];
  let yields = 0;
  let deferFirstLoad = false;
  let resolveFirstLoad: (() => void) | undefined;
  const extension = loadWithVscode<typeof import("../../src/extension.js")>("../../src/extension.js", {});
  const productionLoad = extension.createNormalEditorDecorationLoadHandler({
    toDocumentDescriptor: async (editor: Editor, isCurrent) => {
      const descriptor = { documentUri: editor.uri, contentHash: editor.contentHash };
      descriptors.push(descriptor);
      if (editor === first && deferFirstLoad) { deferFirstLoad = false; await new Promise<void>((resolve) => { resolveFirstLoad = resolve; }); }
      return isCurrent() ? descriptor : undefined;
    },
    loadForDecoration: async (descriptor, selectedContext) => {
      void selectedContext;
      stateLoads.push(`${descriptor.documentUri}:${descriptor.contentHash}`);
      return { contextState, globalState, target };
    },
    selectedContext: () => undefined,
    workBudget: { maxDecorationsPerStage: 128, yieldControl: () => { yields += 1; } }
  });
  const host: NormalEditorDecorationHost<Editor, DecorationType> = {
    getVisibleEditors: () => [first, second], isDiffEditor: () => false,
    getSettings: (): NormalEditorDecorationSettings => ({ showGlobalReviewed: true, showGutterIcon: true, showOverviewRuler: true }),
    loadDecorations: (editor, showGlobalReviewed, loadContext) => productionLoad(editor, showGlobalReviewed, loadContext),
    createDecorationType: () => new DecorationType(),
    setDecorations: async (editor, _type, decorations, loadContext) => {
      if (loadContext.signal.aborted || !loadContext.isCurrent()) return;
      const options = decorations.map((decoration) => ({ start: decoration.interval.startLine, end: decoration.interval.endLineExclusive, hover: decoration.contextLabel }));
      applies.push({ editor: editor.id, decorationCount: decorations.length, optionCount: options.length });
    },
    onDidChangeVisibleEditors: () => ({ dispose(): void {} }), onDidChangeActiveEditor: () => ({ dispose(): void {} }), onDidChangeSettings: () => ({ dispose(): void {} }), showDecorationError: () => undefined
  };
  const controller = new NormalEditorDecorationController(host, { maxDecorationsPerStage: 128, yieldControl: () => { yields += 1; } });
  await controller.start();
  deferFirstLoad = true;
  const stale = controller.refreshEditor(first);
  await new Promise((resolve) => setImmediate(resolve));
  const current = controller.refreshEditor(first);
  await current;
  resolveFirstLoad!();
  await stale;
  assert.equal(descriptors.length, 4, "two split editors plus a superseded/current refresh each build their actual descriptor");
  assert.ok(descriptors.every((descriptor) => descriptor.documentUri === first.uri && descriptor.contentHash === target.contentHash));
  assert.equal(stateLoads.length, 3, "the superseded descriptor is fenced before state I/O while each current descriptor enters the production state-load boundary");
  assert.deepEqual(applies.map((apply) => apply.editor), ["split-a", "split-b", "split-a"]);
  assert.ok(applies.every((apply) => apply.decorationCount === 2_048 && apply.optionCount === 2_048), "each current split editor receives exactly one 2,048-interval projection and host option apply");
  assert.ok(yields >= 48, "three current 2,048-interval projections use the 128-item deterministic budget");
});

test("T607 uses the production SHA-256 adapter in deterministic large-document checkpoints", async () => {
  const account: number[] = [];
  let yields = 0;
  const text = "x".repeat(1_048_576);
  const hash = new NodeSha256StableHash();
  const value = await hash.digestCooperatively(text, 65_536, () => { yields += 1; }, () => true, (count) => { account.push(count); });
  assert.equal(value, hash.digest(text));
  assert.equal(account.length, 16);
  assert.ok(account.every((count) => count <= 65_536));
  assert.equal(yields, 15, "the production hashing adapter yields between bounded document chunks");
});

test("T607 cooperative SHA-256 preserves Unicode identities across surrogate stage boundaries", async () => {
  const hash = new NodeSha256StableHash();
  for (const boundary of [65_535, 65_536, 65_537]) {
    const text = "x".repeat(boundary - 1) + "😀" + "終";
    const cooperative = await hash.digestCooperatively(text, 65_536, () => new Promise<void>((resolve) => setImmediate(resolve)), () => true);
    assert.equal(cooperative, hash.digest(text), `surrogate at ${boundary} remains canonical`);
  }
});

test("T607 streams normal-document fragments without a full text materialization", async () => {
  const hash = new NodeSha256StableHash();
  const fragments = Array.from({ length: 10_000 }, (_, index) => `行${index}😀\n`);
  let yields = 0;
  const streamed = await hash.digestFragmentsCooperatively(fragments, 128, () => { yields += 1; }, () => true);
  assert.equal(streamed, hash.digest(fragments.join("")));
  assert.ok(yields > 100, "line fragments share the same bounded scheduler budget");
});

test("T607 builds a 2,048-interval normal-editor model cooperatively and fences a superseded generation", async () => {
  const intervals = Array.from({ length: 2_048 }, (_, index) => ({ startLine: index * 2, endLineExclusive: index * 2 + 1 }));
  const target: ReviewStateFileTarget = { fileId: "async-model", currentPath: "src/async-model.ts", revisionId: "r607", lineCount: 4_096, contentHash: "sha256:async" };
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: "workspace:async", kind: "workspace", repositoryId: "repo:async", displayName: "Async",
    workspace: { workspaceId: "workspace:async", snapshotRevision: "r607" },
    files: { [target.fileId]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: target.fileId, currentPath: target.currentPath, previousPaths: [], revisionId: target.revisionId, modifiedReviewed: intervals, originalReviewedByDiff: {}, contentHash: target.contentHash, lineCount: target.lineCount, updatedAt: "2026-08-21T00:00:00.000Z" } },
    createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z"
  };
  let yields = 0;
  const built = await createNormalEditorDecorationModelIncrementally({ contextState, globalState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: contextState.repositoryId, currentRevisionId: target.revisionId, files: {}, updatedAt: contextState.updatedAt }, target, showGlobalReviewed: true }, { maxWorkItems: 128, yieldControl: () => { yields += 1; }, isCurrent: () => true });
  assert.equal(built?.length, 2_048);
  assert.ok(yields >= 16, "validation, normalization, projection, and final sort stay within the 128-item budget");
  let current = true;
  const stale = createNormalEditorDecorationModelIncrementally({ contextState, globalState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: contextState.repositoryId, currentRevisionId: target.revisionId, files: {}, updatedAt: contextState.updatedAt }, target, showGlobalReviewed: true }, { maxWorkItems: 128, yieldControl: () => { current = false; }, isCurrent: () => current });
  assert.equal(await stale, undefined, "a superseded model never reaches apply");
});

test("T607 focused workload harness is wired through the diagnostic CI runner", async () => {
  const root = path.resolve(__dirname, "../../..");
  const [manifestText, workflow] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8")
  ]);
  const scripts = (JSON.parse(manifestText) as { readonly scripts?: Record<string, string> }).scripts ?? {};
  assert.match(scripts["test:t607"] ?? "", /t607-performance-incremental-ui\.test\.js/u);
  assert.match(workflow, /node tools\/run-ci-command\.mjs test-t607 npm run test:t607/u);
});

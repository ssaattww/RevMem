import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const runtimeRequire = createRequire(__filename);
const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode" ? vscode : Reflect.apply(original, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve(moduleName); delete runtimeRequire.cache[modulePath];
  const loaded = runtimeRequire(modulePath) as T; loader._load = original; return loaded;
};

import {
  FolderUnderstandingScopeController
} from "../../src/application/global-understanding/folder-understanding-scope-controller";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import { NodeRepositoryFilePathEnumerator } from "../../src/adapters/repository-files/node-repository-file-path-enumerator";
import { NodeFolderUnderstandingStoppedStore, FolderUnderstandingStoppedStoreError } from "../../src/adapters/state-repository/node-folder-understanding-stopped-store";
import { createT305GlobalUnderstandingSource } from "../../src/t305-global-understanding-composition";
import { T505GlobalUnderstandingSource } from "../../src/t505-global-understanding-source";
import type { GlobalUnderstandingTreeSnapshot } from "../../src/ui/global-understanding/global-understanding-ui-model";
import { OperationCancelledError, OperationFeedback, setActiveOperationFeedback } from "../../src/application/operation-feedback/operation-feedback";
import { observeGlobalUnderstandingDocumentOpen, shouldRefreshGlobalUnderstandingFolderEntry } from "../../src/t305-global-understanding-lifecycle";

test("T610 scopes file opens to direct folders, preserves stopped descendants, and isolates repository roots", async () => {
  const saved: string[][] = [];
  const controller = new FolderUnderstandingScopeController({
    loadStopped: async () => ["src/held"],
    saveStopped: async (_repositoryId, _repositoryRoot, paths) => { saved.push([...paths]); }
  });
  await controller.restore("repo", "/one");
  controller.openFile("repo", "/one", "src/a.ts", false);
  controller.openFile("repo", "/two", "src/a.ts", false);
  await controller.start("repo", "/one", "src", ["src", "src/held", "src/child"]);
  assert.deepEqual(controller.activeFolders("repo", "/one"), ["src", "src/child"]);
  assert.deepEqual(controller.activeFolders("repo", "/two"), ["src"]);
  await controller.stop("repo", "/one", "src/child");
  assert.deepEqual(saved.at(-1), ["src/child", "src/held"]);
  assert.equal(controller.state("repo", "/one", "src/child"), "stopped");
  controller.openFile("repo", "/one", "src/child/file.ts", false);
  assert.equal(controller.state("repo", "/one", "src/child"), "stopped");
});

test("T610 aggregates only complete direct children and fences stopped generation publication", async () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  controller.openFile("repo", "/repo", "root.ts", false);
  controller.openFile("repo", "/repo", "src/a.ts", false);
  controller.setComplete("repo", "/repo", "", { reviewed: 1, total: 2 });
  controller.setComplete("repo", "/repo", "src", { reviewed: 2, total: 2 });
  assert.deepEqual(controller.aggregate("repo", "/repo", ""), { reviewed: 3, total: 4, complete: true });
  await controller.stop("repo", "/repo", "src");
  assert.deepEqual(controller.aggregate("repo", "/repo", ""), { reviewed: 1, total: 2, complete: false });
  const generation = controller.begin("repo", "/repo", "");
  await controller.stop("repo", "/repo", "");
  assert.equal(controller.accept("repo", "/repo", "", generation, { reviewed: 9, total: 9 }), false);
});

test("T610 accepts a direct total only for the current running generation", async () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  controller.openFile("repo", "/repo", "src/a.ts", false);
  const first = controller.begin("repo", "/repo", "src");
  const second = controller.begin("repo", "/repo", "src");
  assert.equal(controller.accept("repo", "/repo", "src", first, { reviewed: 4, total: 4 }), false);
  assert.equal(controller.accept("repo", "/repo", "src", second, { reviewed: 1, total: 4 }), true);
  assert.deepEqual(controller.aggregate("repo", "/repo", "src"), { reviewed: 1, total: 4, complete: true });
});

test("T610 aborts only superseded or stopped scope work", async () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  controller.openFile("repo", "/repo", "one/a.ts", false); controller.openFile("repo", "/repo", "two/b.ts", false);
  controller.begin("repo", "/repo", "one"); controller.begin("repo", "/repo", "two");
  const one = controller.signal("repo", "/repo", "one")!; const two = controller.signal("repo", "/repo", "two")!;
  controller.begin("repo", "/repo", "one");
  assert.equal(one.aborted, true); assert.equal(two.aborted, false);
  await controller.stop("repo", "/repo", "two");
  assert.equal(two.aborted, true);
});

test("T610-IFR-001 restores durable stops before startup document observation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-restart-open-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "source\n", "utf8");
  for (const autoStartDescendants of [false, true]) {
    const globalStoragePath = path.join(root, `global-${String(autoStartDescendants)}`);
    await mkdir(globalStoragePath, { recursive: true });
    const context = { context: { kind: "branch" as const, label: "main", detail: root, headRevision: "restart", selection: { kind: "branch" as const, repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined };
    const dependencies = {
      globalStoragePath,
      storageUris: { globalStorageUri: { fsPath: globalStoragePath }, storageUri: { fsPath: root } },
      exclusionPolicy: new ReviewFileExclusionPolicyService(),
      readAutoStartDescendants: () => autoStartDescendants
    };
    const first = createT305GlobalUnderstandingSource(dependencies);
    first.setContext(context);
    await first.stopFolder("src");
    let openDocumentReads = 0;
    const restarted = createT305GlobalUnderstandingSource({
      ...dependencies,
      readOpenDocuments: () => { openDocumentReads += 1; return []; }
    });
    restarted.setContext(context);
    await restarted.observeFileOpen(path.join(root, "src", "a.ts"));
    const snapshot = await restarted.recalculate();
    assert.equal(snapshot?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    assert.equal(openDocumentReads, 0, "restart never captures content from a durable stopped scope");
  }
});

test("T610-IFR-002 publishes a running scope before I/O so the same row can stop it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-running-stop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "source\n", "utf8");
  let openDocumentReads = 0;
  const source = new T505GlobalUnderstandingSource({
    storageUris: { globalStorageUri: { fsPath: path.join(root, "global") }, storageUri: { fsPath: root } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    folderScopes: new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined }),
    readOpenDocuments: () => { openDocumentReads += 1; return []; }
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: root, headRevision: "running", selection: { kind: "branch", repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(root, "src", "a.ts"));
  let runningPublished = false;
  const final = await source.recalculate(undefined, async (snapshot: GlobalUnderstandingTreeSnapshot) => {
    const folder = snapshot.folders?.find((candidate) => candidate.path === "src");
    assert.equal(folder?.state, "running");
    runningPublished = true;
    await source.stopFolder("src");
  });
  assert.equal(runningPublished, true);
  assert.equal(openDocumentReads, 0, "stopping the published running row prevents owner content capture");
  assert.equal(final?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
});

test("T610-IFR-002 exposes the running row through the actual provider before public stop", async () => {
  setActiveOperationFeedback(undefined);
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  let provider: { getChildren(node?: unknown): readonly { readonly kind: string; readonly state?: string }[] } | undefined;
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }),
      createTreeView: (_id: string, options: { treeDataProvider: typeof provider }) => {
        provider = options.treeDataProvider;
        return { onDidChangeSelection: () => disposable, reveal: async () => undefined, dispose(): void {}, get treeDataProvider() { return options.treeDataProvider; } };
      }
    },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return disposable; } },
    workspace: { onDidChangeConfiguration: () => disposable }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  const snapshot = (state: "running" | "active" | "stopped") => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, folders: [{ path: "src", state, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: state !== "active" }] });
  let first = true; let stopCalls = 0; let releaseFirst: (() => void) | undefined; let runningPublished: (() => void) | undefined;
  const published = new Promise<void>((resolve) => { runningPublished = resolve; });
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: {
      recalculate: async (
        _signal?: AbortSignal,
        publishProgress?: (value: GlobalUnderstandingTreeSnapshot) => void | Promise<void>
      ) => {
        if (!first) return snapshot("stopped");
        first = false;
        await publishProgress?.(snapshot("running"));
        runningPublished?.();
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return snapshot("active");
      },
      stopFolder: async () => { stopCalls += 1; releaseFirst?.(); }
    },
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined,
    refreshDecorations: async () => undefined, openFile: async () => undefined, reportError: async () => undefined
  });
  const initialRefresh = registered.refresh();
  await published;
  const running = provider!.getChildren().find((node) => node.kind === "folder")!;
  assert.equal(running.state, "running");
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(running);
  await assert.rejects(
    initialRefresh,
    (error: unknown) => error instanceof OperationCancelledError,
    "the stopped running generation terminates as typed cancellation",
  );
  assert.equal(stopCalls, 1);
  assert.equal(provider!.getChildren().find((node) => node.kind === "folder")?.state, "stopped");
  registered.dispose(); setActiveOperationFeedback(undefined);
});

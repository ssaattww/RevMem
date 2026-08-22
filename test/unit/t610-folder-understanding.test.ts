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
import { setActiveOperationFeedback } from "../../src/application/operation-feedback/operation-feedback";

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

test("T610 contributes one focused package/CI gate and mutually exclusive folder actions", async () => {
  const root = path.resolve(__dirname, "../../..");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    contributes: { commands: Array<{ command: string }>; configuration: { properties: Record<string, { default?: unknown }> }; menus: { "view/item/context": Array<{ command: string; when?: string }> } };
  };
  assert.match(manifest.scripts["test:t610"]!, /t610-folder-understanding\.test\.js/u);
  assert.equal(manifest.contributes.configuration.properties["reviewRange.globalUnderstanding.autoStartDescendants"]?.default, false);
  const actions = manifest.contributes.menus["view/item/context"].filter((item) => item.command.includes("GlobalUnderstandingFolder"));
  assert.equal(actions.length, 3);
  assert.equal(new Set(actions.map((item) => item.when)).size, 3, "one row action is selected by the current folder state");
  const workflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.equal((workflow.match(/npm run test:t610\b/gu) ?? []).length, 1);
});

test("T610 exported T305 composition scopes actual file opens and setting changes to the next open only", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-composition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  await mkdir(path.join(repositoryRoot, "src", "child"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "src", "held"), { recursive: true });
  await Promise.all([
    writeFile(path.join(repositoryRoot, "root.ts"), "root\n", "utf8"),
    writeFile(path.join(repositoryRoot, "src", "a.ts"), "source\n", "utf8"),
    writeFile(path.join(repositoryRoot, "src", "child", "b.ts"), "child\n", "utf8"),
    writeFile(path.join(repositoryRoot, "src", "held", "c.ts"), "held\n", "utf8")
  ]);
  const revisionId = "t610-revision";
  const openDocuments = ["root.ts", "src/a.ts", "src/child/b.ts", "src/held/c.ts"].map((repositoryPath) => ({
    path: repositoryPath, revisionId, lineCount: 1, nonEmptyLines: [0], contentHash: repositoryPath, cacheKey: repositoryPath
  }));
  let autoStartDescendants = false;
  const source = createT305GlobalUnderstandingSource({
    globalStoragePath: path.join(root, "global"),
    storageUris: { globalStorageUri: { fsPath: path.join(root, "global") }, storageUri: { fsPath: path.join(root, "workspace") } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => openDocuments,
    readAutoStartDescendants: () => autoStartDescendants,
    fileSystemPathSemantics: "posix",
    yieldControl: () => undefined
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: repositoryRoot, headRevision: revisionId,
    selection: { kind: "branch", repositoryId: "repo", repositoryRoot, branchRef: "refs/heads/main" } }, progress: undefined });

  await source.observeFileOpen(path.join(repositoryRoot, "src", "a.ts"));
  const direct = await source.recalculate();
  assert.deepEqual(direct?.progress.files.map((file) => file.path), ["src/a.ts"]);
  assert.deepEqual(direct?.folders?.map((folder) => folder.path), ["", "src"], "the actual source projects the discovered ancestor chain");

  autoStartDescendants = true;
  const afterFalseToTrue = await source.recalculate();
  assert.deepEqual(afterFalseToTrue?.folders?.map((folder) => folder.path), ["", "src"], "a setting transition does not start existing descendants");
  await source.stopFolder("src/held");
  await source.observeFileOpen(path.join(repositoryRoot, "src", "child", "b.ts"));
  const descendant = await source.recalculate();
  assert.deepEqual(descendant?.progress.files.map((file) => file.path).sort(), ["src/a.ts", "src/child/b.ts"]);
  assert.equal(descendant?.folders?.find((folder) => folder.path === "src/held")?.state, "stopped");

  autoStartDescendants = false;
  const afterTrueToFalse = await source.recalculate();
  assert.equal(afterTrueToFalse?.folders?.find((folder) => folder.path === "src/child")?.state, "active", "a setting transition never stops an active scope");
  assert.equal(afterTrueToFalse?.folders?.find((folder) => folder.path === "src/held")?.state, "stopped", "a setting transition never resumes a stopped scope");
});

test("T610 controller keeps accepted sibling totals when another scope is stopped or fails", async () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  controller.openFile("repo", "/repo", "one/a.ts", false);
  controller.openFile("repo", "/repo", "two/b.ts", false);
  const one = controller.begin("repo", "/repo", "one");
  const two = controller.begin("repo", "/repo", "two");
  assert.equal(controller.accept("repo", "/repo", "one", one, { reviewed: 1, total: 1 }), true);
  assert.equal(controller.accept("repo", "/repo", "two", two, { reviewed: 2, total: 2 }), true);
  const refreshingOne = controller.begin("repo", "/repo", "one");
  await controller.stop("repo", "/repo", "one");
  assert.equal(controller.accept("repo", "/repo", "one", refreshingOne, { reviewed: 9, total: 9 }), false);
  assert.deepEqual(controller.aggregate("repo", "/repo", "one"), { reviewed: 1, total: 1, complete: false });
  assert.deepEqual(controller.aggregate("repo", "/repo", "two"), { reviewed: 2, total: 2, complete: true });
  const failed = controller.begin("repo", "/repo", "two");
  assert.equal(controller.fail("repo", "/repo", "two", failed), true);
  assert.deepEqual(controller.aggregate("repo", "/repo", "two"), { reviewed: 2, total: 2, complete: false });
});

test("T610-NR-002 inherits an ancestor stop, then resumes without turning inherited descendants into markers", async () => {
  const persisted: string[][] = [];
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async (_id, _root, paths) => { persisted.push([...paths]); } });
  controller.openFile("repo", "/repo", "src/child/a.ts", false);
  await controller.stop("repo", "/repo", "src");
  controller.openFile("repo", "/repo", "src/child/a.ts", false);
  assert.equal(controller.state("repo", "/repo", "src/child"), "stopped", "a file open cannot cross a stopped ancestor");
  assert.deepEqual(persisted.at(-1), ["src"], "only the selected explicit marker is persisted");
  await controller.resume("repo", "/repo", "src");
  assert.equal(controller.state("repo", "/repo", "src/child"), "inactive", "resume removes inherited stops so the subtree is recoverable");
  controller.openFile("repo", "/repo", "src/child/a.ts", false);
  assert.equal(controller.state("repo", "/repo", "src/child"), "active");
});

test("T610-NR-004 recursively aggregates three levels and creates only hierarchical ancestors", () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  controller.openFile("repo", "/repo", "src/feature/a.ts", false);
  controller.setComplete("repo", "/repo", "src/feature", { reviewed: 2, total: 3 });
  controller.setComplete("repo", "/repo", "src", { reviewed: 1, total: 1 });
  controller.setComplete("repo", "/repo", "", { reviewed: 1, total: 2 });
  assert.deepEqual(controller.aggregate("repo", "/repo", ""), { reviewed: 4, total: 6, complete: true });
  void controller.openFile("repo", "/repo", "src/other/b.ts", false);
  assert.equal(controller.aggregate("repo", "/repo", "").complete, false, "an incomplete direct child makes every ancestor partial");
  assert.deepEqual(controller.snapshots("repo", "/repo").map((item) => item.path), ["", "src", "src/feature", "src/other"]);
});

test("T610-NR-008 bounds 257 direct entries and prunes a stopped subtree before discovery", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-bounded-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "active", "held", "nested"), { recursive: true });
  await Promise.all(Array.from({ length: 257 }, (_, index) => writeFile(path.join(root, "active", `f-${index}.ts`), "x\n", "utf8")));
  await writeFile(path.join(root, "active", "held", "nested", "secret.ts"), "secret\n", "utf8");
  const batches: number[] = [];
  const enumerator = new NodeRepositoryFilePathEnumerator(new ReviewFileExclusionPolicyService(), {
    maxEntriesPerStage: 128, yieldControl: () => undefined, accountWorkBatch: (entry) => { batches.push(entry.count); }
  });
  const direct = await enumerator.enumerateDirectFolders(root, ["active"]);
  assert.equal(direct.includedPaths.length, 257);
  assert.ok(batches.length >= 2 && batches.every((count) => count <= 128));
  const folders = await enumerator.enumerateSubtreeFolders(root, "active", undefined, (candidate) => candidate === "active/held");
  assert.ok(!folders.some((folder) => folder.startsWith("active/held")), "a stopped subtree is never recursively discovered");
});

test("T610-R7 never presents a partial repository aggregate as a percentage", async () => {
  const model = await import("../../src/ui/global-understanding/global-understanding-ui-model.js");
  const partial = {
    progress: { reviewedNonEmptyLineCount: 1, totalNonEmptyLineCount: 2, progress: 0.5, files: [] },
    excludedFileCount: 0, prunedExcludedDirectoryCount: 0, repositoryPartial: true,
    folders: [{ path: "src", state: "active" as const, reviewedNonEmptyLineCount: 1, totalNonEmptyLineCount: 2, partial: true }]
  };
  const tree = model.createGlobalUnderstandingTreeModel(partial);
  assert.match(tree.summary.description, /partial/u);
  assert.doesNotMatch(tree.summary.description, /50%/u);
  assert.doesNotMatch(model.formatGlobalUnderstandingStatusBar(partial).text, /50%/u);
});

test("T610-R7 documents the real watcher and startup-open lifecycle without a callback shortcut", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  assert.match(activation, /for \(const document of vscode\.workspace\.textDocuments\)/u);
  assert.match(activation, /folderEntryWatcher\.onDidCreate/u);
  assert.match(activation, /folderEntryWatcher\.onDidDelete/u);
  assert.match(suite, /workspace\.fs\.writeFile/u);
  assert.doesNotMatch(suite, /notifyGlobalUnderstandingFolderEntryForTest/u);
});

test("T610-R7 applies one 128-item enumeration budget across a deep 257+ folder walk", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-wide-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(Array.from({ length: 257 }, async (_, index) => {
    const folder = path.join(root, "deep", `d-${index}`);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "a.ts"), "x\n", "utf8");
  }));
  const batches: number[] = [];
  const enumerator = new NodeRepositoryFilePathEnumerator(new ReviewFileExclusionPolicyService(), {
    maxEntriesPerStage: 128, yieldControl: () => undefined, accountWorkBatch: (entry) => { batches.push(entry.count); }
  });
  await enumerator.enumerateSubtreeFolders(root, "deep");
  assert.ok(batches.length >= 3);
  assert.ok(batches.every((count) => count <= 128));
});

test("T610-R7 wires the exported T610 documentation contract exactly once", async () => {
  const root = path.resolve(__dirname, "../../..");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(manifest.scripts["test:t610"]!, /t610-public-api-documentation\.test\.js/u);
  assert.equal((manifest.scripts["test:t610"]!.match(/t610-public-api-documentation\.test\.js/gu) ?? []).length, 1);
});

test("T610-NR-007 fails closed for corrupt marker text and durable write failure", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corrupt = new NodeFolderUnderstandingStoppedStore(root, {
    atomicFileStore: { readText: async () => "{not-json", writeTextAtomically: async () => undefined }
  });
  await assert.rejects(() => corrupt.loadStopped("repo", "/repo"), FolderUnderstandingStoppedStoreError);
  const diskFull = new NodeFolderUnderstandingStoppedStore(root, {
    atomicFileStore: { readText: async () => undefined, writeTextAtomically: async () => { throw Object.assign(new Error("full"), { code: "ENOSPC" }); } }
  });
  await assert.rejects(() => diskFull.saveStopped("repo", "/repo", ["src"]), FolderUnderstandingStoppedStoreError);
});

test("T610-NR-007 serializes independent-window marker mutations without a lost stop", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-windows-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new NodeFolderUnderstandingStoppedStore(root);
  const second = new NodeFolderUnderstandingStoppedStore(root);
  await Promise.all([
    first.mutateStopped("repo", "scope", { add: ["src/a"], remove: [] }),
    second.mutateStopped("repo", "scope", { add: ["src/b"], remove: [] })
  ]);
  assert.deepEqual(await first.loadStopped("repo", "scope"), ["src/a", "src/b"]);
  await second.mutateStopped("repo", "scope", { add: [], remove: ["src/a"] });
  assert.deepEqual(await first.loadStopped("repo", "scope"), ["src/b"]);
});

test("T610-NR-005 accepts folder commands only for the current Tree generation", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  const errors: string[] = [];
  let provider: { getChildren(node?: unknown): readonly { readonly kind: string }[] } | undefined;
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }), createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }), registerTreeDataProvider: (_id: string, value: typeof provider) => { provider = value; return disposable; } },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return disposable; } },
    workspace: { onDidChangeConfiguration: () => disposable }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  let stops = 0;
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: { recalculate: async () => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, folders: [{ path: "src", state: "active", reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: false }] }), stopFolder: async () => { stops += 1; } },
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined, openFile: async () => undefined, reportError: async (error) => { errors.push(String(error)); }
  });
  await registered.refresh();
  const folder = provider!.getChildren().find((node) => node.kind === "folder")!;
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(folder);
  assert.equal(stops, 1);
  registered.invalidate();
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(folder);
  assert.equal(stops, 1, "a stale Tree row is rejected before it reaches the source command");
  assert.ok(errors.at(-1)?.includes("Review Range Output"), "stale command rejection reaches the privacy-safe error boundary");
  registered.dispose();
});

test("T610-NR-007 sends source and persistence failures through a privacy-safe refresh boundary", async () => {
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }), createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }), registerTreeDataProvider: () => disposable },
    commands: { registerCommand: () => disposable }, workspace: { onDidChangeConfiguration: () => disposable }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  const errors: string[] = [];
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: { recalculate: async () => { throw new Error("C:\\private\\repository\\secret.ts ENOSPC"); } },
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined, openFile: async () => undefined,
    reportError: async (error) => { errors.push(String(error)); }
  });
  await registered.refreshWithErrorBoundary();
  assert.deepEqual(errors, ["操作を完了できませんでした。詳細は Review Range Output を確認してください。"]);
  assert.equal(errors.join("\n").includes("secret.ts"), false);
  registered.dispose();
});

test("T610-R7 runs a real folder command through the privacy-safe error boundary", async () => {
  setActiveOperationFeedback(undefined);
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  const errors: string[] = [];
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }), createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }), registerTreeDataProvider: () => disposable },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return disposable; } }, workspace: { onDidChangeConfiguration: () => disposable }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: { recalculate: async () => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, folders: [{ path: "src", state: "active" as const, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: false }] }), stopFolder: async () => { throw Object.assign(new Error("C:\\private\\marker.json ENOSPC"), { code: "ENOSPC" }); } },
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined, openFile: async () => undefined, reportError: async (error) => { errors.push(String(error)); }
  });
  await registered.refresh();
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!();
  assert.deepEqual(errors, ["操作を完了できませんでした。詳細は Review Range Output を確認してください。"]);
  assert.equal(errors.join("\n").includes("marker.json"), false);
  registered.dispose(); setActiveOperationFeedback(undefined);
});

test("T610-NR-005 keeps stopped markers isolated by actual URI authority and rejects traversal before enumeration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-uri-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true }); await writeFile(path.join(root, "src", "a.ts"), "x\n", "utf8");
  const dependencies = (authority: string) => ({ globalStoragePath: path.join(root, "storage"), storageUris: { globalStorageUri: { fsPath: path.join(root, "storage") }, storageUri: { fsPath: path.join(root, "workspace") } }, exclusionPolicy: new ReviewFileExclusionPolicyService(), resolveRepositoryRootUri: () => ({ scheme: "vscode-remote", authority, path: "/work/repo", query: "", fragment: "" }), yieldControl: () => undefined });
  const context = { context: { kind: "branch" as const, label: "main", detail: root, headRevision: "r", selection: { kind: "branch" as const, repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined };
  const first = createT305GlobalUnderstandingSource(dependencies("host-a")); first.setContext(context); await first.stopFolder("src");
  const second = createT305GlobalUnderstandingSource(dependencies("host-b")); second.setContext(context);
  assert.deepEqual((await second.recalculate())?.folders, [], "remote authorities never share a stopped marker");
  await assert.rejects(() => second.startFolder("../outside"), /canonical repository-relative folder/u);
});

test("T610-NR-009 wires one Test API lifecycle seam and one Host selector", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const runner = await readFile(path.join(root, "test", "vscode", "run-extension-host.ts"), "utf8");
  const ownedLaunch = await readFile(path.join(root, "test", "vscode", "owned-extension-host-launch.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  for (const method of ["startGlobalUnderstandingFolderForTest", "stopGlobalUnderstandingFolderForTest", "resumeGlobalUnderstandingFolderForTest"]) {
    assert.equal((activation.match(new RegExp(`${method}:`, "gu")) ?? []).length, 1, `${method} is exported once from actual activation`);
  }
  assert.equal((runner.match(/process\.argv\.includes\("--t610"\)/gu) ?? []).length, 1, "the focused Host selector is registered once");
  const fixturePreparation = runner.indexOf("await prepareT610Fixture(t610Paths.workspace);");
  const initialLaunch = runner.indexOf('await launch("t610-initial"');
  assert.ok(fixturePreparation >= 0 && fixturePreparation < initialLaunch, "the runner owns Git fixture preparation before the initial Host launch");
  const startupDrain = suite.indexOf("await api.drainCurrentContextStartupForTest();");
  const contextRefresh = suite.indexOf('await vscode.commands.executeCommand("reviewRange.refreshContext");');
  const documentOpen = suite.indexOf("await vscode.workspace.openTextDocument");
  assert.ok(startupDrain >= 0 && startupDrain < contextRefresh && contextRefresh < documentOpen, "the Host drains and explicitly establishes Current Context before opening its fixture document");
  assert.match(suite, /const closeDocument = async/u, "the T610 Host owns an explicit document-close lifecycle");
  assert.match(suite, /onDidCloseTextDocument/u, "the T610 close lifecycle observes and disposes its own close listener");
  assert.match(suite, /finally \{\s*await closeDocument\(document\);/u, "the T610 fixture closes the document even when a Host assertion fails");
  assert.match(ownedLaunch, /ownedWorkerPid/u, "owned worker PID diagnostics remain explicit per Host phase");
  assert.match(ownedLaunch, /ownedExtensionHostPids/u, "observed Extension Host PIDs remain attributable to the owning phase");
  assert.doesNotMatch(suite, /setTimeout/gu, "the T610 Host fixture uses explicit lifecycle drains instead of fixed sleeps");
});

test("T610-R4 separates accepted open, source refresh, and published runtime snapshot observations", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  assert.match(activation, /getGlobalUnderstandingLifecycleObservationForTest:/u);
  assert.match(activation, /drainGlobalUnderstandingFileOpenForTest:/u);
  assert.match(suite, /getGlobalUnderstandingLifecycleObservationForTest\(\)/u);
  assert.match(suite, /acceptedDocumentOpenCount/u);
  assert.match(suite, /sourceRefreshOutcome/u);
  assert.match(suite, /publishedSnapshot/u);
});

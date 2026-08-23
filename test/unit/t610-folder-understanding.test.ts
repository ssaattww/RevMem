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
import { OperationFeedback, setActiveOperationFeedback } from "../../src/application/operation-feedback/operation-feedback";
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

test("T610 contributes one focused package/CI gate and mutually exclusive folder actions", async () => {
  const root = path.resolve(__dirname, "../../..");
  const manifestText = await readFile(path.join(root, "package.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    scripts: Record<string, string>;
    contributes: { commands: Array<{ command: string }>; configuration: { properties: Record<string, { default?: unknown }> }; menus: { "view/item/context": Array<{ command: string; when?: string }>; "editor/context": Array<{ command: string }> } };
  };
  assert.match(manifest.scripts["test:t610"]!, /t610-folder-understanding\.test\.js/u);
  assert.equal(manifest.contributes.configuration.properties["reviewRange.globalUnderstanding.autoStartDescendants"]?.default, false);
  const actions = manifest.contributes.menus["view/item/context"].filter((item) => item.command.includes("GlobalUnderstandingFolder"));
  assert.equal(actions.length, 3);
  assert.equal(new Set(actions.map((item) => item.when)).size, 3, "one row action is selected by the current folder state");
  assert.equal((manifestText.match(/"editor\/context"\s*:/gu) ?? []).length, 1, "the manifest has one non-overwriting editor/context menu key");
  assert.equal(manifest.contributes.menus["editor/context"].length, 7, "four review commands and three folder commands remain contributed together");
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
  assert.deepEqual(direct?.folders?.map((folder) => folder.path), ["", "src", "src/child", "src/held"], "the actual source projects inactive direct children without reading them");
  assert.equal(direct?.repositoryPartial, true);

  autoStartDescendants = true;
  const afterFalseToTrue = await source.recalculate();
  assert.deepEqual(afterFalseToTrue?.folders?.map((folder) => folder.path), ["", "src", "src/child", "src/held"], "a setting transition does not start existing descendants");
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

test("T610-R8 persists ordered Host subphases and drains the real watcher without local operation deadlines", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const runner = await readFile(path.join(root, "test", "vscode", "run-extension-host.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  assert.match(activation, /recordT610HostSubphaseForTest:/u);
  assert.match(activation, /drainGlobalUnderstandingFolderEntryForTest:/u);
  assert.match(runner, /t610-host-subphase\.json/u);
  const phases = [
    "context-ready", "document-opened", "before-tree-node-acquisition", "after-tree-node-acquisition",
    "before-public-start", "after-public-start", "before-mismatch-feedback-drain",
    "after-mismatch-feedback-drain", "before-public-stop", "after-public-stop",
    "before-public-resume", "after-public-resume", "before-second-root-open-owner-observation",
    "after-second-root-open-owner-observation", "before-hierarchy-status-probe",
    "after-hierarchy-status-probe", "before-real-watcher-event", "after-real-watcher-event",
    "final-stop-completed", "before-document-close", "after-document-close"
  ];
  let previous = -1;
  for (const phase of phases) {
    const current = suite.indexOf(`recordT610HostSubphaseForTest("${phase}")`);
    assert.ok(current > previous, `T610 Host records ${phase} after its predecessor`);
    previous = current;
  }
  assert.doesNotMatch(suite, /setTimeout|Promise\.race/u, "T610 has no local wrapper around public operations");
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

test("T610-R10 indexes many scope totals once per snapshot and fences stopped stale publication", async () => {
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  for (let index = 0; index < 257; index += 1) {
    const folder = `many/f-${index}`;
    controller.openFile("repo", "/repo", `${folder}/a.ts`, false);
    controller.setComplete("repo", "/repo", folder, { reviewed: 1, total: 2 });
  }
  controller.setComplete("repo", "/repo", "many", { reviewed: 0, total: 0 });
  controller.setComplete("repo", "/repo", "", { reviewed: 1, total: 1 });
  const first = controller.snapshots("repo", "/repo");
  const root = first.find((snapshot) => snapshot.path === "")!;
  assert.deepEqual(root.total, { reviewed: 258, total: 515, complete: true }, "all direct and deep totals are accounted exactly once");
  const second = controller.snapshots("repo", "/repo");
  assert.deepEqual(second, first, "a repeated projection has no retained duplicate rows or totals");
  const generation = controller.begin("repo", "/repo", "many/f-128");
  await controller.stop("repo", "/repo", "many/f-128");
  assert.equal(controller.accept("repo", "/repo", "many/f-128", generation, { reviewed: 999, total: 999 }), false, "a cancelled folder generation never republishes stale work");
  assert.equal(controller.snapshots("repo", "/repo").find((snapshot) => snapshot.path === "")!.total.complete, false, "stopped evidence makes the aggregate partial without duplicating the remaining scopes");
});

test("T610-R11 cancels an actual many-entry source scope before post-cancel document I/O or publication", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-source-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await Promise.all(Array.from({ length: 257 }, (_, index) => writeFile(path.join(root, "src", `f-${index}.ts`), "x\n", "utf8")));
  const context = { context: { kind: "branch" as const, label: "main", detail: root, headRevision: "r11", selection: { kind: "branch" as const, repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined };
  let stopScope: () => Promise<void> = async () => undefined;
  let documentReads = 0;
  let workBatches = 0;
  const source = createT305GlobalUnderstandingSource({
    globalStoragePath: path.join(root, "storage"),
    storageUris: { globalStorageUri: { fsPath: path.join(root, "storage") }, storageUri: { fsPath: root } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => { documentReads += 1; return []; },
    accountWorkBatch: () => { workBatches += 1; },
    yieldControl: async () => { await stopScope(); }
  });
  stopScope = () => source.stopFolder("src");
  source.setContext(context);
  await source.observeFileOpen(path.join(root, "src", "f-0.ts"));
  const snapshot = await source.recalculate();
  assert.equal(documentReads, 0, "a stopped generation performs no post-cancel document evidence I/O");
  assert.ok(workBatches > 0, "the deterministic fixture reaches the bounded enumerator checkpoint before cancellation");
  assert.deepEqual(snapshot?.progress.files, [], "a cancelled source scope publishes no stale file projection");
  assert.equal(snapshot?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
  assert.ok((snapshot?.folders?.length ?? 0) <= 2, "the cancelled source retains only root and direct-scope descriptors");
});

test("T610-NR-008 captures owner evidence once and projects each active folder without duplicates", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-owner-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(["one", "two"].map(async (folder) => {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, "a.ts"), `${folder}\n`, "utf8");
  }));
  await mkdir(path.join(root, "one", "inactive-child"), { recursive: true });
  let documentReads = 0;
  const source = createT305GlobalUnderstandingSource({
    globalStoragePath: path.join(root, "storage"),
    storageUris: { globalStorageUri: { fsPath: path.join(root, "storage") }, storageUri: { fsPath: root } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => {
      documentReads += 1;
      return ["one", "two"].map((folder) => ({
        path: `${folder}/a.ts`, revisionId: "r15", lineCount: 2,
        nonEmptyLines: [0], contentHash: folder, cacheKey: folder
      }));
    },
    yieldControl: () => undefined
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: root, headRevision: "r15", selection: { kind: "branch", repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(root, "one", "a.ts"));
  await source.observeFileOpen(path.join(root, "two", "a.ts"));
  const snapshot = await source.recalculate();
  assert.equal(documentReads, 1, "opened evidence is captured once for the owner generation, not once per scope");
  assert.deepEqual(snapshot?.progress.files.map((file) => file.path).sort(), ["one/a.ts", "two/a.ts"]);
  assert.equal(snapshot?.folders?.find((folder) => folder.path === "one/inactive-child")?.state, "inactive");
  assert.equal(snapshot?.repositoryPartial, true, "a discovered inactive child keeps repository summary and status partial");
});

test("T610-NR-007 marks every current scope failed when owner-shared capture fails", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "review-range-t610-shared-failure-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const repositoryRoot = path.join(fixture, "repository");
  await Promise.all(["one", "two"].map(async (folder) => {
    await mkdir(path.join(repositoryRoot, folder), { recursive: true });
    await writeFile(path.join(repositoryRoot, folder, "a.ts"), `${folder}\n`, "utf8");
  }));
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  const source = new T505GlobalUnderstandingSource({
    storageUris: { globalStorageUri: { fsPath: path.join(fixture, "storage") } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(), folderScopes: controller,
    readOpenDocuments: () => { throw new Error("owner shared capture failed"); },
    yieldControl: () => undefined
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: repositoryRoot, headRevision: "r17", selection: { kind: "branch", repositoryId: "repo", repositoryRoot, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(repositoryRoot, "one", "a.ts"));
  await source.observeFileOpen(path.join(repositoryRoot, "two", "a.ts"));
  await assert.rejects(() => source.recalculate(), /owner shared capture failed/u);
  assert.equal(controller.state("repo", repositoryRoot, "one"), "failed");
  assert.equal(controller.state("repo", repositoryRoot, "two"), "failed");
  assert.equal(controller.aggregate("repo", repositoryRoot, "").complete, false);
});

test("T610-NR-008 retries owner-shared capture without a stopped scope or post-stop copy work", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "review-range-t610-shared-cancel-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const repositoryRoot = path.join(fixture, "repository");
  await Promise.all(["one", "two"].map(async (folder) => {
    await mkdir(path.join(repositoryRoot, folder), { recursive: true });
    await writeFile(path.join(repositoryRoot, folder, "a.ts"), `${folder}\n`, "utf8");
  }));
  const controller = new FolderUnderstandingScopeController({ loadStopped: async () => [], saveStopped: async () => undefined });
  let lastWorkKind = "";
  let stopped = false;
  let postStopCopyBatches = 0;
  const lines = Array.from({ length: 257 }, (_, index) => index);
  const source = new T505GlobalUnderstandingSource({
    storageUris: { globalStorageUri: { fsPath: path.join(fixture, "storage") } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(), folderScopes: controller,
    readOpenDocuments: () => ["one", "two"].map((folder) => ({ path: `${folder}/a.ts`, revisionId: "r18", lineCount: 258, nonEmptyLines: lines, contentHash: folder, cacheKey: folder })),
    accountWorkBatch: (entry) => {
      lastWorkKind = entry.kind;
      if (stopped && entry.kind.includes("open-non-empty-line")) postStopCopyBatches += 1;
    },
    yieldControl: async () => {
      if (!stopped && lastWorkKind === "copied-open-non-empty-line") {
        stopped = true;
        await controller.stop("repo", repositoryRoot, "one");
      }
    }
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: repositoryRoot, headRevision: "r18", selection: { kind: "branch", repositoryId: "repo", repositoryRoot, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(repositoryRoot, "one", "a.ts"));
  await source.observeFileOpen(path.join(repositoryRoot, "two", "a.ts"));
  const snapshot = await source.recalculate();
  assert.equal(stopped, true, "the deterministic stop occurs after enumeration during shared evidence copy");
  assert.equal(postStopCopyBatches, 4, "post-stop copy batches belong only to the live sibling's live and retained evidence");
  assert.deepEqual(snapshot?.progress.files.map((file) => file.path), ["two/a.ts"], "the live sibling completes without stale stopped-scope publication");
  assert.equal(snapshot?.folders?.find((folder) => folder.path === "one")?.state, "stopped");
  assert.equal(snapshot?.folders?.find((folder) => folder.path === "two")?.state, "active");
});

test("T610-R15 presents the Host hierarchy as complete until a newly discovered child is inactive", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "review-range-t610-host-partial-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const root = path.join(fixture, "repository");
  await mkdir(path.join(root, "src", "child"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "src", "a.ts"), "a\n", "utf8"),
    writeFile(path.join(root, "src", "child", "b.ts"), "b\n", "utf8")
  ]);
  const source = createT305GlobalUnderstandingSource({
    globalStoragePath: path.join(fixture, "storage"),
    storageUris: { globalStorageUri: { fsPath: path.join(fixture, "storage") }, storageUri: { fsPath: fixture } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    readOpenDocuments: () => ["src/a.ts", "src/child/b.ts"].map((repositoryPath) => ({
      path: repositoryPath, revisionId: "r15", lineCount: 2,
      nonEmptyLines: [0], contentHash: repositoryPath, cacheKey: repositoryPath
    })),
    yieldControl: () => undefined
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: root, headRevision: "r15", selection: { kind: "branch", repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(root, "src", "a.ts"));
  await source.startFolder("");
  await source.stopFolder("src");
  await source.resumeFolder("src");
  await source.observeFileOpen(path.join(root, "src", "child", "b.ts"));
  const complete = await source.recalculate();
  assert.equal(complete?.repositoryPartial, undefined, "the fully enumerated Host hierarchy remains complete");

  await mkdir(path.join(root, "src", "inactive-watcher-child"));
  const partial = await source.recalculate();
  assert.equal(partial?.folders?.find((folder) => folder.path === "src/inactive-watcher-child")?.state, "inactive");
  assert.equal(partial?.repositoryPartial, true, "the newly discovered inactive child makes the repository partial");
  const model = await import("../../src/ui/global-understanding/global-understanding-ui-model.js");
  assert.doesNotMatch(model.formatGlobalUnderstandingStatusBar(partial!).text, /%/u);
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

test("T610-R11 routes actual injected Node marker corruption, ENOSPC, and permission faults through exported T305 composition", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-composition-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { context: { kind: "branch" as const, label: "main", detail: root, headRevision: "r11", selection: { kind: "branch" as const, repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined };
  const dependencies = (folderStoppedStore: NodeFolderUnderstandingStoppedStore) => ({
    globalStoragePath: root,
    storageUris: { globalStorageUri: { fsPath: root }, storageUri: { fsPath: root } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(),
    folderStoppedStore,
    yieldControl: () => undefined
  });
  const corrupt = createT305GlobalUnderstandingSource(dependencies(new NodeFolderUnderstandingStoppedStore(root, {
    atomicFileStore: { readText: async () => "{corrupt", writeTextAtomically: async () => undefined }
  })));
  corrupt.setContext(context);
  await assert.rejects(() => corrupt.recalculate(), /stopped-marker load failed/u);
  for (const code of ["ENOSPC", "EACCES"] as const) {
    const source = createT305GlobalUnderstandingSource(dependencies(new NodeFolderUnderstandingStoppedStore(root, {
      atomicFileStore: {
        readText: async () => undefined,
        writeTextAtomically: async () => { throw Object.assign(new Error(`raw ${code} C:\\private\\marker.tmp`), { code }); }
      }
    })));
    source.setContext(context);
    await assert.rejects(() => source.stopFolder("src"), /stopped-marker save failed/u, `${code} remains generic at the exported composition boundary`);
  }
});

test("T610-R15 routes the actual production document-open lifecycle through shared redacted Output and generic UI", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t610-raw-open-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output: string[] = [];
  setActiveOperationFeedback(new OperationFeedback({
    showBusy: () => undefined, clearBusy: () => undefined, revealLog: () => undefined,
    appendLog: (entry) => { output.push(`${entry.event}:${entry.message ?? ""}`); }
  }));
  try {
    const source = createT305GlobalUnderstandingSource({
      globalStoragePath: path.join(root, "storage"),
      storageUris: { globalStorageUri: { fsPath: path.join(root, "storage") }, storageUri: { fsPath: root } },
      exclusionPolicy: new ReviewFileExclusionPolicyService(), readAutoStartDescendants: () => true,
      yieldControl: () => { throw Object.assign(new Error("C:\\private\\secret.ts EACCES"), { code: "EACCES" }); }
    });
    source.setContext({ context: { kind: "branch", label: "main", detail: root, headRevision: "r11", selection: { kind: "branch", repositoryId: "repo", repositoryRoot: root, branchRef: "refs/heads/main" } }, progress: undefined });
    const messages: string[] = [];
    const outcome = await observeGlobalUnderstandingDocumentOpen({
      observe: () => source.observeFileOpen(path.join(root, "src", "a.ts")),
      requestRefresh: () => assert.fail("a failed open must not schedule the normal refresh"),
      refreshAfterFailure: async () => undefined,
      showGenericError: (message) => { messages.push(message); }
    });
    assert.equal(outcome, "error");
    assert.deepEqual(messages, ["Global Understanding folderを開始できませんでした。詳細は Review Range Output を確認してください。"]);
    assert.ok(output.some((line) => line.includes("details were redacted")), "the shared Output records a redacted terminal");
    assert.equal(output.join("\n").includes("secret.ts"), false);
    const extension = await readFile(path.join(path.resolve(__dirname, "../../.."), "src", "t305-extension.ts"), "utf8");
    assert.match(extension, /const observeRegisteredGlobalUnderstandingDocument =/u);
    assert.match(extension, /onDidOpenTextDocument\(\(document\) => \{\s*void observeRegisteredGlobalUnderstandingDocument\(document, true\);/u, "the actual registered listener uses the shared activated failure handler");
    assert.match(extension, /runInjectedGlobalUnderstandingDocumentOpenForTest:[\s\S]*await observeRegisteredGlobalUnderstandingDocument\(document, false\);/u, "the deterministic Test seam awaits that same activated handler");
    assert.match(extension, /void vscode\.window\.showErrorMessage\(message\);/u, "the background listener never waits for notification dismissal");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T610-NR-006 watcher admission is selected-owner, active-scope, and filesystem-only", () => {
  assert.equal(shouldRefreshGlobalUnderstandingFolderEntry("file", "C:\\repo\\src\\a.ts", () => true), true);
  assert.equal(shouldRefreshGlobalUnderstandingFolderEntry("vscode-remote", "/repo/src/a.ts", () => true), true);
  assert.equal(shouldRefreshGlobalUnderstandingFolderEntry("untitled", "/repo/src/a.ts", () => true), false);
  assert.equal(shouldRefreshGlobalUnderstandingFolderEntry("file", "C:\\foreign\\a.ts", () => false), false);
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

test("T610-R10 resolves each public folder command only for its current expected action", async () => {
  setActiveOperationFeedback(undefined);
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  let provider: { getChildren(node?: unknown): readonly { readonly kind: string }[] } | undefined;
  let selectTreeNode: ((node: unknown) => void) | undefined;
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } }, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }), createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }), createTreeView: (_id: string, options: { treeDataProvider: typeof provider }) => {
      provider = options.treeDataProvider;
      let selectionListener: ((event: { readonly selection: readonly unknown[] }) => void) | undefined;
      selectTreeNode = (node) => selectionListener?.({ selection: [node] });
      return { onDidChangeSelection: (listener: typeof selectionListener) => { selectionListener = listener; return disposable; }, reveal: async (node: unknown) => { selectTreeNode?.(node); }, dispose(): void {} };
    } },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return disposable; } }, workspace: { onDidChangeConfiguration: () => disposable }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  let state: "inactive" | "active" | "stopped" = "inactive";
  const calls: string[] = []; const errors: string[] = [];
  const editorResource = { authority: "owner", path: "/repo/src/a.ts" };
  const foreignResource = { authority: "foreign", path: "/repo/src/a.ts" };
  const snapshot = () => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, folders: [{ path: "src", state, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: state !== "active" }] });
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: { recalculate: async () => snapshot(), startFolder: async () => { calls.push("start"); state = "active"; }, stopFolder: async () => { calls.push("stop"); state = "stopped"; }, resumeFolder: async () => { calls.push("resume"); state = "active"; } },
    resolveFolderPathForResource: (resource) => resource === editorResource ? "src" : undefined,
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined, openFile: async () => undefined, reportError: async (error) => { errors.push(String(error)); }
  });
  await registered.refresh();
  const startNode = provider!.getChildren().find((node) => node.kind === "folder")!;
  await commands.get(runtime.START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!();
  assert.deepEqual(calls, [], "an unselected Palette command never guesses from globally unique actions");
  selectTreeNode!(startNode);
  await commands.get(runtime.START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!();
  assert.deepEqual(calls, ["start"], "a Palette command resolves only the selected current Tree row");
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(startNode);
  assert.deepEqual(calls, ["start"], "a stale or state-mismatched Tree target never reaches another action");
  const stopNode = provider!.getChildren().find((node) => node.kind === "folder")!;
  selectTreeNode!(stopNode);
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!();
  const resumeNode = provider!.getChildren().find((node) => node.kind === "folder")!;
  selectTreeNode!(resumeNode);
  await commands.get(runtime.RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!();
  assert.deepEqual(calls, ["start", "stop", "resume"], "no-argument stop and resume resolve only their matching current states");
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(editorResource);
  assert.deepEqual(calls, ["start", "stop", "resume", "stop"], "an editor resource resolves through its selected owner to the current active row");
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(foreignResource);
  assert.deepEqual(calls, ["start", "stop", "resume", "stop"], "a foreign editor resource never reaches the selected owner");
  assert.ok(errors.some((error) => error.includes("Review Range Output")), "state mismatch uses the shared feedback boundary");
  registered.dispose(); setActiveOperationFeedback(undefined);
});

test("T610-NR-005 supplies the actual Tree parent contract required for selection reveal", async () => {
  const root = path.resolve(__dirname, "../../..");
  const runtime = await readFile(path.join(root, "src", "ui", "global-understanding", "vscode-global-understanding-runtime.ts"), "utf8");
  assert.match(runtime, /public getParent\(node: GlobalUnderstandingViewNode\)/u);
  assert.match(runtime, /this\.model\?\.folders\?\.find\(\(candidate\) => candidate\.path === parent\)/u);
  assert.match(runtime, /treeView\.reveal\(node, \{ select: true, focus: false \}\)/u);
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
  const editorResource = { path: "/repo/src/a.ts" };
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: { recalculate: async () => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, folders: [{ path: "src", state: "active" as const, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: false }] }), stopFolder: async () => { throw Object.assign(new Error("C:\\private\\marker.json ENOSPC"), { code: "ENOSPC" }); } },
    resolveFolderPathForResource: (resource) => resource === editorResource ? "src" : undefined,
    readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined, openFile: async () => undefined, reportError: async (error) => { errors.push(String(error)); }
  });
  await registered.refresh();
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(editorResource);
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
  const preactivationOpen = suite.indexOf("const preactivationDocument =");
  const activationCall = suite.indexOf("const api = await extension.activate()");
  assert.ok(preactivationOpen >= 0 && preactivationOpen < activationCall, "the Host opens an actual document before explicit activation so startup-open composition is exercised");
  assert.ok(activationCall < contextRefresh && contextRefresh < startupDrain, "the Host public refresh cancels startup selection before its drain");
  assert.match(suite, /const closeDocument = async/u, "the T610 Host owns an explicit document-close lifecycle");
  assert.match(suite, /onDidCloseTextDocument/u, "the T610 close lifecycle observes and disposes its own close listener");
  assert.match(suite, /finally \{\s*await api\.recordT610HostSubphaseForTest\("before-document-close"\);\s*await closeDocument\(document\);/u, "the T610 fixture records then closes the document even when a Host assertion fails");
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

test("T610-R10 combined missing-cell contract: presentation hierarchy, startup helper, editor actions, and watcher containment", async (t) => {
  const root = path.resolve(__dirname, "../../..");
  const hostSuite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { contributes: { menus: { "editor/context": Array<{ command: string; when: string }> } } };
  const editorActions = manifest.contributes.menus["editor/context"].filter((item) => item.command.includes("GlobalUnderstandingFolder"));
  assert.equal(editorActions.length, 3, "all three state-specific folder actions are available from the editor context");
  assert.match(hostSuite, /getGlobalUnderstandingPresentationForTest/u);
  assert.match(hostSuite, /third-level folder hierarchy/u);
  assert.match(hostSuite, /Status Bar never exposes a percentage/u);

  const startup = await import("../../src/t305-global-understanding-startup.js");
  const observed: string[] = [];
  let refreshed = 0;
  await startup.observeStartupGlobalUnderstandingDocuments(
    [{ isClosed: false, uri: { scheme: "file" }, id: "open" }, { isClosed: true, uri: { scheme: "file" }, id: "closed" }, { isClosed: false, uri: { scheme: "untitled" }, id: "foreign" }],
    async (document) => { observed.push(document.id); },
    async () => { refreshed += 1; }
  );
  assert.deepEqual(observed, ["open"]);
  assert.equal(refreshed, 1);

  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "review-range-t610-r10-watcher-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(path.join(repositoryRoot, "src", "a.ts"), "x\n", "utf8");
  const source = createT305GlobalUnderstandingSource({
    globalStoragePath: path.join(repositoryRoot, "storage"), storageUris: { globalStorageUri: { fsPath: path.join(repositoryRoot, "storage") }, storageUri: { fsPath: path.join(repositoryRoot, "workspace") } },
    exclusionPolicy: new ReviewFileExclusionPolicyService(), readAutoStartDescendants: () => false, yieldControl: () => undefined
  });
  source.setContext({ context: { kind: "branch", label: "main", detail: repositoryRoot, headRevision: "r10", selection: { kind: "branch", repositoryId: "repo", repositoryRoot, branchRef: "refs/heads/main" } }, progress: undefined });
  await source.observeFileOpen(path.join(repositoryRoot, "src", "a.ts"));
  assert.equal(source.isActiveFolderEntry(path.join(repositoryRoot, "src", "changed.ts")), true);
  assert.equal(source.isActiveFolderEntry(path.join(repositoryRoot, "outside.ts")), false, "an inactive root sibling must not refresh an active child scope");
  assert.equal(source.isActiveFolderEntry(path.join(repositoryRoot, "..", "foreign", "a.ts")), false, "a foreign root never reaches the selected owner");
});

test("T610-R12 persists before-and-after Host subphases around each R11 actual-composition operation", async () => {
  const root = path.resolve(__dirname, "../../..");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  for (const operation of [
    "second-root-open-owner-observation",
    "tree-node-acquisition",
    "public-start",
    "mismatch-feedback-drain",
    "public-stop",
    "public-resume",
    "hierarchy-status-probe",
    "real-watcher-event",
    "document-close"
  ]) {
    const before = `before-${operation}`;
    const after = `after-${operation}`;
    const beforeIndex = suite.indexOf(`recordT610HostSubphaseForTest("${before}")`);
    const afterIndex = suite.indexOf(`recordT610HostSubphaseForTest("${after}")`);
    assert.ok(beforeIndex >= 0, `the Host persists ${before} before its actual operation`);
    assert.ok(afterIndex > beforeIndex, `the Host persists ${after} after ${operation}`);
  }
  assert.doesNotMatch(suite, /const recordSubphase/gu, "R12 calls the persisted Test API directly instead of hiding operation boundaries in a local wrapper");
});

test("T610-R13 registers startup Global work outside activation and exposes its Test drain", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  const startup = await import("../../src/t305-global-understanding-startup.js");
  let releaseObservation: (() => void) | undefined;
  const observationGate = new Promise<void>((resolve) => { releaseObservation = resolve; });
  const observed: string[] = [];
  let refreshed = 0;
  const pending = startup.observeStartupGlobalUnderstandingDocuments(
    [{ isClosed: false, uri: { scheme: "file" }, id: "open" }],
    async (document) => { observed.push(document.id); await observationGate; },
    async () => { refreshed += 1; }
  );
  assert.deepEqual(observed, ["open"], "startup work is registered immediately without waiting for its calculation");
  assert.equal(refreshed, 0, "the refresh remains pending while startup observation is still running");
  releaseObservation!();
  await pending;
  assert.equal(refreshed, 1, "the queued startup calculation still refreshes once after observation settles");

  assert.doesNotMatch(activation, /await observeStartupGlobalUnderstandingDocuments/gu, "activation never awaits the long startup Global calculation");
  assert.match(activation, /drainStartupGlobalUnderstandingForTest:/u, "Test mode exposes the registered startup work as an explicit drain");
  const activationDrain = suite.indexOf("await api.drainStartupGlobalUnderstandingForTest();");
  const firstMarker = suite.indexOf('recordT610HostSubphaseForTest("context-ready")');
  assert.ok(activationDrain >= 0 && activationDrain < firstMarker, "the Host drains startup Global work before its first marker or assertion");
});

test("T610-R14 settles Current Context startup before queuing non-blocking startup Global work", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  const currentContextRuntime = activation.indexOf("const currentContextRuntime = registerCurrentContextRuntime(");
  const queuedGlobalStartup = activation.indexOf("const startupGlobalUnderstanding = currentContextRuntime.startupRefresh.then(");
  assert.ok(currentContextRuntime >= 0 && queuedGlobalStartup > currentContextRuntime, "startup Global work is registered only after the production Current Context startup owner exists");
  assert.match(
    activation,
    /currentContextRuntime\.startupRefresh\.then\(\(\) =>\s*observeStartupGlobalUnderstandingDocuments/u,
    "startup Global observation waits for Current Context startup settlement"
  );
  assert.doesNotMatch(activation, /await currentContextRuntime\.startupRefresh/gu, "activation never waits for Current Context or startup Global completion");
  const currentContextDrain = suite.indexOf("await api.drainCurrentContextStartupForTest();");
  const globalStartupDrain = suite.indexOf("await api.drainStartupGlobalUnderstandingForTest();");
  const firstMarker = suite.indexOf('recordT610HostSubphaseForTest("context-ready")');
  assert.ok(
    currentContextDrain >= 0 && currentContextDrain < globalStartupDrain && globalStartupDrain < firstMarker,
    "the Host settles Current Context before draining its dependent startup Global work"
  );
});

test("T610-R15 publishes Test APIs without waiting for persistence migration while production still awaits it", async () => {
  const root = path.resolve(__dirname, "../../..");
  const activation = await readFile(path.join(root, "src", "t305-extension.ts"), "utf8");
  const suite = await readFile(path.join(root, "test", "vscode", "t610-suite", "index.ts"), "utf8");
  assert.match(activation, /const persistenceStartup = composeStartupFeedback/u);
  assert.match(activation, /extensionMode === vscode\.ExtensionMode\.Test[\s\S]*?void persistenceStartup\.catch[\s\S]*?else \{\s*await persistenceStartup;/u);
  const activationCall = suite.indexOf("const api = await extension.activate()");
  const activationMarker = suite.indexOf('recordT610HostSubphaseForTest("activation-returned")');
  const currentContextDrain = suite.indexOf("await api.drainCurrentContextStartupForTest();");
  assert.ok(activationCall >= 0 && activationCall < activationMarker && activationMarker < currentContextDrain);
  assert.ok(
    activation.indexOf("vscode.workspace.onDidOpenTextDocument") < activation.indexOf("const startupGlobalUnderstanding ="),
    "the production listener is registered before startup textDocuments are snapshotted"
  );
  assert.match(
    activation,
    /const observeRegisteredGlobalUnderstandingDocument[\s\S]*?observeGlobalUnderstandingDocumentOpen/u,
    "the shared registered-document helper owns the production lifecycle operation",
  );
  assert.match(
    activation,
    /vscode\.window\.onDidChangeActiveTextEditor[\s\S]*?observeRegisteredGlobalUnderstandingDocument/u,
    "active-editor events route through the same registered-document helper",
  );
  assert.match(activation, /drainNextGlobalUnderstandingDocumentObservationForTest:/u);
  assert.match(suite, /getGlobalUnderstandingDocumentObservationCountForTest[\s\S]*?showTextDocument[\s\S]*?drainNextGlobalUnderstandingDocumentObservationForTest/u);
  assert.match(activation, /reportError: \(error\) => \{[\s\S]*?void vscode\.window\.showErrorMessage\(message\);/u);
});

test("T610 preserves T506 restart coverage by draining the registered file-open lifecycle", async () => {
  const root = path.resolve(__dirname, "../../..");
  const suite = await readFile(path.join(root, "test", "vscode", "t506-suite", "index.ts"), "utf8");
  const start = suite.indexOf("const assertMappedNormalEditorAfterRestart");
  const end = suite.indexOf("/** Exercises T506 multiple-context", start);
  assert.ok(start >= 0 && end > start);
  const restart = suite.slice(start, end);
  assert.match(
    restart,
    /openNormalReviewEditor\(workspaceFolder\)[\s\S]*?drainGlobalUnderstandingFileOpenForTest\(\)[\s\S]*?assertMappedGlobalUnderstanding\(api\)/u,
    "T506 waits for T610's registered file-open lifecycle before reading the folder-scoped snapshot",
  );
});

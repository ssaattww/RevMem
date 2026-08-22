import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FolderUnderstandingScopeController
} from "../../src/application/global-understanding/folder-understanding-scope-controller";
import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/review-file-exclusion-policy-service";
import { createT305GlobalUnderstandingSource } from "../../src/t305-global-understanding-composition";

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
  assert.deepEqual(direct?.folders?.map((folder) => folder.path), ["src"]);

  autoStartDescendants = true;
  const afterFalseToTrue = await source.recalculate();
  assert.deepEqual(afterFalseToTrue?.folders?.map((folder) => folder.path), ["src"], "a setting transition does not start existing descendants");
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

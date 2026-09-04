import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY,
  PrProgressDiffReviewContextController,
  type PrProgressDiffReviewContextHost
} from "../../src/ui/pr-progress/pr-progress-diff-review-context";

interface FakeTab {
  readonly id: string;
  readonly kind: "diff" | "text";
}

class FakeHost implements PrProgressDiffReviewContextHost<FakeTab> {
  public activeTab: FakeTab | undefined;
  public readonly contextUpdates: Array<{ readonly key: string; readonly value: boolean }> = [];

  public getActiveTab(): FakeTab | undefined {
    return this.activeTab;
  }

  public isDiffTab(tab: FakeTab): boolean {
    return tab.kind === "diff";
  }

  public async setContext(key: string, value: boolean): Promise<void> {
    this.contextUpdates.push({ key, value });
  }
}

test("PR Progress diff review context is enabled only for the exact diff tab recorded by PR Progress", async () => {
  const host = new FakeHost();
  const controller = new PrProgressDiffReviewContextController(host);
  const unrelatedDiff: FakeTab = { id: "src/example.ts", kind: "diff" };
  const prProgressDiff: FakeTab = { id: "src/example.ts", kind: "diff" };

  host.activeTab = unrelatedDiff;
  await controller.refresh();
  assert.deepEqual(host.contextUpdates.at(-1), {
    key: PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY,
    value: false
  });

  host.activeTab = prProgressDiff;
  assert.equal(await controller.recordActiveDiff(), true);
  assert.deepEqual(host.contextUpdates.at(-1), {
    key: PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY,
    value: true
  });

  host.activeTab = unrelatedDiff;
  await controller.refresh();
  assert.equal(host.contextUpdates.at(-1)?.value, false);

  host.activeTab = prProgressDiff;
  await controller.refresh();
  assert.equal(host.contextUpdates.at(-1)?.value, true);
});

test("matching diff metadata does not grant PR Progress provenance to a different tab instance", async () => {
  const host = new FakeHost();
  const controller = new PrProgressDiffReviewContextController(host);
  const openedByPrProgress: FakeTab = { id: "same-resource", kind: "diff" };
  const independentlyOpened: FakeTab = { id: "same-resource", kind: "diff" };

  host.activeTab = openedByPrProgress;
  assert.equal(await controller.recordActiveDiff(), true);

  host.activeTab = independentlyOpened;
  await controller.refresh();
  assert.equal(host.contextUpdates.at(-1)?.value, false);
});

test("non-diff tabs cannot be recorded as PR Progress diff review contexts", async () => {
  const host = new FakeHost();
  const controller = new PrProgressDiffReviewContextController(host);
  host.activeTab = { id: "src/example.ts", kind: "text" };

  assert.equal(await controller.recordActiveDiff(), false);
  assert.deepEqual(host.contextUpdates.at(-1), {
    key: PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY,
    value: false
  });
});

test("editor context menu reuses whole-file review commands only inside the PR Progress diff context", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes?: { menus?: { "editor/context"?: Array<{ command?: string; when?: string }> } };
  };
  const items = manifest.contributes?.menus?.["editor/context"] ?? [];
  const findScoped = (command: string) => items.find((item) =>
    item.command === command
    && item.when?.includes(PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY)
    && item.when.includes("isInDiffEditor")
  );

  assert.ok(findScoped("reviewRange.markFileReviewed"));
  assert.ok(findScoped("reviewRange.unmarkFileReviewed"));
});

test("VS Code PR Progress selection records provenance only after a diff was actually opened", async () => {
  const source = await readFile("src/ui/pr-progress/vscode-pull-request-progress-tree.ts", "utf8");

  assert.match(source, /PrProgressDiffReviewContextController/);
  assert.match(source, /const result = await source\.select\(node\)/);
  assert.match(source, /result\.kind === "opened-diff"/);
  assert.match(source, /recordActiveDiff\(\)/);
  assert.match(source, /onDidChangeActiveTextEditor/);
});

test("PR Progress contributes a right-click command that opens the current working-tree file", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    activationEvents?: string[];
    contributes?: {
      commands?: Array<{ command?: string; title?: string; category?: string }>;
      menus?: { "view/item/context"?: Array<{ command?: string; when?: string; group?: string }> };
    };
  };
  const commandId = "reviewRange.openPrProgressWorkingTreeFile";

  assert.ok(manifest.activationEvents?.includes(`onCommand:${commandId}`));
  assert.deepEqual(
    manifest.contributes?.commands?.find((command) => command.command === commandId),
    {
      command: commandId,
      title: "実際のファイルを開く",
      category: "Review Range"
    }
  );
  const menuItem = manifest.contributes?.menus?.["view/item/context"]?.find(
    (item) => item.command === commandId
  );
  assert.ok(menuItem);
  assert.match(menuItem.when ?? "", /view == reviewRange\.prProgress/);
  assert.match(menuItem.when ?? "", /viewItem == reviewRange\.prProgressFile/);
  assert.ok(!(menuItem.group ?? "").startsWith("inline"));

  const source = await readFile("src/ui/pr-progress/vscode-pull-request-progress-tree.ts", "utf8");
  assert.match(source, /OPEN_PULL_REQUEST_PROGRESS_WORKING_TREE_FILE_COMMAND_ID/);
  assert.match(source, /source\.openWorkingTreeFile\(node\)/);
});

test("PR Progress source and refresh ownership is scoped to each activated runtime", async () => {
  const treeSource = await readFile("src/ui/pr-progress/vscode-pull-request-progress-tree.ts", "utf8");
  const baseSource = await readFile("src/extension.ts", "utf8");
  const activationSource = await readFile("src/t305-extension.ts", "utf8");

  assert.doesNotMatch(treeSource, /\blet activeRuntime\b/);
  assert.doesNotMatch(treeSource, /activeRuntime\?\./);
  assert.match(baseSource, /setPullRequestProgressSource\(/);
  assert.match(baseSource, /refreshPullRequestProgressTree\(/);
  assert.match(activationSource, /runtimePort\.setPullRequestProgressSource\(/);
  assert.match(activationSource, /runtimePort\.refreshPullRequestProgressTree\(/);
});

test("an applied PR diff review refreshes reviewed decorations and owning progress before returning", async () => {
  const runtimeSource = await readFile("src/t405-pull-request-review-runtime.ts", "utf8");
  const treeSource = await readFile("src/ui/pr-progress/vscode-pull-request-progress-tree.ts", "utf8");

  assert.match(runtimeSource, /synchronizeAppliedPullRequestReview/);
  assert.match(runtimeSource, /\(\) => this\.refreshActiveProgress\(\)/);
  assert.match(runtimeSource, /\(\) => this\.projectionNotifier\.notify\(\)/);
  assert.match(runtimeSource, /loadReviewedDecorations\(uri: string\)/);
  assert.match(treeSource, /onDidChangeReviewProjection/);
  assert.match(treeSource, /loadReviewedDecorations/);
  assert.match(treeSource, /refreshPullRequestProgressTree\(\)/);
});

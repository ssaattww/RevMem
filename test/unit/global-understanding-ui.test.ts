import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createGlobalUnderstandingTreeModel,
  formatGlobalUnderstandingStatusBar,
  GlobalLayerToggleController,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";
import {
  resolveConfiguredNonGitSnapshotLimits
} from "../../src/application/non-git-snapshots/non-git-snapshot-settings";

const snapshot = (): GlobalUnderstandingTreeSnapshot => ({
  progress: {
    reviewedNonEmptyLineCount: 3,
    totalNonEmptyLineCount: 8,
    progress: 3 / 8,
    files: [
      {
        path: "src/b.ts",
        state: "current",
        reviewedNonEmptyLineCount: 3,
        totalNonEmptyLineCount: 4,
        progress: 3 / 4
      },
      {
        path: "src/a.ts",
        state: "missing",
        reviewedNonEmptyLineCount: 0,
        totalNonEmptyLineCount: 4,
        progress: 0
      }
    ]
  },
  excludedFileCount: 2,
  prunedExcludedDirectoryCount: 3
});

test("Global Understanding model keeps repository, file, and exclusion diagnostics separate", () => {
  const model = createGlobalUnderstandingTreeModel(snapshot());

  assert.deepEqual(model.summary, {
    kind: "summary",
    label: "リポジトリ全体",
    description: "38% (3/8)",
    reviewedNonEmptyLineCount: 3,
    totalNonEmptyLineCount: 8,
    progress: 3 / 8
  });
  assert.deepEqual(model.files.map((file) => ({
    path: file.path,
    description: file.description,
    state: file.state
  })), [
    { path: "src/a.ts", description: "0% (0/4)", state: "missing" },
    { path: "src/b.ts", description: "75% (3/4)", state: "current" }
  ]);
  assert.deepEqual(model.diagnostics, {
    kind: "diagnostics",
    label: "除外診断",
    excludedFileCount: 2,
    prunedExcludedDirectoryCount: 3
  });
});

test("Status Bar text co-displays Global progress without merging pruned directories into excluded files", () => {
  assert.deepEqual(formatGlobalUnderstandingStatusBar(snapshot()), {
    text: "$(book) Global: 38% (3/8)",
    tooltip: [
      "Global理解率: 38%",
      "確認済み非空行: 3",
      "対象非空行: 8",
      "除外ファイル: 2",
      "pruneした除外ディレクトリ: 3"
    ].join("\n")
  });
});

test("Global layer toggle persists the setting before refreshing decoration and Global UI", async () => {
  const events: string[] = [];
  let enabled = false;
  const controller = new GlobalLayerToggleController({
    readEnabled: () => enabled,
    writeEnabled: async (next) => {
      events.push(`write:${next}`);
      enabled = next;
    },
    refreshDecorations: async () => {
      events.push("refresh:decorations");
    },
    refreshGlobalUnderstanding: async () => {
      events.push("refresh:global");
    }
  });

  assert.equal(await controller.toggle(), true);
  assert.deepEqual(events, [
    "write:true",
    "refresh:decorations",
    "refresh:global"
  ]);
});

test("Global layer toggle does not refresh dependents when persistence fails", async () => {
  const events: string[] = [];
  const controller = new GlobalLayerToggleController({
    readEnabled: () => true,
    writeEnabled: async () => {
      events.push("write");
      throw new Error("settings write failed");
    },
    refreshDecorations: async () => {
      events.push("refresh:decorations");
    },
    refreshGlobalUnderstanding: async () => {
      events.push("refresh:global");
    }
  });

  await assert.rejects(() => controller.toggle(), /settings write failed/u);
  assert.deepEqual(events, ["write"]);
});

test("snapshot file-size setting is converted to the NonGitSnapshotTracker contract", () => {
  assert.deepEqual(resolveConfiguredNonGitSnapshotLimits({
    maxSnapshotFileSizeBytes: 10 * 1024 * 1024
  }), {
    maxSnapshots: 128,
    maxCompressedBytes: 10 * 1024 * 1024,
    retentionMs: 30 * 24 * 60 * 60 * 1_000
  });

  assert.throws(
    () => resolveConfiguredNonGitSnapshotLimits({
      maxSnapshotFileSizeBytes: 0
    }),
    /maxSnapshotFileSizeBytes/u
  );
});

test("manifest contributes T505 commands and the designed snapshot limit setting", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: { command: string }[];
      configuration: { properties: Record<string, { default?: unknown }> };
      menus: { "view/title"?: { command: string; when?: string }[] };
    };
    scripts: Record<string, string>;
  };
  const commands = manifest.contributes.commands.map(({ command }) => command);

  assert.equal(commands.includes("reviewRange.refreshGlobalUnderstanding"), true);
  assert.equal(commands.includes("reviewRange.toggleGlobalLayer"), true);
  assert.equal(
    manifest.activationEvents.includes("onView:reviewRange.globalUnderstanding"),
    true
  );
  assert.equal(
    manifest.contributes.configuration.properties[
      "reviewRange.maxSnapshotFileSizeBytes"
    ]?.default,
    5 * 1024 * 1024
  );
  assert.equal(
    manifest.scripts["test:t505"].includes("global-understanding-ui.test.js"),
    true
  );
});

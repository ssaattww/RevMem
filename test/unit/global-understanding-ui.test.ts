import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createGlobalUnderstandingTreeModel,
  formatGlobalUnderstandingStatusBar,
  GlobalLayerToggleController,
  GlobalUnderstandingRefreshCoalescer,
  GlobalUnderstandingRefreshController,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";
import {
  DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
  resolveConfiguredNonGitSnapshotLimits
} from "../../src/application/non-git-snapshots/non-git-snapshot-settings";

const snapshot = (): GlobalUnderstandingTreeSnapshot => ({
  progress: {
    reviewedNonEmptyLineCount: 3,
    totalNonEmptyLineCount: 8,
    progress: 3 / 8,
    files: [
      { path: "src/b.ts", state: "current", reviewedNonEmptyLineCount: 3, totalNonEmptyLineCount: 4, progress: 3 / 4 },
      { path: "src/a.ts", state: "missing", reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 4, progress: 0 }
    ]
  },
  excludedFileCount: 2,
  prunedExcludedDirectoryCount: 3
});

test("Global Understanding model keeps repository, file, and exclusion diagnostics separate", () => {
  const model = createGlobalUnderstandingTreeModel(snapshot());
  assert.deepEqual(model.summary, {
    kind: "summary", label: "リポジトリ全体", description: "38% (3/8)",
    reviewedNonEmptyLineCount: 3, totalNonEmptyLineCount: 8, progress: 3 / 8
  });
  assert.deepEqual(model.files.map((file) => ({ path: file.path, description: file.description, state: file.state })), [
    { path: "src/a.ts", description: "0% (0/4)", state: "missing" },
    { path: "src/b.ts", description: "75% (3/4)", state: "current" }
  ]);
  assert.deepEqual(model.diagnostics, {
    kind: "diagnostics", label: "除外診断", excludedFileCount: 2, prunedExcludedDirectoryCount: 3
  });
});

test("Status Bar text co-displays Global progress without merging pruned directories into excluded files", () => {
  assert.deepEqual(formatGlobalUnderstandingStatusBar(snapshot()), {
    text: "$(book) Global: 38% (3/8)",
    tooltip: ["Global理解率: 38%", "確認済み非空行: 3", "対象非空行: 8", "除外ファイル: 2", "pruneした除外ディレクトリ: 3"].join("\n")
  });
});

test("Global layer toggle persists the setting before refreshing decoration and Global UI", async () => {
  const events: string[] = [];
  let enabled = false;
  const controller = new GlobalLayerToggleController({
    readEnabled: () => enabled,
    writeEnabled: async (next) => { events.push(`write:${next}`); enabled = next; },
    refreshDecorations: async () => { events.push("refresh:decorations"); },
    refreshGlobalUnderstanding: async () => { events.push("refresh:global"); }
  });
  assert.equal(await controller.toggle(), true);
  assert.deepEqual(events, ["write:true", "refresh:decorations", "refresh:global"]);
});

test("Global layer toggle does not refresh dependents when persistence fails", async () => {
  const events: string[] = [];
  const controller = new GlobalLayerToggleController({
    readEnabled: () => true,
    writeEnabled: async () => { events.push("write"); throw new Error("settings write failed"); },
    refreshDecorations: async () => { events.push("refresh:decorations"); },
    refreshGlobalUnderstanding: async () => { events.push("refresh:global"); }
  });
  await assert.rejects(() => controller.toggle(), /settings write failed/u);
  assert.deepEqual(events, ["write"]);
});

test("Global refresh clears stale presentation when the current recalculation fails", async () => {
  const events: string[] = [];
  const controller = new GlobalUnderstandingRefreshController(
    { recalculate: async () => { throw new Error("recalculation failed"); } },
    { show: () => events.push("show"), clear: () => events.push("clear") }
  );
  await assert.rejects(() => controller.refresh(), /recalculation failed/u);
  assert.deepEqual(events, ["clear"]);
});

test("T505-R005 an older failed recalculation is absorbed after a newer Global snapshot is published", async () => {
  let rejectFirst: ((reason: Error) => void) | undefined;
  let resolveSecond: ((value: GlobalUnderstandingTreeSnapshot) => void) | undefined;
  let invocation = 0;
  const events: string[] = [];
  const controller = new GlobalUnderstandingRefreshController(
    { recalculate: () => ++invocation === 1
      ? new Promise((_, reject) => { rejectFirst = reject; })
      : new Promise((resolve) => { resolveSecond = resolve; }) },
    { show: (value) => events.push(`show:${value.progress.reviewedNonEmptyLineCount}`), clear: () => events.push("clear") }
  );
  const first = controller.refresh();
  const second = controller.refresh();
  resolveSecond?.(snapshot());
  await second;
  rejectFirst?.(new Error("older failed"));
  assert.equal(await first, undefined);
  assert.deepEqual(events, ["show:3"]);
});

test("T505-R005 rapid document changes invalidate work, cancel the pending timer, and run one latest refresh", () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const events: string[] = [];
  let nextHandle = 0;
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => { events.push("invalidate"); },
    schedule: (callback, delayMs) => {
      events.push(`schedule:${delayMs}`);
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      const numeric = handle as number;
      cancelled.push(numeric);
      callbacks.delete(numeric);
    },
    run: () => { events.push("refresh"); }
  }, 150);
  coalescer.request();
  coalescer.request();
  assert.deepEqual(cancelled, [1]);
  assert.equal(callbacks.has(1), false);
  callbacks.get(2)?.();
  assert.deepEqual(events, ["invalidate", "schedule:150", "invalidate", "schedule:150", "refresh"]);
  coalescer.dispose();
});

test("snapshot file-size setting is converted to an independent per-snapshot limit", () => {
  assert.deepEqual(resolveConfiguredNonGitSnapshotLimits({ maxSnapshotFileSizeBytes: 10 * 1024 * 1024 }), {
    maxSnapshots: 128,
    maxSnapshotCompressedBytes: 10 * 1024 * 1024,
    maxTotalCompressedBytes: DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
    retentionMs: 30 * 24 * 60 * 60 * 1_000
  });
  assert.deepEqual(resolveConfiguredNonGitSnapshotLimits({ maxSnapshotFileSizeBytes: 0 }), {
    maxSnapshots: 128,
    maxSnapshotCompressedBytes: DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
    maxTotalCompressedBytes: DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES,
    retentionMs: 30 * 24 * 60 * 60 * 1_000
  });
});

test("manifest contributes T505 commands and the designed snapshot limit setting", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    activationEvents: string[];
    contributes: { commands: { command: string }[]; configuration: { properties: Record<string, { default?: unknown }> }; menus: { "view/title"?: { command: string; when?: string }[] } };
    scripts: Record<string, string>;
  };
  const commands = manifest.contributes.commands.map(({ command }) => command);
  assert.equal(commands.includes("reviewRange.refreshGlobalUnderstanding"), true);
  assert.equal(commands.includes("reviewRange.toggleGlobalLayer"), true);
  assert.equal(manifest.activationEvents.includes("onView:reviewRange.globalUnderstanding"), true);
  assert.equal(manifest.contributes.configuration.properties["reviewRange.maxSnapshotFileSizeBytes"]?.default, 5 * 1024 * 1024);
  assert.equal(manifest.scripts["test:t505"].includes("global-understanding-ui.test.js"), true);
});

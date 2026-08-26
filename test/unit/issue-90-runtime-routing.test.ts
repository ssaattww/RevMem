import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import {
  OperationCancelledError,
  OperationFeedback,
  reportActiveOperationDetail,
  runWithActiveOperationFeedback,
  setActiveOperationFeedback,
  type OperationDiagnosticDetail,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import { PullRequestReviewRuntime, type PullRequestReviewRuntimeRepository } from "../../src/t405-pull-request-review-runtime.js";
import { GlobalUnderstandingRefreshCoalescer } from "../../src/ui/global-understanding/issue-90-global-refresh.js";

const runtimeRequire = createRequire(__filename);

const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode"
    ? vscode
    : Reflect.apply(original, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve(moduleName);
  delete runtimeRequire.cache[modulePath];
  const loaded = runtimeRequire(modulePath) as T;
  loader._load = original;
  return loaded;
};

class RuntimeDiagnosticHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public reveals = 0;
  public constructor(private readonly detailed: boolean) {}
  public isDetailedDiagnosticsEnabled(): boolean { return this.detailed; }
  public showBusy(): void {}
  public clearBusy(): void {}
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void { this.reveals += 1; }
}

test("NR90-001 production Global runtime routes manual, folder, toggle, and configuration triggers through the detail-aware coalescer", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  let configurationListener: ((event: { affectsConfiguration: (key: string) => boolean }) => void) | undefined;
  let provider: { getChildren(node?: unknown): readonly { readonly kind: string; readonly path?: string }[] } | undefined;
  const disposable = { dispose(): void {} };
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
    ThemeIcon: class { public constructor(...args: unknown[]) { void args; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }),
      createTreeView: (_id: string, options: { treeDataProvider: typeof provider }) => {
        provider = options.treeDataProvider;
        return { onDidChangeSelection: () => disposable, reveal: async () => undefined, dispose(): void {} };
      }
    },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return disposable; } },
    workspace: {
      onDidChangeConfiguration: (listener: typeof configurationListener) => { configurationListener = listener; return disposable; },
      getConfiguration: () => ({ get: () => true })
    }
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
  let state: "inactive" | "active" | "stopped" = "inactive";
  const detailRuns: OperationDiagnosticDetail[] = [];
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => undefined,
    schedule: () => 1,
    cancel: () => undefined,
    run: async (detail) => { detailRuns.push(detail!); await registered.refreshWithErrorBoundary(); }
  });
  const snapshot = () => ({
    progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] },
    excludedFileCount: 0,
    prunedExcludedDirectoryCount: 0,
    folders: [{ path: "src", state, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, partial: state !== "active" }]
  });
  const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
    source: {
      recalculate: async () => snapshot(),
      startFolder: async () => { state = "active"; },
      stopFolder: async () => { state = "stopped"; },
      resumeFolder: async () => { state = "active"; }
    },
    readGlobalLayerEnabled: () => false,
    writeGlobalLayerEnabled: async () => undefined,
    refreshDecorations: async () => undefined,
    openFile: async () => undefined,
    reportError: async () => undefined,
    requestGlobalRefresh: (detail) => coalescer.flush(detail)
  });

  await registered.refresh();
  await commands.get(runtime.REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID)!();
  await commands.get(runtime.START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(provider!.getChildren().find((node) => node.kind === "folder"));
  await commands.get(runtime.STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(provider!.getChildren().find((node) => node.kind === "folder"));
  await commands.get(runtime.RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID)!(provider!.getChildren().find((node) => node.kind === "folder"));
  await commands.get(runtime.TOGGLE_GLOBAL_LAYER_COMMAND_ID)!();
  configurationListener?.({ affectsConfiguration: (key) => key === "reviewRange.exclude" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(detailRuns, [
    { reason: "manual-refresh", phase: "global-refresh-trigger" },
    { reason: "folder-start", target: "src", phase: "global-refresh-trigger" },
    { reason: "folder-stop", target: "src", phase: "global-refresh-trigger" },
    { reason: "folder-resume", target: "src", phase: "global-refresh-trigger" },
    { reason: "global-layer-toggled", phase: "global-refresh-trigger" },
    { reason: "configuration-changed", phase: "global-refresh-trigger" }
  ]);
  registered.dispose();
  coalescer.dispose();
});

test("NR90-002 production Global runtime supersedes a different input without user error or stale publication", async () => {
  for (const detailed of [false, true]) {
    const host = new RuntimeDiagnosticHost(detailed);
    setActiveOperationFeedback(new OperationFeedback(host));
    const disposable = { dispose(): void {} };
    const vscode = {
      EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
      TreeItem: class { public description: unknown; public tooltip: unknown; public iconPath: unknown; public contextValue: unknown; public command: unknown; public constructor(...args: unknown[]) { void args; } },
      ThemeIcon: class { public constructor(...args: unknown[]) { void args; } },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, StatusBarAlignment: { Left: 1 },
      window: { createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }), createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }), registerTreeDataProvider: () => disposable },
      commands: { registerCommand: () => disposable }, workspace: { onDidChangeConfiguration: () => disposable }
    };
    const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>("../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode);
    let recalculateCalls = 0;
    const published: string[] = [];
    let firstStarted: (() => void) | undefined;
    const firstRunning = new Promise<void>((resolve) => { firstStarted = resolve; });
    const snapshot = (name: string) => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [{ path: name, state: "current" as const, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1 }] }, excludedFileCount: 0, prunedExcludedDirectoryCount: 0 });
    const coalescer = new GlobalUnderstandingRefreshCoalescer({
      invalidate: () => undefined,
      schedule: () => 1,
      cancel: () => undefined,
      run: async () => registered.refreshWithErrorBoundary()
    });
    const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
      source: {
        recalculate: async (signal) => {
          recalculateCalls += 1;
          if (recalculateCalls === 1) {
            firstStarted?.();
            await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
            return snapshot("stale.ts");
          }
          return snapshot("latest.ts");
        }
      },
      readGlobalLayerEnabled: () => false,
      writeGlobalLayerEnabled: async () => undefined,
      refreshDecorations: async () => undefined,
      openFile: async () => undefined,
      reportError: async () => { throw new Error("user-visible error must not be reported for supersession"); },
      onSnapshotPublishedForTest: (value) => published.push(value.progress.files[0]?.path ?? "unknown")
    });
    const old = coalescer.flush({ reason: "review-state-changed", target: "generation-old", phase: "global-refresh-trigger" });
    await firstRunning;
    const latest = coalescer.flush({ reason: "review-state-changed", target: "generation-latest", phase: "global-refresh-trigger" });
    await Promise.all([old, latest]);

    assert.deepEqual(published, ["latest.ts"], `detailed=${String(detailed)} publishes only the latest snapshot`);
    assert.equal(host.reveals, 0, `detailed=${String(detailed)} cancellation does not reveal Output`);
    assert.equal(host.logs.filter((entry) => entry.event === "cancelled").length, 1, `detailed=${String(detailed)} old generation terminates as CANCEL`);
    assert.equal(host.logs.filter((entry) => entry.event === "succeeded").length, 1, `detailed=${String(detailed)} latest generation terminates as OK`);
    registered.dispose();
    coalescer.dispose();
    setActiveOperationFeedback(undefined);
  }
});

test("NR90-004 real VS Code feedback host republishes tooltip detail while PullRequestReviewRuntime read remains pending", async () => {
  const status = { name: "", command: "", text: "", tooltip: undefined as unknown, shows: 0, show(): void { this.shows += 1; }, hide(): void {}, dispose(): void {} };
  const output: string[] = [];
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem: () => status, createOutputChannel: () => ({ appendLine: (line: string) => output.push(line), show(): void {}, dispose(): void {} }) },
    workspace: { getConfiguration: () => ({ get: () => true }) }
  };
  const feedbackUi = loadWithVscode<typeof import("../../src/ui/operation-feedback/vscode-operation-feedback.js")>("../../src/ui/operation-feedback/vscode-operation-feedback.js", vscode);
  const feedback = new OperationFeedback(new feedbackUi.VscodeOperationFeedbackHost());
  setActiveOperationFeedback(feedback);
  let finishManual: (() => void) | undefined;
  const manualPending = new Promise<void>((resolve) => { finishManual = resolve; });
  const manual = runWithActiveOperationFeedback("PR進捗を計算", async (context) => {
    reportActiveOperationDetail({ reason: "pull-request-file", phase: "read-content", target: "src/example.ts" }, context);
    await manualPending;
  });
  assert.match(String(status.tooltip), /pull-request-file/u);
  assert.match(String(status.tooltip), /read-content/u);
  assert.match(String(status.tooltip), /src\/example\.ts/u);
  assert.ok(status.shows >= 2, "reporting detail republishes the live Status Bar immediately");
  finishManual?.();
  await manual;

  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const repositoryId = "github.com/example/repo";
  const contextId = `github-pr:${repositoryId}#90`;
  const fileId = "file-1";
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId, kind: "pull-request", repositoryId, displayName: "PR #90",
    pullRequest: { host: "github.com", owner: "example", repository: "repo", number: 90, state: "open", title: "Pending read", baseSha: base, headSha: head },
    files: { [fileId]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId, currentPath: "src/example.ts", previousPaths: [], revisionId: head, modifiedReviewed: [], originalReviewedByDiff: {}, lineCount: 1, updatedAt: "2026-08-26T00:00:00.000Z" } },
    createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z"
  };
  const globalState: RepositoryGlobalState = { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId, currentRevisionId: head, files: {}, updatedAt: "2026-08-26T00:00:00.000Z" };
  class Repository implements PullRequestReviewRuntimeRepository {
    public async load(): Promise<{ schemaVersion: typeof REVIEW_RANGE_SCHEMA_VERSION; contextState: ReviewContextState; globalState: RepositoryGlobalState }> { return { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState: structuredClone(contextState), globalState: structuredClone(globalState) }; }
    public async commit(): Promise<void> {}
  }
  const snapshot: PullRequestDiffSnapshot = { contextId, baseSha: base, headSha: head, originalDiffId: `${base}..${head}`, files: [{ fileId, oldPath: "src/example.ts", newPath: "src/example.ts", status: "modified", additions: 1, deletions: 1, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ kind: "deletion", oldLine: 1, text: "old" }, { kind: "addition", newLine: 1, text: "new" }] }] }] };
  let firstRead: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => { firstRead = resolve; });
  let releaseRead: (() => void) | undefined;
  const readPending = new Promise<void>((resolve) => { releaseRead = resolve; });
  let reads = 0;
  const runtime = new PullRequestReviewRuntime<string>({ repository: new Repository(), requestHistory: async () => undefined, diffHost: { parseUri: (value) => value, openDiff: async () => undefined }, getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }) });
  runtime.register({ repositoryId, repositoryRoot: "/repo", fileSystemPathSemantics: "posix", snapshot, readTextContent: async (descriptor) => {
    reads += 1;
    if (reads === 1) { firstRead?.(); await readPending; }
    return { kind: "found", content: descriptor.revision === base ? "old\n" : "new\n" };
  } });
  const progress = runWithActiveOperationFeedback("PR進捗を計算", () => runtime.activateProgress(contextId));
  await readStarted;
  assert.match(String(status.tooltip), /pull-request-file/u);
  assert.match(String(status.tooltip), /read-content/u);
  assert.match(String(status.tooltip), /src\/example\.ts/u);
  assert.ok(status.shows >= 4, "pending production read republishes the current detailed status before resolution");
  releaseRead?.();
  await progress;
  assert.ok(output.some((line) => line.includes("pull-request-file") && line.includes("read-content")));
  setActiveOperationFeedback(undefined);
});

test("NR90-003 invalidated A is not shared when pending B is replaced by an immediate fresh A", async () => {
  const host = new RuntimeDiagnosticHost(true);
  const feedback = new OperationFeedback(host);
  let active: AbortController | undefined;
  let firstAStarted: (() => void) | undefined;
  const firstARunning = new Promise<void>((resolve) => { firstAStarted = resolve; });
  let runs = 0;
  const published: string[] = [];
  const a = { reason: "review-state-changed", target: "A", phase: "global-refresh-trigger" };
  const b = { reason: "review-state-changed", target: "B", phase: "global-refresh-trigger" };
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => active?.abort(),
    schedule: () => 1,
    cancel: () => undefined,
    run: async (detail) => {
      const controller = new AbortController();
      active = controller;
      const index = ++runs;
      await feedback.run("Global理解率を再計算", async () => {
        if (index === 1) {
          firstAStarted?.();
          await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
          throw new OperationCancelledError();
        }
        if (controller.signal.aborted) throw new Error("stale generation must not publish");
        published.push(detail?.target ?? "none");
      });
    }
  });
  const oldA = coalescer.flush(a).catch(() => undefined);
  await firstARunning;
  coalescer.request(b);
  const freshA = coalescer.flush(a);
  await oldA;
  await freshA;

  assert.equal(runs, 2, "fresh A starts exactly once instead of sharing invalidated A");
  assert.deepEqual(published, ["A"], "pending B and stale A never publish");
  assert.equal(host.logs.filter((entry) => entry.event === "cancelled").length, 1, "invalidated old A has CANCEL terminal");
  assert.equal(host.logs.filter((entry) => entry.event === "succeeded").length, 1, "fresh A has OK terminal");
  coalescer.dispose();
});

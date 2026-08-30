import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import {
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index";
import {
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  type CurrentContextUiSnapshot,
} from "../../src/ui/current-context/index";

const runtimeRequire = createRequire(__filename);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

class FeedbackHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public showBusy(): void {}
  public clearBusy(): void {}
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void {}
}

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

const baseVscode = () => ({
  EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
  TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
});

test("T606 R5 invokes the registered Current Context command through its production composition and records supersede as a typed terminal", async () => {
  const commands = new Map<string, () => Promise<void>>();
  const providers: Array<{ getChildren(): readonly unknown[] }> = [];
  const vscode = {
    ...baseVscode(), StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: (_id: string, provider: { getChildren(): readonly unknown[] }) => { providers.push(provider); return { dispose(): void {} }; },
      onDidChangeActiveTextEditor: () => ({ dispose(): void {} }),
    },
    commands: { registerCommand: (id: string, callback: () => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/current-context/vscode-current-context-runtime.js")>(
    "../../src/ui/current-context/vscode-current-context-runtime.js", vscode,
  );
  const pendingT405 = deferred<readonly CurrentContextUiSnapshot[]>();
  const signals: AbortSignal[] = [];
  const errors: unknown[] = [];
  const accepted: Array<CurrentContextUiSnapshot | undefined> = [];
  const snapshot: CurrentContextUiSnapshot = { context: { kind: "branch", label: "main" }, progress: undefined };
  let acquisition = 0;
  const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
    enumerateCandidates: async (signal) => {
      signals.push(signal!);
      return acquisition++ === 0 ? pendingT405.promise : [snapshot];
    },
    resolveFallback: async (candidates) => candidates[0],
    requestSelection: async () => undefined,
  });
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerCurrentContextRuntime({ subscriptions: [] } as never, {
      recompute: (signal, context) => composition.recompute(signal, context),
      selectContext: (signal, context) => composition.selectContext(signal, context),
      acceptRecomputed: (value) => accepted.push(value),
    }, { refreshDependents: async () => undefined }, async (error) => { errors.push(error); });
    await new Promise((resolve) => setImmediate(resolve));
    const refresh = commands.get(runtime.REFRESH_CONTEXT_COMMAND_ID)!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(signals[0]?.aborted, true, "the command aborts the pending T405 acquisition with its owner signal");
    pendingT405.resolve([snapshot]);
    await refresh;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors.length, 0, "a superseded command records a typed terminal without clearing the current UI");
    assert.equal(host.logs.filter((entry) => entry.event === "cancelled").length, 1, "a superseded command records exactly one non-error CANCEL terminal");
    assert.equal(host.logs.filter((entry) => entry.event === "failed").length, 0, "a typed cancellation never becomes an error terminal");
    assert.equal(host.logs.filter((entry) => entry.event === "succeeded").length, 1);
    assert.deepEqual(accepted, [snapshot], "only the current command may publish its snapshot");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 R5 invokes the registered Global open command with one generic UI error and one redacted terminal", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  const providers: Array<{ getChildren(): readonly { readonly kind: string }[] }> = [];
  const messages: string[] = [];
  const vscode = {
    ...baseVscode(), StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: (_id: string, provider: { getChildren(): readonly { readonly kind: string }[] }) => { providers.push(provider); return { dispose(): void {} }; },
      showErrorMessage: async (message: string) => { messages.push(message); },
    },
    commands: { registerCommand: (id: string, callback: (...args: unknown[]) => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
    workspace: { onDidChangeConfiguration: () => ({ dispose(): void {} }) },
  };
  const runtime = loadWithVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>(
    "../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode,
  );
  const host = new FeedbackHost();
  setActiveOperationFeedback(new OperationFeedback(host, () => 1));
  try {
    const registered = runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
      source: { recalculate: async () => ({ progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 1, progress: 0, files: [{ path: "src/a.ts", state: "current", reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 1, progress: 0 }] }, fileOpenTargets: [{ kind: "working-tree", repositoryId: "r", contextId: "c", revisionId: "x", repositoryPath: "src/a.ts", filePath: "/private/a.ts" }], excludedFileCount: 0, prunedExcludedDirectoryCount: 0 }) },
      readGlobalLayerEnabled: () => false, writeGlobalLayerEnabled: async () => undefined, refreshDecorations: async () => undefined,
      openFile: async () => { throw new Error("private open failure"); },
      reportError: async (error) => { await vscode.window.showErrorMessage(String(error)); },
    });
    await registered.refresh();
    host.logs.splice(0);
    const group = providers[0]!.getChildren().find((node) => node.kind === "files-group");
    const file = (providers[0] as unknown as { getChildren(node: unknown): readonly { readonly kind: string }[] })
      .getChildren(group).find((node) => node.kind === "file");
    await commands.get(runtime.OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID)!(file);
    assert.equal(messages.length, 1);
    assert.equal(messages[0], "操作を完了できませんでした。詳細は Review Range Output を確認してください。");
    assert.doesNotMatch(messages[0]!, /private open failure|\/private\/a\.ts/u);
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
    assert.equal(host.logs.at(-1)?.message, "Operation failed; details were redacted.");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

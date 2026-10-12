import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OperationCancelledError,
  OperationFeedback,
  formatOperationLogEntry,
  queueOperationStartDetails,
  reportActiveOperationStageDiagnostic,
  setActiveOperationFeedback,
  type OperationActivity,
  type OperationDiagnosticDetail,
  type OperationFeedbackContext,
  type OperationFeedbackHost,
  type OperationLogEntry,
  type OperationProgress,
} from "../../src/application/operation-feedback/index.js";
import {
  describePullRequestProgressFile,
  describePullRequestProgressSummary,
} from "../../src/application/operation-feedback/pr-progress-diagnostics.js";
import { GlobalUnderstandingRefreshCoalescer } from "../../src/ui/global-understanding/issue-90-global-refresh.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewContextState } from "../../src/core/contracts/index.js";

class DiagnosticHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public readonly statuses: Array<{ readonly label: string; readonly activeCount: number; readonly progress?: OperationProgress; readonly activities?: readonly OperationActivity[] } | undefined> = [];
  public reveals = 0;
  public constructor(public detailed = true) {}
  public isDetailedDiagnosticsEnabled(): boolean { return this.detailed; }
  public showBusy(label: string, activeCount: number, progress?: OperationProgress, activities?: readonly OperationActivity[]): void {
    this.statuses.push({ label, activeCount, ...(progress === undefined ? {} : { progress }), ...(activities === undefined ? {} : { activities }) });
  }
  public clearBusy(): void { this.statuses.push(undefined); }
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void { this.reveals += 1; }
}

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};
const runtimeRequire = createRequire(__filename);
const detail = (reason: string, target?: string, phase?: string): OperationDiagnosticDetail => ({ reason, ...(target === undefined ? {} : { target }), ...(phase === undefined ? {} : { phase }) });

test("repository boundary diagnostics record fixed stages, safe classifications, counts, and no exception details", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_500);
  const secret = "C:\\private\\repo\\catalog.json token=fixture-secret repoId=private-owner";
  await feedback.run("Review Contexts refresh", async (context) => {
    reportActiveOperationStageDiagnostic("repository-context-catalog", new SyntaxError(secret), context);
    reportActiveOperationStageDiagnostic("repository-root-resolution", Object.assign(new Error(secret), { code: "EACCES" }), context);
  });

  const diagnostics = host.logs.filter((entry) => entry.operationDiagnostic !== undefined);
  assert.equal(diagnostics.length, 2, "one record is emitted for each known failing boundary");
  assert.deepEqual(diagnostics.map((entry) => entry.operationDiagnostic), [
    { stage: "repository-context-catalog", status: "failed", category: "permanent" },
    { stage: "repository-root-resolution", status: "failed", category: "permanent", code: "EACCES" },
  ]);
  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.match(output, /stage=repository-context-catalog status=failed category=permanent/u);
  assert.match(output, /stage=repository-root-resolution status=failed category=permanent code=EACCES/u);
  assert.doesNotMatch(output, /private\\repo|fixture-secret|private-owner|catalog\.json/u);
});

test("T405 root resolution suppresses selection cancellation and interruption diagnostics but retains I/O failures", async () => {
  const rootA = path.join(tmpdir(), "review-range-root-cancel-a");
  const rootB = path.join(tmpdir(), "review-range-root-cancel-b");
  const secret = "C:\\private\\repo\\root token=fixture-secret repoId=private-owner";
  let inspectionFailure: "none" | "abort" | "io" = "none";
  const commands = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const errors: string[] = [];
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_600);
  class Memento {
    private readonly values = new Map<string, unknown>();
    public get<T>(key: string, fallback?: T): T | undefined { return this.values.get(key) as T | undefined ?? fallback; }
    public async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
  }
  const toFileUri = (fsPath: string) => ({ scheme: "file", authority: "", path: fsPath.replace(/\\/gu, "/"), fsPath, query: "", fragment: "" });
  const vscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0, Expanded: 1 },
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => Promise<unknown>) => { commands.set(id, handler); return { dispose(): void {} }; } },
    window: {
      activeTextEditor: undefined,
      createTreeView: () => ({ dispose(): void {} }),
      showQuickPick: async () => undefined,
      showErrorMessage: async (error: string) => { errors.push(error); },
    },
    workspace: {
      workspaceFolders: [{ uri: toFileUri(rootA) }, { uri: toFileUri(rootB) }],
      textDocuments: [],
      getConfiguration: () => ({ get: () => undefined }),
    },
    authentication: { getSession: async () => ({ accessToken: "fixture-token" }) },
  };
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  let runtime: { dispose(): void } | undefined;
  setActiveOperationFeedback(feedback);
  try {
    loader._load = (request, parent, isMain) => request === "vscode"
      ? vscode
      : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
    const runtimePath = runtimeRequire.resolve("../../src/composition/review-contexts/review-contexts-runtime.js");
    const uiRuntimePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
    const uiIndexPath = runtimeRequire.resolve("../../src/ui/review-contexts/index.js");
    delete runtimeRequire.cache[runtimePath];
    delete runtimeRequire.cache[uiRuntimePath];
    delete runtimeRequire.cache[uiIndexPath];
    const runtimeModule = runtimeRequire(runtimePath) as typeof import("../../src/composition/review-contexts/review-contexts-runtime.js");
    loader._load = originalLoad;
    const storageRoot = path.join(tmpdir(), "review-range-root-cancel-storage");
    const registered = runtimeModule.registerT405ReviewContextsRuntime({
      context: {
        globalStorageUri: toFileUri(storageRoot), storageUri: toFileUri(storageRoot), workspaceState: new Memento(), subscriptions: [],
      } as never,
      git: {
        inspectRepository: async (root: string) => {
          if (inspectionFailure === "abort") throw new DOMException(secret, "AbortError");
          if (inspectionFailure === "io") throw Object.assign(new Error(secret), { code: "EACCES" });
          return { kind: "repository", repository: { rootPath: root, repositoryId: root.toLowerCase() } };
        },
      } as never,
      enumerateCurrentContexts: async () => [],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: () => undefined,
      openPullRequestReviewDiff: async () => undefined,
      getPullRequestReviewProgress: async () => ({ reviewedLineCount: 0, totalLineCount: 0, progress: 0 }),
      reviewStateRepository: {
        load: async () => undefined, loadGlobal: async () => undefined, listRepositoryContexts: async () => [],
        commit: async () => undefined, create: async () => undefined,
      },
      reviewHistoryRecorder: { recordContextCreated: async () => undefined, recordRevisionMapping: async () => undefined },
    } as never);
    runtime = registered;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const refreshCache = commands.get("reviewRange.refreshReviewContextCache");
    assert.ok(refreshCache);
    const context: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: "private-pr-context",
      kind: "pull-request",
      repositoryId: "private-owner/repository",
      displayName: "PR #1",
      pullRequest: { host: "github.com", owner: "private-owner", repository: "repository", number: 1, state: "open", baseSha: "a".repeat(40), headSha: "b".repeat(40) },
      files: {},
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };
    const item = { context };

    await refreshCache(item);
    assert.equal(host.logs.some((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution"), false,
      "user cancellation while choosing between repositories is not a root-resolution failure diagnostic");
    inspectionFailure = "abort";
    await refreshCache(item);
    assert.equal(host.logs.some((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution"), false,
      "an interrupted root inspection is not a root-resolution failure diagnostic");
    inspectionFailure = "io";
    await refreshCache(item);
    const diagnostics = host.logs.filter((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution");
    assert.equal(diagnostics.length, 1, "ordinary root-inspection I/O failure remains observable");
    assert.deepEqual(diagnostics[0]?.operationDiagnostic, {
      stage: "repository-root-resolution", status: "failed", category: "permanent", code: "EACCES",
    });
    const output = host.logs.map(formatOperationLogEntry).join("\n") + errors.join("\n");
    assert.doesNotMatch(output, /private\\repo|fixture-secret|private-owner/u,
      "cancellation and ordinary failures keep exception details redacted");
  } finally {
    runtime?.dispose();
    loader._load = originalLoad;
    setActiveOperationFeedback(undefined);
  }
});

test("Issue #90 manifest exposes opt-in detailed diagnostics with a privacy-safe default", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { contributes: { configuration: { properties: Record<string, { readonly type?: unknown; readonly default?: unknown; readonly description?: unknown }> } }; scripts: Record<string, string> };
  const setting = manifest.contributes.configuration.properties["reviewRange.diagnostics.detailed"];
  assert.deepEqual({ type: setting?.type, default: setting?.default }, { type: "boolean", default: false });
  assert.match(String(setting?.description), /ファイル名|path|機密/u);
  assert.match(manifest.scripts["test:unit"] ?? "", /issue-90-diagnostics-and-cancellation\.test\.js/u);
});

test("Issue #90 active status enumerates every operation and detailed mode correlates reason, target, and operation id", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 1_000);
  const globalGate = deferred<void>();
  const progressGate = deferred<void>();
  let progressContext: OperationFeedbackContext | undefined;
  const global = feedback.run("Global理解率を再計算", async () => globalGate.promise, detail("document-changed", "src/global.ts"));
  const progress = feedback.run("PR進捗を計算", async (context) => { progressContext = context; await progressGate.promise; }, detail("selected-pull-request", "github-pr:repo#90"));
  const current = host.statuses.at(-1);
  assert.ok(current);
  assert.equal(current.activeCount, 2);
  assert.deepEqual(current.activities?.map((activity) => ({ id: activity.id, label: activity.label, detail: activity.detail })), [
    { id: 1, label: "Global理解率を再計算", detail: detail("document-changed") },
    { id: 2, label: "PR進捗を計算", detail: detail("selected-pull-request") },
  ]);
  assert.deepEqual(host.logs.slice(0, 4).map((entry) => ({ event: entry.event, operationId: entry.operationId, detail: entry.detail })), [
    { event: "started", operationId: 1, detail: undefined },
    { event: "detail", operationId: 1, detail: detail("document-changed") },
    { event: "started", operationId: 2, detail: undefined },
    { event: "detail", operationId: 2, detail: detail("selected-pull-request") },
  ]);
  const statusCountBeforePendingReadDetail = host.statuses.length;
  feedback.reportDetail(detail("pull-request-file", "src/progress.ts", "read-content"), progressContext);
  assert.equal(host.statuses.length, statusCountBeforePendingReadDetail + 1);
  assert.deepEqual(host.statuses.at(-1)?.activities?.find((activity) => activity.id === progressContext?.id)?.detail, detail("pull-request-file", undefined, "read-content"));
  const detailEntry = host.logs.at(-1);
  assert.equal(detailEntry?.event, "detail");
  assert.equal(detailEntry?.operationId, 2);
  assert.equal(formatOperationLogEntry(detailEntry!), "[1970-01-01T00:00:01.000Z] DETAIL op=2 PR進捗を計算 reason=pull-request-file phase=read-content");
  globalGate.resolve(); progressGate.resolve();
  await Promise.all([global, progress]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "started").map((entry) => entry.operationId), [1, 2]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "succeeded").map((entry) => entry.operationId).sort(), [1, 2]);
});

test("Issue #90 default diagnostics never emit a supplied file target", async () => {
  const host = new DiagnosticHost(false);
  const feedback = new OperationFeedback(host, () => 2_000);
  await feedback.run("Global理解率を再計算", async () => undefined, detail("document-changed", "src/private-owner-file.ts"));
  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.doesNotMatch(output, /private-owner-file|document-changed/u);
  assert.equal(host.statuses[0]?.activities?.[0]?.detail, undefined);
});

test("operation finish hooks clean up after success, failure, and cancellation", async () => {
  const host = new DiagnosticHost(false);
  const feedback = new OperationFeedback(host, () => 2_500);
  const completed: number[] = [];
  await feedback.run("success", async (context) => {
    feedback.onOperationFinished(context, () => completed.push(context.id));
  });
  await assert.rejects(feedback.run("failure", async (context) => {
    feedback.onOperationFinished(context, () => completed.push(context.id));
    throw new Error("expected fixture failure");
  }), /expected fixture failure/u);
  await feedback.run("cancelled", async (context) => {
    feedback.onOperationFinished(context, () => completed.push(context.id));
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "review-contexts-refresh", stage: "refresh-request", status: "cancelled",
      reasonCode: "superseded-by-newer-generation",
    });
  });
  assert.deepEqual(completed, [1, 2, 3]);
});

test("reported PR refresh cancellation with AbortError records one cancelled terminal and finalizes", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_000);
  const cancellation = new DOMException("superseded", "AbortError");
  let finalized = 0;
  await assert.rejects(feedback.run("PR refresh", async (context) => {
    feedback.onOperationFinished(context, () => { finalized += 1; });
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "review-contexts-refresh", stage: "refresh-request", status: "cancelled",
      reasonCode: "superseded-by-newer-generation",
    });
    throw cancellation;
  }), (error: unknown) => error === cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "refresh", "cancelled"]);
  assert.equal(host.reveals, 0);
  assert.equal(finalized, 1);
});

test("reported PR refresh cancellation does not hide an ordinary operation error", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_100);
  const failure = new Error("refresh failed after cancellation");
  await assert.rejects(feedback.run("PR refresh", async (context) => {
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "review-contexts-refresh", stage: "refresh-request", status: "cancelled",
      reasonCode: "superseded-by-newer-generation",
    });
    throw failure;
  }), (error: unknown) => error === failure);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "refresh", "failed"]);
  assert.equal(host.reveals, 1);
});

test("a reported boundary failure takes priority over a later AbortError", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_200);
  const failure = new Error("boundary failure");
  const cancellation = new DOMException("superseded", "AbortError");
  await assert.rejects(feedback.run("PR refresh", async (context) => {
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "review-contexts-refresh", stage: "refresh-request", status: "cancelled",
      reasonCode: "superseded-by-newer-generation",
    });
    feedback.reportFailure("PR refresh", failure, context);
    throw cancellation;
  }), (error: unknown) => error === cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "refresh", "failed"]);
  assert.equal(host.logs.at(-1)?.failureCategory, "permanent");
  assert.equal(host.reveals, 1);
});

test("an unreported AbortError retains the existing failed terminal behavior", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_300);
  const cancellation = new DOMException("unreported abort", "AbortError");
  await assert.rejects(feedback.run("PR refresh", async () => { throw cancellation; }), (error: unknown) => error === cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
  assert.equal(host.logs.at(-1)?.failureCategory, "stale");
  assert.equal(host.reveals, 1);
});

test("Issue #137 production formatter preserves refresh payloads and hides queued PR file paths", async () => {
  const hostileValues = [
    "private-repository-name", "secret-branch-name", "https://private.example/pr/42?token=secret",
    "deadbeef-private-sha", "/private/repo/source.ts", "source body with token=do-not-log",
    "diff body with private content", "exception containing /private/repo/source.ts",
  ];
  for (const detailed of [false, true]) {
    const host = new DiagnosticHost(detailed);
    const feedback = new OperationFeedback(host, () => 4_000);
    queueOperationStartDetails("PR進捗を計算", [describePullRequestProgressFile({
      path: hostileValues[4]!, totalLineCount: 3, excluded: false,
    })]);
    await feedback.run("Current Contextを更新", async (parentContext) => {
      assert.equal(parentContext.owner, feedback);
      await feedback.run("PR進捗を計算", async (context) => {
        for (const hostile of hostileValues) {
          feedback.reportDetail({ reason: hostile, target: hostile, phase: hostile }, context);
        }
        feedback.reportPullRequestRefresh(context, {
          generation: 5, trigger: "review-contexts-refresh", stage: "pr-progress",
          status: "succeeded", counts: { snapshotFiles: 1 },
        });
      });
    });
    const rendered = host.logs.map(formatOperationLogEntry).join("\n");
    assert.match(rendered, /REFRESH .*generation=5 .*stage=pr-progress status=succeeded/u);
    assert.doesNotMatch(rendered, /private-repository|secret-branch|private\.example|deadbeef-private|\/private\/repo|source body|diff body|exception containing|target=/u);
    for (const hostile of hostileValues) assert.equal(rendered.includes(hostile), false);
    assert.deepEqual(host.logs.filter((entry) => entry.event === "started").map((entry) => entry.operationId), [1, 2]);
    await assert.rejects(feedback.run("PR進捗を計算", async () => { throw new Error(hostileValues[7]); }), /exception/u);
    const withFailure = host.logs.map(formatOperationLogEntry).join("\n");
    for (const hostile of hostileValues) assert.equal(withFailure.includes(hostile), false);
  }
});

test("Issue #137 default lifecycle correlates concurrent same-label refreshes by owner operation id", async () => {
  const host = new DiagnosticHost(false);
  const feedback = new OperationFeedback(host, () => 5_000);
  const gates = [deferred<void>(), deferred<void>()];
  const operations = gates.map((gate, index) => feedback.run("Review Contextsを更新", async (context) => {
    feedback.reportPullRequestRefresh(context, {
      generation: index + 10, trigger: "review-contexts-refresh", stage: "pr-progress", status: "started",
    });
    await gate.promise;
  }));
  gates.forEach((gate) => gate.resolve());
  await Promise.all(operations);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "started").map((entry) => entry.operationId), [1, 2]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "refresh").map((entry) => entry.operationId), [1, 2]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "succeeded").map((entry) => entry.operationId).sort(), [1, 2]);
  assert.match(host.logs.map(formatOperationLogEntry).join("\n"), /START op=1 Review Contextsを更新[\s\S]*START op=2 Review Contextsを更新/u);
});

test("Issue #90 superseded work has a cancellation terminal and does not reveal Output as an error", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 3_000);
  const cancellation = new OperationCancelledError();
  await assert.rejects(feedback.run("Global理解率を再計算", async () => { throw cancellation; }, detail("review-state-changed")), cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "detail", "cancelled"]);
  assert.equal(host.logs[2]?.operationId, 1);
  assert.equal(host.reveals, 0);
  assert.match(formatOperationLogEntry(host.logs[2]!), /CANCEL op=1 Global理解率を再計算/u);
});

test("Issue #90 cancellation remains a non-error terminal while detailed diagnostics are OFF", async () => {
  const host = new DiagnosticHost(false);
  const feedback = new OperationFeedback(host, () => 3_500);
  const cancellation = new OperationCancelledError();
  await assert.rejects(feedback.run("Global理解率を再計算", async () => { throw cancellation; }, detail("review-state-changed", "src/private.ts")), cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "cancelled"]);
  assert.equal(host.reveals, 0);
  assert.doesNotMatch(host.logs.map(formatOperationLogEntry).join("\n"), /private\.ts|review-state-changed/u);
});

test("Issue #90 coalescer cancels the pending stale refresh and flushes exactly one latest reason and file", async () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const invalidations: string[] = [];
  const runs: OperationDiagnosticDetail[] = [];
  let nextHandle = 0;
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => { invalidations.push("invalidate"); },
    schedule: (callback) => { const handle = ++nextHandle; callbacks.set(handle, callback); return handle; },
    cancel: (handle) => { const numeric = handle as number; cancelled.push(numeric); callbacks.delete(numeric); },
    run: async (request) => { assert.ok(request); runs.push(request); },
  });
  coalescer.request(detail("document-changed", "src/first.ts"));
  coalescer.request(detail("review-state-changed", "src/first.ts"));
  await coalescer.flush(detail("document-review-state-applied", "src/first.ts"));
  assert.deepEqual(invalidations, ["invalidate", "invalidate"]);
  assert.deepEqual(cancelled, [1, 2]);
  assert.deepEqual(runs, [detail("document-review-state-applied", "src/first.ts")]);
  assert.equal(callbacks.size, 0);
  coalescer.dispose();
});

test("Issue #90 coalescer shares three running requests with the same effective input and supersedes different input", async () => {
  const gates = [deferred<void>(), deferred<void>()];
  const runs: OperationDiagnosticDetail[] = [];
  const published: string[] = [];
  let invalidations = 0;
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => { invalidations += 1; },
    schedule: () => 1,
    cancel: () => undefined,
    run: async (request) => {
      assert.ok(request);
      const index = runs.push(request) - 1;
      await gates[index]!.promise;
      published.push(request.target!);
    },
  });
  const same = detail("review-state-changed", "context:owner@revision-1");
  const newer = detail("review-state-changed", "context:owner@revision-2");
  const first = coalescer.flush(same);
  coalescer.request(same);
  coalescer.request(same);
  coalescer.request(same);
  const second = coalescer.flush(same);
  const third = coalescer.flush(same);
  assert.deepEqual(runs, [same]);
  assert.equal(invalidations, 0, "same running input must be shared before invalidation");
  const latest = coalescer.flush(newer);
  assert.deepEqual(runs, [same, newer]);
  gates[0]!.resolve();
  gates[1]!.resolve();
  await Promise.all([first, second, third, latest]);
  assert.deepEqual(published, [same.target, newer.target]);
  coalescer.dispose();
});

test("Issue #90 PR Progress diagnostics explain a zero denominator per file and in aggregate", () => {
  assert.deepEqual(describePullRequestProgressFile({
    path: "src/ignored.ts", status: "modified", additions: 12, deletions: 3, reviewedLineCount: 0, totalLineCount: 0, excluded: true, exclusionReason: { kind: "user-glob" },
  }), detail("excluded:user-glob", "src/ignored.ts", "progress-file total=0 additions=12 deletions=3"));
  assert.deepEqual(describePullRequestProgressFile({
    path: "src/empty.ts", status: "modified", additions: 0, deletions: 0, reviewedLineCount: 0, totalLineCount: 0, excluded: false,
  }), detail("zero-changed-lines", "src/empty.ts", "progress-file total=0 additions=0 deletions=0"));
  assert.deepEqual(describePullRequestProgressSummary({
    snapshotFileCount: 2,
    files: [
      { path: "src/ignored.ts", excluded: true, totalLineCount: 0 },
      { path: "src/empty.ts", excluded: false, totalLineCount: 0 },
    ],
    reviewedLineCount: 0,
    totalLineCount: 0,
  }), detail("zero-denominator", "snapshotFiles=2 included=1 excluded=1 zeroFiles=2 reviewed=0 total=0", "progress-summary"));
});

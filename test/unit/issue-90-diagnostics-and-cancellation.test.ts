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

test("repository boundary diagnostics record lifecycle, useful error evidence, and redact only secret values", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_500);
  const secret = "C:\\local-fixture\\catalog.json token=fixture-secret repoId=synthetic-owner";
  await feedback.run("Review Contexts refresh", async (context) => {
    reportActiveOperationStageDiagnostic("repository-context-catalog", new SyntaxError(secret), context);
    reportActiveOperationStageDiagnostic("repository-root-resolution", Object.assign(new Error(secret), { code: "EACCES" }), context);
  });

  const diagnostics = host.logs.filter((entry) => entry.operationDiagnostic !== undefined);
  assert.equal(diagnostics.length, 2, "one record is emitted for each known failing boundary");
  assert.deepEqual(diagnostics.map((entry) => ({ ...entry.operationDiagnostic, code: entry.operationDiagnostic?.code, error: undefined })), [
    { stage: "repository-context-catalog", status: "failed", category: "permanent", code: undefined, error: undefined },
    { stage: "repository-root-resolution", status: "failed", category: "permanent", code: "EACCES", error: undefined },
  ]);
  assert.equal(diagnostics[0]?.operationDiagnostic?.error?.name, "SyntaxError");
  assert.equal(diagnostics[0]?.operationDiagnostic?.error?.message.includes("C:\\local-fixture\\catalog.json"), true);
  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.match(output, /stage=repository-context-catalog status=failed category=permanent/u);
  assert.match(output, /stage=repository-root-resolution status=failed category=permanent code=EACCES/u);
  assert.match(output, /C:\\local-fixture\\catalog\.json/u);
  assert.match(output, /repoId=synthetic-owner/u);
  assert.doesNotMatch(output, /fixture-secret/u);
});

test("operation failure keeps local paths, codes, stack, and causes while masking credentials", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_510);
  const cause = Object.assign(new Error("read failed at C:\\local-fixture\\state.json client_secret=fixture-child-secret"), { code: "EACCES" });
  const failure = new Error("open C:\\local-fixture\\state.json token=fixture-access-token Authorization: Bearer fixture-bearer Cookie=fixture-cookie-value password=fixture-password", { cause });
  await assert.rejects(feedback.run("Review Contexts refresh", async () => { throw failure; }), failure);

  const terminal = host.logs.at(-1);
  assert.equal(terminal?.event, "failed");
  assert.equal(terminal?.errorDetails?.name, "Error");
  assert.equal(terminal?.errorDetails?.cause?.code, "EACCES");
  assert.match(terminal?.errorDetails?.stack ?? "", /issue-90-diagnostics-and-cancellation\.test\.js/u);
  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.match(output, /C:\\local-fixture\\state\.json/u);
  assert.match(output, /caused by Error code=EACCES/u);
  assert.match(output, /client_secret=\[REDACTED\]/u);
  for (const secret of ["fixture-access-token", "fixture-bearer", "fixture-cookie-value", "fixture-password", "fixture-child-secret"]) {
    assert.doesNotMatch(output, new RegExp(secret, "u"));
  }
});

test("non-Error and circular causes are bounded and safely diagnosed", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_520);
  const first = new Error("outer token=fixture-token");
  const second = new Error("inner");
  Object.defineProperty(first, "cause", { value: second });
  Object.defineProperty(second, "cause", { value: first });
  await assert.rejects(feedback.run("non-error failure", async () => { throw first; }), first);
  const circular = host.logs.at(-1)?.errorDetails;
  assert.equal(circular?.cause?.cause?.message, "Circular error cause omitted.");

  const nonError = Object.defineProperty({}, "message", { get: () => { throw new Error("getter failed"); } });
  await assert.rejects(feedback.run("thrown value", async () => { throw nonError; }), (error) => error === nonError);
  const nonErrorDetails = host.logs.at(-1)?.errorDetails;
  assert.equal(nonErrorDetails?.kind, "non-error");
  assert.equal(nonErrorDetails?.message, "Thrown non-Error value has no readable message.");
  assert.equal(host.logs.at(-1)?.event, "failed");
});

test("throwing error getters do not mask outcomes and long stacks stay bounded", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_525);
  const hostile = new Error("readable failure message");
  Object.defineProperty(hostile, "stack", { configurable: true, get: () => { throw new Error("stack getter failed"); } });
  await assert.rejects(feedback.run("throwing stack getter", async () => { throw hostile; }), (error) => error === hostile);
  const hostileDetails = host.logs.at(-1)?.errorDetails;
  assert.equal(hostileDetails?.message, "readable failure message");
  assert.equal(hostileDetails?.stack, undefined);

  const longStackError = new Error("long stack failure");
  const longStack = ["Error: long stack failure", ...Array.from({ length: 80 }, (_, index) =>
    `    at generated frame ${index} ${"x".repeat(1_000)}`)].join("\n");
  Object.defineProperty(longStackError, "stack", { configurable: true, value: longStack });
  await assert.rejects(feedback.run("long stack", async () => { throw longStackError; }), (error) => error === longStackError);
  const recordedStack = host.logs.at(-1)?.errorDetails?.stack ?? "";
  assert.ok(recordedStack.length <= 12_000, "diagnostic stacks respect the hard character limit");
  assert.match(recordedStack, /truncated \d+ chars/u);
  assert.doesNotMatch(recordedStack, /generated frame 79/u, "later frames are omitted after the line limit");
});

test("diagnostics preserve the last AggregateError cause and report omitted causes", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_526);
  const causes = Array.from({ length: 21 }, (_, index) => new Error(`aggregate cause ${index + 1}`));
  const aggregate = new AggregateError(causes, "aggregate diagnostic failure");

  await assert.rejects(feedback.run("aggregate error", async () => { throw aggregate; }), (error) => error === aggregate);

  const details = host.logs.at(-1)?.errorDetails;
  assert.equal(details?.causes?.[0]?.message, "aggregate cause 1");
  assert.equal(details?.causes?.at(-1)?.message, "aggregate cause 21", "the final cause remains directly traceable");
  assert.equal(details?.omittedCauseCount, 5, "omission is counted when the bounded sample skips middle causes");
  assert.match(details?.causes?.[15]?.message ?? "", /5 additional error causes omitted/u);
});

test("formatted diagnostics keep every sampled AggregateError cause summary before truncating verbose stacks", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_526);
  const causes = Array.from({ length: 21 }, (_, index) => {
    const cause = new Error(`aggregate cause ${index + 1}`);
    Object.defineProperty(cause, "stack", {
      configurable: true,
      value: `Error: aggregate cause ${index + 1}\n${Array.from({ length: 24 }, (_, frame) =>
        `    at aggregate frame ${index + 1}-${frame} ${"x".repeat(1_000)}`).join("\n")}`,
    });
    return cause;
  });
  const aggregate = new AggregateError(causes, "aggregate diagnostic failure");

  await assert.rejects(feedback.run("aggregate error", async () => { throw aggregate; }), (error) => error === aggregate);

  const output = formatOperationLogEntry(host.logs.at(-1)!);
  assert.ok(output.length <= 24_000, "the complete formatted entry respects its output budget");
  for (const index of [...Array.from({ length: 15 }, (_, offset) => offset + 1), 21]) {
    assert.ok(output.includes(`also caused by Error: aggregate cause ${index}`), `cause ${index} remains identifiable`);
  }
  assert.match(output, /5 additional error causes omitted from the diagnostic sample/u);
  assert.match(output, /diagnostic output truncated after 24,000 chars/u);
});

test("stack secrets are redacted as a whole before line and character limits", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_527);
  const failure = new Error("private key stack fixture");
  const privateKey = [
    "-----BEGIN RSA PRIVATE KEY-----",
    ...Array.from({ length: 40 }, (_, index) => `fixture-private-key-line-${index}-${"x".repeat(400)}`),
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  Object.defineProperty(failure, "stack", {
    configurable: true,
    value: `Error: private key stack fixture\n    at useful/local/operation.ts:17\n${privateKey}\n    at later/frame.ts:99`,
  });

  await assert.rejects(feedback.run("multiline private key", async () => { throw failure; }), (error) => error === failure);

  const stack = host.logs.at(-1)?.errorDetails?.stack ?? "";
  assert.match(stack, /\[REDACTED PRIVATE KEY\]/u);
  assert.match(stack, /useful\/local\/operation\.ts:17/u, "useful stack location remains available");
  assert.doesNotMatch(stack, /fixture-private-key-line/u);
  assert.ok(stack.length <= 12_000);
});

test("quoted JSON secrets, authorization headers, cookies, and URL credentials are masked", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_528);
  const cause = new Error("nested cause client_secret=fixture-child-secret");
  const failure = new Error([
    'metadata={"password":"fixture-json-password","client_secret":"fixture-json-client-secret"}',
    "Authorization: Bearer fixture-authorization-secret",
    "Cookie: session=fixture-cookie-secret",
    "request https://fixture-user:fixture-url-password@private.example/repository failed",
    "useful error context remains available",
  ].join("\n"), { cause });

  await assert.rejects(feedback.run("quoted secret fixture", async () => { throw failure; }), (error) => error === failure);

  const terminal = host.logs.at(-1);
  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.equal(terminal?.errorDetails?.cause?.message, "nested cause client_secret=[REDACTED]");
  assert.match(output, /useful error context remains available/u);
  assert.match(output, /private\.example\/repository/u, "non-secret host and path context remains available");
  for (const secret of [
    "fixture-json-password", "fixture-json-client-secret", "fixture-authorization-secret",
    "fixture-cookie-secret", "fixture-user", "fixture-url-password", "fixture-child-secret",
  ]) assert.doesNotMatch(output, new RegExp(secret, "u"));
});

test("hostile error proxies and cause-array getters never replace the original failure", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_529);
  const causes = new Proxy([new Error("first readable cause"), new Error("unreadable cause"), new Error("last readable cause")], {
    get(target, property, receiver) {
      if (property === "filter" || property === "map") throw new Error("array helper getter failed");
      if (property === "1") throw new Error("cause index getter failed");
      return Reflect.get(target, property, receiver);
    },
  });
  const target = new Error("hostile proxy failure");
  Object.defineProperty(target, "errors", { configurable: true, value: causes });
  const hostile = new Proxy(target, {
    getPrototypeOf() { throw new Error("proxy prototype trap failed"); },
  });

  await assert.rejects(feedback.run("hostile error proxy", async () => { throw hostile; }), (error) => error === hostile);

  const terminal = host.logs.at(-1);
  assert.equal(terminal?.event, "failed");
  assert.equal(terminal?.errorDetails?.message, "hostile proxy failure");
  assert.equal(terminal?.errorDetails?.causes?.[0]?.message, "first readable cause");
  assert.equal(terminal?.errorDetails?.causes?.[1]?.message, "An error cause could not be read safely.");
  assert.equal(terminal?.errorDetails?.causes?.[2]?.message, "last readable cause");
});

test("logger and status sink exceptions never replace outcomes or leak active operations", async () => {
  class ThrowingHost extends DiagnosticHost {
    public readonly attemptedEvents: string[] = [];
    public throwEvents = new Set<string>(["started", "progress", "refresh", "failed", "succeeded"]);
    public throwStatus = true;
    public clearCount = 0;
    public override showBusy(): void { if (this.throwStatus) throw new Error("status sink failed token=fixture-token"); }
    public override clearBusy(): void { this.clearCount += 1; if (this.throwStatus) throw new Error("clear sink failed"); }
    public override appendLog(entry: OperationLogEntry): void {
      this.attemptedEvents.push(entry.event);
      if (this.throwEvents.has(entry.event)) throw new Error(`append failed for ${entry.event} apiKey=fixture-api-key`);
      super.appendLog(entry);
    }
    public override revealLog(): void { throw new Error("reveal sink failed"); }
  }
  const host = new ThrowingHost(true);
  const fallback: string[] = [];
  const feedback = new OperationFeedback(host, () => 4_530, (line) => fallback.push(line));
  const original = new Error("application failure at C:\\local-fixture\\operation.json token=fixture-operation-secret");
  await assert.rejects(feedback.run("fails despite logger", async (context) => {
    feedback.reportProgress({ stage: "repositories", completed: 1 }, context);
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "current-context-refresh", stage: "pr-progress", status: "progress",
    });
    throw original;
  }), original);
  assert.deepEqual(host.attemptedEvents, ["started", "progress", "refresh", "failed"]);
  assert.equal(host.clearCount, 1, "cleanup status is attempted after failure");
  assert.ok(fallback.some((line) => line.includes("append failed for started")));
  assert.ok(fallback.some((line) => line.includes("append failed for progress")));
  assert.ok(fallback.some((line) => line.includes("append failed for refresh")));
  assert.ok(fallback.some((line) => line.includes("append failed for failed")));
  assert.ok(fallback.some((line) => line.includes("status sink failed")));
  assert.ok(fallback.some((line) => line.includes("clear sink failed")));
  assert.ok(fallback.some((line) => line.includes("reveal-output")));
  assert.ok(fallback.every((line) => !line.includes("fixture-token") && !line.includes("fixture-api-key")));

  assert.equal(await feedback.run("success despite logger", async () => "live result"), "live result");
  assert.ok(host.attemptedEvents.includes("succeeded"), "success-terminal sink failures are exercised too");
  assert.ok(fallback.some((line) => line.includes("append failed for succeeded")));
  await feedback.run("cleanup observer fails", async (context) => {
    feedback.onOperationFinished(context, () => { throw new Error("observer failed token=fixture-observer-secret"); });
  });
  assert.ok(fallback.some((line) => line.includes("operation-finish-listener")));
  assert.ok(fallback.every((line) => !line.includes("fixture-observer-secret")));

  host.throwEvents.clear();
  host.throwStatus = false;
  const result = await feedback.run("recovered operation", async () => "result");
  assert.equal(result, "result");
  assert.deepEqual(host.logs.slice(-2).map((entry) => entry.event), ["started", "succeeded"]);
  assert.equal(host.clearCount, 4);
});

test("detailed configuration getter failures fall back to privacy-safe diagnostics", async () => {
  class ConfigurationHost extends DiagnosticHost {
    public override isDetailedDiagnosticsEnabled(): boolean { throw new Error("configuration read failed Cookie: fixture-cookie-value"); }
  }
  const host = new ConfigurationHost(false);
  const fallback: string[] = [];
  const feedback = new OperationFeedback(host, () => 4_540, (line) => fallback.push(line));
  assert.equal(await feedback.run("configuration failure", async () => "unchanged"), "unchanged");
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "succeeded"]);
  assert.ok(fallback.some((line) => line.includes("diagnostics-configuration")));
  assert.ok(fallback.every((line) => !line.includes("fixture-cookie-value")));
});

test("T405 root resolution suppresses selection cancellation and interruption diagnostics but retains I/O failures", async () => {
  const rootA = path.join(tmpdir(), "review-range-root-cancel-a");
  const rootB = path.join(tmpdir(), "review-range-root-cancel-b");
  const secret = "C:\\local-fixture\\root token=fixture-secret repoId=synthetic-owner";
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
    assert.equal(host.logs.some((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution" && entry.operationDiagnostic.status === "cancelled"), true,
      "user cancellation while choosing between repositories is logged as cancellation, not failure");
    inspectionFailure = "abort";
    await refreshCache(item);
    assert.equal(host.logs.some((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution" && entry.operationDiagnostic.status === "cancelled"), true,
      "an interrupted root inspection is logged as cancellation, not failure");
    inspectionFailure = "io";
    await refreshCache(item);
    const diagnostics = host.logs.filter((entry) => entry.operationDiagnostic?.stage === "repository-root-resolution");
    const ioFailure = diagnostics.find((entry) => entry.operationDiagnostic?.status === "failed" && entry.operationDiagnostic.error?.code === "EACCES");
    assert.ok(ioFailure, "ordinary root-inspection I/O failure remains observable");
    assert.ok(diagnostics.some((entry) => entry.operationDiagnostic?.status === "cancelled"), "selection and interruption remain cancellation terminals");
    const output = host.logs.map(formatOperationLogEntry).join("\n") + errors.join("\n");
    assert.match(output, /C:\\local-fixture\\root/u,
      "local Output keeps actionable repository paths");
    assert.doesNotMatch(output, /fixture-secret/u,
      "secret values remain redacted in local Output");
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

test("reported cancellation does not replace a delayed ordinary operation error", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_150);
  const read = deferred<void>();
  const failure = new Error("content read failed after abort notification");
  const operation = feedback.run("PR refresh", async (context) => {
    feedback.reportPullRequestRefresh(context, {
      generation: 1, trigger: "review-contexts-refresh", stage: "refresh-request", status: "cancelled",
      reasonCode: "superseded-by-newer-generation",
    });
    await read.promise;
    throw failure;
  });

  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "refresh"]);
  read.resolve();
  await assert.rejects(operation, (error: unknown) => error === failure);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "refresh", "failed"]);
  assert.equal(host.logs.at(-1)?.errorDetails?.message, failure.message);
  assert.equal(host.logs.filter((entry) => ["succeeded", "failed", "cancelled", "no-result"].includes(entry.event)).length, 1);
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

test("an unreported AbortError receives a cancelled terminal without revealing Output as an error", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 4_300);
  const cancellation = new DOMException("unreported abort", "AbortError");
  await assert.rejects(feedback.run("PR refresh", async () => { throw cancellation; }), (error: unknown) => error === cancellation);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "cancelled"]);
  assert.equal(host.logs.at(-1)?.failureCategory, "stale");
  assert.equal(host.reveals, 0);
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
    assert.match(withFailure, /exception containing \/private\/repo\/source\.ts/u,
      "local exception paths remain available when diagnosing the failed operation");
    for (const secret of ["do-not-log", "private content", "source body"]) assert.equal(withFailure.includes(secret), false);
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

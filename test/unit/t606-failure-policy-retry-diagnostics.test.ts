import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import {
  OperationFeedback,
  OperationDiagnosticError,
  classifyOperationFailure,
  reportActiveOperationFailure,
  reportActiveStorageLockDiagnostic,
  runWithBoundedRetry,
  runWithActiveOperationFeedback,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index";
import { StaleReviewStateError } from "../../src/adapters/state-repository/index";

class FakeHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public busy = 0;
  public clear = 0;
  public reveals = 0;
  public showBusy(): void { this.busy += 1; }
  public clearBusy(): void { this.clear += 1; }
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void { this.reveals += 1; }
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const runtimeRequire = createRequire(__filename);

test("T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages", () => {
  assert.equal(classifyOperationFailure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })).kind, "retryable");
  assert.equal(classifyOperationFailure(Object.assign(new Error("disk"), { code: "ENOSPC" })).kind, "permanent");
  assert.equal(classifyOperationFailure(Object.assign(new Error("limit"), { status: 429 })).kind, "retryable");
  assert.equal(classifyOperationFailure({ name: "GitCommandFailedError", result: { exitCode: -1 } }).kind, "retryable");
  assert.equal(classifyOperationFailure(Object.assign(new Error("expired"), { name: "AbortError" })).kind, "stale");
  assert.equal(classifyOperationFailure(Object.assign(new Error("token"), { status: 401 })).kind, "authentication");
  assert.equal(classifyOperationFailure(new TypeError("bad input")).kind, "validation");
  assert.equal(classifyOperationFailure(new StaleReviewStateError({
    kind: "git", repositoryId: "root-a", contextId: "branch:main"
  })).kind, "stale");
  assert.equal(classifyOperationFailure(new OperationDiagnosticError({
    code: "PR_PROGRESS_UNAVAILABLE",
    attempts: [{ source: "github-patch", reason: "authentication" }],
  })).kind, "authentication");
});

test("T606 retries only retryable faults with a bounded cancellable sequence", async () => {
  let calls = 0;
  const result = await runWithBoundedRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("network"), { code: "ECONNRESET" });
    return "ok";
  }, { maxAttempts: 3, sleep: async () => undefined });
  assert.equal(result.value, "ok");
  assert.deepEqual(result.attempts.map((attempt) => attempt.category), ["retryable", "retryable"]);
  assert.equal(calls, 3);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runWithBoundedRetry(async () => "never", { signal: controller.signal }),
    (error: unknown) => classifyOperationFailure(error).kind === "stale",
  );
});

test("T606 never retries authentication, validation, stale, or partial-side-effect failures", async () => {
  const nonRetryable = [
    Object.assign(new Error("auth"), { status: 401 }),
    new TypeError("validation"),
    new StaleReviewStateError({ kind: "git", repositoryId: "root-a", contextId: "branch:main" }),
    Object.assign(new Error("disk full after write"), { code: "ENOSPC" }),
  ];
  for (const failure of nonRetryable) {
    let calls = 0;
    await assert.rejects(() => runWithBoundedRetry(async () => {
      calls += 1;
      throw failure;
    }, { sleep: async () => undefined }), failure);
    assert.equal(calls, 1);
  }
});

test("T606 emits one bounded single-line redacted ERROR and always clears activity", async () => {
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  const failure = Object.assign(new Error("token=abc\nC:\\private\\repo\\source.ts"), { code: "ENOSPC" });
  await assert.rejects(() => feedback.run("Storage state", async () => { throw failure; }));
  feedback.reportFailure("Storage state", failure);
  const errors = host.logs.filter((entry) => entry.event === "failed");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "Operation failed (code ENOSPC); details were redacted.");
  assert.ok((errors[0]?.message?.length ?? 0) <= 160);
  assert.equal(host.clear, 1);
});

test("T606 makes a handled inner failure terminal exactly once for its shared operation", async () => {
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  setActiveOperationFeedback(feedback);
  try {
    await runWithActiveOperationFeedback("Review Contextsを更新", async (context) => {
      await runWithActiveOperationFeedback("PR進捗を取得", async () => {
        reportActiveOperationFailure("PR進捗を取得", new OperationDiagnosticError({
          code: "PR_PROGRESS_UNAVAILABLE",
          attempts: [{ source: "github-patch", reason: "authentication" }],
        }), context);
      }, undefined, context);
    });
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
    assert.equal(host.logs.filter((entry) => entry.event === "succeeded").length, 0);
    assert.equal(host.clear, 1);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 keeps independent concurrent production operations as separate lifecycles", async () => {
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  const firstGate = deferred<void>();
  const secondGate = deferred<void>();
  setActiveOperationFeedback(feedback);
  try {
    const first = runWithActiveOperationFeedback("Global理解率を再計算", async () => firstGate.promise);
    const second = runWithActiveOperationFeedback("Current Contextを更新", async () => secondGate.promise);
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "started"]);
    firstGate.resolve();
    secondGate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "started", "succeeded", "succeeded"]);
    assert.equal(host.clear, 1);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 joins an actual storage diagnostic to its explicit owner context without a duplicate terminal", async () => {
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  setActiveOperationFeedback(feedback);
  try {
    await runWithActiveOperationFeedback("Storage cacheを更新", async (context) => {
      reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "cache-attempt-1" }, context);
    });
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
    assert.equal(host.logs.filter((entry) => entry.label === "Storage lock").length, 0);

    await runWithActiveOperationFeedback("Storage cacheを更新", async (context) => {
      reportActiveStorageLockDiagnostic({ kind: "stale-recovered", operationId: "cache-attempt-2" }, context);
    });
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed", "started", "succeeded"]);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 Review Contexts runtime fences a superseded source publication", async () => {
  const first = deferred<readonly never[]>();
  const second = deferred<readonly never[]>();
  let call = 0;
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
  };
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => request === "vscode"
    ? fakeVscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async () => (call += 1) === 1 ? first.promise : second.promise,
  });
  const oldRefresh = provider.refresh();
  const newRefresh = provider.refresh();
  second.resolve([]);
  await newRefresh;
  first.resolve([]);
  await oldRefresh;
  assert.deepEqual(provider.getChildren(), []);
});

test("T606 Review Contexts provider aborts an old root load and never publishes its distinct stale item", async () => {
  const old = deferred<readonly never[]>();
  const fresh = [{ label: "fresh" }] as never[];
  const signals: AbortSignal[] = [];
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
  };
  const moduleLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => request === "vscode"
    ? fakeVscode : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  let calls = 0;
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async (signal?: AbortSignal) => {
      signals.push(signal!);
      return ++calls === 1 ? old.promise : fresh;
    },
  });
  const stale = provider.refresh();
  const current = provider.refresh();
  await current;
  assert.equal(signals[0]?.aborted, true);
  old.resolve([{ label: "stale" }] as never[]);
  await stale;
  assert.deepEqual(provider.getChildren(), fresh);
});

test("T606 retries only an actual Review Contexts pure-read runtime operation", async () => {
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
  };
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => request === "vscode"
    ? fakeVscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as {
    runReviewContextsPureRead?: <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  };
  moduleLoader._load = originalLoad;
  assert.equal(typeof runtime.runReviewContextsPureRead, "function");
  let attempts = 0;
  const result = await runtime.runReviewContextsPureRead!(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("temporary read"), { code: "ECONNRESET" });
    return "fresh";
  });
  assert.equal(result, "fresh");
  assert.equal(attempts, 2);
});

test("T606 runs Review Contexts commands through the production registration: read retries, mutations do not", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
    window: { createTreeView: () => ({ dispose: () => undefined }) },
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => Promise<void>) => {
      commands.set(id, handler); return { dispose: () => undefined };
    } },
  };
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => request === "vscode"
    ? fakeVscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  let reads = 0;
  let mutations = 0;
  const errors: unknown[] = [];
  runtime.registerReviewContextsRuntime({ subscriptions: [] } as never, {
    source: { load: async () => {
      reads += 1;
      if (reads === 2) throw Object.assign(new Error("temporary read"), { code: "ECONNRESET" });
      return [];
    } },
    controller: {
      refreshCache: async () => {
        mutations += 1;
        throw Object.assign(new Error("after side effect"), { code: "ECONNRESET" });
      },
    } as never,
    refreshDecorations: async () => undefined,
    reportError: async (error) => { errors.push(error); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await commands.get("reviewRange.refreshReviewContexts")!();
  assert.equal(reads, 3, "one retry follows the initial load");
  await commands.get("reviewRange.refreshReviewContextCache")!({
    context: { kind: "pull-request", contextId: "pr:1" },
  });
  assert.equal(mutations, 1, "a partial side effect is never retried");
  assert.equal(errors.length, 1);
});

test("T606 passes one explicit feedback context through the production Review Contexts read boundary", async () => {
  const commands = new Map<string, (...args: unknown[]) => Promise<void>>();
  const fakeVscode = {
    EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
    TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
    window: { createTreeView: () => ({ dispose: () => undefined }) },
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => Promise<void>) => {
      commands.set(id, handler); return { dispose: () => undefined };
    } },
  };
  const moduleLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => request === "vscode"
    ? fakeVscode : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  delete runtimeRequire.cache[modulePath];
  const runtime = runtimeRequire(modulePath) as typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  let loads = 0;
  let receivedContext = false;
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerReviewContextsRuntime({ subscriptions: [] } as never, {
      source: { load: async (_signal, context) => {
        loads += 1;
        if (loads === 1) return [];
        receivedContext = context?.owner === feedback;
        reportActiveOperationFailure("PR進捗を取得", Object.assign(new Error("authentication"), { status: 401 }), context);
        return [];
      } },
      controller: {} as never,
      refreshDecorations: async () => undefined,
      reportError: async () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await commands.get("reviewRange.refreshReviewContexts")!();
    assert.equal(receivedContext, true);
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "succeeded", "started", "failed"]);
    assert.equal(host.logs.filter((entry) => entry.event === "succeeded").length, 1);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

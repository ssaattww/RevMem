import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import {
  GitHubPullRequestCacheService,
  type GitHubPullRequestCacheEntry,
  type GitHubPullRequestCacheStorage,
  type PullRequestDiffAcquisitionPort,
} from "../../src/application/github-pr-cache/index";
import {
  OperationFeedback,
  reportActiveStorageLockDiagnostic,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index";
import type { PullRequestDiffAcquisitionRequest, PullRequestDiffAcquisitionResult } from "../../src/application/github-pr-diff/index";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";

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

const withVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const originalLoad = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode"
    ? vscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve(moduleName);
  delete runtimeRequire.cache[modulePath];
  const loaded = runtimeRequire(modulePath) as T;
  loader._load = originalLoad;
  return loaded;
};

const fakeVscodeBase = () => ({
  EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
  TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 },
});

test("T606 R6 Current Context production runtime cross-supersedes refresh/select with one signal owner and one typed terminal", async () => {
  const commands = new Map<string, () => Promise<void>>();
  const vscode = {
    ...fakeVscodeBase(),
    StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: () => ({ dispose(): void {} }),
      onDidChangeActiveTextEditor: () => ({ dispose(): void {} }),
    },
    commands: { registerCommand: (id: string, callback: () => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
  };
  const runtime = withVscode<typeof import("../../src/ui/current-context/vscode-current-context-runtime.js")>(
    "../../src/ui/current-context/vscode-current-context-runtime.js", vscode,
  );
  const firstRefresh = deferred<undefined>();
  const selection = deferred<undefined>();
  const refreshSignals: AbortSignal[] = [];
  const selectionSignals: AbortSignal[] = [];
  const errors: unknown[] = [];
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  let refreshCalls = 0;
  let selectCalls = 0;
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerCurrentContextRuntime({ subscriptions: [] } as never, {
      recompute: async (signal) => {
        refreshSignals.push(signal!);
        return refreshCalls++ === 0 ? firstRefresh.promise : undefined;
      },
      selectContext: async (signal) => {
        selectionSignals.push(signal!);
        selectCalls += 1;
        return selection.promise;
      },
    }, { refreshDependents: async () => undefined }, async (error) => { errors.push(error); });
    await new Promise((resolve) => setImmediate(resolve));
    const choose = commands.get(runtime.SELECT_CONTEXT_COMMAND_ID)!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshSignals[0]?.aborted, true, "select supersedes the initial refresh through its shared owner");
    const refresh = commands.get(runtime.REFRESH_CONTEXT_COMMAND_ID)!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(selectionSignals[0]?.aborted, true, "refresh supersedes the in-flight select through the same owner");
    selection.resolve(undefined);
    firstRefresh.resolve(undefined);
    await Promise.all([choose, refresh]);
    assert.equal(selectCalls, 1, "a user selection remains a one-attempt operation");
    assert.equal(errors.length, 0);
    assert.equal(host.logs.filter((entry) => entry.event === "failed").length, 0);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 R6 Review Contexts rejects failed old-root publication and preserves later fresh root data", async () => {
  const old = deferred<readonly { label: string }[]>();
  const signals: AbortSignal[] = [];
  const runtime = withVscode<typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js")>(
    "../../src/ui/review-contexts/vscode-review-contexts-runtime.js", fakeVscodeBase(),
  );
  let calls = 0;
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async (signal) => {
      signals.push(signal!);
      if (calls++ === 0) return old.promise as never;
      return [{ label: "fresh-root-b" }] as never;
    },
  });
  const stale = provider.refresh();
  const current = provider.refresh();
  await current;
  assert.equal(signals[0]?.aborted, true);
  old.resolve([{ label: "old-root-a" }]);
  await stale;
  assert.deepEqual(provider.getChildren(), [{ label: "fresh-root-b" }]);
});

test("T606 R6 Review Contexts mutation forwards its explicit feedback context and emits no outer OK after cache-lock failure", async () => {
  const commands = new Map<string, (...argumentsList: unknown[]) => Promise<void>>();
  const vscode = {
    ...fakeVscodeBase(),
    window: { createTreeView: () => ({ dispose(): void {} }) },
    commands: { registerCommand: (id: string, callback: (...argumentsList: unknown[]) => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
  };
  const runtime = withVscode<typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js")>(
    "../../src/ui/review-contexts/vscode-review-contexts-runtime.js", vscode,
  );
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  let receivedOwner = false;
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerReviewContextsRuntime({ subscriptions: [] } as never, {
      source: { load: async () => [] },
      controller: {
        refreshCache: async (_context: unknown, feedbackContext: { owner?: unknown } | undefined) => {
          receivedOwner = feedbackContext?.owner === feedback;
          reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "r6-cache-lock" }, feedbackContext as never);
        },
      } as never,
      refreshDecorations: async () => undefined,
      reportError: async () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    host.logs.splice(0);
    await commands.get("reviewRange.refreshReviewContextCache")!({ context: { kind: "pull-request", contextId: "pr:r6", pullRequest: {} } });
    assert.equal(receivedOwner, true);
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

const request: PullRequestDiffAcquisitionRequest = {
  contextId: "github:github.com/example/r6#1",
  repository: { host: "github.com", owner: "example", repository: "r6" },
  number: 1,
  baseSha: "1".repeat(40),
  headSha: "2".repeat(40),
};
const snapshot: PullRequestDiffSnapshot = { contextId: request.contextId, baseSha: request.baseSha, headSha: request.headSha, originalDiffId: `${request.baseSha}..${request.headSha}`, files: [] };
const acquired: PullRequestDiffAcquisitionResult = { kind: "acquired", source: "github-patch", snapshot, metadata: { number: 1, title: "R6", url: "https://example.invalid/1", state: "open", baseSha: request.baseSha, headSha: request.headSha } };

test("T606 R6 cache retries acquisition only, publishes once, and never retries a publish failure", async () => {
  let reads = 0;
  let writes = 0;
  const acquisition: PullRequestDiffAcquisitionPort = { acquire: async () => {
    reads += 1;
    return acquired;
  } };
  const storage: GitHubPullRequestCacheStorage = {
    read: async () => undefined,
    write: async (entry: GitHubPullRequestCacheEntry) => { void entry; writes += 1; throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); },
  };
  const cache = new GitHubPullRequestCacheService({ acquisition, storage, freshnessMs: 1_000, now: () => new Date(1_000) });
  const read = await cache.acquireRead(request);
  assert.equal(reads, 1);
  assert.equal(writes, 0, "pure acquisition cannot write cache state");
  const published = await cache.publish(request, read);
  assert.equal(reads, 1);
  assert.equal(writes, 1, "publish failure is one non-retryable side effect");
  assert.equal(published.kind, "acquired");
  assert.deepEqual(published.cache, { origin: "live", freshness: "not-cached" });
});

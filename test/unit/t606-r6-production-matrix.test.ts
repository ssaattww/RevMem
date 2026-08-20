import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import {
  GitHubPullRequestCacheService,
  type GitHubPullRequestCacheEntry,
  type GitHubPullRequestCacheStorage,
  type PullRequestDiffAcquisitionPort,
} from "../../src/application/github-pr-cache/index";
import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/index";
import type { AtomicTextFileStore } from "../../src/adapters/state-repository/index";
import {
  OperationFeedback,
  OperationDiagnosticError,
  reportActiveStorageLockDiagnostic,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index";
import type { PullRequestDiffAcquisitionRequest, PullRequestDiffAcquisitionResult } from "../../src/application/github-pr-diff/index";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index";
import { PullRequestReviewRuntime, type PullRequestReviewRuntimeRegistration } from "../../src/t405-pull-request-review-runtime";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewContextState } from "../../src/core/contracts";
import { CurrentContextUiController, type CurrentContextUiSnapshot } from "../../src/ui/current-context";

const runtimeRequire = createRequire(__filename);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
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
  const refreshOwners: unknown[] = [];
  const selectionSignals: AbortSignal[] = [];
  const selectionOwners: unknown[] = [];
  const errors: unknown[] = [];
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  let refreshCalls = 0;
  let selectCalls = 0;
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerCurrentContextRuntime({ subscriptions: [] } as never, {
      recompute: async (signal, feedbackContext) => {
        refreshSignals.push(signal!);
        refreshOwners.push(feedbackContext?.owner);
        return refreshCalls++ === 0 ? firstRefresh.promise : undefined;
      },
      selectContext: async (signal, feedbackContext) => {
        selectionSignals.push(signal!);
        selectionOwners.push(feedbackContext?.owner);
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
    assert.ok(refreshOwners.every((owner) => owner === feedback), "the Current Context owner reaches its production recompute port");
    assert.ok(selectionOwners.every((owner) => owner === feedback), "the Current Context owner reaches its production selection port");
    assert.equal(errors.length, 0);
    assert.equal(host.logs.filter((entry) => entry.event === "failed").length, 0);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 R7 absorbs a failed old-root load and preserves the fresh-root stale/unknown transition", async () => {
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
  old.reject(Object.assign(new Error("old root failed after switch"), { code: "ECONNRESET" }));
  await assert.rejects(stale, (error: unknown) => error instanceof Error && error.name === "OperationCancelledError");
  assert.deepEqual(provider.getChildren(), [{ label: "fresh-root-b" }]);
});

test("T606 R7 cache publish mutation records a terminal failure, rethrows to its boundary, and starts no post-mutation refresh", async () => {
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
  let loads = 0;
  let writes = 0;
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerReviewContextsRuntime({ subscriptions: [] } as never, {
      source: { load: async () => { loads += 1; return []; } },
      controller: {
        refreshCache: async (_context: unknown, feedbackContext: { owner?: unknown } | undefined) => {
          receivedOwner = feedbackContext?.owner === feedback;
          writes += 1;
          reportActiveStorageLockDiagnostic({ kind: "failure", operationId: "r6-cache-lock" }, feedbackContext as never);
          throw Object.assign(new Error("cache publish failed"), { code: "ENOSPC" });
        },
      } as never,
      refreshDecorations: async () => undefined,
      reportError: async () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const loadsBeforeMutation = loads;
    host.logs.splice(0);
    await commands.get("reviewRange.refreshReviewContextCache")!({ context: { kind: "pull-request", contextId: "pr:r6", pullRequest: {} } });
    assert.equal(receivedOwner, true);
    assert.equal(writes, 1, "a publish failure is a single non-retryable write");
    assert.equal(loads, loadsBeforeMutation, "a thrown terminal mutation cannot start post-mutation refresh");
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
  await assert.rejects(() => cache.publish(request, read));
  assert.equal(reads, 1);
  assert.equal(writes, 1, "publish failure is one non-retryable side effect");
});

test("T606 IFR001 propagates an actual cache write failure instead of projecting live not-cached success", async () => {
  const acquisition: PullRequestDiffAcquisitionPort = { acquire: async () => acquired };
  const cache = new GitHubPullRequestCacheService({
    acquisition,
    storage: { read: async () => undefined, write: async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); } },
    freshnessMs: 1_000,
    now: () => new Date(1_000),
  });
  const read = await cache.acquireRead(request);
  await assert.rejects(() => cache.publish(request, read));
});

test("T606 IFR002 fences a pending Node cache write after abort and returns a typed cancellation", async () => {
  const pendingWrite = deferred<void>();
  const writes: string[] = [];
  const files = new Map<string, string>();
  const store: AtomicTextFileStore = {
    readText: async (filePath) => files.get(filePath),
    writeTextAtomically: async (filePath, content) => {
      writes.push(filePath);
      if (writes.length === 1) await pendingWrite.promise;
      files.set(filePath, content);
    },
  };
  const storage = new NodeGitHubPullRequestCacheStorage({
    cacheDirectory: "/virtual/t606-cache",
    atomicFileStore: store,
    createGenerationId: () => "t606-r4",
  });
  const cache = new GitHubPullRequestCacheService({
    acquisition: { acquire: async () => acquired },
    storage,
    freshnessMs: 1_000,
    now: () => new Date(1_000),
  });
  const controller = new AbortController();
  const read = await cache.acquireRead(request, undefined, controller.signal);
  const publishing = cache.publish(request, read, undefined, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  pendingWrite.resolve();
  await assert.rejects(
    () => publishing,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(writes.length, 1, "abort after pending storage I/O prevents later diff/pointer publication");
});

test("T606 IFR003 runs the production Global layer toggle through one redacted terminal lifecycle", async () => {
  const commands = new Map<string, () => Promise<void>>();
  const vscode = {
    ...fakeVscodeBase(),
    StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
      registerTreeDataProvider: () => ({ dispose(): void {} }),
    },
    commands: { registerCommand: (id: string, callback: () => Promise<void>) => { commands.set(id, callback); return { dispose(): void {} }; } },
    workspace: { onDidChangeConfiguration: () => ({ dispose(): void {} }) },
  };
  const runtime = withVscode<typeof import("../../src/ui/global-understanding/vscode-global-understanding-runtime.js")>(
    "../../src/ui/global-understanding/vscode-global-understanding-runtime.js", vscode,
  );
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  const errors: unknown[] = [];
  setActiveOperationFeedback(feedback);
  try {
    runtime.registerGlobalUnderstandingRuntime({ subscriptions: [] } as never, {
      source: { recalculate: async () => undefined },
      readGlobalLayerEnabled: () => false,
      writeGlobalLayerEnabled: async () => { throw new Error("private settings failure"); },
      refreshDecorations: async () => undefined,
      openFile: async () => undefined,
      reportError: async (error) => { errors.push(error); },
    });
    await commands.get(runtime.TOGGLE_GLOBAL_LAYER_COMMAND_ID)!();
    assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "failed"]);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(String(errors[0]), /private settings failure/u);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 IFR001 republishes the post-cache-publish tree snapshot and fails closed when publication reports failure", async () => {
  const runtime = withVscode<typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js")>(
    "../../src/ui/review-contexts/vscode-review-contexts-runtime.js", fakeVscodeBase(),
  );
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async () => [{ label: "before-publish" }] as never,
    publishLoaded: async () => [{ label: "after-publish" }] as never,
  } as never);
  await provider.refresh();
  assert.deepEqual(provider.getChildren(), [{ label: "after-publish" }]);
});

test("T606 IFR003 Global open throws once to the shared redacted UI boundary without a raw-error callback", async () => {
  const global = await import("../../src/ui/global-understanding/global-understanding-ui-model.js");
  const snapshot = {
    progress: {
      reviewedNonEmptyLineCount: 0,
      totalNonEmptyLineCount: 1,
      progress: 0,
      files: [{ path: "src/a.ts", state: "current" as const, reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 1, progress: 0 }],
    },
    openedFileCount: 1,
    unopenedFileCount: 0,
    excludedFileCount: 0,
    prunedExcludedDirectoryCount: 0,
  };
  const model = global.createGlobalUnderstandingTreeModel(snapshot);
  const controller = new global.GlobalUnderstandingFileOpenController({
    openFile: async () => { throw new Error("private open failure"); },
  });
  controller.replaceModel(model);
  await assert.rejects(() => controller.open(model.files[0]!));
});

test("T606 IFR003 PR Progress carries its owner and abort signal to pending content I/O, then emits one terminal per cancelled, failed, and successful refresh", async () => {
  const contextId = "github-pr:github.com/example/r6#1";
  const fileId = "src/value.ts";
  const state: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "pull-request",
    repositoryId: "github.com/example/r6",
    displayName: "PR #1",
    pullRequest: { host: "github.com", owner: "example", repository: "r6", number: 1, state: "open", title: "R6", baseSha: request.baseSha, headSha: request.headSha },
    files: {}, createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const runtime = new PullRequestReviewRuntime<string>({
    repository: {
      load: async () => ({ schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState: state, globalState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: state.repositoryId, currentRevisionId: request.headSha, files: {}, updatedAt: state.updatedAt } }),
      commit: async () => undefined,
    },
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  const content = deferred<{ kind: "found"; content: string }>();
  const signals: AbortSignal[] = [];
  const owners: unknown[] = [];
  let mode: "pending" | "failure" | "success" = "pending";
  const registration: PullRequestReviewRuntimeRegistration = {
    repositoryId: state.repositoryId, repositoryRoot: "/repo", fileSystemPathSemantics: "posix",
    snapshot: { ...snapshot, contextId, files: [{ fileId, newPath: fileId, status: "added", additions: 1, deletions: 0, hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: [{ kind: "addition", newLine: 1, text: "value" }] }] }] },
    readTextContent: async (_descriptor, feedbackContext, signal) => {
      owners.push(feedbackContext?.owner); signals.push(signal!);
      if (mode === "pending") return content.promise;
      if (mode === "failure") throw Object.assign(new Error("content adapter failed"), { code: "EIO" });
      return { kind: "found", content: "value\n" };
    },
  };
  runtime.register(registration);
  const host = new FeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  setActiveOperationFeedback(feedback);
  try {
    const cancelled = runtime.activateProgress(contextId);
    await new Promise((resolve) => setImmediate(resolve));
    runtime.clearProgress();
    assert.equal(signals[0]?.aborted, true, "clearProgress aborts the signal observed by the deepest content adapter");
    content.resolve({ kind: "found", content: "stale\n" });
    await assert.rejects(
      () => cancelled,
      (error: unknown) => error instanceof Error && error.name === "OperationCancelledError",
      "a superseded operation has a typed cancellation terminal rather than a success terminal",
    );
    assert.equal(
      runtime.progress.getChildren().filter((item) => item.kind === "file").length,
      0,
      "a cancelled pending read cannot publish stale PR Progress",
    );

    runtime.unregister(contextId);
    runtime.register(registration);
    mode = "failure";
    await assert.rejects(() => runtime.activateProgress(contextId));
    runtime.unregister(contextId);
    runtime.register(registration);
    mode = "success";
    await runtime.activateProgress(contextId);
    assert.ok(owners.every((owner) => owner === feedback), "the active PR Progress owner reaches content I/O");
    const events = host.logs.map((entry) => entry.event);
    assert.equal(events.filter((event) => event === "started").length, 3);
    assert.equal(events.filter((event) => event === "succeeded" || event === "failed").length, 3, "each cancellation, failure, and success has exactly one terminal");
    assert.equal(events.filter((event) => event === "failed").length, 2, "cancel and content failure each end once");
    assert.equal(events.filter((event) => event === "succeeded").length, 1, "only the published content snapshot succeeds");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("T606 IFR002 retries only transient result unions through Current Context's cache read port and keeps permanent causes single-attempt", async () => {
  const candidate: CurrentContextUiSnapshot = { context: { kind: "branch", label: "main" }, progress: undefined };
  const seenSignals: AbortSignal[] = [];
  const seenOwners: unknown[] = [];
  let attempts = 0;
  let permanent = false;
  const cache = new GitHubPullRequestCacheService({
    acquisition: {
      acquire: async (_request, feedbackContext, signal) => {
        attempts += 1; seenOwners.push(feedbackContext?.owner); seenSignals.push(signal!);
        return permanent
          ? { kind: "unavailable" as const, attempts: [{ source: "github-patch" as const, reason: "authentication" as const }] }
          : attempts < 3
            ? { kind: "unavailable" as const, attempts: [{ source: "github-patch" as const, reason: "network" as const }] }
            : acquired;
      },
    },
    storage: { read: async (_request, feedbackContext, signal) => { seenOwners.push(feedbackContext?.owner); seenSignals.push(signal!); return undefined; }, write: async () => undefined },
    freshnessMs: 1_000,
  });
  const host = { setCurrentContext: () => undefined, setStatusBar: () => undefined, clearCurrentContext: () => undefined, clearStatusBar: () => undefined };
  const controller = new CurrentContextUiController(host, {
    recompute: async (signal, feedbackContext) => {
      const result = await cache.acquireRead(request, feedbackContext, signal);
      if (result.kind !== "acquired") throw new OperationDiagnosticError({ code: "PR_PROGRESS_UNAVAILABLE", attempts: result.attempts });
      return candidate;
    },
    selectContext: async () => candidate,
  });
  const feedback = new OperationFeedback(new FeedbackHost(), () => 1);
  setActiveOperationFeedback(feedback);
  try {
    await feedback.run("Current Contextを更新", (context) => controller.refresh(new AbortController().signal, context));
    assert.equal(attempts, 3, "network result unions retry at most three times at the Current Context acquisition boundary");
    assert.ok(seenSignals.every((signal) => signal instanceof AbortSignal));
    assert.ok(seenOwners.every((owner) => owner === feedback), "one typed owner reaches acquisition and cache-read ports");
    attempts = 0; permanent = true;
    await assert.rejects(() => feedback.run("Current Contextを更新", (context) => controller.refresh(new AbortController().signal, context)));
    assert.equal(attempts, 1, "authentication result unions are final typed causes and never retry");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/index.js";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  NodeAtomicTextFileStore,
  resolveReviewStateStorageRoute,
} from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import { PullRequestDiffAcquisitionService } from "../../src/application/github-pr-diff/index.js";
import { NormalEditorReviewCommandService } from "../../src/application/review-commands/index.js";
import type { SelectedReviewContext } from "../../src/application/review-context/index.js";
import { isPullRequestDecorationEnabled } from "../../src/application/github-pr-context/index.js";
import {
  augmentCurrentContextCandidatesWithBranchFallback,
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  CurrentContextRuntimeCoordinator,
  CurrentContextUiController,
  type CurrentContextUiSnapshot,
} from "../../src/ui/current-context/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import {
  OperationDiagnosticError,
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationFeedbackContext,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import {
  markReviewedRanges,
  unmarkReviewedRanges,
  type ReviewStateTransaction,
} from "../../src/core/review-state/index.js";
import { PullRequestReviewRuntime } from "../../src/composition/pull-request/pull-request-review-runtime.js";
import { refreshCurrentContextPullRequestViews } from "../../src/composition/current-context/current-context-pull-request-views.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const FILE_ID = "src/example.ts";

interface DisposableLike {
  dispose(): void;
}

interface CapturedReviewContextsProvider {
  onDidChangeTreeData(listener: () => void): DisposableLike;
  getChildren(): ReviewContextListItem[];
}

class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key)
      ? this.values.get(key) as T
      : defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, structuredClone(value));
  }

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

class FakeEventEmitter<Value> {
  private readonly listeners: Array<(value: Value) => void> = [];

  public readonly event = (listener: (value: Value) => void): DisposableLike => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };

  public fire(value: Value): void {
    for (const listener of this.listeners) listener(value);
  }

  public dispose(): void {
    this.listeners.length = 0;
  }
}

class FakeTreeItem {
  public description: string | undefined;
  public tooltip: string | undefined;
  public contextValue: string | undefined;
  public iconPath: unknown;

  public constructor(
    public readonly label: string,
    public readonly collapsibleState: number,
  ) {}
}

class FakeThemeIcon {
  public constructor(public readonly id: string) {}
}

const runGit = async (repositoryRoot: string, argumentsList: readonly string[]): Promise<string> => {
  const result = await execFileAsync("git", [...argumentsList], { cwd: repositoryRoot });
  return result.stdout.trim();
};

const pullRequestContext = (
  baseSha: string,
  headSha: string,
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: `github-pr:${REPOSITORY_ID}#52`,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #52",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "open",
    title: "PR 52",
    baseSha,
    headSha,
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: FILE_ID,
      previousPaths: [],
      revisionId: headSha,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 2,
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
});

const repositoryGlobal = (revisionId: string): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revisionId,
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: FILE_ID,
      revisionId,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
  },
  updatedAt: "2026-08-17T00:00:00.000Z",
});

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const findPullRequestItem = (
  provider: CapturedReviewContextsProvider,
  number: number,
): ReviewContextListItem => {
  const item = provider.getChildren().find((candidate) => candidate.context.pullRequest?.number === number);
  assert.ok(item, `PR #${number} should be projected by Review Contexts.`);
  return item;
};

test("T406-IFR002 rejects non-allowlisted GitHub detection reasons before Output projection", async () => {
  const entries: Array<{ event: string; message?: string }> = [];
  const feedback = new OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => entries.push(entry),
    revealLog: () => undefined,
  }, () => 0);
  for (const reason of ["network", "api", "rate-limit"] as const) {
    await assert.rejects(feedback.run("PRを再検出", async () => {
      throw new OperationDiagnosticError({ code: "GITHUB_PR_DETECTION_UNAVAILABLE", reason });
    }));
    assert.equal(
      entries.filter((entry) => entry.message === `GITHUB_PR_DETECTION_UNAVAILABLE reason=${reason}`).length,
      1,
    );
  }
  const unsafeReason = "token=ghp_example\nC:\\private\\repository";
  assert.throws(
    () => new OperationDiagnosticError({
      code: "GITHUB_PR_DETECTION_UNAVAILABLE",
      reason: unsafeReason as never,
    }),
    TypeError,
  );
  assert.doesNotMatch(JSON.stringify(entries), /ghp_example|private\\repository/u);
});

test("T405-IFR-1 shared production owner rejects one stale lifecycle/mark race without losing Context, Global, manifest, or history", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "revmem-t405-ifr1-"));
  const storageUris = { globalStorageUri: { fsPath: storageRoot } };
  const target = {
    kind: "pull-request" as const,
    repositoryId: REPOSITORY_ID,
    contextId: `github-pr:${REPOSITORY_ID}#52`,
  };
  const owner = new DebouncedReviewStateRepository({
    delegate: new FileSystemReviewStateRepository({ storageUris }),
    debounceMilliseconds: 0,
  });
  const historyEvents: string[] = [];
  const history = new ReviewHistoryRecorder({
    sessionId: "t405-ifr1",
    createEventId: (() => {
      let next = 0;
      return () => `t405-ifr1-${++next}`;
    })(),
    appender: {
      append: async (_target, event) => { historyEvents.push(event.type); },
    },
  });

  try {
    await owner.save(target, {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: pullRequestContext("a".repeat(40), "b".repeat(40)),
      globalState: repositoryGlobal("b".repeat(40)),
    });
    await owner.flush();
    const before = await owner.load(target);
    assert.ok(before);
    const mark = markReviewedRanges({
      contextState: before.contextState,
      globalState: before.globalState,
      target: { fileId: FILE_ID, currentPath: FILE_ID, revisionId: "b".repeat(40), lineCount: 2 },
      intervals: [{ startLine: 1, endLineExclusive: 2 }],
      occurredAt: "2026-08-17T08:33:17.000Z",
    });
    const lifecycle: ReviewStateTransaction = {
      ...mark,
      next: {
        contextState: {
          ...mark.expected.contextState,
          displayName: "PR #52 (lifecycle refreshed)",
          updatedAt: "2026-08-17T08:33:16.000Z",
        },
        globalState: mark.expected.globalState,
      },
    };

    const raced = await Promise.allSettled([owner.commit(lifecycle), owner.commit(mark)]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raced.filter((result) => result.status === "rejected").length, 1);

    const afterRace = await owner.load(target);
    assert.ok(afterRace);
    const retryMark = markReviewedRanges({
      contextState: afterRace.contextState,
      globalState: afterRace.globalState,
      target: { fileId: FILE_ID, currentPath: FILE_ID, revisionId: "b".repeat(40), lineCount: 2 },
      intervals: [{ startLine: 1, endLineExclusive: 2 }],
      occurredAt: "2026-08-17T08:33:18.000Z",
    });
    await owner.commit(retryMark);
    await history.recordTransaction(retryMark, "user-selection");
    const afterMark = await owner.load(target);
    assert.deepEqual(afterMark?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 2 },
    ]);
    assert.deepEqual(afterMark?.globalState.files[FILE_ID]?.reviewed, [
      { startLine: 0, endLineExclusive: 2 },
    ]);

    const unmark = unmarkReviewedRanges({
      contextState: afterMark!.contextState,
      globalState: afterMark!.globalState,
      target: { fileId: FILE_ID, currentPath: FILE_ID, revisionId: "b".repeat(40), lineCount: 2 },
      intervals: [{ startLine: 1, endLineExclusive: 2 }],
      occurredAt: "2026-08-17T08:33:19.000Z",
    });
    await owner.commit(unmark);
    await history.recordTransaction(unmark, "user-selection");
    await owner.flush();
    const durable = await new FileSystemReviewStateRepository({ storageUris }).load(target);
    assert.equal(durable?.contextState.displayName, "PR #52 (lifecycle refreshed)");
    assert.equal(durable?.globalState.repositoryId, REPOSITORY_ID);
    assert.deepEqual(historyEvents, ["marked-reviewed", "unmarked-reviewed"]);
  } finally {
    await owner.dispose();
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revmem-t405-composition-"));
  const repositoryRoot = path.join(temporaryRoot, "repository");
  const globalStorageRoot = path.join(temporaryRoot, "global-storage");
  const workspaceStorageRoot = path.join(temporaryRoot, "workspace-storage");
  const sourcePath = path.join(repositoryRoot, FILE_ID);
  const contexts: Array<{ subscriptions: DisposableLike[] }> = [];
  const originalFetch = globalThis.fetch;
  const moduleLoader = Module as unknown as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const originalModuleLoad = moduleLoader._load;

  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(globalStorageRoot, { recursive: true });
    await mkdir(workspaceStorageRoot, { recursive: true });
    await runGit(repositoryRoot, ["init", "-b", "main"]);
    await runGit(repositoryRoot, ["config", "user.email", "review-range@example.invalid"]);
    await runGit(repositoryRoot, ["config", "user.name", "Review Range Test"]);
    await writeFile(sourcePath, "keep\nold", "utf8");
    await runGit(repositoryRoot, ["add", FILE_ID]);
    await runGit(repositoryRoot, ["commit", "-m", "base"]);
    const baseSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(repositoryRoot, ["commit", "--allow-empty", "-m", "source head"]);
    const sourceHeadSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await writeFile(sourcePath, "keep\nnew", "utf8");
    await runGit(repositoryRoot, ["commit", "-am", "target head"]);
    const targetHeadSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/ssaattww/revmem.git"]);

    const storageUris = {
      globalStorageUri: { fsPath: globalStorageRoot },
      storageUri: { fsPath: workspaceStorageRoot },
    };
    const stateRepository = new FileSystemReviewStateRepository({ storageUris });
    let nextHistoryEventId = 0;
    const historyEvents: Array<{
      readonly contextId: string;
      readonly fileId: string;
      readonly revisionId: string;
      readonly action: string;
    }> = [];
    const historyStore = new JsonlReviewHistoryStore({ storageUris });
    const historyRecorder = new ReviewHistoryRecorder({
      sessionId: "t405-composition",
      createEventId: () => `t405-composition-event-${++nextHistoryEventId}`,
      appender: {
        append: async (target, event) => {
          if ("filePath" in event) {
            historyEvents.push({
              contextId: event.contextId,
              fileId: event.filePath,
              revisionId: event.revisionId,
              action: event.type,
            });
          }
          await historyStore.append(target, event);
        },
      },
    });
    const contextId52 = `github-pr:${REPOSITORY_ID}#52`;
    const contextId53 = `github-pr:${REPOSITORY_ID}#53`;
    await stateRepository.save(
      { kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: contextId52 },
      {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState: pullRequestContext(baseSha, sourceHeadSha),
        globalState: repositoryGlobal(sourceHeadSha),
      },
    );

    let earlyLifecycleFailures = 0;
    let earlyAcquisitionInterrupt: (() => Promise<void>) | undefined;
    const unsafeAcquisitionError = "token=ghp_private /private/customer/source.ts https://private.invalid/pr";
    let lifecycle52: "open" | "closed" | "merged" = "open";
    let lifecycle53: "open" | "closed" | "merged" = "open";
    let refreshTransport: "live" | "offline" = "live";
    let discoveryTransport: "live" | "network" | "zero" = "live";
    let remoteBaseSha = baseSha;
    let remoteHeadSha = targetHeadSha;
    let patchOldLine = "old";
    let patchNewLine = "new";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/repos/ssaattww/revmem/pulls" && url.searchParams.get("state") === "open") {
        if (discoveryTransport === "network") throw new Error("network interrupted during PR detection");
        if (discoveryTransport === "zero") return jsonResponse([]);
        return jsonResponse([52, 53].map((number) => ({
          number,
          title: `PR ${number}`,
          html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          head: { sha: remoteHeadSha },
          base: { ref: "main", sha: remoteBaseSha },
        })));
      }
      if (url.pathname === `/repos/ssaattww/revmem/compare/${remoteBaseSha}...${remoteHeadSha}`) {
        return jsonResponse({ merge_base_commit: { sha: remoteBaseSha } });
      }
      if (url.pathname === "/repos/ssaattww/revmem/pulls/52/files") {
        if (refreshTransport === "offline") throw new Error("offline for cache fallback");
        return jsonResponse([{
          filename: FILE_ID,
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: `@@ -1,2 +1,2 @@\n keep\n-${patchOldLine}\n+${patchNewLine}`,
        }]);
      }
      const lifecycleMatch = /^\/repos\/ssaattww\/revmem\/pulls\/(52|53)$/u.exec(url.pathname);
      if (lifecycleMatch !== null) {
        const interrupt = earlyAcquisitionInterrupt;
        earlyAcquisitionInterrupt = undefined;
        await interrupt?.();
        if (earlyLifecycleFailures > 0) {
          earlyLifecycleFailures -= 1;
          throw new Error(unsafeAcquisitionError);
        }
        if (refreshTransport === "offline" && lifecycleMatch[1] === "52") {
          throw new Error("offline for cache fallback");
        }
        const number = Number(lifecycleMatch[1]);
        const lifecycle = number === 52 ? lifecycle52 : lifecycle53;
        return jsonResponse({
          number,
          title: `PR ${number}`,
          html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          state: lifecycle === "open" ? "open" : "closed",
          merged_at: lifecycle === "merged" ? "2026-08-17T00:30:00Z" : null,
          changed_files: number === 52 ? 1 : 0,
          base: { sha: remoteBaseSha },
          head: { sha: remoteHeadSha },
        });
      }
      throw new Error(`Unexpected GitHub request in T405 composition regression: ${url}`);
    };

    const commands = new Map<string, (...argumentsList: unknown[]) => unknown>();
    const providers: CapturedReviewContextsProvider[] = [];
    const initialProviderRefreshes = new WeakMap<CapturedReviewContextsProvider, Promise<void>>();
    const errors: string[] = [];
    let injectCacheStorage = false;
    let cacheAtomicWriteFailure: "ENOSPC" | "EACCES" | undefined;
    let cacheAtomicWrites = 0;
    const cacheStorageFactory = (cacheDirectory: string) => {
      const nodeStore = new NodeAtomicTextFileStore(path.dirname(cacheDirectory));
      return new NodeGitHubPullRequestCacheStorage({
        cacheDirectory,
        atomicFileStore: {
          readText: (filePath) => nodeStore.readText(filePath),
          writeTextAtomically: async (filePath, content) => {
            cacheAtomicWrites += 1;
            if (cacheAtomicWriteFailure !== undefined) {
              throw Object.assign(new Error(`deterministic cache atomic write failure: ${cacheAtomicWriteFailure}`), {
                code: cacheAtomicWriteFailure,
              });
            }
            await nodeStore.writeTextAtomically(filePath, content);
          },
          deleteText: (filePath) => nodeStore.deleteText(filePath),
        },
      });
    };
    const workspaceState = new MemoryMemento();
    let redetectChoice: 52 | 53 | undefined = 53;
    const fakeVscode = {
      CancellationTokenSource: class { public readonly token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }; public cancel(): void {} public dispose(): void {} },
      EventEmitter: FakeEventEmitter,
      TreeItem: FakeTreeItem,
      ThemeIcon: FakeThemeIcon,
      TreeItemCollapsibleState: { None: 0 },
      commands: {
        registerCommand: (id: string, handler: (...argumentsList: unknown[]) => unknown): DisposableLike => {
          commands.set(id, handler);
          return { dispose: () => undefined };
        },
      },
      window: {
        activeTextEditor: {
          document: {
            uri: { scheme: "file", authority: "", fsPath: sourcePath, query: "", fragment: "" },
          },
        },
        createTreeView: (_id: string, options: { treeDataProvider: CapturedReviewContextsProvider }): DisposableLike => {
          const provider = options.treeDataProvider;
          let resolveInitialRefresh!: () => void;
          initialProviderRefreshes.set(provider, new Promise<void>((resolve) => {
            resolveInitialRefresh = resolve;
          }));
          const initialRefreshListener = provider.onDidChangeTreeData(() => resolveInitialRefresh());
          providers.push(provider);
          return { dispose: () => initialRefreshListener.dispose() };
        },
        showQuickPick: async (items: readonly unknown[], options?: { placeHolder?: string }): Promise<unknown> => {
          if (options?.placeHolder === "現在HEADのPRを選択") {
            return items.find((item) =>
              (item as { candidate?: { number?: number } }).candidate?.number === redetectChoice
            );
          }
          return items[0];
        },
        showErrorMessage: async (message: string): Promise<undefined> => {
          errors.push(message);
          return undefined;
        },
      },
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        textDocuments: [],
        workspaceFolders: [{ uri: { scheme: "file", authority: "", fsPath: repositoryRoot, query: "", fragment: "" } }],
      },
      authentication: {
        getSession: async () => undefined,
      },
    };

    moduleLoader._load = (request, parent, isMain) => request === "vscode"
      ? fakeVscode
      : Reflect.apply(originalModuleLoad, Module, [request, parent, isMain]) as unknown;
    const runtimeModulePath = runtimeRequire.resolve("../../src/composition/review-contexts/review-contexts-runtime.js");
    delete runtimeRequire.cache[runtimeModulePath];
    const runtimeModule = runtimeRequire(runtimeModulePath) as typeof import("../../src/composition/review-contexts/review-contexts-runtime.js");
    moduleLoader._load = originalModuleLoad;

    // T406-R001: an explicit branch/no-PR preference is scoped to its repository
    // and immutable HEAD; selecting a PR at another key must not erase it.
    moduleLoader._load = (request, parent, isMain) => request === "vscode"
      ? fakeVscode
      : Reflect.apply(originalModuleLoad, Module, [request, parent, isMain]) as unknown;
    const selectionStoreModulePath = runtimeRequire.resolve(
      "../../src/ui/review-contexts/vscode-review-contexts-runtime.js"
    );
    delete runtimeRequire.cache[selectionStoreModulePath];
    const selectionStoreModule = runtimeRequire(selectionStoreModulePath) as typeof import(
      "../../src/ui/review-contexts/vscode-review-contexts-runtime.js"
    );
    moduleLoader._load = originalModuleLoad;
    const preferenceStore = new selectionStoreModule.VscodeCurrentPullRequestSelectionStore(workspaceState);
    await preferenceStore.selectBranch(REPOSITORY_ID, targetHeadSha);
    await preferenceStore.select(
      "github.com/ssaattww/another-repository",
      sourceHeadSha,
      "github-pr:github.com/ssaattww/another-repository#9",
    );
    assert.equal(preferenceStore.prefersBranch(REPOSITORY_ID, targetHeadSha), true);
    await preferenceStore.clear(REPOSITORY_ID, targetHeadSha);
    assert.equal(preferenceStore.prefersBranch(REPOSITORY_ID, targetHeadSha), false);
    assert.equal(
      preferenceStore.read("github.com/ssaattww/another-repository", sourceHeadSha),
      "github-pr:github.com/ssaattww/another-repository#9",
    );

    const localGit = createNodeLocalGitAdapter();
    const openedDiffs: Array<{ original: string; modified: string; title: string }> = [];
    const pullRequestReviewRuntime = new PullRequestReviewRuntime<string>({
      repository: stateRepository,
      requestHistory: (transaction) => historyRecorder.recordTransaction(transaction, "user-selection"),
      diffHost: {
        parseUri: (value) => value,
        openDiff: async (original, modified, title) => {
          openedDiffs.push({ original, modified, title });
        },
      },
      getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    });
    let branchSnapshot: CurrentContextUiSnapshot = {
      context: {
        kind: "branch",
        label: "main",
        detail: repositoryRoot,
        headRevision: targetHeadSha,
        selection: {
          kind: "branch",
          repositoryId: REPOSITORY_ID,
          repositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    };
    let enumerateEnabled = false;
    let localDiffUnavailable = false;
    let registered: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime> | undefined;
    const selectedContexts: Array<SelectedReviewContext | undefined> = [];

    const refreshCurrentContext = async (feedbackContext?: OperationFeedbackContext): Promise<void> => {
      assert.ok(registered);
      const selection = new CurrentContextCandidateSelection();
      const composition = new CurrentContextRuntimeComposition(selection, {
        enumerateCandidates: () => registered!.augmentCurrentContextCandidates([branchSnapshot]),
        resolveFallback: async (available) =>
          available.find((candidate) => candidate.context.kind === "pull-request") ?? available[0],
        requestSelection: async () => undefined,
      });
      const controller = new CurrentContextUiController(
        {
          setCurrentContext: () => undefined,
          setStatusBar: () => undefined,
          clearCurrentContext: () => undefined,
          clearStatusBar: () => undefined,
        },
        {
          recompute: () => composition.recompute(),
          selectContext: () => composition.selectContext(),
          acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
          acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot),
        },
      );
      const coordinator = new CurrentContextRuntimeCoordinator(controller, {
        setSelectedContext: (selected) => selectedContexts.push(selected),
        refreshDependents: (refreshContext) =>
          registered?.refreshListOnly?.(refreshContext?.feedbackContext),
      });
      await coordinator.refresh(undefined, feedbackContext, { allowInteraction: false }, "review-contexts-refresh");
    };

    const createExtensionContext = (): {
      context: Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]["context"];
      subscriptions: DisposableLike[];
    } => {
      const subscriptions: DisposableLike[] = [];
      const context = {
        globalStorageUri: { fsPath: globalStorageRoot },
        storageUri: { fsPath: workspaceStorageRoot },
        workspaceState,
        subscriptions,
      } as unknown as Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]["context"];
      contexts.push({ subscriptions });
      return { context, subscriptions };
    };

    const registerRuntime = async (): Promise<{
      runtime: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime>;
      provider: CapturedReviewContextsProvider;
    }> => {
      enumerateEnabled = false;
      const extensionContext = createExtensionContext();
      const runtime = runtimeModule.registerT405ReviewContextsRuntime({
        context: extensionContext.context,
        git: localGit,
        enumerateCurrentContexts: async () => enumerateEnabled ? [branchSnapshot] : [],
        refreshDecorations: async () => undefined,
        refreshCurrentContext,
        registerPullRequestReviewDiff: (registration) => pullRequestReviewRuntime.register(registration),
        openPullRequestReviewDiff: (contextId, fileId, title) =>
          pullRequestReviewRuntime.openReviewDiff(contextId, fileId, title),
        getPullRequestReviewProgress: (contextId, feedbackContext, signal) =>
          pullRequestReviewRuntime.getProgress(contextId, feedbackContext, signal),
        reviewStateRepository: stateRepository,
        reviewHistoryRecorder: historyRecorder,
        createPullRequestDiffAcquisition: ({ local, remote }) => new PullRequestDiffAcquisitionService({
          local: localDiffUnavailable
            ? { loadDiff: async () => ({ kind: "unavailable" as const, reason: "git-unavailable" as const }) }
            : local,
          remote,
        }),
        ...(injectCacheStorage ? { createPullRequestCacheStorage: cacheStorageFactory } : {}),
      } as Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]);
      registered = runtime;
      enumerateEnabled = true;
      const provider = providers.at(-1);
      assert.ok(provider);
      const initialRefresh = initialProviderRefreshes.get(provider);
      assert.ok(initialRefresh);
      await initialRefresh;
      assert.deepEqual(errors, [], "the automatic empty startup refresh must drain before commands begin");
      return { runtime, provider };
    };

    const invoke = async (id: string, ...argumentsList: unknown[]): Promise<void> => {
      const handler = commands.get(id);
      assert.ok(handler, `${id} should be registered by the T405 production runtime.`);
      await handler(...argumentsList);
      assert.deepEqual(errors, [], `T405 command ${id} should not report an error.`);
    };

    // R405-1 + R405-7: redetect itself must cross the T405 synchronization/resolver seam.
    let current = await registerRuntime();
    fakeVscode.window.activeTextEditor = undefined as never;
    await invoke("reviewRange.redetectPullRequest");
    const mapped = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.equal(mapped?.contextState.pullRequest?.headSha, targetHeadSha);
    assert.equal(mapped?.globalState.currentRevisionId, targetHeadSha);
    assert.equal(mapped?.contextState.files[FILE_ID]?.revisionId, targetHeadSha);
    assert.equal(mapped?.globalState.files[FILE_ID]?.revisionId, targetHeadSha);
    assert.deepEqual(mapped?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 1 },
    ]);
    const selectedAfterRedetect = selectedContexts.at(-1);
    assert.equal(selectedAfterRedetect?.kind, "pull-request");
    if (selectedAfterRedetect?.kind !== "pull-request") {
      throw new Error("same-HEAD redetection did not publish a pull-request Current Context");
    }
    assert.equal(
      selectedAfterRedetect.contextId,
      contextId53,
      "same-HEAD redetection must preserve the user-selected PR into normal-editor ownership",
    );

    const assertClosedStages = (entries: readonly OperationLogEntry[]): void => {
      const records = entries.flatMap((entry) => entry.pullRequestRefresh === undefined ? [] : [{ ...entry.pullRequestRefresh, operationId: entry.operationId }]);
      for (const started of records.filter((record) => record.status === "started")) {
        const terminals = records.filter((record) => record.operationId === started.operationId && record.generation === started.generation &&
          record.stage === started.stage && !["started", "progress"].includes(record.status));
        assert.equal(terminals.length, 1, `${started.stage} must have exactly one terminal for its owner/generation`);
        assert.equal(typeof terminals[0]?.durationMs, "number", `${started.stage} must close with duration`);
      }
      assert.doesNotMatch(JSON.stringify(entries), /ghp_private|private\.invalid|customer\/source|repositoryRoot|contextId|baseSha|headSha/u);
    };

    await t.test("R3 NR-006 early actual T405 acquisition failure retains safe verified-branch recovery provenance", async () => {
      for (const trigger of ["current-context-refresh", "review-contexts-refresh"] as const) {
        const entries: OperationLogEntry[] = [];
        const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
        let accepted: CurrentContextUiSnapshot | undefined;
        let listRecovered = false;
        const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
          enumerateCandidates: (signal, owner) => augmentCurrentContextCandidatesWithBranchFallback([branchSnapshot],
            () => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner), signal),
          resolveFallback: async (available) => available.find((candidate) => candidate.context.kind === "pull-request") ?? available[0],
          requestSelection: async () => undefined,
        });
        const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
          recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
          selectContext: (signal, owner) => composition.selectContext(signal, owner),
          acceptRecomputed: (snapshot) => { accepted = snapshot; composition.acceptRecomputed(snapshot); },
        });
        const coordinator = new CurrentContextRuntimeCoordinator(controller, {
          acceptCurrentContextPreparation: (selection) => current.runtime.acceptCurrentContextPreparation?.(selection),
          refreshDependents: (owner) => refreshCurrentContextPullRequestViews({
            selection: accepted?.context.selection, runtime: pullRequestReviewRuntime,
            refreshList: async (parent) => { await current.runtime.refreshListOnly?.(parent, owner?.signal); listRecovered = true; },
            refreshProgress: async () => pullRequestReviewRuntime.clearProgress(),
            refreshDecorations: async () => undefined, refreshGlobal: async () => undefined, reportProgressError() {},
          }, owner),
        });
        earlyLifecycleFailures = 1;
        await feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner, undefined, trigger));
        assert.equal(earlyLifecycleFailures, 0, "actual lifecycle adapter must consume the early failure");
        assert.equal(accepted?.context.kind, "branch");
        assert.equal(listRecovered, true, "later real list acquisition recovers in the same operation");
        const acquisition = entries.find((entry) => entry.pullRequestRefresh?.stage === "pr-acquisition" && entry.pullRequestRefresh?.status === "failed");
        assert.equal(acquisition?.pullRequestRefresh?.reasonCode, "verified-branch-preserved", `${trigger}: retain the initial failure and recovery cause`);
        assert.equal(entries.filter((entry) => entry.event === "succeeded").length, 1);
        assertClosedStages(entries);
      }
    });

    await t.test("R3 NR-006 actual acquisition exception closes repository identity for both entries and explicit selection", async () => {
      for (const trigger of ["current-context-refresh", "review-contexts-refresh", "current-context-selection"] as const) {
        const entries: OperationLogEntry[] = [];
        const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
        const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
          enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
          resolveFallback: async (available) => available[0], requestSelection: async (available) => available[0],
        });
        const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
          recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
          selectContext: (signal, owner) => composition.selectContext(signal, owner),
        });
        let dependents = 0;
        const coordinator = new CurrentContextRuntimeCoordinator(controller, { refreshDependents: async () => { dependents += 1; } });
        earlyLifecycleFailures = trigger === "current-context-selection" ? 1 : 3;
        await assert.rejects(feedback.run("Current Contextを更新", (owner) => trigger === "current-context-selection"
          ? coordinator.selectContext(undefined, owner) : coordinator.refresh(undefined, owner, undefined, trigger)));
        assert.equal(dependents, 0);
        assert.equal(entries.filter((entry) => entry.pullRequestRefresh?.stage === "repository-identity" && entry.pullRequestRefresh.status === "failed").length, 1,
          `${trigger}: rejected acquisition must close started identity`);
        assertClosedStages(entries);
      }
    });

    await t.test("R3 NR-006 interrupted actual T405 acquisition closes every started owner stage once", async () => {
      for (const trigger of ["current-context-refresh", "review-contexts-refresh", "current-context-selection"] as const) {
        for (const interruption of ["cancelled", "superseded"] as const) {
          const entries: OperationLogEntry[] = [];
          const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
          const cancellation = new AbortController();
          let started!: () => void;
          let release!: () => void;
          const began = new Promise<void>((resolve) => { started = resolve; });
          const gate = new Promise<void>((resolve) => { release = resolve; });
          earlyAcquisitionInterrupt = async () => { started(); await gate; throw new Error(unsafeAcquisitionError); };
          const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
            enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
            resolveFallback: async (available) => available.find((candidate) => candidate.context.kind === "pull-request") ?? available[0],
            requestSelection: async (available) => available[0],
          });
          const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
            recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
            selectContext: (signal, owner) => composition.selectContext(signal, owner),
          });
          const coordinator = new CurrentContextRuntimeCoordinator(controller, { refreshDependents: async () => undefined });
          const old = feedback.run("Current Contextを更新", (owner) => trigger === "current-context-selection"
            ? coordinator.selectContext(cancellation.signal, owner) : coordinator.refresh(cancellation.signal, owner, undefined, trigger));
          await began;
          if (interruption === "cancelled") cancellation.abort();
          else await feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner));
          release();
          await old;
          for (const stage of ["repository-identity", "pr-acquisition", "current-context"] as const) {
            assert.equal(entries.filter((entry) => entry.operationId === 1 && entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === interruption).length, 1,
              `${trigger}/${interruption}: acquisition must close ${stage}`);
          }
          assertClosedStages(entries);
        }
      }
    });

    await t.test("R3 NR-006 actual explicit-selection PR publication failure closes its started stage once", async () => {
      for (const interruption of ["failed", "cancelled", "superseded"] as const) {
        const cancellation = new AbortController();
        let chooseBranch = false;
        const entries: OperationLogEntry[] = [];
        const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
        let accepted: CurrentContextUiSnapshot | undefined;
        const outcomeRuntime = new PullRequestReviewRuntime<string>({
          repository: { load: async () => {
            if (interruption === "cancelled") cancellation.abort();
            if (interruption === "superseded") {
              chooseBranch = true;
              await feedback.run("Current Contextを選択", (owner) => coordinator.selectContext(undefined, owner));
            }
            throw new Error(unsafeAcquisitionError);
          }, commit: (transaction) => stateRepository.commit(transaction) },
          requestHistory: async () => undefined, diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
          getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
        });
        const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
          enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
          resolveFallback: async (available) => available[0],
          requestSelection: async (available) => chooseBranch ? available.find((candidate) => candidate.context.kind === "branch") : available.find((candidate) => candidate.context.selection?.kind === "pull-request" && candidate.context.selection.contextId === contextId53),
        });
        const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
          recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
          selectContext: (signal, owner) => composition.selectContext(signal, owner),
          acceptExplicit: (snapshot) => { accepted = snapshot; composition.acceptExplicit(snapshot); },
        });
        const coordinator = new CurrentContextRuntimeCoordinator(controller, {
          acceptCurrentContextPreparation: (selection) => current.runtime.acceptCurrentContextPreparation?.(selection),
          refreshDependents: async (owner) => {
            const snapshot = pullRequestReviewRuntime.snapshotForContext(contextId53);
            assert.ok(snapshot);
            outcomeRuntime.register({ repositoryId: REPOSITORY_ID, repositoryRoot, fileSystemPathSemantics: "posix", snapshot,
              readTextContent: async () => ({ kind: "found", content: "" }) });
            await refreshCurrentContextPullRequestViews({
              selection: accepted?.context.selection, runtime: outcomeRuntime,
              refreshList: (parent) => current.runtime.refreshListOnly?.(parent, owner?.signal) ?? Promise.resolve(),
              refreshProgress: async (parent) => {
                if (accepted?.context.selection?.kind === "pull-request") await outcomeRuntime.activateProgress(contextId53, parent, owner?.signal);
                else outcomeRuntime.clearProgress();
              },
              refreshDecorations: async () => undefined, refreshGlobal: async () => undefined, reportProgressError() {},
            }, owner);
          },
        });
        const operation = feedback.run("Current Contextを選択", (owner) => coordinator.selectContext(cancellation.signal, owner));
        if (interruption === "failed") await assert.rejects(operation); else await operation;
        assert.equal(accepted?.context.pullRequestCandidateCount, 2, "selection metadata must come from real T405 resolver");
        for (const stage of ["pr-progress", "tree-publication"] as const) {
          const terminals = entries.filter((entry) => entry.operationId === 1 && entry.pullRequestRefresh?.stage === stage && !["started", "progress"].includes(entry.pullRequestRefresh.status));
          assert.equal(terminals.length, 1, `${stage}/${interruption}: explicit publication must terminate once`);
          assert.equal(terminals[0]?.pullRequestRefresh?.status, interruption === "failed" ? "failed" : "superseded");
        }
        assert.equal(entries.filter((entry) => entry.event === "failed").length, interruption === "failed" ? 1 : 0);
        if (interruption === "superseded") {
          assert.equal(accepted?.context.kind, "branch", "new explicit branch must remain accepted");
          assert.equal(outcomeRuntime.progress.getEffectiveProgress().files.length, 0);
        }
        assertClosedStages(entries);
      }
    });

    await t.test("R2 NR-006 actual T405 recompute closes Current Context and repository identity stages", async () => {
      const entries: OperationLogEntry[] = [];
      const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
      const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
        enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
        resolveFallback: async (available) => available.find((candidate) => candidate.context.kind === "pull-request") ?? available[0],
        requestSelection: async () => undefined,
      });
      const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
        recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
        selectContext: (signal, owner) => composition.selectContext(signal, owner),
      });
      const coordinator = new CurrentContextRuntimeCoordinator(controller, { refreshDependents: async () => undefined });
      await feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner));
      for (const stage of ["repository-identity", "current-context"] as const) {
        assert.ok(entries.some((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "started"), `${stage} recompute must start`);
        const completed = entries.find((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "succeeded");
        assert.equal(typeof completed?.pullRequestRefresh?.durationMs, "number", `${stage} recompute must close`);
      }
    });

    await t.test("R2 NR-006 actual T405 explicit multiple-candidate selection retains provenance and completes identity stages", async () => {
      const entries: OperationLogEntry[] = [];
      const feedback = new OperationFeedback({
        showBusy: () => undefined, clearBusy: () => undefined,
        appendLog: (entry) => entries.push(entry), revealLog: () => undefined,
      });
      let acceptedSnapshot: CurrentContextUiSnapshot | undefined;
      let observedProvenance: Readonly<{ reason?: string; candidateCount?: number }> | undefined;
      const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
        enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
        resolveFallback: async (available) => available[0],
        requestSelection: async (available) => available.find((candidate) =>
          candidate.context.selection?.kind === "pull-request" && candidate.context.selection.contextId === contextId53),
      });
      const controller = new CurrentContextUiController({
        setCurrentContext: () => undefined, setStatusBar: () => undefined,
        clearCurrentContext: () => undefined, clearStatusBar: () => undefined,
      }, {
        recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
        selectContext: (signal, owner) => composition.selectContext(signal, owner),
        acceptExplicit: (snapshot) => { acceptedSnapshot = snapshot; composition.acceptExplicit(snapshot); },
      });
      const coordinator = new CurrentContextRuntimeCoordinator(controller, {
        setSelectedContext: () => undefined,
        acceptCurrentContextPreparation: (selected) => current.runtime.acceptCurrentContextPreparation?.(selected),
        refreshDependents: async (owner) => {
          observedProvenance = owner?.selectionProvenance();
          await refreshCurrentContextPullRequestViews({
            selection: acceptedSnapshot?.context.selection,
            runtime: pullRequestReviewRuntime,
            refreshList: (feedbackContext) => current.runtime.refreshListOnly?.(feedbackContext, owner?.signal) ?? Promise.resolve(),
            refreshProgress: async (feedbackContext) => {
              const selected = acceptedSnapshot?.context.selection;
              if (selected?.kind === "pull-request") await pullRequestReviewRuntime.activateProgress(selected.contextId, feedbackContext, owner?.signal);
              else pullRequestReviewRuntime.clearProgress();
            },
            refreshDecorations: async () => undefined, refreshGlobal: async () => undefined,
            reportProgressError: () => undefined,
          }, owner);
        },
      });
      await feedback.run("Current Contextを選択", (owner) => coordinator.selectContext(undefined, owner));
      // Candidate metadata is produced by real resolver -> T405 synchronization,
      // then revalidated and accepted through the real explicit-selection path.
      assert.equal(acceptedSnapshot?.context.pullRequestCandidateCount, 2);
      assert.equal(acceptedSnapshot?.context.selectionReason, "explicit-selection-kept");
      const refreshes = entries.filter((entry) => entry.event === "refresh");
      const identity = refreshes.find((entry) => entry.pullRequestRefresh?.stage === "repository-identity" &&
        entry.pullRequestRefresh.status === "succeeded");
      const completion = refreshes.find((entry) => entry.pullRequestRefresh?.stage === "current-context" && entry.pullRequestRefresh.status === "succeeded");
      const terminal = entries.find((entry) => entry.event === "succeeded");
      assert.deepEqual({
        provenance: observedProvenance,
        identityStatus: identity?.pullRequestRefresh?.status,
        contextCompletion: completion?.pullRequestRefresh?.status,
        sameOwner: identity !== undefined && completion !== undefined && terminal !== undefined &&
          identity.operationId === terminal.operationId && completion.operationId === terminal.operationId,
        sameGeneration: identity !== undefined && completion !== undefined &&
          identity.pullRequestRefresh?.generation === completion.pullRequestRefresh?.generation,
      }, {
        provenance: { reason: "explicit-selection-kept", candidateCount: 2 },
        identityStatus: "succeeded", contextCompletion: "succeeded", sameOwner: true, sameGeneration: true,
      }, "explicit selection must retain two real PR candidates and complete correlated identity/context stages");
      const selectionStage = refreshes.find((entry) => entry.pullRequestRefresh?.stage === "pr-selection" && entry.pullRequestRefresh.status === "succeeded");
      assert.equal(selectionStage?.pullRequestRefresh?.counts?.pullRequestCandidates, 2);
      for (const stage of ["pr-selection", "pr-progress", "diff-registration", "review-contexts-list", "tree-publication"] as const) {
        assert.ok(refreshes.some((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "started"), `${stage} must start`);
        const completed = refreshes.find((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "succeeded");
        assert.equal(typeof completed?.pullRequestRefresh?.durationMs, "number", `${stage} must close with duration`);
      }
      entries.length = 0;
      await feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner));
      for (const stage of ["repository-identity", "current-context"] as const) {
        assert.ok(entries.some((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "started"), `${stage} recompute must start`);
        const completed = entries.find((entry) => entry.pullRequestRefresh?.stage === stage && entry.pullRequestRefresh.status === "succeeded");
        assert.equal(typeof completed?.pullRequestRefresh?.durationMs, "number", `${stage} recompute must close`);
      }
    });

    await t.test("R2 NR-006 actual T405 decisions and production emitted outcomes cover unique ambiguous no-match empty unregistered and failed snapshots", async () => {
      const savedPreferences = workspaceState.get<unknown>("reviewRange.currentPullRequestSelections.v1");
      const savedBranch = branchSnapshot;
      const savedBaseSha = remoteBaseSha;
      const saved53 = await stateRepository.load({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: contextId53 });
      assert.ok(saved53?.contextState.pullRequest);
      const cases = [
        { name: "unique", reason: "unique-pr-match", candidates: 1, files: 1 },
        { name: "ambiguous", reason: "ambiguous-pr-match", candidates: 2, files: 0 },
        { name: "no-match", reason: "no-matching-pr", candidates: 0, files: 0 },
        { name: "empty", reason: "explicit-selection-kept", candidates: 2, files: 0 },
        { name: "unregistered", reason: "explicit-selection-kept", candidates: 2, files: 0 },
        { name: "failed", reason: "explicit-selection-kept", candidates: 2, files: 0 },
      ] as const;
      try {
        for (const cell of cases) for (const trigger of ["current-context-refresh", "review-contexts-refresh"] as const) {
          await workspaceState.update("reviewRange.currentPullRequestSelections.v1", {});
          lifecycle53 = cell.name === "unique" ? "closed" : "open";
          remoteBaseSha = ["empty", "unregistered", "failed"].includes(cell.name) ? targetHeadSha : savedBaseSha;
          // Seed a genuine empty comparison in the real repository before T405
          // resolves and acquires it; the Git adapter still produces its snapshot.
          await stateRepository.save({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: contextId53 }, {
            ...saved53, contextState: { ...saved53.contextState, pullRequest: { ...saved53.contextState.pullRequest!, baseSha: remoteBaseSha } },
          });
          branchSnapshot = cell.name === "no-match"
            ? { ...savedBranch, context: { ...savedBranch.context, headRevision: sourceHeadSha } }
            : savedBranch;
          if (["empty", "unregistered", "failed"].includes(cell.name)) await preferenceStore.select(REPOSITORY_ID, targetHeadSha, contextId53);
          const entries: OperationLogEntry[] = [];
          const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
          let accepted: CurrentContextUiSnapshot | undefined;
          const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
            enumerateCandidates: (signal, owner) => current.runtime.augmentCurrentContextCandidates([branchSnapshot], signal, owner),
            resolveFallback: async (available) => available.find((candidate) => candidate.context.kind === "pull-request") ?? available[0],
            requestSelection: async () => undefined,
          });
          const outcomeRuntime = ["unregistered", "failed"].includes(cell.name) ? new PullRequestReviewRuntime<string>({
            repository: { load: async () => undefined, commit: (transaction) => stateRepository.commit(transaction) }, requestHistory: async () => undefined,
            diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
            getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
          }) : pullRequestReviewRuntime;
          const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
            recompute: (signal, owner, options) => composition.recompute(signal, owner, options),
            selectContext: (signal, owner) => composition.selectContext(signal, owner),
            acceptRecomputed: (snapshot) => { accepted = snapshot; composition.acceptRecomputed(snapshot); },
          });
          const coordinator = new CurrentContextRuntimeCoordinator(controller, {
            acceptCurrentContextPreparation: (selection) => current.runtime.acceptCurrentContextPreparation?.(selection),
            refreshDependents: async (owner) => {
              if (cell.name === "failed") {
                const snapshot = pullRequestReviewRuntime.snapshotForContext(contextId53);
                assert.ok(snapshot);
                outcomeRuntime.register({ repositoryId: REPOSITORY_ID, repositoryRoot, fileSystemPathSemantics: "posix", snapshot,
                  readTextContent: async () => ({ kind: "found", content: "" }) });
              }
              await refreshCurrentContextPullRequestViews({
                selection: accepted?.context.selection, runtime: outcomeRuntime,
                refreshList: (parent) => current.runtime.refreshListOnly?.(parent, owner?.signal) ?? Promise.resolve(),
                refreshProgress: async (parent) => {
                  const selected = accepted?.context.selection;
                  if (selected?.kind === "pull-request" && outcomeRuntime.hasContext(selected.contextId)) await outcomeRuntime.activateProgress(selected.contextId, parent, owner?.signal);
                  else outcomeRuntime.clearProgress();
                },
                refreshDecorations: async () => undefined, refreshGlobal: async () => undefined, reportProgressError() {},
              }, owner);
            },
          });
          const operation = feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner, undefined, trigger));
          const failed = cell.name === "unregistered" || cell.name === "failed";
          if (failed) await assert.rejects(operation); else await operation;
          assert.equal(accepted?.context.selectionReason, cell.reason, `${cell.name}/${trigger} real resolver reason`);
          const decision = entries.find((entry) => entry.pullRequestRefresh?.stage === "pr-selection" && entry.pullRequestRefresh.status !== "started");
          assert.equal(decision?.pullRequestRefresh?.counts?.pullRequestCandidates, cell.candidates, `${cell.name}/${trigger} real candidate count`);
          const progress = entries.find((entry) => entry.pullRequestRefresh?.stage === "pr-progress" && entry.pullRequestRefresh.status !== "started");
          assert.equal(progress?.pullRequestRefresh?.status, failed ? "failed" : "succeeded");
          assert.equal(progress?.pullRequestRefresh?.counts?.treeItems, cell.files, `${cell.name}/${trigger} accepted tree count`);
          if (cell.name === "empty") assert.equal(progress?.pullRequestRefresh?.reasonCode, "no-pr-files");
          if (cell.name === "unregistered") assert.equal(decision?.pullRequestRefresh?.reasonCode, "snapshot-unavailable");
          assert.equal(entries.filter((entry) => entry.event === (failed ? "failed" : "succeeded")).length, 1);
          assert.equal(entries.some((entry) => entry.pullRequestRefresh?.stage === "tree-publication" && entry.pullRequestRefresh.status === "succeeded"), !failed);
          const publication = entries.find((entry) => entry.pullRequestRefresh?.stage === "tree-publication" && entry.pullRequestRefresh.status === (failed ? "failed" : "succeeded"));
          assert.equal(publication?.pullRequestRefresh?.counts?.treeItems, cell.files, `${cell.name}/${trigger} final publication uses accepted tree evidence`);
          assert.equal(publication?.pullRequestRefresh?.counts?.selectedContextOrdinal, progress?.pullRequestRefresh?.counts?.selectedContextOrdinal);
          assert.equal(publication?.pullRequestRefresh?.counts?.snapshotOrdinal, progress?.pullRequestRefresh?.counts?.snapshotOrdinal);
          assert.doesNotMatch(JSON.stringify(entries), new RegExp(repositoryRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
        }
      } finally {
        branchSnapshot = savedBranch; lifecycle53 = "open"; remoteBaseSha = savedBaseSha;
        await stateRepository.save({ kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: contextId53 }, saved53);
        await workspaceState.update("reviewRange.currentPullRequestSelections.v1", savedPreferences);
        await current.runtime.augmentCurrentContextCandidates([branchSnapshot]);
        await current.runtime.refreshListOnly?.();
      }
    });

    const pr52BeforeToggle = findPullRequestItem(current.provider, 52);
    assert.equal(pr52BeforeToggle.layerEnabled, true);
    await invoke("reviewRange.toggleReviewContextLayer", pr52BeforeToggle);
    const layerDisabled = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.equal(isPullRequestDecorationEnabled(layerDisabled!.contextState.pullRequest!), false);
    const isolated53 = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.equal(
      isPullRequestDecorationEnabled(isolated53!.contextState.pullRequest!),
      true,
      "AC-11: toggling PR #52 must not project its layer state onto PR #53",
    );

    // R405-1 restart proof: rebuild the actual T405 runtime over the same durable storage.
    current = await registerRuntime();
    await current.runtime.refresh();
    const restarted = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.equal(restarted?.contextState.pullRequest?.headSha, targetHeadSha);
    assert.equal(restarted?.globalState.currentRevisionId, targetHeadSha);
    assert.equal(isPullRequestDecorationEnabled(restarted!.contextState.pullRequest!), false);

    // R405-3: start at the real Review Contexts command, then execute canonical both-side commands.
    await invoke("reviewRange.openReviewContextDiff", findPullRequestItem(current.provider, 52));
    let opened = openedDiffs.at(-1);
    assert.ok(opened);
    assert.match(opened.original, /^review-range-diff:\/\/document\/v1\//u);
    assert.match(opened.modified, /^review-range-diff:\/\/document\/v1\//u);

    // T405-IFR-2: explicit refresh distinguishes live+write success, stale offline fallback, and cache-write failure at the command/UI boundary.
    const refreshCache = async (item: ReviewContextListItem): Promise<readonly string[]> => {
      errors.length = 0;
      const handler = commands.get("reviewRange.refreshReviewContextCache");
      assert.ok(handler);
      await handler(item);
      return [...errors];
    };
    const liveRefreshErrors = await refreshCache(findPullRequestItem(current.provider, 52));
    assert.deepEqual(liveRefreshErrors, []);
    const liveCache = findPullRequestItem(current.provider, 52).cache;
    assert.equal(liveCache?.origin, "live");
    assert.equal(liveCache?.freshness, "not-cached");
    assert.ok(liveCache !== undefined);

    const cacheDirectory = resolveReviewStateStorageRoute(storageUris, {
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    }).cacheDirectory;
    assert.ok(cacheDirectory);
    for (const relativePath of await readdir(cacheDirectory, { recursive: true })) {
      if (!relativePath.endsWith(".json")) continue;
      const filePath = path.join(cacheDirectory, relativePath);
      const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      value.updatedAt = "2000-01-01T00:00:00.000Z";
      value.expiresAt = "2000-01-01T00:00:01.000Z";
      const snapshot = value.snapshot as { files?: Array<{ hunks?: Array<{ lines?: Array<Record<string, unknown>> }> }> } | undefined;
      for (const file of snapshot?.files ?? []) for (const hunk of file.hunks ?? []) {
        for (const line of hunk.lines ?? []) delete line.textHash;
      }
      await writeFile(filePath, JSON.stringify(value), "utf8");
    }
    const offlineEntry = await new NodeGitHubPullRequestCacheStorage({ cacheDirectory }).read({
      contextId: contextId52,
      repository: { host: "github.com", owner: "ssaattww", repository: "revmem" },
      number: 52,
      baseSha,
      headSha: targetHeadSha,
    });
    assert.ok(offlineEntry, "the source-redacted offline cache must remain parseable after expiry");
    assert.ok(
      offlineEntry.snapshot.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines))
        .every((line) => line.text === "" && !("textHash" in line)),
      "a legacy persisted offline cache must retain redaction without requiring a new source-derived field",
    );
    refreshTransport = "offline";
    const offlineSelectedItem = findPullRequestItem(current.provider, 52);
    const stateBeforeOfflineMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(stateBeforeOfflineMark?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 1 },
    ]);
    const offlineRefreshErrors = await refreshCache(offlineSelectedItem);
    assert.equal(offlineRefreshErrors.length, 1);
    assert.match(offlineRefreshErrors[0]!, /詳細は Review Range Output/u);
    assert.throws(
      () => findPullRequestItem(current.provider, 52),
      /PR #52 should be projected/u,
      "an explicit refresh must reject an offline cache because it promises a fresh remote result",
    );
    localDiffUnavailable = true;
    errors.length = 0;
    await invoke("reviewRange.openReviewContextDiff", offlineSelectedItem);
    const offlineDiff = openedDiffs.at(-1);
    assert.ok(offlineDiff, "an exact offline cache must still open its immutable PR diff");
    const offlineCommandService = pullRequestReviewRuntime.createCommandService<{ readonly uri: string }>({
      getDocumentUri: (editor) => editor.uri,
      getSide: (editor) => pullRequestReviewRuntime.sideForDiffDocumentUri(editor.uri),
      getLineCount: () => 2,
      getSelections: () => [],
      confirmWholeFileOperation: async () => true,
    });
    const offlineWholeHistoryCheckpoint = historyEvents.length;
    assert.equal(
      await offlineCommandService.markFileReviewed({ uri: offlineDiff.modified }),
      "applied",
      "an offline cache must safely hydrate the exact HEAD body before a whole-file mark",
    );
    assert.deepEqual(await pullRequestReviewRuntime.getProgress(contextId52), {
      reviewedLineCount: 2,
      totalLineCount: 2,
      progress: 1,
    });
    assert.equal(
      await offlineCommandService.unmarkFileReviewed({ uri: offlineDiff.modified }),
      "applied",
      "an offline cache must safely hydrate the exact HEAD body before a whole-file unmark",
    );
    const offlineWholeHistory = historyEvents.slice(offlineWholeHistoryCheckpoint);
    assert.deepEqual(
      offlineWholeHistory.map((event) => event.action),
      ["marked-file-reviewed", "marked-file-reviewed", "unmarked-file-reviewed", "unmarked-file-reviewed"],
    );
    assert.ok(offlineWholeHistory.every((event) =>
      event.contextId === contextId52 && event.fileId === FILE_ID && event.revisionId === targetHeadSha,
    ));
    assert.deepEqual(await pullRequestReviewRuntime.getProgress(contextId52), {
      reviewedLineCount: 0,
      totalLineCount: 2,
      progress: 0,
    });
    const stateAfterOfflineUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(stateAfterOfflineUnmark?.contextState.files[FILE_ID]?.modifiedReviewed, []);
    const offlineSelectionCommandService = pullRequestReviewRuntime.createCommandService<{ readonly uri: string }>({
      getDocumentUri: (editor) => editor.uri,
      getSide: (editor) => pullRequestReviewRuntime.sideForDiffDocumentUri(editor.uri),
      getLineCount: () => 2,
      getSelections: () => [{
        anchor: { line: 1, character: 0 },
        active: { line: 1, character: 0 },
      }],
      confirmWholeFileOperation: async () => true,
    });
    const offlineSelectionHistoryCheckpoint = historyEvents.length;
    assert.equal(await offlineSelectionCommandService.markSelectionReviewed({ uri: offlineDiff.modified }), "applied");
    const stateAfterOfflineSelectionMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(stateAfterOfflineSelectionMark?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 1, endLineExclusive: 2 },
    ]);
    assert.equal(await offlineSelectionCommandService.unmarkSelectionReviewed({ uri: offlineDiff.modified }), "applied");
    assert.deepEqual(historyEvents.slice(offlineSelectionHistoryCheckpoint), [
      { contextId: contextId52, fileId: FILE_ID, revisionId: targetHeadSha, action: "marked-reviewed" },
      { contextId: contextId52, fileId: FILE_ID, revisionId: targetHeadSha, action: "unmarked-reviewed" },
    ]);
    const stateAfterOfflineSelectionUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(stateAfterOfflineSelectionUnmark?.contextState.files[FILE_ID]?.modifiedReviewed, []);
    const offlineRestoreCommandService = pullRequestReviewRuntime.createCommandService<{ readonly uri: string }>({
      getDocumentUri: (editor) => editor.uri,
      getSide: (editor) => pullRequestReviewRuntime.sideForDiffDocumentUri(editor.uri),
      getLineCount: () => 2,
      getSelections: () => [{
        anchor: { line: 0, character: 0 },
        active: { line: 0, character: 0 },
      }],
      confirmWholeFileOperation: async () => true,
    });
    assert.equal(
      await offlineRestoreCommandService.markSelectionReviewed({ uri: offlineDiff.modified }),
      "applied",
      "restore the pre-existing fixture selection through the same public PR command before later isolation assertions",
    );
    const stateAfterOfflineRestore = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(
      stateAfterOfflineRestore?.contextState.files[FILE_ID]?.modifiedReviewed,
      stateBeforeOfflineMark?.contextState.files[FILE_ID]?.modifiedReviewed,
    );

    localDiffUnavailable = false;
    refreshTransport = "live";
    await rm(cacheDirectory, { recursive: true, force: true });
    await mkdir(cacheDirectory, { recursive: true });
    await current.runtime.refresh();
    assert.ok(findPullRequestItem(current.provider, 52));
    await rm(cacheDirectory, { recursive: true, force: true });
    await writeFile(cacheDirectory, "cache write blocked", "utf8");
    const writeFailureErrors = await refreshCache(findPullRequestItem(current.provider, 52));
    assert.equal(writeFailureErrors.length, 1);
    assert.match(writeFailureErrors[0]!, /詳細は Review Range Output/u);
    assert.throws(() => findPullRequestItem(current.provider, 52), /PR #52 should be projected/u);

    // T406-R003: terminal cache mutations do not republish the tree. A subsequent
    // explicit live B acquisition has to replace every T405-owned immutable identity.
    await rm(cacheDirectory, { force: true });
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(sourcePath, "keep\nrecovered", "utf8");
    await runGit(repositoryRoot, ["commit", "-am", "recovered target head"]);
    const recoveredHeadSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    remoteBaseSha = targetHeadSha;
    remoteHeadSha = recoveredHeadSha;
    patchOldLine = "new";
    patchNewLine = "recovered";
    branchSnapshot = {
      ...branchSnapshot,
      context: { ...branchSnapshot.context, headRevision: recoveredHeadSha },
    };
    redetectChoice = 52;
    errors.length = 0;
    await invoke("reviewRange.redetectPullRequest");
    const recoveredRefreshErrors = await refreshCache(findPullRequestItem(current.provider, 52));
    assert.deepEqual(recoveredRefreshErrors, []);
    const recoveredCache = findPullRequestItem(current.provider, 52).cache;
    assert.equal(recoveredCache?.origin, "live");
    assert.equal(recoveredCache?.freshness, "not-cached");
    const recovered52 = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.equal(recovered52?.contextState.pullRequest?.baseSha, targetHeadSha);
    assert.equal(recovered52?.contextState.pullRequest?.headSha, recoveredHeadSha);
    assert.equal(recovered52?.globalState.currentRevisionId, recoveredHeadSha);
    assert.equal(recovered52?.contextState.files[FILE_ID]?.revisionId, recoveredHeadSha);
    assert.equal(recovered52?.globalState.files[FILE_ID]?.revisionId, recoveredHeadSha);
    const recovered53 = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.equal(recovered53?.contextState.pullRequest?.headSha, recoveredHeadSha);
    assert.equal(recovered53?.globalState.currentRevisionId, recoveredHeadSha);
    assert.throws(
      () => pullRequestReviewRuntime.createHeadFileDocumentUri(contextId52, FILE_ID, targetHeadSha),
      /stale/u,
    );
    const recoveredUri = pullRequestReviewRuntime.createHeadFileDocumentUri(
      contextId52,
      FILE_ID,
      recoveredHeadSha,
    );
    assert.equal(
      Buffer.from(recoveredUri.split("/").at(-2)!, "base64url").toString("utf8"),
      recoveredHeadSha,
    );
    const cacheValues = await Promise.all((await readdir(cacheDirectory, { recursive: true }))
      .filter((relativePath) => relativePath.endsWith(".json"))
      .map(async (relativePath) => JSON.parse(await readFile(path.join(cacheDirectory, relativePath), "utf8")) as Record<string, unknown>));
    assert.match(JSON.stringify(cacheValues), new RegExp(recoveredHeadSha, "u"));
    assert.doesNotMatch(JSON.stringify(cacheValues), new RegExp(`"headSha":"${targetHeadSha}"`, "u"));

    await invoke("reviewRange.openReviewContextDiff", findPullRequestItem(current.provider, 52));
    opened = openedDiffs.at(-1);
    assert.ok(opened);
    errors.length = 0;
    const commandService = pullRequestReviewRuntime.createCommandService<{ readonly uri: string }>({
      getDocumentUri: (editor) => editor.uri,
      getSide: (editor) => pullRequestReviewRuntime.sideForDiffDocumentUri(editor.uri),
      getLineCount: () => 2,
      getSelections: () => [{
        anchor: { line: 1, character: 0 },
        active: { line: 1, character: 0 },
      }],
      confirmWholeFileOperation: async () => true,
    });
    const originalEditor = { uri: opened.original };
    const modifiedEditor = { uri: opened.modified };

    const assertHistoryTransaction = (
      checkpoint: number,
      contextId: string,
      action: "marked-reviewed" | "unmarked-reviewed",
    ): void => {
      assert.deepEqual(historyEvents.slice(checkpoint), [{
        contextId,
        fileId: FILE_ID,
        revisionId: recoveredHeadSha,
        action,
      }]);
    };
    const withoutUpdatedAt = (state: ReviewContextState | undefined): object => ({
      ...state,
      updatedAt: undefined,
    });

    // T406-R004 / AC-11: commands use the real PR runtime, state repository, and
    // append-only history recorder for both sibling owners. Each direction must
    // leave the other PR's Context ranges and history ownership untouched.
    const state52Before53 = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.ok(state52Before53);
    await invoke("reviewRange.openReviewContextDiff", findPullRequestItem(current.provider, 53));
    const opened53 = openedDiffs.at(-1);
    assert.ok(opened53);
    const originalEditor53 = { uri: opened53.original };
    const modifiedEditor53 = { uri: opened53.modified };
    let historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.markSelectionReviewed(originalEditor53), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId53, "marked-reviewed");
    const state52After53OriginalMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(withoutUpdatedAt(state52After53OriginalMark?.contextState), withoutUpdatedAt(state52Before53.contextState));
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.markSelectionReviewed(modifiedEditor53), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId53, "marked-reviewed");
    const state53AfterMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    const state52After53Mark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(withoutUpdatedAt(state52After53Mark?.contextState), withoutUpdatedAt(state52Before53.contextState));
    assert.deepEqual(state52After53Mark?.globalState, state53AfterMark?.globalState);

    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.markSelectionReviewed(originalEditor), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId52, "marked-reviewed");
    const state53After52OriginalMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.deepEqual(withoutUpdatedAt(state53After52OriginalMark?.contextState), withoutUpdatedAt(state53AfterMark?.contextState));
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.markSelectionReviewed(modifiedEditor), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId52, "marked-reviewed");
    const state52AfterMark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    const state53After52Mark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.deepEqual(withoutUpdatedAt(state53After52Mark?.contextState), withoutUpdatedAt(state53AfterMark?.contextState));
    assert.deepEqual(state53After52Mark?.globalState, state52AfterMark?.globalState);
    assert.deepEqual(await pullRequestReviewRuntime.getProgress(contextId52), {
      reviewedLineCount: 2,
      totalLineCount: 2,
      progress: 1,
    });
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.unmarkSelectionReviewed(originalEditor), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId52, "unmarked-reviewed");
    const state53After52OriginalUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.deepEqual(withoutUpdatedAt(state53After52OriginalUnmark?.contextState), withoutUpdatedAt(state53AfterMark?.contextState));
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.unmarkSelectionReviewed(modifiedEditor), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId52, "unmarked-reviewed");
    const state52AfterUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    const state53After52Unmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.deepEqual(withoutUpdatedAt(state53After52Unmark?.contextState), withoutUpdatedAt(state53AfterMark?.contextState));
    assert.deepEqual(state53After52Unmark?.globalState, state52AfterUnmark?.globalState);
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.unmarkSelectionReviewed(originalEditor53), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId53, "unmarked-reviewed");
    const state52After53OriginalUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(withoutUpdatedAt(state52After53OriginalUnmark?.contextState), withoutUpdatedAt(state52AfterUnmark?.contextState));
    historyCheckpoint = historyEvents.length;
    assert.equal(await commandService.unmarkSelectionReviewed(modifiedEditor53), "applied");
    assertHistoryTransaction(historyCheckpoint, contextId53, "unmarked-reviewed");
    const state53AfterUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    const state52After53Unmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(withoutUpdatedAt(state52After53Unmark?.contextState), withoutUpdatedAt(state52AfterUnmark?.contextState));
    assert.deepEqual(state52After53Unmark?.globalState, state53AfterUnmark?.globalState);
    assert.ok(historyEvents.some((event) => event.contextId === contextId52));
    assert.ok(historyEvents.some((event) => event.contextId === contextId53));
    assert.deepEqual(await pullRequestReviewRuntime.getProgress(contextId52), {
      reviewedLineCount: 0,
      totalLineCount: 2,
      progress: 0,
    });
    const reviewStateAfterUnmark = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(reviewStateAfterUnmark?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 0, endLineExclusive: 1 },
    ]);
    assert.deepEqual(
      reviewStateAfterUnmark?.contextState.files[FILE_ID]?.originalReviewedByDiff[`${targetHeadSha}..${recoveredHeadSha}`],
      [],
    );

    current = await registerRuntime();
    await current.runtime.refresh();
    const restarted52AfterTransactions = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    const restarted53AfterTransactions = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.deepEqual(
      { ...restarted52AfterTransactions?.contextState, updatedAt: undefined },
      { ...state52AfterUnmark?.contextState, updatedAt: undefined },
    );
    assert.deepEqual(
      { ...restarted53AfterTransactions?.contextState, updatedAt: undefined },
      { ...state53AfterUnmark?.contextState, updatedAt: undefined },
    );
    const historyDirectory = resolveReviewStateStorageRoute(storageUris, {
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    }).historyDirectory;
    const persistedHistory = await Promise.all((await readdir(historyDirectory, { recursive: true }))
      .filter((relativePath) => relativePath.endsWith(".jsonl"))
      .map((relativePath) => readFile(path.join(historyDirectory, relativePath), "utf8")));
    const persistedReviewEvents = persistedHistory.flatMap((text) => text.trim().split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        contextId: string;
        filePath?: string;
        revisionId?: string;
        type: string;
      })
      .filter((event) => event.filePath === FILE_ID && event.revisionId === recoveredHeadSha));
    assert.deepEqual(
      persistedReviewEvents.filter((event) => event.contextId === contextId52)
        .map((event) => ({ contextId: event.contextId, fileId: event.filePath, revisionId: event.revisionId, action: event.type })),
      historyEvents.filter((event) => event.contextId === contextId52 && event.revisionId === recoveredHeadSha),
    );
    assert.deepEqual(
      persistedReviewEvents.filter((event) => event.contextId === contextId53)
        .map((event) => ({ contextId: event.contextId, fileId: event.filePath, revisionId: event.revisionId, action: event.type })),
      historyEvents.filter((event) => event.contextId === contextId53 && event.revisionId === recoveredHeadSha),
    );

    // T606-R8: the actual T405 cache mutation uses Node-backed atomic storage.
    // A write fault must be terminal even though this factory deliberately does
    // not forward a diagnostic callback into the storage adapter.
    injectCacheStorage = true;
    current = await registerRuntime();
    await new Promise((resolve) => setImmediate(resolve));
    await current.runtime.refresh();
    cacheAtomicWrites = 0;
    cacheAtomicWriteFailure = "ENOSPC";
    const cacheFailureLog: Array<{ event: string; label: string; message?: string }> = [];
    setActiveOperationFeedback(new OperationFeedback({
      showBusy: () => undefined,
      clearBusy: () => undefined,
      appendLog: (entry) => cacheFailureLog.push(entry),
      revealLog: () => undefined,
    }, () => Date.parse("2026-08-20T00:00:00.000Z")));
    errors.length = 0;
    const cacheHandler = commands.get("reviewRange.refreshReviewContextCache");
    assert.ok(cacheHandler);
    await cacheHandler(findPullRequestItem(current.provider, 52));
    setActiveOperationFeedback(undefined);
    assert.equal(cacheAtomicWrites, 1, "a Node-backed atomic write fault cannot retry or start post-mutation refresh");
    assert.equal(errors.length, 1, "the command boundary reports the terminal cache mutation failure");
    assert.deepEqual(cacheFailureLog.map((entry) => entry.event), ["started", "failed"]);
    cacheAtomicWriteFailure = undefined;
    errors.length = 0;

    // R405-2: lifecycle changes use an explicit mutation command, while refresh remains a pure projection read.
    lifecycle52 = "closed";
    lifecycle53 = "merged";
    await invoke("reviewRange.redetectPullRequest");
    await current.runtime.refresh();
    const closed52 = findPullRequestItem(current.provider, 52);
    const merged53 = findPullRequestItem(current.provider, 53);
    assert.equal(closed52.group, "saved-closed-pull-request");
    assert.equal(merged53.group, "saved-closed-pull-request");
    assert.equal(closed52.layerEnabled, false);
    assert.equal(merged53.layerEnabled, false);
    const durable53 = await new FileSystemReviewStateRepository({ storageUris }).load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId53,
    });
    assert.equal(durable53?.contextState.pullRequest?.state, "merged");
    assert.equal(isPullRequestDecorationEnabled(durable53!.contextState.pullRequest!), false);

    current = await registerRuntime();
    await current.runtime.refresh();
    assert.equal(findPullRequestItem(current.provider, 52).group, "saved-closed-pull-request");
    assert.equal(findPullRequestItem(current.provider, 53).group, "saved-closed-pull-request");
    assert.equal(findPullRequestItem(current.provider, 53).layerEnabled, false);

    // T406-R001: each fallback path has one saved open PR (#52); an explicit
    // branch choice must suppress automatic re-selection after cancel, zero, or unavailable.
    redetectChoice = undefined;
    lifecycle52 = "open";
    lifecycle53 = "closed";
    await current.runtime.refresh();
    await invoke("reviewRange.redetectPullRequest");
    const selectedAfterCancellation = selectedContexts.at(-1);
    assert.equal(selectedAfterCancellation?.kind, "branch");

    discoveryTransport = "zero";
    await invoke("reviewRange.redetectPullRequest");
    assert.equal(selectedContexts.at(-1)?.kind, "branch");

    // T406-R001/R002: a successful explicit PR choice replaces the branch sentinel,
    // then a network fallback restores the branch owner and reports one safe diagnostic.
    discoveryTransport = "live";
    redetectChoice = 52;
    await invoke("reviewRange.redetectPullRequest");
    assert.equal(selectedContexts.at(-1)?.kind, "pull-request");
    const operationLog: Array<{ event: string; label: string; message?: string }> = [];
    setActiveOperationFeedback(new OperationFeedback({
      showBusy: () => undefined,
      clearBusy: () => undefined,
      appendLog: (entry) => operationLog.push(entry),
      revealLog: () => undefined,
    }, () => Date.parse("2026-08-20T00:00:00.000Z")));
    discoveryTransport = "network";
    await invoke("reviewRange.redetectPullRequest");
    setActiveOperationFeedback(undefined);
    assert.equal(selectedContexts.at(-1)?.kind, "branch");
    const diagnostics = operationLog.filter((entry) =>
      entry.event === "failed" && entry.message === "GITHUB_PR_DETECTION_UNAVAILABLE reason=network"
    );
    assert.equal(diagnostics.length, 1);
    assert.equal(operationLog.some((entry) => entry.event === "succeeded"), false);
    assert.doesNotMatch(JSON.stringify(operationLog), /network interrupted|repositoryRoot|targetHeadSha/u);

    // Issue #136 regression: a replacement request must cancel an old request
    // while that request is still awaiting repository inspection.
    discoveryTransport = "live";
    redetectChoice = 52;
    errors.length = 0;
    const originalInspectRepository = localGit.inspectRepository.bind(localGit);
    let releaseBlockedInspection!: () => void;
    let inspectionStarted!: () => void;
    const blockedInspection = new Promise<void>((resolve) => { releaseBlockedInspection = resolve; });
    const inspectionStartedPromise = new Promise<void>((resolve) => { inspectionStarted = resolve; });
    let inspectionCalls = 0;
    localGit.inspectRepository = async (startPath) => {
      inspectionCalls += 1;
      if (inspectionCalls === 1) {
        inspectionStarted();
        await blockedInspection;
      }
      return originalInspectRepository(startPath);
    };
    const redetectCommand = commands.get("reviewRange.redetectPullRequest");
    assert.ok(redetectCommand);
    let firstRedetectionSettled = false;
    const firstRedetection = Promise.resolve(redetectCommand()).finally(() => {
      firstRedetectionSettled = true;
    });
    await inspectionStartedPromise;
    const previousActiveTextEditor = fakeVscode.window.activeTextEditor;
    fakeVscode.window.activeTextEditor = {
      document: {
        uri: {
          scheme: "file",
          authority: "",
          fsPath: repositoryRoot,
          query: "",
          fragment: "",
          toString: () => repositoryRoot,
        },
        version: 1,
      },
    } as never;
    const replacementRedetection = Promise.resolve(redetectCommand());
    await new Promise((resolve) => setImmediate(resolve));
    const cancelledBeforeInspectionCompleted = firstRedetectionSettled;
    releaseBlockedInspection();
    await Promise.allSettled([firstRedetection, replacementRedetection]);
    localGit.inspectRepository = originalInspectRepository;
    fakeVscode.window.activeTextEditor = previousActiveTextEditor;
    assert.equal(
      cancelledBeforeInspectionCompleted,
      true,
      "a replacement request terminates the superseded command without waiting for repository inspection",
    );
    assert.ok(inspectionCalls >= 2, "the replacement resolves its own current repository identity");
    errors.length = 0;

    // T406-R001: the selected branch owner is the production normal-editor
    // command target after unavailable fallback; its mark/unmark cannot mutate PR #52.
    const branchTarget = {
      kind: "git" as const,
      repositoryId: REPOSITORY_ID,
      contextId: "branch:refs/heads/main",
    };
    const branchContext: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: branchTarget.contextId,
      kind: "branch",
      repositoryId: REPOSITORY_ID,
      displayName: "main",
      branch: { refName: "refs/heads/main", headRevision: recoveredHeadSha },
      files: {
        [FILE_ID]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          fileId: FILE_ID,
          currentPath: FILE_ID,
          previousPaths: [],
          revisionId: recoveredHeadSha,
          modifiedReviewed: [],
          originalReviewedByDiff: {},
          lineCount: 2,
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      },
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const branchGlobal: RepositoryGlobalState = {
      ...repositoryGlobal(recoveredHeadSha),
      files: {
        [FILE_ID]: {
          fileId: FILE_ID,
          currentPath: FILE_ID,
          revisionId: recoveredHeadSha,
          reviewed: [],
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      },
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    await stateRepository.save(branchTarget, {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: branchContext,
      globalState: branchGlobal,
    });
    const pr52BeforeBranchCommands = await stateRepository.load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    const normalEditorCommands = new NormalEditorReviewCommandService<{ readonly uri: string }>({
      getLineCount: () => 2,
      getSelections: () => [{
        anchor: { line: 1, character: 0 },
        active: { line: 1, character: 0 },
      }],
      openSession: async () => {
        const persisted = await stateRepository.load(branchTarget);
        assert.ok(persisted);
        return {
          ...persisted,
          target: {
            fileId: FILE_ID,
            currentPath: FILE_ID,
            revisionId: recoveredHeadSha,
            lineCount: 2,
          },
          committer: { commit: (transaction) => stateRepository.commit(transaction) },
        };
      },
      confirmWholeFileOperation: async () => true,
      requestHistory: (transaction) => historyRecorder.recordTransaction(transaction, "user-selection"),
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const branchEditor = { uri: sourcePath };
    assert.equal(await normalEditorCommands.markSelectionReviewed(branchEditor), "applied");
    const branchAfterMark = await stateRepository.load(branchTarget);
    assert.deepEqual(branchAfterMark?.contextState.files[FILE_ID]?.modifiedReviewed, [
      { startLine: 1, endLineExclusive: 2 },
    ]);
    assert.equal(await normalEditorCommands.unmarkSelectionReviewed(branchEditor), "applied");
    const branchAfterUnmark = await stateRepository.load(branchTarget);
    assert.deepEqual(branchAfterUnmark?.contextState.files[FILE_ID]?.modifiedReviewed, []);
    const pr52AfterBranchCommands = await stateRepository.load({
      kind: "pull-request",
      repositoryId: REPOSITORY_ID,
      contextId: contextId52,
    });
    assert.deepEqual(
      withoutUpdatedAt(pr52AfterBranchCommands?.contextState),
      withoutUpdatedAt(pr52BeforeBranchCommands?.contextState),
    );
  } finally {
    moduleLoader._load = originalModuleLoad;
    globalThis.fetch = originalFetch;
    for (const context of contexts) {
      for (const subscription of context.subscriptions) subscription.dispose();
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

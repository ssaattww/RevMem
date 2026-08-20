import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute,
} from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import type { SelectedReviewContext } from "../../src/application/review-context/index.js";
import { isPullRequestDecorationEnabled } from "../../src/application/github-pr-context/index.js";
import {
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  CurrentContextRuntimeCoordinator,
  CurrentContextUiController,
  type CurrentContextUiSnapshot,
} from "../../src/ui/current-context/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
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
import { PullRequestReviewRuntime } from "../../src/t405-pull-request-review-runtime.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const FILE_ID = "src/example.ts";

interface DisposableLike {
  dispose(): void;
}

interface CapturedReviewContextsProvider {
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

test("T406 executes the T405 production seam across PR selection, failure fallback, cache recovery, closed state, and isolation", async () => {
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
    const historyRecorder = new ReviewHistoryRecorder({
      sessionId: "t405-composition",
      createEventId: () => `t405-composition-event-${++nextHistoryEventId}`,
      appender: new JsonlReviewHistoryStore({ storageUris }),
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

    let lifecycle52: "open" | "closed" | "merged" = "open";
    let lifecycle53: "open" | "closed" | "merged" = "open";
    let refreshTransport: "live" | "offline" = "live";
    let discoveryTransport: "live" | "network" = "live";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/repos/ssaattww/revmem/pulls" && url.searchParams.get("state") === "open") {
        if (discoveryTransport === "network") throw new Error("network interrupted during PR detection");
        return jsonResponse([52, 53].map((number) => ({
          number,
          title: `PR ${number}`,
          html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          head: { sha: targetHeadSha },
          base: { ref: "main", sha: baseSha },
        })));
      }
      if (url.pathname === "/repos/ssaattww/revmem/pulls/52/files") {
        if (refreshTransport === "offline") throw new Error("offline for cache fallback");
        return jsonResponse([{
          filename: FILE_ID,
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1,2 +1,2 @@\n keep\n-old\n+new",
        }]);
      }
      const lifecycleMatch = /^\/repos\/ssaattww\/revmem\/pulls\/(52|53)$/u.exec(url.pathname);
      if (lifecycleMatch !== null) {
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
          base: { sha: baseSha },
          head: { sha: targetHeadSha },
        });
      }
      throw new Error(`Unexpected GitHub request in T405 composition regression: ${url}`);
    };

    const commands = new Map<string, (...argumentsList: unknown[]) => unknown>();
    const providers: CapturedReviewContextsProvider[] = [];
    const errors: string[] = [];
    const workspaceState = new MemoryMemento();
    let redetectChoice: 52 | 53 | undefined = 53;
    const fakeVscode = {
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
            uri: { scheme: "file", fsPath: sourcePath },
          },
        },
        createTreeView: (_id: string, options: { treeDataProvider: CapturedReviewContextsProvider }): DisposableLike => {
          providers.push(options.treeDataProvider);
          return { dispose: () => undefined };
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
      },
      authentication: {
        getSession: async () => undefined,
      },
    };

    moduleLoader._load = (request, parent, isMain) => request === "vscode"
      ? fakeVscode
      : Reflect.apply(originalModuleLoad, Module, [request, parent, isMain]) as unknown;
    const runtimeModulePath = runtimeRequire.resolve("../../src/t405-review-contexts-runtime.js");
    delete runtimeRequire.cache[runtimeModulePath];
    const runtimeModule = runtimeRequire(runtimeModulePath) as typeof import("../../src/t405-review-contexts-runtime.js");
    moduleLoader._load = originalModuleLoad;

    const localGit = createNodeLocalGitAdapter();
    const openedDiffs: Array<{ original: string; modified: string; title: string }> = [];
    const pullRequestReviewRuntime = new PullRequestReviewRuntime<string>({
      repository: stateRepository,
      requestHistory: async () => undefined,
      diffHost: {
        parseUri: (value) => value,
        openDiff: async (original, modified, title) => {
          openedDiffs.push({ original, modified, title });
        },
      },
      getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    });
    const branchSnapshot: CurrentContextUiSnapshot = {
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
    let registered: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime> | undefined;
    const selectedContexts: Array<SelectedReviewContext | undefined> = [];

    const refreshCurrentContext = async (): Promise<void> => {
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
        refreshDependents: () => undefined,
      });
      await coordinator.refresh();
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

    const registerRuntime = (): {
      runtime: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime>;
      provider: CapturedReviewContextsProvider;
    } => {
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
        getPullRequestReviewProgress: (contextId) => pullRequestReviewRuntime.getProgress(contextId),
        reviewStateRepository: stateRepository,
        reviewHistoryRecorder: historyRecorder,
      });
      registered = runtime;
      enumerateEnabled = true;
      const provider = providers.at(-1);
      assert.ok(provider);
      return { runtime, provider };
    };

    const invoke = async (id: string, ...argumentsList: unknown[]): Promise<void> => {
      const handler = commands.get(id);
      assert.ok(handler, `${id} should be registered by the T405 production runtime.`);
      await handler(...argumentsList);
      assert.deepEqual(errors, [], `T405 command ${id} should not report an error.`);
    };

    // R405-1 + R405-7: redetect itself must cross the T405 synchronization/resolver seam.
    let current = registerRuntime();
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
    current = registerRuntime();
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
    const opened = openedDiffs.at(-1);
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
    assert.equal(liveCache?.freshness, "fresh");
    assert.ok(liveCache !== undefined && "updatedAt" in liveCache);

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
      await writeFile(filePath, JSON.stringify(value), "utf8");
    }
    refreshTransport = "offline";
    const offlineRefreshErrors = await refreshCache(findPullRequestItem(current.provider, 52));
    assert.equal(offlineRefreshErrors.length, 1);
    assert.match(offlineRefreshErrors[0]!, /offline cache \(stale\)/u);
    assert.deepEqual(findPullRequestItem(current.provider, 52).cache, {
      origin: "offline",
      freshness: "stale",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });

    refreshTransport = "live";
    await rm(cacheDirectory, { recursive: true, force: true });
    await writeFile(cacheDirectory, "cache write blocked", "utf8");
    const writeFailureErrors = await refreshCache(findPullRequestItem(current.provider, 52));
    assert.equal(writeFailureErrors.length, 1);
    assert.match(writeFailureErrors[0]!, /live取得結果をcacheへ保存できませんでした/u);
    assert.deepEqual(findPullRequestItem(current.provider, 52).cache, {
      origin: "live",
      freshness: "not-cached",
    });
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
    assert.equal(await commandService.markSelectionReviewed(originalEditor), "applied");
    assert.equal(await commandService.markSelectionReviewed(modifiedEditor), "applied");
    assert.deepEqual(await pullRequestReviewRuntime.getProgress(contextId52), {
      reviewedLineCount: 2,
      totalLineCount: 2,
      progress: 1,
    });
    assert.equal(await commandService.unmarkSelectionReviewed(originalEditor), "applied");
    assert.equal(await commandService.unmarkSelectionReviewed(modifiedEditor), "applied");
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
      reviewStateAfterUnmark?.contextState.files[FILE_ID]?.originalReviewedByDiff[`${baseSha}..${targetHeadSha}`],
      [],
    );

    // R405-2: lifecycle changes must enter through Review Contexts load/synchronize, then survive restart.
    lifecycle52 = "closed";
    lifecycle53 = "merged";
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

    current = registerRuntime();
    await current.runtime.refresh();
    assert.equal(findPullRequestItem(current.provider, 52).group, "saved-closed-pull-request");
    assert.equal(findPullRequestItem(current.provider, 53).group, "saved-closed-pull-request");
    assert.equal(findPullRequestItem(current.provider, 53).layerEnabled, false);

    // T405-IFR-3: a cancelled same-HEAD re-detection must clear PR preference and return normal editor ownership to branch.
    redetectChoice = undefined;
    lifecycle52 = "open";
    lifecycle53 = "open";
    await invoke("reviewRange.redetectPullRequest");
    const selectedAfterCancellation = selectedContexts.at(-1);
    assert.equal(selectedAfterCancellation?.kind, "branch");

    // T406: GitHub network failure must also clear the PR preference so normal-editor review remains in the branch context.
    redetectChoice = 52;
    await invoke("reviewRange.redetectPullRequest");
    assert.equal(selectedContexts.at(-1)?.kind, "pull-request");
    discoveryTransport = "network";
    await invoke("reviewRange.redetectPullRequest");
    assert.equal(selectedContexts.at(-1)?.kind, "branch");
  } finally {
    moduleLoader._load = originalModuleLoad;
    globalThis.fetch = originalFetch;
    for (const context of contexts) {
      for (const subscription of context.subscriptions) subscription.dispose();
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

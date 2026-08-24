import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import {
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { PullRequestReviewRuntime } from "../../src/t405-pull-request-review-runtime.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

interface DisposableLike { dispose(): void }

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }
  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, structuredClone(value));
  }
  public keys(): readonly string[] { return [...this.values.keys()]; }
}

class FakeEventEmitter<Value> {
  private readonly listeners: Array<(value: Value) => void> = [];
  public readonly event = (listener: (value: Value) => void): DisposableLike => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  public fire(value: Value): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void { this.listeners.length = 0; }
}

class FakeTreeItem {
  public description: string | undefined;
  public tooltip: string | undefined;
  public contextValue: string | undefined;
  public iconPath: unknown;
  public constructor(public readonly label: string, public readonly collapsibleState: number) {}
}
class FakeThemeIcon { public constructor(public readonly id: string) {} }

const runGit = async (root: string, args: readonly string[]): Promise<string> =>
  (await execFileAsync("git", [...args], { cwd: root })).stdout.trim();

const globalState = (head: string): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: head,
  files: {},
  updatedAt: "2026-08-24T12:00:00.000Z",
});

const pullRequestState = (number: number, head: string): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: `github-pr:${REPOSITORY_ID}#${number}`,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${number}`,
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number,
    state: "open",
    title: `PR ${number}`,
    baseSha: head,
    headSha: head,
  },
  files: {},
  createdAt: `2026-08-24T12:00:0${number - 51}.000Z`,
  updatedAt: `2026-08-24T12:00:0${number - 51}.000Z`,
});

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("PR85 closure regressions use production Review Contexts composition for in-flight counts and PR-file ownership", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revmem-pr85-closure-"));
  const repositoryRoot = path.join(temporaryRoot, "repository");
  const globalStorageRoot = path.join(temporaryRoot, "global-storage");
  const workspaceStorageRoot = path.join(temporaryRoot, "workspace-storage");
  const originalFetch = globalThis.fetch;
  const moduleLoader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalModuleLoad = moduleLoader._load;
  const entries: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => entries.push(entry),
    revealLog: () => undefined,
  });

  try {
    await mkdir(repositoryRoot, { recursive: true });
    await mkdir(globalStorageRoot, { recursive: true });
    await mkdir(workspaceStorageRoot, { recursive: true });
    await runGit(repositoryRoot, ["init", "-b", "main"]);
    await runGit(repositoryRoot, ["config", "user.email", "review-range@example.invalid"]);
    await runGit(repositoryRoot, ["config", "user.name", "Review Range Test"]);
    await runGit(repositoryRoot, ["commit", "--allow-empty", "-m", "smoke head"]);
    const head = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/ssaattww/revmem.git"]);

    const storageUris = {
      globalStorageUri: { fsPath: globalStorageRoot },
      storageUri: { fsPath: workspaceStorageRoot },
    };
    const stateRepository = new FileSystemReviewStateRepository({ storageUris });
    for (const number of [52, 53]) {
      await stateRepository.save(
        { kind: "pull-request", repositoryId: REPOSITORY_ID, contextId: `github-pr:${REPOSITORY_ID}#${number}` },
        {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          contextState: pullRequestState(number, head),
          globalState: globalState(head),
        },
      );
    }

    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const workspaceState = new MemoryMemento();
    let resolveInitialRefresh: (() => void) | undefined;
    const initialRefresh = new Promise<void>((resolve) => { resolveInitialRefresh = resolve; });
    const fakeVscode = {
      EventEmitter: FakeEventEmitter,
      TreeItem: FakeTreeItem,
      ThemeIcon: FakeThemeIcon,
      TreeItemCollapsibleState: { None: 0 },
      commands: {
        registerCommand: (id: string, handler: (...args: unknown[]) => unknown): DisposableLike => {
          commands.set(id, handler);
          return { dispose: () => undefined };
        },
      },
      window: {
        activeTextEditor: undefined,
        createTreeView: (_id: string, options: { treeDataProvider: { onDidChangeTreeData(listener: () => void): DisposableLike } }): DisposableLike => {
          const disposable = options.treeDataProvider.onDidChangeTreeData(() => resolveInitialRefresh?.());
          return { dispose: () => disposable.dispose() };
        },
        showQuickPick: async (items: readonly unknown[]) => items[0],
        showErrorMessage: async () => undefined,
      },
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        textDocuments: [],
        workspaceFolders: [{ uri: { scheme: "file", authority: "", fsPath: repositoryRoot, query: "", fragment: "" } }],
      },
      authentication: { getSession: async () => undefined },
    };

    moduleLoader._load = (request, parent, isMain) => request === "vscode"
      ? fakeVscode
      : Reflect.apply(originalModuleLoad, Module, [request, parent, isMain]) as unknown;
    const runtimeModulePath = runtimeRequire.resolve("../../src/t405-review-contexts-runtime.js");
    delete runtimeRequire.cache[runtimeModulePath];
    const runtimeModule = runtimeRequire(runtimeModulePath) as typeof import("../../src/t405-review-contexts-runtime.js");
    moduleLoader._load = originalModuleLoad;

    const pullRequestReviewRuntime = new PullRequestReviewRuntime<string>({
      repository: stateRepository,
      requestHistory: async () => undefined,
      diffHost: {
        parseUri: (value) => value,
        openDiff: async () => undefined,
      },
      getExclusionPolicy: () => ({ isExcluded: () => false }),
    } as ConstructorParameters<typeof PullRequestReviewRuntime<string>>[0]);

    let enumerateEnabled = false;
    const branchSnapshot: CurrentContextUiSnapshot = {
      context: {
        kind: "branch",
        label: "main",
        detail: repositoryRoot,
        headRevision: head,
        selection: {
          kind: "branch",
          repositoryId: REPOSITORY_ID,
          repositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    };

    let lifecycleRequests = 0;
    let holdSecondLifecycle = false;
    let secondLifecycleStarted = deferred();
    let releaseSecondLifecycle = deferred();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const lifecycle = /^\/repos\/ssaattww\/revmem\/pulls\/(52|53)$/u.exec(url.pathname);
      if (lifecycle !== null) {
        lifecycleRequests += 1;
        if (holdSecondLifecycle && lifecycleRequests === 2) {
          secondLifecycleStarted.resolve();
          await releaseSecondLifecycle.promise;
        }
        const number = Number(lifecycle[1]);
        return jsonResponse({
          number,
          title: `PR ${number}`,
          html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          state: "open",
          merged_at: null,
          changed_files: 0,
          base: { sha: head },
          head: { sha: head },
        });
      }
      if (/^\/repos\/ssaattww\/revmem\/pulls\/(52|53)\/files$/u.test(url.pathname)) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected GitHub request in PR85 closure regression: ${url}`);
    };

    setActiveOperationFeedback(feedback);
    const subscriptions: DisposableLike[] = [];
    const runtime = runtimeModule.registerT405ReviewContextsRuntime({
      context: {
        globalStorageUri: { fsPath: globalStorageRoot },
        storageUri: { fsPath: workspaceStorageRoot },
        workspaceState,
        subscriptions,
      } as unknown as Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]["context"],
      git: createNodeLocalGitAdapter(),
      enumerateCurrentContexts: async () => enumerateEnabled ? [branchSnapshot] : [],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: (registration) => pullRequestReviewRuntime.register(registration),
      openPullRequestReviewDiff: (contextId, fileId, title) => pullRequestReviewRuntime.openReviewDiff(contextId, fileId, title),
      getPullRequestReviewProgress: (contextId, feedbackContext, signal) =>
        pullRequestReviewRuntime.getProgress(contextId, feedbackContext, signal),
      reviewStateRepository: stateRepository,
      reviewHistoryRecorder: { recordTransaction: async () => undefined },
    } as Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]);
    await initialRefresh;
    enumerateEnabled = true;

    entries.length = 0;
    lifecycleRequests = 0;
    holdSecondLifecycle = true;
    secondLifecycleStarted = deferred();
    releaseSecondLifecycle = deferred();
    const blockedRefresh = runtime.refresh();
    await secondLifecycleStarted.promise;
    assert.ok(
      entries.some((entry) =>
        entry.label === "Review Contextsを更新" &&
        entry.event === "progress" &&
        entry.progress?.stage === "pull-request-contexts" &&
        entry.progress.completed === 1
      ),
      "PR85-NR-002: first completed PR context must be visible while the second lifecycle request is still pending",
    );
    releaseSecondLifecycle.resolve();
    await blockedRefresh;

    entries.length = 0;
    lifecycleRequests = 0;
    holdSecondLifecycle = false;
    await runtime.refresh();
    assert.equal(
      entries.filter((entry) =>
        entry.label === "Review Contextsを更新" &&
        entry.event === "progress" &&
        entry.progress?.stage === "pull-request-files"
      ).length,
      0,
      "PR85-NR-003: Review Contexts internal progress reads must not publish PR-file progress under Review Contexts",
    );

    entries.length = 0;
    await feedback.run("PR進捗を計算", async () => {
      await pullRequestReviewRuntime.getProgress(`github-pr:${REPOSITORY_ID}#52`);
    });
    assert.ok(
      entries.some((entry) =>
        entry.label === "PR進捗を計算" &&
        entry.event === "progress" &&
        entry.progress?.stage === "pull-request-files"
      ),
      "selected PR Progress must retain PR-file progress reporting",
    );

    for (const subscription of subscriptions) subscription.dispose();
  } finally {
    setActiveOperationFeedback(undefined);
    moduleLoader._load = originalModuleLoad;
    globalThis.fetch = originalFetch;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

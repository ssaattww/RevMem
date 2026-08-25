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
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import { refreshSelectedPullRequestProgress } from "../../src/t305-projection-refresh.js";
import { PullRequestReviewRuntime } from "../../src/t405-pull-request-review-runtime.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const SECONDARY_REPOSITORY_ID = "github.com/ssaattww/revmem-secondary";

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

const withTimeout = async (promise: Promise<void>, message: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

test("PR85-IFR-004 production Review Contexts completion counts stay monotonic across two PRs, retry, and repositories", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revmem-pr85-closure-"));
  const repositoryRoot = path.join(temporaryRoot, "repository");
  const secondaryRepositoryRoot = path.join(temporaryRoot, "secondary-repository");
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
  let releaseSecondLifecycle = deferred();

  try {
    await mkdir(repositoryRoot, { recursive: true });
    await mkdir(secondaryRepositoryRoot, { recursive: true });
    await mkdir(globalStorageRoot, { recursive: true });
    await mkdir(workspaceStorageRoot, { recursive: true });
    await runGit(repositoryRoot, ["init", "-b", "main"]);
    await runGit(repositoryRoot, ["config", "user.email", "review-range@example.invalid"]);
    await runGit(repositoryRoot, ["config", "user.name", "Review Range Test"]);
    await runGit(repositoryRoot, ["commit", "--allow-empty", "-m", "smoke head"]);
    const head = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/ssaattww/revmem.git"]);
    await runGit(secondaryRepositoryRoot, ["init", "-b", "main"]);
    await runGit(secondaryRepositoryRoot, ["config", "user.email", "review-range@example.invalid"]);
    await runGit(secondaryRepositoryRoot, ["config", "user.name", "Review Range Test"]);
    await runGit(secondaryRepositoryRoot, ["commit", "--allow-empty", "-m", "secondary smoke head"]);
    const secondaryHead = await runGit(secondaryRepositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(secondaryRepositoryRoot, ["remote", "add", "origin", "https://github.com/ssaattww/revmem-secondary.git"]);

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
    const secondaryContext = pullRequestState(54, secondaryHead);
    const secondaryState = globalState(secondaryHead);
    await stateRepository.save(
      { kind: "pull-request", repositoryId: SECONDARY_REPOSITORY_ID, contextId: `github-pr:${SECONDARY_REPOSITORY_ID}#54` },
      {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState: {
          ...secondaryContext,
          contextId: `github-pr:${SECONDARY_REPOSITORY_ID}#54`,
          repositoryId: SECONDARY_REPOSITORY_ID,
          pullRequest: {
            ...secondaryContext.pullRequest!,
            repository: "revmem-secondary",
            baseSha: secondaryHead,
            headSha: secondaryHead,
          },
        },
        globalState: { ...secondaryState, repositoryId: SECONDARY_REPOSITORY_ID },
      },
    );

    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const workspaceState = new MemoryMemento();
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
        createTreeView: (): DisposableLike => ({ dispose: () => undefined }),
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
      getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    });

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
    const secondaryBranchSnapshot: CurrentContextUiSnapshot = {
      context: {
        kind: "branch",
        label: "main",
        detail: secondaryRepositoryRoot,
        headRevision: secondaryHead,
        selection: {
          kind: "branch",
          repositoryId: SECONDARY_REPOSITORY_ID,
          repositoryRoot: secondaryRepositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    };

    let lifecycleRequests = 0;
    let holdSecondLifecycle = false;
    let failSecondLifecycleOnce = false;
    let secondLifecycleStarted = deferred();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const lifecycle = /^\/repos\/ssaattww\/(?:revmem|revmem-secondary)\/pulls\/(52|53|54)$/u.exec(url.pathname);
      if (lifecycle !== null) {
        lifecycleRequests += 1;
        if (holdSecondLifecycle && lifecycleRequests === 2) {
          secondLifecycleStarted.resolve();
          await releaseSecondLifecycle.promise;
        }
        const number = Number(lifecycle[1]);
        if (failSecondLifecycleOnce && number === 53) {
          failSecondLifecycleOnce = false;
          throw new Error("transient lifecycle transport failure");
        }
        const pullRequestHead = number === 54 ? secondaryHead : head;
        return jsonResponse({
          number,
          title: `PR ${number}`,
          html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          state: "open",
          merged_at: null,
          changed_files: 0,
          base: { sha: pullRequestHead },
          head: { sha: pullRequestHead },
        });
      }
      if (/^\/repos\/ssaattww\/(?:revmem|revmem-secondary)\/pulls\/(52|53|54)\/files$/u.test(url.pathname)) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected GitHub request in PR85 closure regression: ${url}`);
    };

    setActiveOperationFeedback(feedback);
    const subscriptions: DisposableLike[] = [];
    await workspaceState.update("reviewRange.hiddenReviewContexts.v1", [`github-pr:${REPOSITORY_ID}#53`]);
    const runtime = runtimeModule.registerT405ReviewContextsRuntime({
      context: {
        globalStorageUri: { fsPath: globalStorageRoot },
        storageUri: { fsPath: workspaceStorageRoot },
        workspaceState,
        subscriptions,
      } as unknown as Parameters<typeof runtimeModule.registerT405ReviewContextsRuntime>[0]["context"],
      git: createNodeLocalGitAdapter(),
      enumerateCurrentContexts: async () => [branchSnapshot, secondaryBranchSnapshot],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: (registration) => pullRequestReviewRuntime.register(registration),
      openPullRequestReviewDiff: (contextId, fileId, title) => pullRequestReviewRuntime.openReviewDiff(contextId, fileId, title),
      getPullRequestReviewProgress: (contextId, feedbackContext, signal) =>
        pullRequestReviewRuntime.getProgress(contextId, feedbackContext, signal),
      reviewStateRepository: stateRepository,
      reviewHistoryRecorder: {
        recordContextCreated: async () => undefined,
        recordRevisionMapping: async () => undefined,
      },
    });

    entries.length = 0;
    lifecycleRequests = 0;
    holdSecondLifecycle = true;
    secondLifecycleStarted = deferred();
    releaseSecondLifecycle = deferred();
    const blockedRefresh = runtime.refresh();
    await withTimeout(secondLifecycleStarted.promise, "second PR lifecycle request was not reached");
    const firstContextWasReported = entries.some((entry) =>
      entry.label === "Review Contextsを更新" &&
      entry.event === "progress" &&
      entry.progress?.stage === "pull-request-contexts" &&
      entry.progress.completed === 1
    );
    releaseSecondLifecycle.resolve();
    await withTimeout(blockedRefresh, "blocked Review Contexts refresh did not complete after release");

    entries.length = 0;
    lifecycleRequests = 0;
    holdSecondLifecycle = false;
    failSecondLifecycleOnce = true;
    await runtime.refresh();
    assert.equal(failSecondLifecycleOnce, false, "the second PR lifecycle failure must exercise the public retry path");
    const completedPullRequestContexts = entries
      .filter((entry) => entry.event === "progress" && entry.progress?.stage === "pull-request-contexts")
      .map((entry) => entry.progress!.completed);
    const finalPullRequestContexts = entries
      .filter((entry) => entry.event === "progress" && entry.progress?.stage === "pull-request-contexts")
      .at(-1)?.progress;
    const reviewContextsPrFileProgressCount = entries.filter((entry) =>
      entry.label === "Review Contextsを更新" &&
      entry.event === "progress" &&
      entry.progress?.stage === "pull-request-files"
    ).length;

    entries.length = 0;
    await feedback.run("PR進捗を計算", async () => {
      await pullRequestReviewRuntime.getProgress(`github-pr:${REPOSITORY_ID}#52`);
    });
    const selectedPrFileProgressReported = entries.some((entry) =>
      entry.label === "PR進捗を計算" &&
      entry.event === "progress" &&
      entry.progress?.stage === "pull-request-files"
    );

    assert.deepEqual(
      {
        firstContextWasReported,
        reviewContextsPrFileProgressCount,
        selectedPrFileProgressReported,
      },
      {
        firstContextWasReported: true,
        reviewContextsPrFileProgressCount: 0,
        selectedPrFileProgressReported: true,
      },
      "PR85-NR-002/003 production composition contract",
    );
    assert.deepEqual(
      completedPullRequestContexts,
      [...completedPullRequestContexts].sort((left, right) => left - right),
      "PR85-IFR-004 production completion counts must never decrease with hidden PR contexts",
    );
    assert.deepEqual(
      finalPullRequestContexts,
      { stage: "pull-request-contexts", completed: 3, total: 3 },
      "PR85-IFR-004 final count must use the synchronized identity authority, not visible Tree rows",
    );

    for (const subscription of subscriptions) subscription.dispose();
  } finally {
    releaseSecondLifecycle.resolve();
    setActiveOperationFeedback(undefined);
    moduleLoader._load = originalModuleLoad;
    globalThis.fetch = originalFetch;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("PR85-NR-003 selected PR Progress reports file counts through the production Tree path on immutable-cache hits", async () => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const contextId = `github-pr:${REPOSITORY_ID}#52`;
  const fileId = "file-1";
  const snapshot: PullRequestDiffSnapshot = {
    contextId,
    baseSha,
    headSha,
    originalDiffId: `${baseSha}..${headSha}`,
    files: [{
      fileId,
      oldPath: "src/example.ts",
      newPath: "src/example.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      hunks: [{
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [
          { kind: "deletion", oldLine: 1, text: "old" },
          { kind: "addition", newLine: 1, text: "new" },
        ],
      }],
    }],
  };
  const persistedContext = pullRequestState(52, headSha);
  persistedContext.pullRequest = {
    ...persistedContext.pullRequest!,
    baseSha,
    headSha,
  };
  persistedContext.files = {
    [fileId]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId,
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: headSha,
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      lineCount: 1,
      updatedAt: "2026-08-24T12:00:00.000Z",
    },
  };
  const persisted = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: persistedContext,
    globalState: globalState(headSha),
  };
  let readCount = 0;
  const runtime = new PullRequestReviewRuntime<string>({
    repository: {
      load: async () => structuredClone(persisted),
      commit: async () => undefined,
    },
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => {
      readCount += 1;
      return {
        kind: "found",
        content: descriptor.revision === baseSha ? "old" : "new",
      };
    },
  });

  const entries: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => entries.push(entry),
    revealLog: () => undefined,
  });
  const refreshTree = async (): Promise<void> => {
    await refreshSelectedPullRequestProgress({
      contextId,
      source: runtime.progress,
      activateProgress: (selectedContextId) => runtime.activateProgress(selectedContextId),
      clearProgress: () => runtime.clearProgress(),
      setSource: () => undefined,
      refreshTree: () => undefined,
    });
  };

  setActiveOperationFeedback(feedback);
  try {
    await refreshTree();
    const readsAfterPrime = readCount;
    assert.ok(readsAfterPrime > 0, "first selected Tree refresh must prime immutable full-text cache");

    entries.length = 0;
    await refreshTree();

    assert.equal(readCount, readsAfterPrime, "second selected Tree refresh must use immutable cache");
    const fileProgress = entries.filter((entry) =>
      entry.event === "progress" && entry.progress?.stage === "pull-request-files"
    );
    assert.ok(fileProgress.some((entry) =>
      entry.label === "PR進捗を計算" && entry.progress?.completed === 0 && entry.progress.total === 1
    ), "cache-hit selected Tree refresh must report pull-request-files 0/1");
    assert.ok(fileProgress.some((entry) =>
      entry.label === "PR進捗を計算" && entry.progress?.completed === 1 && entry.progress.total === 1
    ), "cache-hit selected Tree refresh must report pull-request-files 1/1");
    assert.ok(fileProgress.every((entry) => entry.label === "PR進捗を計算"));
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

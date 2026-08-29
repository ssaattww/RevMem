import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import { FileSystemReviewStateRepository } from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const repositoryId = "github.com/example/private-context";

interface DisposableLike {
  dispose(): void;
}

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  public updateCount = 0;

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.updateCount += 1;
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
  public constructor(public readonly label: string, public readonly collapsibleState: number) {}
}

class FakeThemeIcon {
  public constructor(public readonly id: string) {}
}

const runGit = async (root: string, argumentsList: readonly string[]): Promise<string> =>
  (await execFileAsync("git", [...argumentsList], { cwd: root })).stdout.trim();

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const runScenario = async (options: {
  readonly privateApi: boolean;
  readonly interactiveSession: boolean;
  readonly multiplePullRequests?: boolean;
  readonly selectedPullRequestNumbers?: readonly number[];
  readonly redetectCount?: number;
  readonly operation?: "background" | "prepare" | "redetect";
  readonly operationCount?: number;
  readonly wrongPreferredSession?: boolean;
  readonly reselectCancelled?: boolean;
  readonly retryFails?: boolean;
  readonly anonymousUnavailable?: boolean;
  readonly abortDuringPicker?: boolean;
}): Promise<{
  readonly candidates: readonly CurrentContextUiSnapshot[];
  readonly candidatesByRefresh: readonly (readonly CurrentContextUiSnapshot[])[];
  readonly quickPickNumbers: readonly number[];
  readonly sessionRequests: readonly boolean[];
  readonly clearSessionPreferenceRequests: number;
  readonly searchRequestCount: number;
  readonly reviewStateMutationCount: number;
  readonly preferenceMutationCount: number;
  readonly operationErrorName: string | undefined;
}> => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revmem-t407-private-context-"));
  const repositoryRoot = path.join(temporaryRoot, "repository");
  const storageRoot = path.join(temporaryRoot, "storage");
  const sourcePath = path.join(repositoryRoot, "src", "example.ts");
  const originalFetch = globalThis.fetch;
  const moduleLoader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalModuleLoad = moduleLoader._load;
  let runtime: ReturnType<typeof import("../../src/t405-review-contexts-runtime.js").registerT405ReviewContextsRuntime> | undefined;
  const subscriptions: DisposableLike[] = [];

  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(storageRoot, { recursive: true });
    await runGit(repositoryRoot, ["init", "-b", "main"]);
    await runGit(repositoryRoot, ["config", "user.email", "t407@example.invalid"]);
    await runGit(repositoryRoot, ["config", "user.name", "T407"]);
    await writeFile(sourcePath, "before\n", "utf8");
    await runGit(repositoryRoot, ["add", "."]);
    await runGit(repositoryRoot, ["commit", "-m", "base"]);
    const baseSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await writeFile(sourcePath, "after\n", "utf8");
    await runGit(repositoryRoot, ["commit", "-am", "head"]);
    const headSha = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    await runGit(repositoryRoot, ["remote", "add", "origin", "https://github.com/example/private-context.git"]);

    const branch: CurrentContextUiSnapshot = {
      context: {
        kind: "branch",
        label: "main",
        headRevision: headSha,
        selection: {
          kind: "branch",
          repositoryId,
          repositoryRoot,
          branchRef: "refs/heads/main",
        },
      },
      progress: undefined,
    };
    const commands = new Map<string, () => Promise<void>>();
    const errors: string[] = [];
    const sessionRequests: boolean[] = [];
    let clearSessionPreferenceRequests = 0;
    let searchRequestCount = 0;
    const quickPickNumbers: number[] = [];
    let resolvePendingPicker: (() => void) | undefined;
    let signalPickerStarted: (() => void) | undefined;
    const pickerStarted = new Promise<void>((resolve) => { signalPickerStarted = resolve; });
    const selectedPullRequestNumbers = [...(options.selectedPullRequestNumbers ?? [])];
    const pullRequestNumbers = options.multiplePullRequests ? [77, 78] : [77];
    let sessionCreated = false;
    let sessionPreferenceCleared = false;
    const fakeVscode = {
      EventEmitter: FakeEventEmitter,
      TreeItem: FakeTreeItem,
      ThemeIcon: FakeThemeIcon,
      TreeItemCollapsibleState: { None: 0 },
      commands: {
        registerCommand: (id: string, handler: () => Promise<void>): DisposableLike => {
          commands.set(id, handler);
          return { dispose: () => undefined };
        },
      },
      window: {
        activeTextEditor: undefined,
        createTreeView: (): DisposableLike => ({ dispose: () => undefined }),
        showQuickPick: async (
          items: readonly { readonly candidate?: { readonly number: number } }[],
          quickPickOptions?: { readonly placeHolder?: string },
        ): Promise<{ readonly candidate?: { readonly number: number } } | undefined> => {
          if (quickPickOptions?.placeHolder !== "現在HEADのPRを選択") return undefined;
          if (options.abortDuringPicker) {
            signalPickerStarted?.();
            return new Promise((resolve) => {
              resolvePendingPicker = () => resolve(items[0]);
            });
          }
          const number = selectedPullRequestNumbers.shift();
          if (number === undefined) {
            throw new Error("each private PR redetect must choose through the production Quick Pick");
          }
          const selected = items.find((item) => item.candidate?.number === number);
          assert.ok(selected, `Quick Pick must offer PR #${number}`);
          quickPickNumbers.push(number);
          return selected;
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
        getSession: async (
          _providerId: string,
          _scopes: readonly string[],
          sessionOptions: { readonly createIfNone: boolean; readonly clearSessionPreference?: boolean },
        ) => {
          sessionRequests.push(sessionOptions.createIfNone);
          if (sessionOptions.clearSessionPreference === true) {
            clearSessionPreferenceRequests += 1;
            if (options.reselectCancelled) return undefined;
            sessionPreferenceCleared = true;
            sessionCreated = true;
          }
          if (options.wrongPreferredSession && !sessionPreferenceCleared) {
            return { accessToken: "wrong-session-token" };
          }
          if (sessionOptions.createIfNone && options.interactiveSession) sessionCreated = true;
          return sessionCreated ? { accessToken: "test-session-token" } : undefined;
        },
      },
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.pathname === "/repos/example/private-context/pulls" && url.searchParams.get("state") === "open") {
        searchRequestCount += 1;
        if (options.anonymousUnavailable && authorization === null) return new Response(null, { status: 404 });
        if (options.privateApi && authorization !== "Bearer test-session-token") return new Response(null, { status: 404 });
        if (options.retryFails && authorization === "Bearer test-session-token") return new Response(null, { status: 404 });
        if (!options.privateApi) assert.equal(authorization, null, "public PR search must remain anonymous without a session");
        return jsonResponse(pullRequestNumbers.map((number) => ({
          number,
          title: `test pull request ${number}`,
          html_url: `https://github.com/example/private-context/pull/${number}`,
          head: { sha: headSha },
          base: { ref: "main", sha: baseSha },
        })));
      }
      const pullRequestMatch = /^\/repos\/example\/private-context\/pulls\/(\d+)$/.exec(url.pathname);
      if (pullRequestMatch !== null) {
        const number = Number(pullRequestMatch[1]);
        assert.ok(pullRequestNumbers.includes(number), `unexpected pull request #${number}`);
        return jsonResponse({
          number,
          title: `test pull request ${number}`,
          html_url: `https://github.com/example/private-context/pull/${number}`,
          state: "open",
          merged_at: null,
          base: { sha: baseSha },
          head: { sha: headSha },
        });
      }
      throw new Error(`unexpected GitHub request: ${url.pathname}`);
    };

    moduleLoader._load = (request, parent, isMain) => request === "vscode"
      ? fakeVscode
      : Reflect.apply(originalModuleLoad, Module, [request, parent, isMain]) as unknown;
    const runtimeModulePath = runtimeRequire.resolve("../../src/t405-review-contexts-runtime.js");
    const reviewContextsModulePath = runtimeRequire.resolve("../../src/ui/review-contexts/vscode-review-contexts-runtime.js");
    const reviewContextsIndexPath = runtimeRequire.resolve("../../src/ui/review-contexts/index.js");
    delete runtimeRequire.cache[runtimeModulePath];
    delete runtimeRequire.cache[reviewContextsModulePath];
    delete runtimeRequire.cache[reviewContextsIndexPath];
    const runtimeModule = runtimeRequire(runtimeModulePath) as typeof import("../../src/t405-review-contexts-runtime.js");
    moduleLoader._load = originalModuleLoad;

    let candidates: readonly CurrentContextUiSnapshot[] = [];
    const candidatesByRefresh: Array<readonly CurrentContextUiSnapshot[]> = [];
    const workspaceState = new MemoryMemento();
    const stateRepository = new FileSystemReviewStateRepository({ storageUris: { globalStorageUri: { fsPath: storageRoot } } });
    let reviewStateMutationCount = 0;
    runtime = runtimeModule.registerT405ReviewContextsRuntime({
      context: {
        globalStorageUri: { fsPath: storageRoot },
        storageUri: { fsPath: storageRoot },
        workspaceState,
        subscriptions,
      } as never,
      git: createNodeLocalGitAdapter(),
      enumerateCurrentContexts: async () => [branch],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => {
        candidates = await runtime!.augmentCurrentContextCandidates([branch]);
        candidatesByRefresh.push(candidates);
      },
      registerPullRequestReviewDiff: () => undefined,
      openPullRequestReviewDiff: async () => undefined,
      getPullRequestReviewProgress: async () => ({ reviewedLineCount: 0, totalLineCount: 0, progress: 0 }),
      reviewStateRepository: {
        load: (target: Parameters<typeof stateRepository.load>[0]) => stateRepository.load(target),
        loadGlobal: (target: Parameters<typeof stateRepository.loadGlobal>[0]) => stateRepository.loadGlobal(target),
        listRepositoryContexts: (repository: Parameters<typeof stateRepository.listRepositoryContexts>[0]) => stateRepository.listRepositoryContexts(repository),
        commit: async (transaction: Parameters<typeof stateRepository.commit>[0]) => {
          reviewStateMutationCount += 1;
          return stateRepository.commit(transaction);
        },
        create: async (transaction: Parameters<typeof stateRepository.create>[0]) => {
          reviewStateMutationCount += 1;
          return stateRepository.create(transaction);
        },
      },
      reviewHistoryRecorder: new ReviewHistoryRecorder({
        sessionId: "t407",
        createEventId: () => "t407-event",
        appender: { append: async () => undefined },
      }),
    } as never);

    if (options.operation === "background") {
      candidates = await runtime.augmentCurrentContextCandidates([branch]);
    } else if (options.operation === "prepare") {
      const prepare = (runtime as unknown as {
        readonly preparePullRequestCandidateForExplicitContextSelection?: (signal?: AbortSignal) => Promise<void>;
      }).preparePullRequestCandidateForExplicitContextSelection;
      assert.ok(prepare, "Current Context selection preparation must be registered by the T405 runtime");
      let operationErrorName: string | undefined;
      if (options.abortDuringPicker) {
        const cancellation = new AbortController();
        const pending = prepare(cancellation.signal);
        await pickerStarted;
        cancellation.abort();
        resolvePendingPicker?.();
        try {
          await pending;
        } catch (error) {
          operationErrorName = error instanceof DOMException ? error.name : undefined;
        }
      } else {
        for (let count = 0; count < (options.operationCount ?? 1); count += 1) await prepare();
      }
      candidates = await runtime.augmentCurrentContextCandidates([branch]);
      return {
        candidates,
        candidatesByRefresh,
        quickPickNumbers,
        sessionRequests,
        clearSessionPreferenceRequests,
        searchRequestCount,
        reviewStateMutationCount,
        preferenceMutationCount: workspaceState.updateCount,
        operationErrorName,
      };
    } else {
      const redetect = commands.get("reviewRange.redetectPullRequest");
      assert.ok(redetect, `production PR redetect command must be registered; actual=${[...commands.keys()].join(",")}`);
      for (let count = 0; count < (options.redetectCount ?? 1); count += 1) await redetect();
    }
    assert.deepEqual(errors, []);
    return {
      candidates,
      candidatesByRefresh,
      quickPickNumbers,
      sessionRequests,
      clearSessionPreferenceRequests,
      searchRequestCount,
      reviewStateMutationCount,
      preferenceMutationCount: workspaceState.updateCount,
      operationErrorName: undefined,
    };
  } finally {
    runtime?.dispose();
    for (const subscription of subscriptions) subscription.dispose();
    globalThis.fetch = originalFetch;
    moduleLoader._load = originalModuleLoad;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

test("T407 explicit PR redetect registers private authenticated and public anonymous Current Context candidates", async () => {
  const privateResult = await runScenario({ privateApi: true, interactiveSession: true });
  assert.equal(privateResult.candidates.some((candidate) => candidate.context.kind === "pull-request"), true);
  assert.ok(privateResult.sessionRequests.includes(true), "private PR redetect must request an interactive VS Code session");
  assert.ok(privateResult.sessionRequests.includes(false), "candidate refresh must keep non-interactive session reads");

  const publicResult = await runScenario({ privateApi: false, interactiveSession: false });
  assert.equal(publicResult.candidates.some((candidate) => candidate.context.kind === "pull-request"), true);
});

test("T407 explicit Current Context preparation detects a private PR once and leaves background non-interactive", async () => {
  const privateResult = await runScenario({
    privateApi: true,
    interactiveSession: true,
    operation: "prepare",
    operationCount: 2,
  });
  assert.equal(privateResult.candidates.some((candidate) => candidate.context.kind === "pull-request"), true);
  assert.equal(
    privateResult.sessionRequests.filter((createIfNone) => createIfNone).length,
    1,
    "a saved PR at the same HEAD must prevent a second connection prompt",
  );

  const backgroundResult = await runScenario({ privateApi: true, interactiveSession: false, operation: "background" });
  assert.equal(backgroundResult.candidates.some((candidate) => candidate.context.kind === "pull-request"), false);
  assert.equal(backgroundResult.sessionRequests.filter((createIfNone) => createIfNone).length, 0);
});

test("T407 cancelled explicit Current Context preparation does not reprompt in the same operation", async () => {
  const result = await runScenario({ privateApi: true, interactiveSession: false, operation: "prepare" });
  assert.equal(result.candidates.some((candidate) => candidate.context.kind === "pull-request"), false);
  assert.equal(result.sessionRequests.filter((createIfNone) => createIfNone).length, 1);
  assert.equal(result.clearSessionPreferenceRequests, 0);
});

test("T407 reselects a wrong preferred session once after authenticated private 404 and retries the PR search", async () => {
  const result = await runScenario({
    privateApi: true,
    interactiveSession: true,
    wrongPreferredSession: true,
    operation: "prepare",
    operationCount: 2,
  });
  assert.equal(result.candidates.some((candidate) => candidate.context.kind === "pull-request"), true);
  assert.equal(result.clearSessionPreferenceRequests, 1, "only the first authenticated 404 may clear the account preference");
  assert.equal(result.searchRequestCount, 2, "the reselected account must retry the same PR search once");
});

test("T407 never loops account reselect or search retry after cancellation, retry failure, anonymous 404, or background refresh", async () => {
  const reselectCancelled = await runScenario({
    privateApi: true,
    interactiveSession: true,
    wrongPreferredSession: true,
    reselectCancelled: true,
    operation: "prepare",
  });
  assert.equal(reselectCancelled.clearSessionPreferenceRequests, 1);
  assert.equal(reselectCancelled.searchRequestCount, 1);

  const retryFailure = await runScenario({
    privateApi: true,
    interactiveSession: true,
    wrongPreferredSession: true,
    retryFails: true,
    operation: "prepare",
  });
  assert.equal(retryFailure.clearSessionPreferenceRequests, 1);
  assert.equal(retryFailure.searchRequestCount, 2);

  const anonymous = await runScenario({
    privateApi: false,
    interactiveSession: false,
    anonymousUnavailable: true,
    operation: "prepare",
  });
  assert.equal(anonymous.clearSessionPreferenceRequests, 0);

  const background = await runScenario({
    privateApi: true,
    interactiveSession: false,
    wrongPreferredSession: true,
    operation: "background",
  });
  assert.equal(background.clearSessionPreferenceRequests, 0);
});

test("T407 superseded explicit preparation cannot publish stale state or preference after its PR picker completes", async () => {
  const result = await runScenario({
    privateApi: true,
    interactiveSession: true,
    multiplePullRequests: true,
    operation: "prepare",
    abortDuringPicker: true,
  });
  assert.equal(result.operationErrorName, "AbortError");
  assert.equal(result.reviewStateMutationCount, 0);
  assert.equal(result.preferenceMutationCount, 0);
  assert.equal(result.candidates.some((candidate) => candidate.context.kind === "pull-request"), false);
});

test("T407 private PR redetect switches the Current Context owner through the production Quick Pick", async () => {
  const result = await runScenario({
    privateApi: true,
    interactiveSession: true,
    multiplePullRequests: true,
    selectedPullRequestNumbers: [77, 78],
    redetectCount: 2,
  });
  assert.deepEqual(result.quickPickNumbers, [77, 78]);
  assert.equal(result.candidatesByRefresh.length, 2);
  const selectedPullRequest = (snapshots: readonly CurrentContextUiSnapshot[]) => {
    const candidates = snapshots.filter((snapshot) => snapshot.context.kind === "pull-request");
    assert.equal(candidates.length, 1, "only the selected PR may own the Current Context projection");
    const selection = candidates[0].context.selection;
    assert.equal(selection?.kind, "pull-request");
    return selection;
  };
  const first = selectedPullRequest(result.candidatesByRefresh[0]);
  const second = selectedPullRequest(result.candidatesByRefresh[1]);
  assert.equal(first.pullRequestNumber, 77);
  assert.equal(second.pullRequestNumber, 78);
  assert.notEqual(first.contextId, second.contextId, "switching must replace the selected PR context identity");
  assert.equal(
    result.candidatesByRefresh[1].some((snapshot) => snapshot.context.selection?.kind === "pull-request" && snapshot.context.selection.pullRequestNumber === 77),
    false,
    "the stale PR must not remain the display owner after switching",
  );
});

test("T407 suite is wired into the required test:unit command", async () => {
  const packageJson = JSON.parse(await readFile(path.join(__dirname, "../../../package.json"), "utf8")) as {
    readonly scripts: { readonly "test:unit": string };
  };
  assert.match(packageJson.scripts["test:unit"], /test-dist\/test\/unit\/t407-private-pr-context\.test\.js/);
});

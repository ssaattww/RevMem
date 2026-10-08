import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createNodeLocalGitAdapter, type GitBlobReader, type GitCommandExecutor } from "../../src/adapters/local-git/index.js";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
} from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import { OperationFeedback, setActiveOperationFeedback } from "../../src/application/operation-feedback/index.js";
import { PullRequestDiffAcquisitionService } from "../../src/application/github-pr-diff/index.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import { PullRequestReviewRuntime } from "../../src/composition/pull-request/pull-request-review-runtime.js";
import type { T405ReviewContextsRuntimeOptions } from "../../src/composition/review-contexts/review-contexts-runtime.js";
import {
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  CurrentContextRuntimeCoordinator,
  CurrentContextUiController,
  type CurrentContextUiSnapshot,
} from "../../src/ui/current-context/index.js";

export const PR108_REPOSITORY_ID = "github.com/ssaattww/revmem";
export const PR108_FILE = "src/example.ts";
export const pr108ContextId = (number: number): string => `github-pr:${PR108_REPOSITORY_ID}#${number}`;
export type FixtureRevision = "A" | "B" | "C" | "D";
const TIMESTAMP = "2026-09-05T00:00:00.000Z";
const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
interface Disposable { dispose(): void }
interface Provider {
  onDidChangeTreeData(listener: () => void): Disposable;
  getChildren(): ReviewContextListItem[];
}
class Memento {
  public readonly values = new Map<string, unknown>();
  public get<T>(key: string, fallback?: T): T | undefined { return this.values.has(key) ? this.values.get(key) as T : fallback; }
  public async update(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  public keys(): readonly string[] { return [...this.values.keys()]; }
}
class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  public readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } };
  };
  public fire(value: T): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void { this.listeners.clear(); }
}
interface FakeCancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: (listener: (event: void) => void) => Disposable;
}
class FakeCancellationTokenSource {
  private readonly cancellation = new Emitter<void>();
  private cancelled = false;
  public readonly token: FakeCancellationToken;
  public constructor() {
    this.token = Object.defineProperties({}, {
      isCancellationRequested: { get: () => this.cancelled, enumerable: true },
      onCancellationRequested: { value: this.cancellation.event, enumerable: true },
    }) as FakeCancellationToken;
  }
  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancellation.fire();
  }
  public dispose(): void { this.cancellation.dispose(); }
}
// The same VS Code object is retained by CommonJS modules between sequential
// fixtures. Only external host ports are mocked; all T405 wiring is production.
const vscodeHost: Record<string, unknown> = {
  EventEmitter: Emitter,
  CancellationTokenSource: FakeCancellationTokenSource,
  TreeItem: class { public constructor(public label: string, public collapsibleState: number) {} },
  ThemeIcon: class { public constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0 },
  commands: {}, window: {}, workspace: {}, authentication: {},
};

export async function createPr108ProductionFixture(options: {
  readonly contexts?: readonly number[];
  readonly contextHead?: FixtureRevision;
  readonly globalHead?: FixtureRevision;
  readonly ownerHead?: FixtureRevision;
  readonly ownerSynchronizationRevision?: FixtureRevision;
  readonly operationFeedback?: boolean;
  readonly distinctRemoteHeads?: boolean;
  readonly preserveSourceSnapshot?: boolean;
  readonly syntheticRepository?: Readonly<{
    fileCount: number;
    linesPerFile: number;
    changedLinesPerFile: number;
    changedFileCount?: number;
  }>;
  /** Deterministic delay for each mocked GitHub HTTP request in lifecycle scaling checks. */
  readonly githubResponseDelayMilliseconds?: number;
  readonly existingRepository?: Readonly<{
    root: string;
    baseRevision: string;
    headRevision: string;
    owner: string;
    repository: string;
    accessToken: string;
    fetch: typeof globalThis.fetch;
  }>;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-pr108-production-"));
  const repositoryRoot = options.existingRepository?.root ?? path.join(root, "repository");
  const repositoryId = options.existingRepository === undefined
    ? PR108_REPOSITORY_ID
    : `github.com/${options.existingRepository.owner.toLowerCase()}/${options.existingRepository.repository.toLowerCase()}`;
  const primaryFilePath = options.existingRepository === undefined
    ? PR108_FILE
    : "performance/synthetic/fixture-0000.ts";
  const storageRoot = path.join(root, "state");
  const storageUris = { globalStorageUri: { fsPath: storageRoot } };
  const git = async (...args: string[]): Promise<string> =>
    (await execFileAsync("git", args, { cwd: repositoryRoot })).stdout.trim();
  await mkdir(storageRoot, { recursive: true });
  const revisions = {} as Record<FixtureRevision, string>;
  const texts = { A: "keep\nold\nstable", B: "keep\nb\nstable", C: "keep\nc\nstable", D: "keep\nd\nstable" };
  if (options.existingRepository !== undefined) {
    revisions.A = options.existingRepository.baseRevision;
    revisions.B = options.existingRepository.headRevision;
    revisions.C = options.existingRepository.headRevision;
    revisions.D = options.existingRepository.headRevision;
  } else {
    await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
    await git("init", "-b", "main");
    await git("config", "user.email", "pr108@example.invalid");
    await git("config", "user.name", "PR108 fixture");
    await git("config", "core.autocrlf", "false");
  }
  if (options.existingRepository === undefined && options.syntheticRepository === undefined) {
    for (const revision of ["A", "B", "C", "D"] as const) {
      await writeFile(path.join(repositoryRoot, PR108_FILE), texts[revision]);
      await git("add", PR108_FILE); await git("commit", "-m", revision);
      revisions[revision] = await git("rev-parse", "HEAD");
    }
  } else if (options.existingRepository === undefined && options.syntheticRepository !== undefined) {
    const { fileCount, linesPerFile, changedLinesPerFile } = options.syntheticRepository;
    const changedFileCount = options.syntheticRepository.changedFileCount ?? fileCount;
    for (const [name, value] of Object.entries({ fileCount, linesPerFile, changedLinesPerFile, changedFileCount })) {
      assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
    }
    assert.ok(changedLinesPerFile <= linesPerFile, "changedLinesPerFile must not exceed linesPerFile");
    assert.ok(changedFileCount <= fileCount, "changedFileCount must not exceed fileCount");
    const filePaths = Array.from({ length: fileCount }, (_, index) =>
      path.join("src", `synthetic-${String(index).padStart(4, "0")}.ts`));
    const originalLines = Array.from({ length: linesPerFile }, (_, line) => `const value${line} = ${line};`);
    for (const relativePath of filePaths) {
      const fullPath = path.join(repositoryRoot, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, `${originalLines.join("\n")}\n`);
    }
    await git("add", "src"); await git("commit", "-m", "A: synthetic repository baseline");
    revisions.A = await git("rev-parse", "HEAD");
    const changedLines = originalLines.slice();
    for (let line = 0; line < changedLinesPerFile; line += 1) changedLines[line] = `const changed${line} = ${line + 1};`;
    const changedText = `${changedLines.join("\n")}\n`;
    for (const relativePath of filePaths.slice(0, changedFileCount)) await writeFile(path.join(repositoryRoot, relativePath), changedText);
    await git("add", "src"); await git("commit", "-m", "B: synthetic PR changes");
    revisions.B = await git("rev-parse", "HEAD");
    for (const revision of ["C", "D"] as const) {
      await git("commit", "--allow-empty", "-m", `${revision}: synthetic fixture revision`);
      revisions[revision] = await git("rev-parse", "HEAD");
    }
  }
  if (options.existingRepository === undefined) await git("remote", "add", "origin", "https://github.com/ssaattww/revmem.git");
  const globalFor = (revision: FixtureRevision): RepositoryGlobalState => ({
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId,
    currentRevisionId: revisions[revision],
    files: { [PR108_FILE]: {
      fileId: PR108_FILE, currentPath: PR108_FILE, revisionId: revisions[revision],
      contentHash: hash(texts[revision]), reviewed: [{ startLine: 0, endLineExclusive: 1 }], updatedAt: TIMESTAMP,
    } }, updatedAt: TIMESTAMP,
  });
  const contextHead = options.contextHead ?? "B";
  const globalHead = options.globalHead ?? contextHead;
  const initialGlobal = globalFor(globalHead);
  if (options.preserveSourceSnapshot !== false && globalHead !== contextHead) {
    initialGlobal.revisionSnapshots = { [revisions[contextHead]]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, revisionId: revisions[contextHead],
      files: globalFor(contextHead).files, updatedAt: TIMESTAMP,
    } };
  }
  let atomic = new FileSystemReviewStateRepository({ storageUris });
  for (const number of options.contexts ?? [52, 53]) {
    const contextState: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: pr108ContextId(number), kind: "pull-request",
      repositoryId, displayName: `PR #${number}`,
      pullRequest: { host: "github.com", owner: "ssaattww", repository: "revmem", number,
        state: "open", title: `PR ${number}`, baseSha: revisions.A, headSha: revisions[contextHead] },
      files: { [PR108_FILE]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: PR108_FILE, currentPath: PR108_FILE,
        previousPaths: [], revisionId: revisions[contextHead], contentHash: hash(texts[contextHead]),
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }], originalReviewedByDiff: {},
        lineCount: 3, updatedAt: TIMESTAMP,
      } }, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    };
    await atomic.save({ kind: "pull-request", repositoryId, contextId: contextState.contextId },
      { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState: initialGlobal });
  }
  let publications = 0;
  let publicationMilliseconds = 0;
  let stateSaveCount = 0;
  let stateSaveMilliseconds = 0;
  let stateCommitCount = 0;
  let stateCreateCount = 0;
  const stateReadCounts = { load: 0, loadRepositorySnapshot: 0, listRepositoryContexts: 0 };
  const instrumentOwner = (): void => {
    const load = atomic.load.bind(atomic);
    atomic.load = async (...args) => { stateReadCounts.load += 1; return load(...args); };
    const loadRepositorySnapshot = atomic.loadRepositorySnapshot.bind(atomic);
    atomic.loadRepositorySnapshot = async (...args) => {
      stateReadCounts.loadRepositorySnapshot += 1;
      return loadRepositorySnapshot(...args);
    };
    const listRepositoryContexts = atomic.listRepositoryContexts.bind(atomic);
    atomic.listRepositoryContexts = async (...args) => {
      stateReadCounts.listRepositoryContexts += 1;
      return listRepositoryContexts(...args);
    };
    const commit = atomic.commitRepository.bind(atomic);
    atomic.commitRepository = async (transaction) => {
      const startedAt = performance.now();
      await commit(transaction);
      publications += 1;
      publicationMilliseconds += performance.now() - startedAt;
    };
    const save = atomic.save.bind(atomic);
    atomic.save = async (...args) => {
      const startedAt = performance.now();
      await save(...args);
      stateSaveCount += 1;
      stateSaveMilliseconds += performance.now() - startedAt;
    };
    const commitState = atomic.commit.bind(atomic);
    atomic.commit = async (...args) => {
      const startedAt = performance.now();
      await commitState(...args);
      stateCommitCount += 1;
      stateSaveMilliseconds += performance.now() - startedAt;
    };
    const createState = atomic.create.bind(atomic);
    atomic.create = async (...args) => {
      const startedAt = performance.now();
      await createState(...args);
      stateCreateCount += 1;
      stateSaveMilliseconds += performance.now() - startedAt;
    };
  };
  instrumentOwner();
  let repository = new DebouncedReviewStateRepository({ delegate: atomic, debounceMilliseconds: 0 });
  const histories: Array<{ contextId: string; type: string; revisionId?: string }> = [];
  const refreshDiagnostics: Array<{ stage: string; status: string; durationMs?: number }> = [];
  const historyStore = new JsonlReviewHistoryStore({ storageUris });
  let eventId = 0;
  const history = new ReviewHistoryRecorder({ sessionId: "pr108", createEventId: () => `pr108-${++eventId}`,
    appender: { append: async (target, event) => {
      await historyStore.append(target, event);
      histories.push({ contextId: event.contextId, type: event.type,
        ...("revisionId" in event ? { revisionId: event.revisionId } : {}) });
    } },
  });
  const remoteNumbers = [...new Set(options.contexts !== undefined && options.contexts.length > 0
    ? options.contexts
    : [52, 53])];
  const dynamicRevisions = new Map<string, string>();
  const revisionSha = (revision: string): string => {
    const dynamic = dynamicRevisions.get(revision);
    if (dynamic !== undefined) return dynamic;
    const fixed = revisions[revision as FixtureRevision];
    assert.ok(fixed, `Unknown fixture revision: ${revision}`);
    return fixed;
  };
  const remote = new Map<number, { base: string; head: string; state: "open" | "closed" }>(
    remoteNumbers.map((number) => [number, { base: "A", head: contextHead, state: "open" }]),
  );
  if (options.distinctRemoteHeads === true) {
    assert.equal(options.existingRepository, undefined, "distinct synthetic heads require a generated local fixture repository");
    for (const number of remoteNumbers) {
      const name = `PR-${number}`;
      await git("commit", "--allow-empty", "-m", `${name}: distinct synthetic PR head`);
      dynamicRevisions.set(name, await git("rev-parse", "HEAD"));
      remote.set(number, { base: "A", head: name, state: "open" });
    }
  }
  const unavailable = new Set<number>();
  let ownerHead = options.ownerHead ?? contextHead;
  let ownerSynchronizationRevision = options.ownerSynchronizationRevision;
  if (options.operationFeedback === true) setActiveOperationFeedback(new OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => {
      const refresh = entry.pullRequestRefresh;
      if (refresh !== undefined) refreshDiagnostics.push({
        stage: refresh.stage,
        status: refresh.status,
        ...(refresh.durationMs === undefined ? {} : { durationMs: refresh.durationMs }),
      });
    },
    revealLog: () => undefined,
  }));
  await git("checkout", "--detach", revisions[ownerHead]);
  const control = { selected: options.existingRepository === undefined ? 52 : 2, requireAuthentication: false, authenticated: false };
  const authenticationCalls: Array<{ interactive: boolean }> = [];
  const originalFetch = globalThis.fetch;
  const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
  const fetchRequests: string[] = [];
  const githubFetchIntervals: Array<{ startedAt: number; endedAt: number }> = [];
  let githubFetchMilliseconds = 0;
  const githubFetchRequestCountsByPath: Record<string, number> = {};
  globalThis.fetch = options.existingRepository?.fetch ?? (async (input, init) => {
    const url = new URL(String(input));
    const fetchStartedAt = performance.now();
    const fetchInterval = { startedAt: fetchStartedAt, endedAt: fetchStartedAt };
    githubFetchIntervals.push(fetchInterval);
    fetchRequests.push(`${url.pathname}?${url.searchParams.get("state") ?? ""}`);
    githubFetchRequestCountsByPath[url.pathname] = (githubFetchRequestCountsByPath[url.pathname] ?? 0) + 1;
    try {
      if ((options.githubResponseDelayMilliseconds ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.githubResponseDelayMilliseconds));
      }
      if (control.requireAuthentication && new Headers(init?.headers).get("authorization") === null) {
        return response({ message: "Not Found" }, 404);
      }
      const metadata = (number: number) => {
        const value = remote.get(number); assert.ok(value);
        return { number, title: `PR ${number}`, html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
          state: value.state, merged_at: null, changed_files: 1,
          base: { ref: "main", sha: revisionSha(value.base) }, head: { sha: revisionSha(value.head) } };
      };
      if (url.pathname === "/repos/ssaattww/revmem/pulls") {
        return response([...remote.keys()].map(metadata));
      }
      const match = /\/pulls\/(\d+)$/u.exec(url.pathname);
      if (match !== null) {
        const number = Number(match[1]);
        if (unavailable.has(number)) throw new Error("fixture lifecycle unavailable");
        return response(metadata(number));
      }
      const compare = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/u.exec(url.pathname);
      if (compare !== null) {
        return response({ merge_base_commit: { sha: compare[1] } });
      }
      throw new Error(`Unexpected request in PR108 production fixture: ${url.pathname}`);
    } finally {
      fetchInterval.endedAt = performance.now();
      githubFetchMilliseconds += fetchInterval.endedAt - fetchStartedAt;
    }
  });
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const errors: string[] = [];
  const opened: Array<{ original: string; modified: string }> = [];
  const registrations: Array<{ contextId: string; baseSha: string; headSha: string }> = [];
  const workspaceState = new Memento();
  let provider!: Provider;
  let providerTreeChangeEvents = 0;
  let initialRefresh!: Promise<void>;
  Object.assign(vscodeHost, {
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      commands.set(id, handler); return { dispose: () => { commands.delete(id); } };
    } },
      window: {
      activeTextEditor: { document: { uri: { scheme: "file", authority: "", fsPath: path.join(repositoryRoot, primaryFilePath), query: "", fragment: "" } } },
      createTreeView: (_id: string, value: { treeDataProvider: Provider }) => {
        provider = value.treeDataProvider;
        provider.onDidChangeTreeData(() => { providerTreeChangeEvents += 1; });
        initialRefresh = new Promise<void>((resolve) => {
          const listener = provider.onDidChangeTreeData(() => { listener.dispose(); resolve(); });
        });
        return { dispose: () => undefined };
      },
      showQuickPick: (
        items: readonly { candidate?: { number?: number } }[],
        value?: { placeHolder?: string },
        cancellationToken?: FakeCancellationToken,
      ) => {
        const selected = value?.placeHolder === "現在HEADのPRを選択"
          ? items.find((item) => item.candidate?.number === control.selected)
          : items[0];
        if (cancellationToken === undefined) return Promise.resolve(selected);
        if (cancellationToken.isCancellationRequested) return Promise.resolve(undefined);
        return new Promise<typeof selected>((resolve) => {
          let settled = false;
          const cancellationSubscription = cancellationToken.onCancellationRequested(() => {
            if (settled) return;
            settled = true;
            cancellationSubscription.dispose();
            resolve(undefined);
          });
          queueMicrotask(() => {
            if (settled) return;
            settled = true;
            cancellationSubscription.dispose();
            resolve(selected);
          });
        });
      },
      showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
    },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }), textDocuments: [],
      workspaceFolders: [{ uri: { scheme: "file", authority: "", fsPath: repositoryRoot, query: "", fragment: "" } }] },
    authentication: { getSession: async (_id: string, _scopes: string[], flags: { createIfNone?: unknown; clearSessionPreference?: boolean }) => {
      const interactive = Boolean(flags.createIfNone || flags.clearSessionPreference);
      authenticationCalls.push({ interactive });
      if (interactive && control.requireAuthentication) control.authenticated = true;
      return options.existingRepository !== undefined
        ? { accessToken: options.existingRepository.accessToken }
        : control.authenticated ? { accessToken: "fixture-token" } : undefined;
    } },
  });
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = loader._load;
  let runtimeModule: typeof import("../../src/composition/review-contexts/review-contexts-runtime.js");
  try {
    loader._load = (request, parent, isMain) => request === "vscode" ? vscodeHost : Reflect.apply(originalLoad, Module, [request, parent, isMain]);
    runtimeModule = runtimeRequire("../../src/composition/review-contexts/review-contexts-runtime.js") as typeof runtimeModule;
  } finally { loader._load = originalLoad; }
  const localGit = createNodeLocalGitAdapter();
  let gitSubprocessCount = 0;
  let gitSubprocessMilliseconds = 0;
  const gitCommandCounts: Record<string, number> = {};
  const gitInternals = localGit as unknown as {
    commandExecutor: GitCommandExecutor;
    blobReader: GitBlobReader;
  };
  const executeGitCommand = gitInternals.commandExecutor.execute.bind(gitInternals.commandExecutor);
  gitInternals.commandExecutor.execute = async (invocation, feedbackContext, signal) => {
    const startedAt = performance.now();
    const command = invocation.argumentsList[0] ?? "unknown";
    gitSubprocessCount += 1;
    gitCommandCounts[command] = (gitCommandCounts[command] ?? 0) + 1;
    try { return await executeGitCommand(invocation, feedbackContext, signal); }
    finally { gitSubprocessMilliseconds += performance.now() - startedAt; }
  };
  const readGitBlob = gitInternals.blobReader.readBlob.bind(gitInternals.blobReader);
  gitInternals.blobReader.readBlob = async (repositoryRoot, blobObjectId, feedbackContext, signal) => {
    const startedAt = performance.now();
    gitSubprocessCount += 1;
    gitCommandCounts["cat-file"] = (gitCommandCounts["cat-file"] ?? 0) + 1;
    try { return await readGitBlob(repositoryRoot, blobObjectId, feedbackContext, signal); }
    finally { gitSubprocessMilliseconds += performance.now() - startedAt; }
  };
  let revisionContentReadCount = 0;
  let revisionContentReadMilliseconds = 0;
  const readRevisionContent = localGit.readTextFileAtRevision.bind(localGit);
  localGit.readTextFileAtRevision = async (...args) => {
    const startedAt = performance.now();
    revisionContentReadCount += 1;
    try { return await readRevisionContent(...args); }
    finally { revisionContentReadMilliseconds += performance.now() - startedAt; }
  };
  let diffAcquisitionCount = 0;
  let diffAcquisitionMilliseconds = 0;
  let diffSnapshotFileCount = 0;
  const createReviewRuntime = (): PullRequestReviewRuntime<string> => {
    const created = new PullRequestReviewRuntime<string>({
      repository, requestHistory: (transaction) => history.recordTransaction(transaction, "user-selection"),
      diffHost: { parseUri: (value) => value, openDiff: async (original, modified) => { opened.push({ original, modified }); } },
      getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    });
    return created;
  };
  let review = createReviewRuntime();
  let runtime!: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime>;
  let subscriptions: Disposable[] = [];
  const start = async (): Promise<void> => {
    let enumerating = false;
    const enumerateCurrentContexts = async (): Promise<readonly CurrentContextUiSnapshot[]> => enumerating ? [{ context: {
      kind: "branch", label: "fixture", headRevision: revisions[ownerHead],
      ...(ownerSynchronizationRevision === undefined ? {} : { pullRequestSynchronizationRevision: revisions[ownerSynchronizationRevision] }),
      selection: ownerSynchronizationRevision === undefined
        ? { kind: "detached", repositoryId, repositoryRoot, headRevision: revisions[ownerHead] }
        : { kind: "branch", repositoryId, repositoryRoot, branchRef: "refs/heads/main" },
    }, progress: undefined }] : [];
    const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
      enumerateCandidates: async (signal, feedbackContext) =>
        runtime.augmentCurrentContextCandidates(await enumerateCurrentContexts(), signal, feedbackContext),
      resolveFallback: async (candidates) => candidates.find((candidate) => candidate.context.kind === "pull-request") ?? candidates[0],
      requestSelection: async () => undefined,
    });
    const controller = new CurrentContextUiController({
      setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {},
    }, {
      recompute: (signal, feedbackContext, refreshOptions) => composition.recompute(signal, feedbackContext, refreshOptions),
      selectContext: (signal, feedbackContext) => composition.selectContext(signal, feedbackContext),
      acceptRecomputed: (snapshot) => composition.acceptRecomputed(snapshot),
      acceptExplicit: (snapshot) => composition.acceptExplicit(snapshot),
    });
    const coordinator = new CurrentContextRuntimeCoordinator(controller, {
      acceptCurrentContextPreparation: (selection) => runtime.acceptCurrentContextPreparation?.(selection),
      refreshDependents: (refreshContext) => runtime.refreshListOnly?.(refreshContext?.feedbackContext, refreshContext?.signal),
    });
    runtime = runtimeModule.registerT405ReviewContextsRuntime({
      context: { ...storageUris, workspaceState, subscriptions } as unknown as T405ReviewContextsRuntimeOptions["context"],
      git: localGit,
      enumerateCurrentContexts,
      refreshDecorations: async () => undefined,
      refreshCurrentContext: (feedbackContext) => coordinator.refreshFromReviewContexts(undefined, feedbackContext),
      registerPullRequestReviewDiff: (registration) => { registrations.push(registration.snapshot); review.register(registration); },
      openPullRequestReviewDiff: (contextId, fileId, title) => review.openReviewDiff(contextId, fileId, title),
      getPullRequestReviewProgress: (contextId) => review.getProgress(contextId),
      reviewStateRepository: repository, reviewHistoryRecorder: history,
      createPullRequestDiffAcquisition: (adapters) => {
        const acquisition = new PullRequestDiffAcquisitionService(adapters);
        return {
          acquire: async (...args) => {
            const startedAt = performance.now();
            diffAcquisitionCount += 1;
            const result = await acquisition.acquire(...args);
            diffAcquisitionMilliseconds += performance.now() - startedAt;
            if (result.kind === "acquired") diffSnapshotFileCount += result.snapshot.files.length;
            return result;
          }
        };
      },
    });
    await initialRefresh;
    enumerating = true;
    assert.deepEqual(errors, [], "empty startup refresh must drain before fixture commands");
  };
  await start();
  return {
    revisions, texts, root, storageUris, remote, unavailable, control, authenticationCalls,
    histories, errors, opened, registrations, workspaceState,
    get runtime() { return runtime; }, get review() { return review; }, get provider() { return provider; },
    get repository() { return repository; }, get atomic() { return atomic; },
    ownerPublications: () => publications,
    metrics: () => ({
      revisionContentReadCount,
      revisionContentReadMilliseconds,
      gitSubprocessCount,
      gitSubprocessMilliseconds,
      gitCommandCounts: { ...gitCommandCounts },
      diffAcquisitionCount,
      diffAcquisitionMilliseconds,
      diffSnapshotFileCount,
      ownerPublications: publications,
      publicationMilliseconds,
      stateSaveCount,
      stateCommitCount,
      stateCreateCount,
      stateReadCounts: { ...stateReadCounts },
      stateSaveMilliseconds,
      providerTreeChangeEvents,
      githubFetchRequests: fetchRequests.length,
      githubFetchMilliseconds,
      githubFetchIntervals: githubFetchIntervals.map((interval) => ({ ...interval })),
      githubFetchRequestCountsByPath: { ...githubFetchRequestCountsByPath },
      refreshDiagnostics: [...refreshDiagnostics],
      projectionGenerationCount: (runtime as typeof runtime & { getProjectionGenerationCountForTest?: () => number })
        .getProjectionGenerationCountForTest?.() ?? 0,
    }),
    async owner(revision: FixtureRevision) { ownerHead = revision; await git("checkout", "--detach", revisions[revision]); },
    ownerSynchronizationRevision(revision: FixtureRevision | undefined) { ownerSynchronizationRevision = revision; },
    async invoke(id: string, ...args: unknown[]): Promise<readonly string[]> {
      errors.length = 0; const command = commands.get(id); assert.ok(command, `${id} must be registered`);
      await command(...args); return [...errors];
    },
    item(number: number) { const item = provider.getChildren().find((entry) => entry.context.pullRequest?.number === number); assert.ok(item, `PR ${number} must remain visible`); return item; },
    state: (number: number) => new FileSystemReviewStateRepository({ storageUris }).load({ kind: "pull-request", repositoryId, contextId: `github-pr:${repositoryId}#${number}` }),
    snapshot: () => new FileSystemReviewStateRepository({ storageUris }).loadRepositorySnapshot(repositoryId),
    async durableFiles(): Promise<Record<string, string>> {
      const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
      const result: Record<string, string> = {};
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath, entry.name);
        if (file.includes(`${path.sep}cache${path.sep}`)) continue;
        result[path.relative(storageRoot, file)] = await readFile(file, "utf8");
      }
      return result;
    },
    async restart() {
      for (const disposable of subscriptions.reverse()) disposable.dispose();
      await repository.dispose(); subscriptions = []; errors.length = 0;
      atomic = new FileSystemReviewStateRepository({ storageUris }); instrumentOwner();
      repository = new DebouncedReviewStateRepository({ delegate: atomic, debounceMilliseconds: 0 });
      review = createReviewRuntime(); await start();
    },
    async dispose() {
      for (const disposable of subscriptions.reverse()) disposable.dispose();
      await repository.dispose(); globalThis.fetch = originalFetch;
      if (options.operationFeedback === true) setActiveOperationFeedback(undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

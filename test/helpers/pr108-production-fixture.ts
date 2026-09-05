import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
} from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import { PullRequestReviewRuntime } from "../../src/t405-pull-request-review-runtime.js";
import type { T405ReviewContextsRuntimeOptions } from "../../src/t405-review-contexts-runtime.js";

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
// The same VS Code object is retained by CommonJS modules between sequential
// fixtures. Only external host ports are mocked; all T405 wiring is production.
const vscodeHost: Record<string, unknown> = {
  EventEmitter: Emitter,
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
  readonly preserveSourceSnapshot?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-pr108-production-"));
  const repositoryRoot = path.join(root, "repository");
  const storageRoot = path.join(root, "state");
  const storageUris = { globalStorageUri: { fsPath: storageRoot } };
  const git = async (...args: string[]): Promise<string> =>
    (await execFileAsync("git", args, { cwd: repositoryRoot })).stdout.trim();
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await mkdir(storageRoot, { recursive: true });
  await git("init", "-b", "main");
  await git("config", "user.email", "pr108@example.invalid");
  await git("config", "user.name", "PR108 fixture");
  await git("config", "core.autocrlf", "false");
  const revisions = {} as Record<FixtureRevision, string>;
  const texts = { A: "keep\nold\nstable", B: "keep\nb\nstable", C: "keep\nc\nstable", D: "keep\nd\nstable" };
  for (const revision of ["A", "B", "C", "D"] as const) {
    await writeFile(path.join(repositoryRoot, PR108_FILE), texts[revision]);
    await git("add", PR108_FILE); await git("commit", "-m", revision);
    revisions[revision] = await git("rev-parse", "HEAD");
  }
  await git("remote", "add", "origin", "https://github.com/ssaattww/revmem.git");
  const globalFor = (revision: FixtureRevision): RepositoryGlobalState => ({
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: PR108_REPOSITORY_ID,
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
      repositoryId: PR108_REPOSITORY_ID, displayName: `PR #${number}`,
      pullRequest: { host: "github.com", owner: "ssaattww", repository: "revmem", number,
        state: "open", title: `PR ${number}`, baseSha: revisions.A, headSha: revisions[contextHead] },
      files: { [PR108_FILE]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: PR108_FILE, currentPath: PR108_FILE,
        previousPaths: [], revisionId: revisions[contextHead], contentHash: hash(texts[contextHead]),
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }], originalReviewedByDiff: {},
        lineCount: 3, updatedAt: TIMESTAMP,
      } }, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    };
    await atomic.save({ kind: "pull-request", repositoryId: PR108_REPOSITORY_ID, contextId: contextState.contextId },
      { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState: initialGlobal });
  }
  let publications = 0;
  const instrumentOwner = (): void => {
    const commit = atomic.commitRepository.bind(atomic);
    atomic.commitRepository = async (transaction) => { await commit(transaction); publications += 1; };
  };
  instrumentOwner();
  let repository = new DebouncedReviewStateRepository({ delegate: atomic, debounceMilliseconds: 0 });
  const histories: Array<{ contextId: string; type: string; revisionId?: string }> = [];
  const historyStore = new JsonlReviewHistoryStore({ storageUris });
  let eventId = 0;
  const history = new ReviewHistoryRecorder({ sessionId: "pr108", createEventId: () => `pr108-${++eventId}`,
    appender: { append: async (target, event) => {
      await historyStore.append(target, event);
      histories.push({ contextId: event.contextId, type: event.type,
        ...("revisionId" in event ? { revisionId: event.revisionId } : {}) });
    } },
  });
  const remote = new Map<number, { base: FixtureRevision; head: FixtureRevision; state: "open" | "closed" }>(
    [52, 53].map((number) => [number, { base: "A", head: contextHead, state: "open" }]),
  );
  const unavailable = new Set<number>();
  let ownerHead = options.ownerHead ?? contextHead;
  await git("checkout", "--detach", revisions[ownerHead]);
  const control = { selected: 52, requireAuthentication: false, authenticated: false };
  const authenticationCalls: Array<{ interactive: boolean }> = [];
  const originalFetch = globalThis.fetch;
  const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (control.requireAuthentication && new Headers(init?.headers).get("authorization") === null) {
      return response({ message: "Not Found" }, 404);
    }
    const metadata = (number: number) => {
      const value = remote.get(number); assert.ok(value);
      return { number, title: `PR ${number}`, html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
        state: value.state, merged_at: null, changed_files: 1,
        base: { ref: "main", sha: revisions[value.base] }, head: { sha: revisions[value.head] } };
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
  };
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const errors: string[] = [];
  const opened: Array<{ original: string; modified: string }> = [];
  const registrations: Array<{ contextId: string; baseSha: string; headSha: string }> = [];
  const workspaceState = new Memento();
  let provider!: Provider;
  let initialRefresh!: Promise<void>;
  Object.assign(vscodeHost, {
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      commands.set(id, handler); return { dispose: () => { commands.delete(id); } };
    } },
    window: {
      activeTextEditor: { document: { uri: { scheme: "file", authority: "", fsPath: path.join(repositoryRoot, PR108_FILE), query: "", fragment: "" } } },
      createTreeView: (_id: string, value: { treeDataProvider: Provider }) => {
        provider = value.treeDataProvider;
        initialRefresh = new Promise<void>((resolve) => {
          const listener = provider.onDidChangeTreeData(() => { listener.dispose(); resolve(); });
        });
        return { dispose: () => undefined };
      },
      showQuickPick: async (items: readonly { candidate?: { number?: number } }[], value?: { placeHolder?: string }) =>
        value?.placeHolder === "現在HEADのPRを選択" ? items.find((item) => item.candidate?.number === control.selected) : items[0],
      showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
    },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }), textDocuments: [],
      workspaceFolders: [{ uri: { scheme: "file", authority: "", fsPath: repositoryRoot, query: "", fragment: "" } }] },
    authentication: { getSession: async (_id: string, _scopes: string[], flags: { createIfNone?: unknown; clearSessionPreference?: boolean }) => {
      const interactive = Boolean(flags.createIfNone || flags.clearSessionPreference);
      authenticationCalls.push({ interactive });
      if (interactive && control.requireAuthentication) control.authenticated = true;
      return control.authenticated ? { accessToken: "fixture-token" } : undefined;
    } },
  });
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = loader._load;
  let runtimeModule: typeof import("../../src/t405-review-contexts-runtime.js");
  try {
    loader._load = (request, parent, isMain) => request === "vscode" ? vscodeHost : Reflect.apply(originalLoad, Module, [request, parent, isMain]);
    runtimeModule = runtimeRequire("../../src/t405-review-contexts-runtime.js") as typeof runtimeModule;
  } finally { loader._load = originalLoad; }
  const localGit = createNodeLocalGitAdapter();
  const createReviewRuntime = (): PullRequestReviewRuntime<string> => new PullRequestReviewRuntime<string>({
    repository, requestHistory: (transaction) => history.recordTransaction(transaction, "user-selection"),
    diffHost: { parseUri: (value) => value, openDiff: async (original, modified) => { opened.push({ original, modified }); } },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  let review = createReviewRuntime();
  let runtime!: ReturnType<typeof runtimeModule.registerT405ReviewContextsRuntime>;
  let subscriptions: Disposable[] = [];
  const start = async (): Promise<void> => {
    let enumerating = false;
    runtime = runtimeModule.registerT405ReviewContextsRuntime({
      context: { ...storageUris, workspaceState, subscriptions } as unknown as T405ReviewContextsRuntimeOptions["context"],
      git: localGit,
      enumerateCurrentContexts: async () => enumerating ? [{ context: {
        kind: "branch", label: "fixture", headRevision: revisions[ownerHead], selection: {
          kind: "detached", repositoryId: PR108_REPOSITORY_ID, repositoryRoot, headRevision: revisions[ownerHead],
        },
      }, progress: undefined }] : [],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: (registration) => { registrations.push(registration.snapshot); review.register(registration); },
      openPullRequestReviewDiff: (contextId, fileId, title) => review.openReviewDiff(contextId, fileId, title),
      getPullRequestReviewProgress: (contextId) => review.getProgress(contextId),
      reviewStateRepository: repository, reviewHistoryRecorder: history,
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
    async owner(revision: FixtureRevision) { ownerHead = revision; await git("checkout", "--detach", revisions[revision]); },
    async invoke(id: string, ...args: unknown[]): Promise<readonly string[]> {
      errors.length = 0; const command = commands.get(id); assert.ok(command, `${id} must be registered`);
      await command(...args); return [...errors];
    },
    item(number: number) { const item = provider.getChildren().find((entry) => entry.context.pullRequest?.number === number); assert.ok(item, `PR ${number} must remain visible`); return item; },
    state: (number: number) => new FileSystemReviewStateRepository({ storageUris }).load({ kind: "pull-request", repositoryId: PR108_REPOSITORY_ID, contextId: pr108ContextId(number) }),
    snapshot: () => new FileSystemReviewStateRepository({ storageUris }).loadRepositorySnapshot(PR108_REPOSITORY_ID),
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
      await rm(root, { recursive: true, force: true });
    },
  };
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import { FileSystemReviewStateRepository, JsonlReviewHistoryStore } from "../../src/adapters/state-repository/index.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import { PullRequestReviewRuntime } from "../../src/t405-pull-request-review-runtime.js";
import type { PullRequestReviewRuntimeRegistration } from "../../src/t405-pull-request-review-runtime.js";
import type { CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";

export const OWNER_ID = "github.com/ssaattww/revmem";
export const OWNER_FILE = "src/example.ts";
export const ownerContextId = (number: number): string => `github-pr:${OWNER_ID}#${number}`;
const timestamp = "2026-09-05T00:00:00.000Z";
const execAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);
type Disposable = { dispose(): void };
type Provider = { getChildren(): ReviewContextListItem[]; onDidChangeTreeData(listener: () => void): Disposable };

class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  public readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };
  public fire(value: T): void { for (const listener of this.listeners) listener(value); }
  public dispose(): void { this.listeners.clear(); }
}
class Memento {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, fallback?: T): T | undefined { return this.values.has(key) ? this.values.get(key) as T : fallback; }
  public async update(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
}

/** Real Git, state/CAS, history, mapper and T405 registration; only VS Code and HTTP are faked. */
export async function createOwnerProductFixture(numbers: readonly number[] = [52, 53]) {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-pr108-products-"));
  const repositoryRoot = path.join(root, "repository");
  const storageRoot = path.join(root, "storage");
  const sourcePath = path.join(repositoryRoot, OWNER_FILE);
  const git = async (...args: string[]): Promise<string> => (await execAsync("git", args, { cwd: repositoryRoot })).stdout.trim();
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await git("init", "-b", "main");
  await git("config", "user.name", "RevMem test");
  await git("config", "user.email", "revmem@example.invalid");
  await git("config", "core.autocrlf", "false");
  const commitText = async (content: string, message: string): Promise<string> => {
    await writeFile(sourcePath, content);
    await git("add", OWNER_FILE);
    await git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const A = await commitText("keep\nold\nstable", "base");
  const B = await commitText("keep\nreview\nstable", "first PR revision");
  const C = await commitText("keep\nnew\nstable", "first owner advance");
  const D = await commitText("prefix\nkeep\nnewer\nstable", "second owner advance");
  await git("remote", "add", "origin", "https://github.com/ssaattww/revmem.git");
  const storageUris = { globalStorageUri: { fsPath: storageRoot } };
  const repository = new FileSystemReviewStateRepository({ storageUris });
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: OWNER_ID, currentRevisionId: B,
    files: { [OWNER_FILE]: { fileId: OWNER_FILE, currentPath: OWNER_FILE, revisionId: B,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }], updatedAt: timestamp } }, updatedAt: timestamp,
  };
  for (const number of numbers) {
    const contextState: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: OWNER_ID, contextId: ownerContextId(number),
      kind: "pull-request", displayName: `PR #${number}`,
      pullRequest: { host: "github.com", owner: "ssaattww", repository: "revmem", number, state: "open",
        title: `PR ${number}`, baseSha: A, headSha: B },
      files: { [OWNER_FILE]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId: OWNER_FILE,
        currentPath: OWNER_FILE, previousPaths: [], revisionId: B, lineCount: 3,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }], originalReviewedByDiff: {}, updatedAt: timestamp } },
      createdAt: timestamp, updatedAt: timestamp,
    };
    await repository.save({ kind: "pull-request", repositoryId: OWNER_ID, contextId: ownerContextId(number) }, {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState: structuredClone(globalState),
    });
  }
  const publications = { owner: 0, context: 0, create: 0 };
  const commitOwner = repository.commitRepository.bind(repository);
  repository.commitRepository = async (transaction) => { await commitOwner(transaction); publications.owner += 1; };
  const commitContext = repository.commit.bind(repository);
  repository.commit = async (transaction) => { await commitContext(transaction); publications.context += 1; };
  const createContext = repository.create.bind(repository);
  repository.create = async (transaction) => { await createContext(transaction); publications.create += 1; };
  const historyStore = new JsonlReviewHistoryStore({ storageUris });
  const history: Array<{ type: string; contextId: string }> = [];
  let eventId = 0;
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId: "pr108-products", createEventId: () => `pr108-product-${++eventId}`,
    appender: { append: async (target, event) => { await historyStore.append(target, event); history.push(event); } },
  });
  const remote = new Map([52, 53].map((number) => [number, { base: A, head: B, state: "open" }]));
  const unavailable = new Set<number>();
  const auth = { required: false, connected: false, interactiveCalls: 0, rejectSearchOnce: false, reselections: 0 };
  const originalFetch = globalThis.fetch;
  const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (auth.required && !auth.connected) return json({ message: "Not Found" }, 404);
    if (url.pathname.endsWith("/pulls")) {
      if (auth.rejectSearchOnce) { auth.rejectSearchOnce = false; return json({ message: "Not Found" }, 404); }
      return json([...remote].map(([number, revision]) => ({ number, title: `PR ${number}`,
        html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
        head: { sha: revision.head }, base: { ref: "main", sha: revision.base } })));
    }
    const comparison = /\/compare\/([a-f0-9]+)\.\.\.([a-f0-9]+)$/u.exec(url.pathname);
    if (comparison !== null) return json({ merge_base_commit: { sha: await git("merge-base", comparison[1]!, comparison[2]!) } });
    const match = /\/pulls\/(\d+)(\/files)?$/u.exec(url.pathname);
    if (match !== null) {
      const number = Number(match[1]);
      if (unavailable.has(number)) return json({ message: "temporarily unavailable" }, 503);
      const revision = remote.get(number);
      assert.ok(revision);
      if (match[2] !== undefined) {
        const diff = await git("diff", "--unified=3", revision.base, revision.head, "--", OWNER_FILE);
        return json([{ filename: OWNER_FILE, status: "modified", additions: 1, deletions: 1,
          patch: diff.slice(diff.indexOf("@@")) }]);
      }
      return json({ number, title: `PR ${number}`, state: revision.state, merged_at: null, changed_files: 1,
        html_url: `https://github.com/ssaattww/revmem/pull/${number}`,
        base: { sha: revision.base }, head: { sha: revision.head } });
    }
    throw new Error(`Unexpected fixture HTTP request: ${url.pathname}`);
  };
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const errors: string[] = [];
  const workspaceState = new Memento();
  let ownerHead = B;
  let choice = 52;
  let enabled = false;
  let provider: Provider;
  let resolveStartup: () => void = () => undefined;
  const subscriptions: Disposable[] = [];
  const fakeVscode = {
    EventEmitter: Emitter,
    TreeItem: class { public constructor(public readonly label: string, public readonly collapsibleState: number) {} },
    ThemeIcon: class { public constructor(public readonly id: string) {} },
    TreeItemCollapsibleState: { None: 0 },
    commands: { registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      commands.set(id, handler); return { dispose: () => { commands.delete(id); } };
    } },
    window: {
      activeTextEditor: { document: { uri: { scheme: "file", authority: "", fsPath: sourcePath, query: "", fragment: "" } } },
      createTreeView: (_id: string, options: { treeDataProvider: Provider }) => {
        provider = options.treeDataProvider;
        const listener = provider.onDidChangeTreeData(() => resolveStartup());
        return { dispose: () => listener.dispose() };
      },
      showQuickPick: async (items: readonly unknown[], options?: { placeHolder?: string }) =>
        options?.placeHolder === "現在HEADのPRを選択"
          ? items.find((item) => (item as { candidate?: { number?: number } }).candidate?.number === choice)
          : items[0],
      showErrorMessage: async (message: string) => { errors.push(message); },
    },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
      textDocuments: [],
      workspaceFolders: [{ uri: { scheme: "file", authority: "", fsPath: repositoryRoot, query: "", fragment: "" } }],
    },
    authentication: { getSession: async (_provider: string, _scopes: string[], options: { createIfNone: boolean; clearSessionPreference?: boolean }) => {
      if (options.createIfNone) { auth.connected = true; auth.interactiveCalls += 1; }
      if (options.clearSessionPreference) auth.reselections += 1;
      return auth.connected ? { accessToken: "fixture-token" } : undefined;
    } },
  };
  const moduleLoader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleLoader._load;
  const oldCacheKeys = new Set(Object.keys(runtimeRequire.cache));
  moduleLoader._load = (request, parent, isMain) => request === "vscode" ? fakeVscode : Reflect.apply(originalLoad, Module, [request, parent, isMain]);
  const runtimePath = runtimeRequire.resolve("../../src/t405-review-contexts-runtime.js");
  delete runtimeRequire.cache[runtimePath];
  const { registerT405ReviewContextsRuntime } = runtimeRequire(runtimePath) as typeof import("../../src/t405-review-contexts-runtime.js");
  moduleLoader._load = originalLoad;
  const registrations = new Map<string, PullRequestReviewRuntimeRegistration>();
  const opened: Array<{ original: string; modified: string }> = [];
  let review: PullRequestReviewRuntime<string>;
  let runtime: ReturnType<typeof registerT405ReviewContextsRuntime>;
  const start = async (): Promise<void> => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    registrations.clear();
    review = new PullRequestReviewRuntime<string>({ repository,
      requestHistory: (transaction) => historyRecorder.recordTransaction(transaction, "user-selection"),
      diffHost: { parseUri: (value) => value, openDiff: async (original, modified) => { opened.push({ original, modified }); } },
      getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    });
    enabled = false;
    const startup = new Promise<void>((resolve) => { resolveStartup = resolve; });
    runtime = registerT405ReviewContextsRuntime({
      context: { globalStorageUri: { fsPath: storageRoot }, workspaceState, subscriptions } as never,
      git: createNodeLocalGitAdapter(),
      enumerateCurrentContexts: async (): Promise<readonly CurrentContextUiSnapshot[]> => enabled ? [{ context: {
        kind: "branch", label: "main", headRevision: ownerHead,
        selection: { kind: "branch", repositoryId: OWNER_ID, repositoryRoot, branchRef: "refs/heads/main" },
      }, progress: undefined }] : [],
      refreshDecorations: async () => undefined, refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: (registration) => { registrations.set(registration.snapshot.contextId, registration); review.register(registration); },
      openPullRequestReviewDiff: (contextId, fileId, title) => review.openReviewDiff(contextId, fileId, title),
      getPullRequestReviewProgress: (contextId) => review.getProgress(contextId),
      reviewStateRepository: repository, reviewHistoryRecorder: historyRecorder,
    });
    enabled = true;
    await startup;
  };
  await git("checkout", "--detach", B);
  await start();
  return {
    A, B, C, D, repository, remote, unavailable, auth, publications, history, errors, registrations, opened,
    get review() { return review; },
    get runtime() { return runtime; },
    items: () => provider.getChildren(),
    load: (number: number) => repository.load({ kind: "pull-request", repositoryId: OWNER_ID, contextId: ownerContextId(number) }),
    setOwner: async (head: string, selected = 52) => { await git("checkout", "--detach", head); ownerHead = head; choice = selected; },
    invoke: async (id = "reviewRange.redetectPullRequest", ...args: unknown[]) => {
      const command = commands.get(id); assert.ok(command, `actual command registered: ${id}`); await command(...args);
    },
    durableFiles: async () => {
      const result: Record<string, string> = {};
      const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name === "cache") continue;
          const filename = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(filename);
          else result[path.relative(storageRoot, filename)] = (await readFile(filename)).toString("base64");
        }
      };
      await walk(storageRoot); return result;
    },
    restart: start,
    dispose: async () => {
      for (const subscription of subscriptions.splice(0)) subscription.dispose();
      globalThis.fetch = originalFetch;
      moduleLoader._load = originalLoad;
      for (const key of Object.keys(runtimeRequire.cache)) if (!oldCacheKeys.has(key)) delete runtimeRequire.cache[key];
      delete runtimeRequire.cache[runtimePath];
      await rm(root, { recursive: true, force: true });
    },
  };
}

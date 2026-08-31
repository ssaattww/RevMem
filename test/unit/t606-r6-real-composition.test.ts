import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import {
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import { REVIEW_RANGE_SCHEMA_VERSION, type ReviewContextState } from "../../src/core/contracts/index.js";
import { CurrentContextCandidateSelection, CurrentContextRuntimeComposition, type CurrentContextUiSnapshot } from "../../src/ui/current-context/index.js";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, defaultValue?: T): T | undefined { return this.values.get(key) as T | undefined ?? defaultValue; }
  public async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
  public keys(): readonly string[] { return [...this.values.keys()]; }
}

class FeedbackHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public showBusy(): void {}
  public clearBusy(): void {}
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void {}
}

const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; };
  const original = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode"
    ? vscode
    : Reflect.apply(original, Module, [request, parent, isMain]) as unknown;
  const modulePath = runtimeRequire.resolve(moduleName);
  delete runtimeRequire.cache[modulePath];
  const loaded = runtimeRequire(modulePath) as T;
  loader._load = original;
  return loaded;
};

test("T606 IFR002 real T305-to-T405 composition retries only transient acquisition, aborts deep cache I/O, and fences stale publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t606-real-composition-"));
  const baseSha = "1".repeat(40);
  try {
    await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t606@example.invalid"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "T606"], { cwd: root });
    await writeFile(path.join(root, "example.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
    const headSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    const repositoryId = "github.com/example/revmem";
    const contextId = `github-pr:${repositoryId}#76`;
    const pullRequest: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId,
      kind: "pull-request",
      repositoryId,
      displayName: "PR #76",
      pullRequest: { host: "github.com", owner: "example", repository: "revmem", number: 76, state: "open", title: "T606", baseSha, headSha },
      files: {}, createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
    };
    const branch: CurrentContextUiSnapshot = {
      context: { kind: "branch", label: "main", detail: root, headRevision: headSha, selection: { kind: "branch", repositoryId, repositoryRoot: root, branchRef: "refs/heads/main" } },
      progress: undefined,
    };
    const commands = new Map<string, () => Promise<void>>();
    const errors: unknown[] = [];
    const fetches: string[] = [];
    let phase: "initial" | "transient" | "permanent" | "pending" | "success" = "initial";
    let transientAttempts = 0;
    const pendingWrite = deferred<void>();
    const writeSignals: AbortSignal[] = [];
    const writes: string[] = [];
    const vscode = {
      EventEmitter: class { public readonly event = () => undefined; public fire(): void {} public dispose(): void {} },
      TreeItem: class {}, ThemeIcon: class {}, TreeItemCollapsibleState: { None: 0 }, StatusBarAlignment: { Left: 1 },
      commands: { registerCommand: (id: string, handler: () => Promise<void>) => { commands.set(id, handler); return { dispose(): void {} }; } },
      window: {
        createStatusBarItem: () => ({ name: "", command: "", text: "", tooltip: undefined, show(): void {}, hide(): void {}, dispose(): void {} }),
        registerTreeDataProvider: () => ({ dispose(): void {} }), onDidChangeActiveTextEditor: () => ({ dispose(): void {} }),
        createTreeView: () => ({ dispose(): void {} }), showErrorMessage: async (error: unknown) => { errors.push(error); },
      },
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      authentication: { getSession: async () => ({ accessToken: "fixture-token" }) },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      fetches.push(url);
      if (url.includes(`/compare/${baseSha}...${headSha}`)) {
        return new Response(JSON.stringify({ merge_base_commit: { sha: baseSha } }), { status: 200 });
      }
      if (url.includes("/pulls/76/files")) {
        if (phase === "transient" && transientAttempts++ < 2) throw new Error("fixture network interruption");
        if (phase === "permanent") return new Response("unauthorized", { status: 401 });
        return new Response(JSON.stringify([{ filename: "example.ts", status: "modified", additions: 1, deletions: 1 }]), { status: 200 });
      }
      if (url.includes("/contents/example.ts")) return new Response(
        url.includes(`ref=${baseSha}`) ? "export const value = 0;\n" : "export const value = 1;\n",
        { status: 200 },
      );
      return new Response(JSON.stringify({ number: 76, title: "T606", html_url: "https://example.invalid/76", state: "open", merged_at: null, changed_files: 1, base: { sha: baseSha }, head: { sha: headSha } }), { status: 200 });
    };
    const t405 = loadWithVscode<typeof import("../../src/t405-review-contexts-runtime.js")>("../../src/t405-review-contexts-runtime.js", vscode);
    const current = loadWithVscode<typeof import("../../src/ui/current-context/vscode-current-context-runtime.js")>("../../src/ui/current-context/vscode-current-context-runtime.js", vscode);
    const context = { globalStorageUri: { fsPath: path.join(root, "global") }, storageUri: { fsPath: path.join(root, "workspace") }, workspaceState: new MemoryMemento(), subscriptions: [] };
    const stateRepository = {
      load: async () => undefined,
      loadGlobal: async () => undefined,
      listRepositoryContexts: async () => phase === "initial" ? [] : [pullRequest],
      commit: async () => undefined,
      create: async () => undefined,
    };
    const registered = t405.registerT405ReviewContextsRuntime({
      context: context as never,
      git: createNodeLocalGitAdapter(),
      enumerateCurrentContexts: async () => [branch],
      refreshDecorations: async () => undefined,
      refreshCurrentContext: async () => undefined,
      registerPullRequestReviewDiff: () => undefined,
      openPullRequestReviewDiff: async () => undefined,
      getPullRequestReviewProgress: async () => ({ reviewedLineCount: 0, totalLineCount: 0, progress: 0 }),
      reviewStateRepository: stateRepository,
      reviewHistoryRecorder: { recordContextCreated: async () => undefined, recordRevisionMapping: async () => undefined },
      createPullRequestCacheStorage: () => ({
        read: async () => undefined,
        write: async (_entry: unknown, _feedback: unknown, signal?: AbortSignal) => {
          writes.push(phase); writeSignals.push(signal!);
          if (phase === "pending") await pendingWrite.promise;
        },
      }),
    });
    const accepted: Array<CurrentContextUiSnapshot | undefined> = [];
    const composition = new CurrentContextRuntimeComposition(new CurrentContextCandidateSelection(), {
      enumerateCandidates: (signal, feedbackContext) => registered.augmentCurrentContextCandidates([branch], signal, feedbackContext),
      resolveFallback: async (candidates) => candidates[0], requestSelection: async () => undefined,
    });
    const host = new FeedbackHost();
    const feedback = new OperationFeedback(host, () => 1);
    setActiveOperationFeedback(feedback);
    try {
      current.registerCurrentContextRuntime(context as never, {
        recompute: (signal, feedbackContext) => composition.recompute(signal, feedbackContext),
        selectContext: (signal, feedbackContext) => composition.selectContext(signal, feedbackContext),
        acceptRecomputed: (snapshot) => { accepted.push(snapshot); composition.acceptRecomputed(snapshot); },
      }, { refreshDependents: async () => undefined }, async (error) => { errors.push(error); });
      await new Promise((resolve) => setImmediate(resolve));

      phase = "transient";
      await commands.get(current.REFRESH_CONTEXT_COMMAND_ID)!();
      assert.equal(transientAttempts, 3, "only transient T405 result unions replay the complete T305 acquisition at most three times");
      assert.ok(fetches.some((url) => url.includes("/pulls/76/files")) && fetches.some((url) => url.includes("/contents/example.ts")), "the actual GitHub metadata/files/blob adapters are reached after local Git");
      assert.equal(writes.filter((value) => value === "transient").length, 1, "the final acquired result publishes cache once after retries");

      phase = "permanent";
      const permanentBefore = fetches.filter((url) => url.includes("/pulls/76/files")).length;
      await commands.get(current.REFRESH_CONTEXT_COMMAND_ID)!();
      assert.equal(fetches.filter((url) => url.includes("/pulls/76/files")).length - permanentBefore, 1, "authentication result unions are terminal and do not retry");

      phase = "pending";
      const pending = commands.get(current.REFRESH_CONTEXT_COMMAND_ID)!();
      while (writes.at(-1) !== "pending") await new Promise((resolve) => setImmediate(resolve));
      phase = "success";
      const currentRefresh = commands.get(current.REFRESH_CONTEXT_COMMAND_ID)!();
      pendingWrite.resolve();
      await Promise.all([pending, currentRefresh]);
      assert.equal(writeSignals.find((signal, index) => writes[index] === "pending")?.aborted, true, "a registered Current Context command supersedes pending deepest cache I/O through the same signal");
      assert.equal(errors.length, 1, "only the permanent terminal reaches the redacted command boundary");
      assert.equal(accepted.at(-1)?.context.kind, "pull-request", "only the current composition may publish the fresh T405 candidate");
      assert.ok(host.logs.filter((entry) => entry.event === "failed" || entry.event === "succeeded").length >= 4, "each real command lifecycle has one typed terminal");
    } finally {
      setActiveOperationFeedback(undefined);
      globalThis.fetch = originalFetch;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

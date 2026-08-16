import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

import {
  FetchGitHubPullRequestAdapter,
  FetchGitHubPullRequestDiffAdapter,
  NodeGitHubPullRequestCacheStorage,
  VsCodeGitHubAuthenticationProvider,
  createNodeGitHubPullRequestContextStateService,
  gitHubApiBaseUrl,
  parseGitHubRemote,
} from "./adapters/github/index";
import {
  LocalGitPullRequestDiffAdapter,
  NodeGitCommandExecutor,
  type LocalGitAdapter,
  type LocalGitRepository,
} from "./adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  resolveReviewStateStorageRoute,
  type ReviewStateStorageUris,
} from "./adapters/state-repository/index";
import { GitHubPullRequestCacheService } from "./application/github-pr-cache/index";
import {
  GitHubPullRequestContextResolver,
  createGitHubPullRequestContextIdFromRepositoryId,
  type GitHubPullRequestCandidate,
  type GitHubRepositoryIdentity,
} from "./application/github-pr-context/index";
import { PullRequestDiffAcquisitionService } from "./application/github-pr-diff/index";
import {
  ReviewContextsController,
  projectReviewContexts,
  type ReviewContextListItem,
} from "./application/review-contexts/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "./core/contracts/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import {
  VscodeReviewContextVisibilityStore,
  registerReviewContextsRuntime,
  type RegisteredReviewContextsRuntime,
  type ReviewContextsRuntimeSource,
} from "./ui/review-contexts/index";

const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const DIFF_SCHEME = "review-range-pr-context";
const MAX_DIFF_DOCUMENTS = 64;

interface T405ReviewContextsRuntimeOptions {
  readonly context: vscode.ExtensionContext;
  readonly git: LocalGitAdapter;
  readonly enumerateCurrentContexts: () => Promise<readonly CurrentContextUiSnapshot[]>;
  readonly refreshDecorations: () => Promise<void>;
}

const storageUris = (context: vscode.ExtensionContext): ReviewStateStorageUris => ({
  globalStorageUri: context.globalStorageUri,
  storageUri: context.storageUri,
});

const pullRequestIdentity = (context: ReviewContextState) => {
  const pullRequest = context.pullRequest;
  if (context.kind !== "pull-request" || pullRequest === undefined) {
    throw new TypeError("pull-request context is required");
  }
  return {
    host: pullRequest.host,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
    pullRequestNumber: pullRequest.number,
  };
};

const repositoryIdentity = (context: ReviewContextState): GitHubRepositoryIdentity => {
  const pullRequest = context.pullRequest;
  if (context.kind !== "pull-request" || pullRequest === undefined) {
    throw new TypeError("pull-request context is required");
  }
  return {
    host: pullRequest.host,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
  };
};

const diffRequest = (context: ReviewContextState) => {
  const pullRequest = context.pullRequest;
  if (context.kind !== "pull-request" || pullRequest === undefined) {
    throw new TypeError("pull-request context is required");
  }
  return {
    contextId: context.contextId,
    repository: repositoryIdentity(context),
    number: pullRequest.number,
    baseSha: pullRequest.baseSha,
    headSha: pullRequest.headSha,
  };
};

const createPullRequestSearch = (
  identity: GitHubRepositoryIdentity,
  token: string | undefined,
): FetchGitHubPullRequestAdapter => {
  const apiBaseUrl = gitHubApiBaseUrl(identity.host);
  return token === undefined
    ? new FetchGitHubPullRequestAdapter({ apiBaseUrl })
    : new FetchGitHubPullRequestAdapter({ apiBaseUrl, token });
};

const createPullRequestRemote = (
  identity: GitHubRepositoryIdentity,
  token: string | undefined,
): FetchGitHubPullRequestDiffAdapter => {
  const apiBaseUrl = gitHubApiBaseUrl(identity.host);
  return token === undefined
    ? new FetchGitHubPullRequestDiffAdapter({ apiBaseUrl })
    : new FetchGitHubPullRequestDiffAdapter({ apiBaseUrl, token });
};

class ReviewContextDiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private sequence = 0;

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString(true)) ?? "";
  }

  public create(content: string, displayPath: string, side: string): vscode.Uri {
    const token = `${Date.now()}-${this.sequence++}-${randomUUID()}`;
    const uri = vscode.Uri.from({
      scheme: DIFF_SCHEME,
      path: `/${encodeURIComponent(displayPath)}`,
      query: `side=${encodeURIComponent(side)}&token=${encodeURIComponent(token)}`,
    });
    this.contents.set(uri.toString(true), content);
    while (this.contents.size > MAX_DIFF_DOCUMENTS) {
      const first = this.contents.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.contents.delete(first);
    }
    return uri;
  }
}

class T405ReviewContextsSource implements ReviewContextsRuntimeSource {
  private readonly repository: FileSystemReviewStateRepository;
  private readonly currentPullRequests = new Map<string, ReviewContextState>();
  private readonly roots = new Map<string, string>();

  public constructor(
    uris: ReviewStateStorageUris,
    private readonly visibility: VscodeReviewContextVisibilityStore,
    private readonly enumerateCurrentContexts: () => Promise<readonly CurrentContextUiSnapshot[]>,
  ) {
    this.repository = new FileSystemReviewStateRepository({ storageUris: uris });
  }

  public setCurrentPullRequest(repositoryId: string, context: ReviewContextState | undefined): void {
    if (context === undefined) this.currentPullRequests.delete(repositoryId);
    else this.currentPullRequests.set(repositoryId, context);
  }

  public repositoryRoot(repositoryId: string): string | undefined {
    return this.roots.get(repositoryId);
  }

  public async load(): Promise<readonly ReviewContextListItem[]> {
    const current: ReviewContextState[] = [];
    const saved = new Map<string, ReviewContextState>();
    this.roots.clear();

    for (const snapshot of await this.enumerateCurrentContexts()) {
      const selection = snapshot.context.selection;
      if (selection?.kind === "branch") {
        this.roots.set(selection.repositoryId, selection.repositoryRoot);
        const persisted = await this.repository.listRepositoryContexts(selection.repositoryId);
        for (const context of persisted) saved.set(context.contextId, context);
        const branch = persisted.find((context) =>
          context.kind === "branch" && context.branch?.refName === selection.branchRef
        );
        current.push(branch ?? this.syntheticBranch(snapshot, selection.repositoryId, selection.branchRef));
        const pullRequest = this.currentPullRequests.get(selection.repositoryId);
        if (pullRequest !== undefined) current.unshift(pullRequest);
      } else if (selection?.kind === "detached") {
        this.roots.set(selection.repositoryId, selection.repositoryRoot);
        for (const context of await this.repository.listRepositoryContexts(selection.repositoryId)) {
          saved.set(context.contextId, context);
        }
        const pullRequest = this.currentPullRequests.get(selection.repositoryId);
        if (pullRequest !== undefined) current.unshift(pullRequest);
      } else if (snapshot.context.kind === "workspace") {
        current.push(this.syntheticWorkspace(snapshot));
      }
    }

    return projectReviewContexts({
      current,
      saved: [...saved.values()],
      hiddenContextIds: new Set(await this.visibility.readHiddenContextIds()),
    });
  }

  private syntheticBranch(
    snapshot: CurrentContextUiSnapshot,
    repositoryId: string,
    refName: string,
  ): ReviewContextState {
    const now = new Date().toISOString();
    const headRevision = snapshot.context.headRevision;
    if (headRevision === undefined) throw new Error("Current branch does not have a HEAD revision");
    return {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: `current-branch:${repositoryId}:${encodeURIComponent(refName)}`,
      kind: "branch",
      repositoryId,
      displayName: snapshot.context.label,
      branch: { refName, headRevision },
      files: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  private syntheticWorkspace(snapshot: CurrentContextUiSnapshot): ReviewContextState {
    const now = new Date().toISOString();
    const identity = snapshot.context.selection?.kind === "workspace"
      ? JSON.stringify(snapshot.context.selection.workspaceFolderUri)
      : snapshot.context.detail ?? snapshot.context.label;
    return {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: `current-workspace:${identity}`,
      kind: "workspace",
      repositoryId: `workspace:${identity}`,
      displayName: snapshot.context.label,
      workspace: { workspaceId: identity, snapshotRevision: "current" },
      files: {},
      createdAt: now,
      updatedAt: now,
    };
  }
}

const pullRequestState = (
  repositoryId: string,
  identity: GitHubRepositoryIdentity,
  candidate: GitHubPullRequestCandidate,
): ReviewContextState => {
  const now = new Date().toISOString();
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: createGitHubPullRequestContextIdFromRepositoryId(repositoryId, candidate.number),
    kind: "pull-request",
    repositoryId,
    displayName: `PR #${candidate.number}`,
    pullRequest: {
      host: identity.host,
      owner: identity.owner,
      repository: identity.repository,
      number: candidate.number,
      state: "open",
      title: candidate.title,
      baseSha: candidate.baseSha,
      headSha: candidate.headSha,
    },
    files: {},
    createdAt: now,
    updatedAt: now,
  };
};

const currentGlobalForNewPullRequest = async (
  repository: FileSystemReviewStateRepository,
  repositoryId: string,
  headSha: string,
): Promise<RepositoryGlobalState | undefined> => {
  const current = await repository.loadGlobal({
    kind: "git",
    repositoryId,
    contextId: "review-contexts-current-global",
  });
  if (current !== undefined) return current.currentRevisionId === headSha ? current : undefined;
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: headSha,
    files: {},
    updatedAt: new Date().toISOString(),
  };
};

/** Composes T401/T402/T403/T404 boundaries into the T405 VS Code View. */
export function registerT405ReviewContextsRuntime(
  options: T405ReviewContextsRuntimeOptions,
): RegisteredReviewContextsRuntime {
  const uris = storageUris(options.context);
  const repository = new FileSystemReviewStateRepository({ storageUris: uris });
  const visibility = new VscodeReviewContextVisibilityStore(options.context.workspaceState);
  const source = new T405ReviewContextsSource(uris, visibility, options.enumerateCurrentContexts);
  const gitExecutor = new NodeGitCommandExecutor();
  const diffDocuments = new ReviewContextDiffDocumentProvider();
  options.context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffDocuments),
  );

  const auth = new VsCodeGitHubAuthenticationProvider(
    vscode.authentication,
    ["repo"],
    vscode.workspace.getConfiguration("github-enterprise").get<string>("uri"),
  );
  const contextStateService = createNodeGitHubPullRequestContextStateService(
    uris,
    async () => {
      throw new Error("Revision remapping is not a layer-toggle operation");
    },
  );

  const inspectActiveRepository = async (): Promise<LocalGitRepository> => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || (editor.document.uri.scheme !== "file" && editor.document.uri.scheme !== "vscode-remote")) {
      throw new Error("GitHub操作にはGitリポジトリ内のアクティブエディタが必要です。");
    }
    const inspection = await options.git.inspectRepository(editor.document.uri.fsPath);
    if (inspection.kind !== "repository") throw new Error("アクティブエディタのGitリポジトリを解決できません。");
    return inspection.repository;
  };

  const acquire = async (context: ReviewContextState) => {
    const root = source.repositoryRoot(context.repositoryId) ?? (await inspectActiveRepository()).rootPath;
    const identity = repositoryIdentity(context);
    const token = await auth.getAccessToken(identity.host);
    const acquisition = new PullRequestDiffAcquisitionService({
      local: new LocalGitPullRequestDiffAdapter(gitExecutor, root),
      remote: createPullRequestRemote(identity, token),
    });
    const route = resolveReviewStateStorageRoute(uris, {
      kind: "pull-request",
      repositoryId: context.repositoryId,
      contextId: context.contextId,
    });
    const cache = new GitHubPullRequestCacheService({
      acquisition,
      storage: new NodeGitHubPullRequestCacheStorage({ cacheDirectory: route.cacheDirectory }),
      freshnessMs: CACHE_FRESHNESS_MS,
    });
    return { result: await cache.acquire(diffRequest(context)), root, identity, token };
  };

  const readRevisionText = async (
    root: string,
    identity: GitHubRepositoryIdentity,
    token: string | undefined,
    revision: string,
    path: string | undefined,
  ): Promise<string> => {
    if (path === undefined) return "";
    const local = await gitExecutor.execute({ cwd: root, argumentsList: ["show", `${revision}:${path}`] });
    if (local.exitCode === 0) return local.stdout;
    const loaded = await createPullRequestRemote(identity, token).readFile(identity, revision, path);
    if (loaded.kind === "found") return loaded.content;
    if (loaded.kind === "binary") throw new Error(`binary file cannot be opened as text diff: ${path}`);
    throw new Error(`revision content is unavailable: ${path}`);
  };

  const controller = new ReviewContextsController({
    visibility,
    setPullRequestLayerEnabled: async (context, enabled) => {
      const pullRequest = context.pullRequest;
      if (pullRequest === undefined) throw new Error("PR context is required");
      await contextStateService.update({
        repositoryId: context.repositoryId,
        identity: pullRequestIdentity(context),
        pullRequest: { ...pullRequest, decorationEnabled: enabled },
      });
    },
    refreshPullRequestCache: async (context) => {
      const { result } = await acquire(context);
      if (result.kind !== "acquired") {
        throw new Error(`PR cacheを更新できませんでした: ${result.attempts.map((attempt) => `${attempt.source}:${attempt.reason}`).join(", ")}`);
      }
    },
    openPullRequestDiff: async (context) => {
      const { result, root, identity, token } = await acquire(context);
      if (result.kind !== "acquired") {
        throw new Error(`PR diffを取得できませんでした: ${result.attempts.map((attempt) => `${attempt.source}:${attempt.reason}`).join(", ")}`);
      }
      const choices = result.snapshot.files.map((file) => ({
        label: file.newPath ?? file.oldPath ?? file.fileId,
        description: file.status,
        file,
      }));
      const selected = choices.length === 1
        ? choices[0]
        : await vscode.window.showQuickPick(choices, { placeHolder: "PR diffを開くファイルを選択" });
      if (selected === undefined) return;
      const pullRequest = context.pullRequest;
      if (pullRequest === undefined) throw new Error("PR context is required");
      const originalText = await readRevisionText(root, identity, token, pullRequest.baseSha, selected.file.oldPath);
      const modifiedText = await readRevisionText(root, identity, token, pullRequest.headSha, selected.file.newPath);
      const original = diffDocuments.create(originalText, selected.file.oldPath ?? selected.label, "base");
      const modified = diffDocuments.create(modifiedText, selected.file.newPath ?? selected.label, "head");
      await vscode.commands.executeCommand("vscode.diff", original, modified, `${selected.label} (PR #${pullRequest.number})`);
    },
    redetectPullRequest: async () => {
      const local = await inspectActiveRepository();
      if (local.head === undefined || local.remote === undefined) {
        throw new Error("PR再検出にはHEADとGit remoteが必要です。");
      }
      const identity = parseGitHubRemote(local.remote.rawUrl);
      if (identity === undefined) throw new Error("GitHub remoteを解決できません。");
      const token = await auth.getAccessToken(identity.host);
      const search = createPullRequestSearch(identity, token);
      const searchResult = await search.findOpenByHead(identity, local.head);
      const resolver = new GitHubPullRequestContextResolver({
        chooseCandidate: async (candidates) => {
          const items = candidates.map((candidate) => ({
            label: `PR #${candidate.number}: ${candidate.title}`,
            description: candidate.url,
            candidate,
          }));
          return (await vscode.window.showQuickPick(items, { placeHolder: "現在HEADのPRを選択" }))?.candidate;
        },
      });
      const resolution = await resolver.resolveSearchResult(searchResult);
      if (resolution.kind !== "pull-request") {
        source.setCurrentPullRequest(local.repositoryId, undefined);
        if (resolution.reason === "unavailable") throw new Error("GitHubからPRを再検出できませんでした。");
        return;
      }

      const state = pullRequestState(local.repositoryId, identity, resolution.pullRequest);
      source.setCurrentPullRequest(local.repositoryId, state);
      const existing = await contextStateService.load(local.repositoryId, pullRequestIdentity(state));
      if (existing !== undefined) {
        if (
          existing.contextState.pullRequest?.baseSha === state.pullRequest?.baseSha &&
          existing.contextState.pullRequest?.headSha === state.pullRequest?.headSha
        ) {
          await contextStateService.update({
            repositoryId: local.repositoryId,
            identity: pullRequestIdentity(state),
            pullRequest: state.pullRequest as PullRequestReviewContext,
            displayName: state.displayName,
          });
        }
        return;
      }
      const global = await currentGlobalForNewPullRequest(repository, local.repositoryId, resolution.pullRequest.headSha);
      if (global === undefined) return;
      const expectedGlobal = await repository.loadGlobal({
        kind: "git",
        repositoryId: local.repositoryId,
        contextId: state.contextId,
      });
      await contextStateService.create({ contextState: state, globalState: global }, expectedGlobal);
    },
    reconnectGitHub: async () => {
      const local = await inspectActiveRepository();
      if (local.remote === undefined) throw new Error("GitHub remoteがありません。");
      const identity = parseGitHubRemote(local.remote.rawUrl);
      if (identity === undefined) throw new Error("GitHub remoteを解決できません。");
      const providerId = identity.host === "github.com" ? "github" : "github-enterprise";
      await vscode.authentication.getSession(providerId, ["repo"], { createIfNone: true });
    },
  });

  return registerReviewContextsRuntime(options.context, {
    source,
    controller,
    refreshDecorations: options.refreshDecorations,
    reportError: async (error) => {
      await vscode.window.showErrorMessage(
        `Review Contexts操作に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
}

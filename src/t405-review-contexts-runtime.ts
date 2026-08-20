import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import {
  FetchGitHubPullRequestAdapter,
  FetchGitHubPullRequestDiffAdapter,
  FetchGitHubPullRequestLifecycleAdapter,
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
  resolveReviewStateStorageRoute,
  type ReviewStateCommit,
  type ReviewStateCreateTransactionLike,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike,
  type ReviewStateStorageUris,
} from "./adapters/state-repository/index";
import { resolveReviewRangeMappingOptions } from "./application/configuration/review-range-mapping-options";
import type { RevisionTextContentReadResult } from "./application/diff-document/index";
import { GitHubPullRequestCacheService } from "./application/github-pr-cache/index";
import type { ReviewHistoryRecorder } from "./application/review-history/index";
import {
  GitHubPullRequestContextResolver,
  createGitHubPullRequestContextIdFromRepositoryId,
  type GitHubPullRequestCandidate,
  type GitHubRepositoryIdentity,
} from "./application/github-pr-context/index";
import { PullRequestDiffAcquisitionService } from "./application/github-pr-diff/index";
import { reportActiveStorageLockDiagnostic } from "./application/operation-feedback/index";
import {
  OperationDiagnosticError,
  reportActiveOperationFailure,
} from "./application/operation-feedback/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type GitRevisionMappingSource,
  type ResolvedGitReviewContext,
} from "./application/review-context/index";
import {
  PullRequestRevisionEvidenceLoader,
  ReviewContextsController,
  findCurrentPullRequestContext,
  projectReviewContexts,
  type ReviewContextCacheStatus,
  type ReviewContextListItem,
  type ReviewContextListProgress,
} from "./application/review-contexts/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "./core/contracts/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import {
  VscodeCurrentPullRequestSelectionStore,
  VscodeReviewContextVisibilityStore,
  registerReviewContextsRuntime,
  type RegisteredReviewContextsRuntime,
  type ReviewContextsRuntimeSource,
} from "./ui/review-contexts/index";
import type { PullRequestReviewRuntimeRegistration } from "./t405-pull-request-review-runtime";

const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const PATH_SEMANTICS = process.platform === "win32" ? "windows" as const : "posix" as const;

export interface T405ReviewContextsRuntimeOptions {
  readonly context: vscode.ExtensionContext;
  readonly git: LocalGitAdapter & GitRevisionMappingSource;
  readonly enumerateCurrentContexts: () => Promise<readonly CurrentContextUiSnapshot[]>;
  readonly refreshDecorations: () => Promise<void>;
  readonly refreshCurrentContext: () => Promise<void>;
  readonly registerPullRequestReviewDiff: (
    registration: PullRequestReviewRuntimeRegistration
  ) => void;
  readonly openPullRequestReviewDiff: (
    contextId: string,
    fileId: string,
    title?: string
  ) => Promise<void>;
  readonly getPullRequestReviewProgress: (
    contextId: string
  ) => Promise<ReviewContextListProgress>;
  /** 同一Extension Hostで通常editor/PR diff/Review Contextsが共有するstate serialization owner。 */
  readonly reviewStateRepository: T405ReviewStateRepository;
  /** 同一Extension Hostで通常editor/PR diff/Review Contextsが共有するhistory serialization owner。 */
  readonly reviewHistoryRecorder: Pick<ReviewHistoryRecorder, "recordContextCreated" | "recordRevisionMapping">;
}

interface T405ReviewStateRepository {
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  loadGlobal(target: ReviewStateRepositoryTarget): Promise<RepositoryGlobalState | undefined>;
  listRepositoryContexts(repositoryId: string): Promise<ReviewContextState[]>;
  commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void>;
  create(transaction: Readonly<ReviewStateCreateTransactionLike>): Promise<void>;
}

export interface RegisteredT405ReviewContextsRuntime
extends RegisteredReviewContextsRuntime {
  augmentCurrentContextCandidates(
    localCandidates: readonly CurrentContextUiSnapshot[]
  ): Promise<readonly CurrentContextUiSnapshot[]>;
}

interface LocalRepositoryOwner {
  readonly repositoryId: string;
  readonly repositoryRoot: string;
  readonly headRevision: string;
  readonly branchRef?: string;
  readonly snapshot: CurrentContextUiSnapshot;
}

interface PreparedNewPullRequestGlobal {
  readonly expectedGlobalState: RepositoryGlobalState | undefined;
  readonly nextGlobalState: RepositoryGlobalState;
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

const createPullRequestLifecycle = (
  identity: GitHubRepositoryIdentity,
  token: string | undefined,
): FetchGitHubPullRequestLifecycleAdapter => {
  const apiBaseUrl = gitHubApiBaseUrl(identity.host);
  return token === undefined
    ? new FetchGitHubPullRequestLifecycleAdapter({ apiBaseUrl })
    : new FetchGitHubPullRequestLifecycleAdapter({ apiBaseUrl, token });
};

const localOwner = (snapshot: CurrentContextUiSnapshot): LocalRepositoryOwner | undefined => {
  const selection = snapshot.context.selection;
  if (selection?.kind === "branch") {
    const headRevision = snapshot.context.headRevision;
    if (headRevision === undefined) return undefined;
    return {
      repositoryId: selection.repositoryId,
      repositoryRoot: selection.repositoryRoot,
      headRevision,
      branchRef: selection.branchRef,
      snapshot,
    };
  }
  if (selection?.kind === "detached") {
    return {
      repositoryId: selection.repositoryId,
      repositoryRoot: selection.repositoryRoot,
      headRevision: selection.headRevision,
      snapshot,
    };
  }
  return undefined;
};

class T405ReviewContextsSource implements ReviewContextsRuntimeSource {
  private readonly roots = new Map<string, Set<string>>();

  public constructor(
    private readonly repository: T405ReviewStateRepository,
    private readonly visibility: VscodeReviewContextVisibilityStore,
    private readonly currentPullRequestSelection: VscodeCurrentPullRequestSelectionStore,
    private readonly enumerateCurrentContexts: () => Promise<readonly CurrentContextUiSnapshot[]>,
    private readonly synchronizeRepository: (
      owner: LocalRepositoryOwner,
      persisted: readonly ReviewContextState[]
    ) => Promise<void>,
    private readonly progressFor: (
      context: ReviewContextState,
      repositoryRoot: string
    ) => Promise<ReviewContextListProgress | undefined>,
    private readonly cacheStatusByContextId: ReadonlyMap<string, ReviewContextCacheStatus>,
  ) {}

  public repositoryRoot(repositoryId: string): string | undefined {
    const roots = this.roots.get(repositoryId);
    return roots?.size === 1 ? roots.values().next().value as string : undefined;
  }

  private rememberRoot(repositoryId: string, repositoryRoot: string): void {
    const roots = this.roots.get(repositoryId) ?? new Set<string>();
    roots.add(repositoryRoot);
    this.roots.set(repositoryId, roots);
  }

  public async load(): Promise<readonly ReviewContextListItem[]> {
    const current: ReviewContextState[] = [];
    const saved = new Map<string, ReviewContextState>();
    const progressByContextId: Record<string, ReviewContextListProgress> = {};
    this.roots.clear();

    for (const snapshot of await this.enumerateCurrentContexts()) {
      const owner = localOwner(snapshot);
      if (owner !== undefined) {
        this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
        let persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
        await this.synchronizeRepository(owner, persisted);
        persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
        for (const context of persisted) saved.set(context.contextId, context);

        if (owner.branchRef !== undefined) {
          const branch = persisted.find((context) =>
            context.kind === "branch" && context.branch?.refName === owner.branchRef
          );
          current.push(branch ?? this.syntheticBranch(snapshot, owner.repositoryId, owner.branchRef));
        }
        const preferredContextId = this.currentPullRequestSelection.read(
          owner.repositoryId,
          owner.headRevision,
        );
        const currentPullRequest = findCurrentPullRequestContext(
          persisted,
          owner.repositoryId,
          owner.headRevision,
          preferredContextId,
          this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
        );
        if (currentPullRequest !== undefined) current.unshift(currentPullRequest);

        for (const context of persisted) {
          if (context.kind !== "pull-request") continue;
          const progress = await this.progressFor(context, owner.repositoryRoot);
          if (progress !== undefined) progressByContextId[context.contextId] = progress;
        }
      } else if (snapshot.context.kind === "workspace") {
        current.push(this.syntheticWorkspace(snapshot));
      }
    }

    return projectReviewContexts({
      current,
      saved: [...saved.values()],
      hiddenContextIds: new Set(await this.visibility.readHiddenContextIds()),
      progressByContextId,
      cacheByContextId: Object.fromEntries(this.cacheStatusByContextId),
    });
  }

  public async augmentCurrentContextCandidates(
    localCandidates: readonly CurrentContextUiSnapshot[]
  ): Promise<readonly CurrentContextUiSnapshot[]> {
    const candidates = new Map<string, CurrentContextUiSnapshot>();
    for (const candidate of localCandidates) {
      candidates.set(this.candidateKey(candidate), candidate);
      const owner = localOwner(candidate);
      if (owner === undefined) continue;
      this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
      let persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
      await this.synchronizeRepository(owner, persisted);
      persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
      const preferredContextId = this.currentPullRequestSelection.read(
        owner.repositoryId,
        owner.headRevision,
      );
      const pullRequest = findCurrentPullRequestContext(
        persisted,
        owner.repositoryId,
        owner.headRevision,
        preferredContextId,
        this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
      );
      if (pullRequest === undefined || pullRequest.pullRequest === undefined) continue;
      const progress = await this.progressFor(pullRequest, owner.repositoryRoot);
      const pr = pullRequest.pullRequest;
      const projected: CurrentContextUiSnapshot = {
        context: {
          kind: "pull-request",
          label: `#${pr.number}`,
          detail: pr.title ?? pullRequest.displayName,
          baseRevision: pr.baseSha,
          headRevision: pr.headSha,
          selection: {
            kind: "pull-request",
            repositoryId: owner.repositoryId,
            repositoryRoot: owner.repositoryRoot,
            contextId: pullRequest.contextId,
            pullRequestNumber: pr.number,
            headRevision: pr.headSha,
          },
        },
        progress,
      };
      candidates.set(this.candidateKey(projected), projected);
    }
    return [...candidates.values()].sort((left, right) =>
      this.kindOrder(left) - this.kindOrder(right) ||
      left.context.label.localeCompare(right.context.label)
    );
  }

  private candidateKey(snapshot: CurrentContextUiSnapshot): string {
    const selection = snapshot.context.selection;
    if (selection?.kind === "pull-request") return `pr\0${selection.repositoryRoot}\0${selection.contextId}`;
    if (selection?.kind === "branch") return `branch\0${selection.repositoryRoot}\0${selection.repositoryId}\0${selection.branchRef}`;
    if (selection?.kind === "detached") return `detached\0${selection.repositoryRoot}\0${selection.repositoryId}\0${selection.headRevision}`;
    if (selection?.kind === "workspace") return `workspace\0${JSON.stringify(selection.workspaceFolderUri)}`;
    return `${snapshot.context.kind}\0${snapshot.context.detail ?? ""}\0${snapshot.context.label}`;
  }

  private kindOrder(snapshot: CurrentContextUiSnapshot): number {
    if (snapshot.context.kind === "pull-request") return 0;
    if (snapshot.context.kind === "branch") return 1;
    return 2;
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
  repository: T405ReviewStateRepository,
  current: ResolvedGitReviewContext,
  mapper: GitContextRevisionMapper,
  mappingOptions: ReturnType<typeof resolveReviewRangeMappingOptions>,
): Promise<PreparedNewPullRequestGlobal> => {
  const expectedGlobalState = await repository.loadGlobal({
    kind: "git",
    repositoryId: current.repositoryId,
    contextId: "review-contexts-current-global",
  });
  if (expectedGlobalState === undefined) {
    return {
      expectedGlobalState: undefined,
      nextGlobalState: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: current.repositoryId,
        currentRevisionId: current.revisionId,
        files: {},
        updatedAt: new Date().toISOString(),
      },
    };
  }
  if (expectedGlobalState.currentRevisionId === current.revisionId) {
    return {
      expectedGlobalState,
      nextGlobalState: expectedGlobalState,
    };
  }

  const branch = current.contextState.branch;
  if (branch === undefined) {
    throw new Error("Git revision mapping requires branch-schema persistence.");
  }
  const mapped = await mapper.map({
    current,
    contextState: {
      ...current.contextState,
      branch: {
        ...branch,
        headRevision: expectedGlobalState.currentRevisionId,
      },
      files: {},
      updatedAt: expectedGlobalState.updatedAt,
    },
    globalState: expectedGlobalState,
    fileSystemPathSemantics: PATH_SEMANTICS,
    options: mappingOptions,
  });
  return {
    expectedGlobalState,
    nextGlobalState: mapped.globalState,
  };
};

export function registerT405ReviewContextsRuntime(
  options: T405ReviewContextsRuntimeOptions,
): RegisteredT405ReviewContextsRuntime {
  const uris = storageUris(options.context);
  const repository = options.reviewStateRepository;
  const visibility = new VscodeReviewContextVisibilityStore(options.context.workspaceState);
  const currentPullRequestSelection = new VscodeCurrentPullRequestSelectionStore(
    options.context.workspaceState,
  );
  const stableHash = new NodeSha256StableHash();
  const gitContextResolver = new GitReviewContextResolver({ stableHash });
  const gitContextRevisionMapper = new GitContextRevisionMapper({
    source: options.git,
    stableHash,
  });
  const gitExecutor = new NodeGitCommandExecutor();
  const auth = new VsCodeGitHubAuthenticationProvider(
    vscode.authentication,
    ["repo"],
    vscode.workspace.getConfiguration("github-enterprise").get<string>("uri"),
  );

  const sourceRef: { current?: T405ReviewContextsSource } = {};

  const inspectActiveRepository = async (): Promise<LocalGitRepository> => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || (editor.document.uri.scheme !== "file" && editor.document.uri.scheme !== "vscode-remote")) {
      throw new Error("GitHub操作にはGitリポジトリ内のアクティブエディタが必要です。");
    }
    const inspection = await options.git.inspectRepository(editor.document.uri.fsPath);
    if (inspection.kind !== "repository") throw new Error("アクティブエディタのGitリポジトリを解決できません。");
    return inspection.repository;
  };

  const resolveRepositoryRoot = async (repositoryId: string): Promise<string> => {
    const known = sourceRef.current?.repositoryRoot(repositoryId);
    if (known !== undefined) return known;
    const active = await inspectActiveRepository();
    if (active.repositoryId !== repositoryId) {
      throw new Error("対象PRのローカルGitリポジトリを解決できません。");
    }
    return active.rootPath;
  };

  const contextStateService = createNodeGitHubPullRequestContextStateService(
    repository,
    options.reviewHistoryRecorder,
    async (evidence) => {
      const current = await repository.load({
        kind: "pull-request",
        repositoryId: evidence.repositoryId,
        contextId: evidence.contextId,
      });
      if (current === undefined || current.contextState.pullRequest === undefined) {
        throw new Error("Revision mapping requires persisted pull-request state.");
      }
      const root = await resolveRepositoryRoot(evidence.repositoryId);
      const context = current.contextState;
      const identity = repositoryIdentity(context);
      const token = await auth.getAccessToken(identity.host);
      const lifecycle = createPullRequestLifecycle(identity, token);
      const remote = createPullRequestRemote(identity, token);
      return new PullRequestRevisionEvidenceLoader({
        loadCurrent: async () => ({
          contextState: current.contextState,
          globalState: current.globalState,
        }),
        loadDiff: async (request) => {
          const local = await new LocalGitPullRequestDiffAdapter(gitExecutor, root).loadDiff({
            contextId: request.contextId,
            repository: identity,
            number: context.pullRequest!.number,
            baseSha: request.sourceHeadSha,
            headSha: request.targetHeadSha,
          });
          if (local.kind === "available") return local.diff;
          const fallback = await lifecycle.compareRevisions(
            identity,
            request.sourceHeadSha,
            request.targetHeadSha
          );
          if (fallback.kind === "available") return fallback.diff;
          throw new Error(`PR revision diff is unavailable: ${fallback.reason}`);
        },
        readText: async (revision, repositoryPath) => {
          const local = await options.git.readTextFileAtRevision(
            root,
            revision,
            repositoryPath,
            PATH_SEMANTICS
          );
          if (local.kind === "found") return local;
          if (local.kind === "invalid-encoding") return { kind: "binary" as const };
          const fallback = await remote.readFile(identity, revision, repositoryPath);
          if (fallback.kind === "found") return fallback;
          if (fallback.kind === "binary") return { kind: "binary" as const };
          return { kind: "unavailable" as const };
        },
        createFileId: (repositoryId, repositoryPath) =>
          `repository-file:${stableHash.digest(["repository-file", repositoryId, repositoryPath].join("\0"))}`,
        hashText: (text) => stableHash.digest(text),
      }).load(evidence);
    },
  );

  const readReviewDiffContent = async (
    root: string,
    identity: GitHubRepositoryIdentity,
    token: string | undefined,
    descriptor: Parameters<PullRequestReviewRuntimeRegistration["readTextContent"]>[0]
  ): Promise<RevisionTextContentReadResult> => {
    const local = await options.git.readTextFileAtRevision(
      root,
      descriptor.revision,
      descriptor.filePath,
      descriptor.fileSystemPathSemantics
    );
    if (local.kind === "found") return local;
    if (local.kind === "invalid-encoding") return local;
    const remote = await createPullRequestRemote(identity, token).readFile(
      identity,
      descriptor.revision,
      descriptor.filePath
    );
    if (remote.kind === "found") return remote;
    if (remote.kind === "binary") return { kind: "invalid-encoding", encoding: "utf-8" };
    if (remote.reason === "missing-file") return { kind: "missing-file" };
    if (remote.reason === "missing-revision") return { kind: "missing-revision" };
    return local.kind === "missing-revision"
      ? { kind: "missing-revision" }
      : { kind: "missing-file" };
  };

  const acquire = async (
    context: ReviewContextState,
    forceRemote = false,
  ) => {
    const root = await resolveRepositoryRoot(context.repositoryId);
    const identity = repositoryIdentity(context);
    const token = await auth.getAccessToken(identity.host);
    const acquisition = new PullRequestDiffAcquisitionService({
      local: forceRemote
        ? { loadDiff: async () => ({ kind: "unavailable" as const, reason: "git-unavailable" as const }) }
        : new LocalGitPullRequestDiffAdapter(gitExecutor, root),
      remote: createPullRequestRemote(identity, token),
    });
    const route = resolveReviewStateStorageRoute(uris, {
      kind: "pull-request",
      repositoryId: context.repositoryId,
      contextId: context.contextId,
    });
    if (route.cacheDirectory === undefined) {
      throw new Error("Pull-request cache requires a repository storage route");
    }
    const cache = new GitHubPullRequestCacheService({
      acquisition,
      storage: new NodeGitHubPullRequestCacheStorage({
        cacheDirectory: route.cacheDirectory,
        notifyStorageLockDiagnostic: reportActiveStorageLockDiagnostic
      }),
      freshnessMs: CACHE_FRESHNESS_MS,
    });
    const result = await cache.acquire(diffRequest(context));
    if (forceRemote || !cacheStatusByContextId.has(context.contextId)) {
      cacheStatusByContextId.set(
        context.contextId,
        result.kind === "acquired"
          ? {
              origin: result.cache.origin,
              freshness: result.cache.freshness,
              ...("updatedAt" in result.cache ? { updatedAt: result.cache.updatedAt } : {}),
            }
          : { origin: "unavailable", freshness: "unavailable" },
      );
    }
    if (result.kind === "acquired") {
      options.registerPullRequestReviewDiff({
        repositoryId: context.repositoryId,
        repositoryRoot: root,
        fileSystemPathSemantics: PATH_SEMANTICS,
        snapshot: result.snapshot,
        readTextContent: (descriptor) => readReviewDiffContent(
          root,
          identity,
          token,
          descriptor
        ),
      });
    }
    return { result, root, identity, token };
  };

  const cacheStatusByContextId = new Map<string, ReviewContextCacheStatus>();

  const progressFor = async (
    context: ReviewContextState
  ): Promise<ReviewContextListProgress | undefined> => {
    try {
      const { result } = await acquire(context);
      if (result.kind !== "acquired") {
        reportActiveOperationFailure(
          "PR進捗を取得",
          new OperationDiagnosticError({
            code: "PR_PROGRESS_UNAVAILABLE",
            attempts: result.attempts,
          }),
        );
        return undefined;
      }
      return await options.getPullRequestReviewProgress(context.contextId);
    } catch (error) {
      reportActiveOperationFailure("PR進捗を取得", error);
      return undefined;
    }
  };

  const synchronizeRepository = async (
    owner: LocalRepositoryOwner,
    persisted: readonly ReviewContextState[]
  ): Promise<void> => {
    for (const context of persisted) {
      if (context.kind !== "pull-request" || context.pullRequest === undefined) continue;
      const identity = repositoryIdentity(context);
      const token = await auth.getAccessToken(identity.host);
      const lifecycle = createPullRequestLifecycle(identity, token);
      const latest = await lifecycle.fetchCurrent(identity, context.pullRequest.number);
      if (latest.kind !== "available") continue;
      await contextStateService.update({
        repositoryId: context.repositoryId,
        identity: pullRequestIdentity(context),
        displayName: `PR #${latest.metadata.number}`,
        pullRequest: {
          ...context.pullRequest,
          state: latest.metadata.state,
          title: latest.metadata.title,
          baseSha: latest.metadata.baseSha,
          headSha: latest.metadata.headSha,
        },
      });
    }
    void owner;
  };

  const source = new T405ReviewContextsSource(
    repository,
    visibility,
    currentPullRequestSelection,
    options.enumerateCurrentContexts,
    synchronizeRepository,
    progressFor,
    cacheStatusByContextId,
  );
  sourceRef.current = source;

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
      const { result } = await acquire(context, true);
      if (result.kind !== "acquired") {
        throw new Error(`PR cacheを更新できませんでした: ${result.attempts.map((attempt) => `${attempt.source}:${attempt.reason}`).join(", ")}`);
      }
      if (result.cache.origin === "offline") {
        throw new Error(`PR cacheを更新できませんでした: offline cache (${result.cache.freshness}) を表示しています。`);
      }
      if (result.cache.freshness !== "fresh") {
        throw new Error("PR cacheを更新できませんでした: live取得結果をcacheへ保存できませんでした。");
      }
    },
    openPullRequestDiff: async (context) => {
      const { result } = await acquire(context);
      if (result.kind !== "acquired") {
        throw new Error(`PR diffを取得できませんでした: ${result.attempts.map((attempt) => `${attempt.source}:${attempt.reason}`).join(", ")}`);
      }
      const choices = result.snapshot.files
        .filter((file) => file.status !== "binary")
        .map((file) => ({
          label: file.newPath ?? file.oldPath ?? file.fileId,
          description: file.status,
          file,
        }));
      if (choices.length === 0) {
        throw new Error("このPRにはテキストとして開ける変更ファイルがありません。");
      }
      const selected = choices.length === 1
        ? choices[0]
        : await vscode.window.showQuickPick(choices, { placeHolder: "PR diffを開くファイルを選択" });
      if (selected === undefined) return;
      const pullRequest = context.pullRequest;
      if (pullRequest === undefined) throw new Error("PR context is required");
      await options.openPullRequestReviewDiff(
        context.contextId,
        selected.file.fileId,
        `${selected.label} (PR #${pullRequest.number})`
      );
    },
    redetectPullRequest: async () => {
      const local = await inspectActiveRepository();
      if (local.head === undefined || local.remote === undefined) {
        throw new Error("PR再検出にはHEADとGit remoteが必要です。");
      }
      const identity = parseGitHubRemote(local.remote.rawUrl);
      if (identity === undefined) throw new Error("GitHub remoteを解決できません。");
      const persistedBefore = await repository.listRepositoryContexts(local.repositoryId);
      await synchronizeRepository({
        repositoryId: local.repositoryId,
        repositoryRoot: local.rootPath,
        headRevision: local.head,
        snapshot: {
          context: { kind: "branch", label: "active", headRevision: local.head },
          progress: undefined,
        },
      }, persistedBefore);

      const token = await auth.getAccessToken(identity.host);
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
      const search = await createPullRequestSearch(identity, token).findOpenByHead(identity, local.head);
      const resolution = await resolver.resolveSearchResult(search);
      if (resolution.kind === "pull-request") {
        const state = pullRequestState(local.repositoryId, identity, resolution.pullRequest);
        const existing = await contextStateService.load(local.repositoryId, pullRequestIdentity(state));
        if (existing !== undefined) {
          await contextStateService.update({
            repositoryId: local.repositoryId,
            identity: pullRequestIdentity(state),
            pullRequest: state.pullRequest!,
            displayName: state.displayName,
          });
        } else {
          const current = gitContextResolver.resolve({
            repositoryId: local.repositoryId,
            rootPath: local.rootPath,
            branch: local.branch,
            head: local.head,
          });
          const reviewRangeConfiguration = vscode.workspace.getConfiguration("reviewRange");
          const preparedGlobal = await currentGlobalForNewPullRequest(
            repository,
            current,
            gitContextRevisionMapper,
            resolveReviewRangeMappingOptions({
              ignoreWhitespaceChanges: reviewRangeConfiguration.get(
                "ignoreWhitespaceChanges",
                false,
              ),
              ignoreEolChanges: reviewRangeConfiguration.get(
                "ignoreEolChanges",
                false,
              ),
            }),
          );
          await contextStateService.create(
            { contextState: state, globalState: preparedGlobal.nextGlobalState },
            preparedGlobal.expectedGlobalState
          );
        }
        await currentPullRequestSelection.select(
          local.repositoryId,
          local.head,
          state.contextId,
        );
      } else {
        await currentPullRequestSelection.selectBranch(local.repositoryId, local.head);
        if (search.kind === "unavailable") {
          reportActiveOperationFailure(
            "PRを再検出",
            new OperationDiagnosticError({
              code: "GITHUB_PR_DETECTION_UNAVAILABLE",
              reason: search.reason,
            }),
          );
        }
      }
      await options.refreshCurrentContext();
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

  const registered = registerReviewContextsRuntime(options.context, {
    source,
    controller,
    refreshDecorations: options.refreshDecorations,
    reportError: async (error) => {
      await vscode.window.showErrorMessage(
        `Review Contexts操作に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  return {
    ...registered,
    augmentCurrentContextCandidates: (localCandidates) =>
      source.augmentCurrentContextCandidates(localCandidates),
  };
}

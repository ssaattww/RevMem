import path from "node:path";
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
  type StorageRootLockDiagnostic,
  type ReviewStateCommit,
  type ReviewStateCreateTransactionLike,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike,
  type ReviewStateStorageUris,
} from "./adapters/state-repository/index";
import { resolveReviewRangeMappingOptions } from "./application/configuration/review-range-mapping-options";
import type { RevisionTextContentReadResult } from "./application/diff-document/index";
import {
  GitHubPullRequestCacheService,
  type GitHubPullRequestCacheStorage,
  type PullRequestDiffAcquisitionPort,
} from "./application/github-pr-cache/index";
import type { ReviewHistoryRecorder } from "./application/review-history/index";
import {
  GitHubPullRequestContextResolver,
  createGitHubPullRequestContextIdFromRepositoryId,
  type GitHubPullRequestCandidate,
  type GitHubRepositoryIdentity,
} from "./application/github-pr-context/index";
import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestRemoteDataPort,
} from "./application/github-pr-diff/index";
import {
  reportActiveOperationProgress,
  reportActiveStorageLockDiagnostic,
  type OperationFeedbackContext,
} from "./application/operation-feedback/index";
import {
  OperationDiagnosticError,
  reportActiveOperationFailure,
} from "./application/operation-feedback/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type GitRevisionMappingSource,
} from "./application/review-context/index";
import {
  PullRequestRevisionEvidenceLoader,
  ReviewContextsController,
  findCurrentPullRequestContext,
  projectReviewContextsCooperatively,
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
import { workspaceUriToFilesystemPath } from "./t609-repository-resolution";
import {
  currentContextCandidateKey,
  resolveUniqueRepositoryRoot
} from "./t405-root-scoped-candidate-identity";
import {
  ReviewContextsRepositorySelectionCancelled,
  resolveReviewContextsRepository,
  type ReviewContextsRepositorySelection
} from "./t609-review-contexts-repository";
import { currentGlobalForNewPullRequest } from "./t405-new-pull-request-global-composition";

const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const PATH_SEMANTICS = process.platform === "win32" ? "windows" as const : "posix" as const;
const observedPullRequestContextsByOperation = new WeakMap<OperationFeedbackContext, Set<string>>();

export interface T405ReviewContextsRuntimeOptions {
  readonly context: vscode.ExtensionContext;
  readonly git: LocalGitAdapter & GitRevisionMappingSource;
  readonly enumerateCurrentContexts: (signal?: AbortSignal) => Promise<readonly CurrentContextUiSnapshot[]>;
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
    contextId: string,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ) => Promise<ReviewContextListProgress>;
  /** 同一Extension Hostで通常editor/PR diff/Review Contextsが共有するstate serialization owner。 */
  readonly reviewStateRepository: T405ReviewStateRepository;
  /** 同一Extension Hostで通常editor/PR diff/Review Contextsが共有するhistory serialization owner。 */
  readonly reviewHistoryRecorder: Pick<ReviewHistoryRecorder, "recordContextCreated" | "recordRevisionMapping">;
  /** Internal composition port for the repository-local PR cache storage adapter. */
  readonly createPullRequestCacheStorage?: (
    cacheDirectory: string,
    notifyStorageLockDiagnostic: (diagnostic: StorageRootLockDiagnostic) => void | Promise<void>,
  ) => GitHubPullRequestCacheStorage;
  /** Testable deepest acquisition seam; production uses the local-Git/GitHub adapter pair below. */
  readonly createPullRequestDiffAcquisition?: (
    options: Readonly<{
      local: LocalPullRequestDiffPort;
      remote: PullRequestRemoteDataPort;
    }>,
  ) => PullRequestDiffAcquisitionPort;
  /** Deterministic scheduler seam for large saved-context projection. */
  readonly reviewContextsWork?: {
    readonly maxItems?: number;
    readonly yieldControl?: () => void | Promise<void>;
    readonly accountBatch?: (entry: Readonly<{ kind: string; count: number }>) => void;
  };
  /** Test-mode-only repository picker supplied by the activation composition. */
  readonly requestRepositorySelection?: ReviewContextsRepositorySelection;
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
  preparePullRequestCandidateForExplicitContextSelection?(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<void>;
  augmentCurrentContextCandidates(
    localCandidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<readonly CurrentContextUiSnapshot[]>;
  /** Optional Test-only read-only evidence that repository selection preserved tree and Review State. */
  getCancellationSnapshotForTest?(): Promise<{
    readonly providerProjection: readonly string[];
    readonly authoritativeContextCounts: readonly { readonly repositoryId: string; readonly count: number }[];
  }>;
  /** Test-only read-only probe for the shared actual VS Code URI boundary. */
  workspaceUriToFilesystemPathForTest?(uri: vscode.Uri): string | undefined;
}

interface LocalRepositoryOwner {
  readonly repositoryId: string;
  readonly repositoryRoot: string;
  readonly headRevision: string;
  readonly branchRef?: string;
  readonly snapshot: CurrentContextUiSnapshot;
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
  private pendingCachePublishes: Array<() => Promise<void>> = [];
  private pendingProjection: (() => Promise<readonly ReviewContextListItem[]>) | undefined;

  public constructor(
    private readonly repository: T405ReviewStateRepository,
    private readonly visibility: VscodeReviewContextVisibilityStore,
    private readonly currentPullRequestSelection: VscodeCurrentPullRequestSelectionStore,
    private readonly enumerateCurrentContexts: (signal?: AbortSignal) => Promise<readonly CurrentContextUiSnapshot[]>,
    /** Performs state mutation only for explicit synchronization commands. */
    private readonly synchronizeRepository: (
      owner: LocalRepositoryOwner,
      persisted: readonly ReviewContextState[]
    ) => Promise<void>,
    /** Acquires a current projection without mutating persisted Review State. */
    private readonly readSynchronizedRepository: (
      owner: LocalRepositoryOwner,
      persisted: readonly ReviewContextState[],
      signal?: AbortSignal,
      feedbackContext?: OperationFeedbackContext,
      onPullRequestContextSynchronized?: (contextId: string) => void,
    ) => Promise<readonly ReviewContextState[]>,
  private readonly progressFor: (
    context: ReviewContextState,
    repositoryRoot: string,
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    deferCachePublish?: boolean,
  ) => Promise<ReviewContextListProgress | undefined>,
    private readonly cacheStatusByContextId: ReadonlyMap<string, ReviewContextCacheStatus>,
    private readonly workOptions: NonNullable<T405ReviewContextsRuntimeOptions["reviewContextsWork"]> = {},
  ) {}

  private createWork(signal?: AbortSignal): {
    item(kind: string): Promise<void>;
    isCurrent(): boolean;
  } {
    const maxItems = this.workOptions.maxItems ?? 128;
    if (!Number.isSafeInteger(maxItems) || maxItems <= 0 || maxItems > 128) {
      throw new RangeError("reviewContextsWork.maxItems must be a positive integer no greater than 128.");
    }
    const yieldControl = this.workOptions.yieldControl ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    let pending = 0;
    let pendingKind = "review-context";
    const isCurrent = (): boolean => signal?.aborted !== true;
    return {
      isCurrent,
      item: async (kind: string): Promise<void> => {
        if (!isCurrent()) throw new DOMException("Review Contexts refresh was superseded.", "AbortError");
        pendingKind = kind;
        pending += 1;
        if (pending < maxItems) return;
        this.workOptions.accountBatch?.({ kind: pendingKind, count: pending });
        pending = 0;
        await yieldControl();
        if (!isCurrent()) throw new DOMException("Review Contexts refresh was superseded.", "AbortError");
      }
    };
  }

  public repositoryRoot(repositoryId: string): string | undefined {
    const roots = this.roots.get(repositoryId);
    return roots === undefined ? undefined : resolveUniqueRepositoryRoot(roots);
  }

  /** Repository owners observed while building the current projection. */
  public repositoryIds(): readonly string[] {
    return [...this.roots.keys()].sort();
  }

  private rememberRoot(repositoryId: string, repositoryRoot: string): void {
    const roots = this.roots.get(repositoryId) ?? new Set<string>();
    roots.add(repositoryRoot);
    this.roots.set(repositoryId, roots);
  }

  public async load(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<readonly ReviewContextListItem[]> {
    this.pendingCachePublishes = [];
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Review Contexts refresh was superseded.", "AbortError");
    };
    const work = this.createWork(signal);
    const checkpoint = (kind = "source-context"): Promise<void> => work.item(kind);
    const current: ReviewContextState[] = [];
    const saved = new Map<string, ReviewContextState>();
    const progressByContextId: Record<string, ReviewContextListProgress> = {};
    const observedRepositories = new Set<string>();
    const reportRepository = (repositoryId: string): void => {
      if (feedbackContext === undefined || observedRepositories.has(repositoryId)) return;
      observedRepositories.add(repositoryId);
      reportActiveOperationProgress({
        stage: "repositories",
        completed: observedRepositories.size,
      }, feedbackContext);
    };
    const reportPullRequestContext = (contextId: string): void => {
      if (feedbackContext === undefined) return;
      let observed = observedPullRequestContextsByOperation.get(feedbackContext);
      if (observed === undefined) {
        observed = new Set<string>();
        observedPullRequestContextsByOperation.set(feedbackContext, observed);
      }
      if (observed.has(contextId)) return;
      observed.add(contextId);
      reportActiveOperationProgress({
        stage: "pull-request-contexts",
        completed: observed.size,
      }, feedbackContext);
    };
    this.roots.clear();

    for (const snapshot of await this.enumerateCurrentContexts(signal)) {
      assertCurrent();
      await checkpoint("enumerated-current-context");
      const owner = localOwner(snapshot);
      if (owner !== undefined) {
        this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
        reportRepository(owner.repositoryId);
        const persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
        assertCurrent();
        const synchronized = await this.readSynchronizedRepository(
          owner,
          persisted,
          signal,
          feedbackContext,
          reportPullRequestContext,
        );
        assertCurrent();
        for (const context of synchronized) {
          saved.set(context.contextId, context);
          if (context.kind === "pull-request") reportPullRequestContext(context.contextId);
          await checkpoint("collected-saved-context");
        }

        if (owner.branchRef !== undefined) {
          const branch = synchronized.find((context) =>
            context.kind === "branch" && context.branch?.refName === owner.branchRef
          );
          current.push(branch ?? this.syntheticBranch(snapshot, owner.repositoryId, owner.branchRef));
        }
        const preferredContextId = this.currentPullRequestSelection.read(
          owner.repositoryId,
          owner.headRevision,
        );
        const currentPullRequest = findCurrentPullRequestContext(
          synchronized,
          owner.repositoryId,
          owner.headRevision,
          preferredContextId,
          this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
        );
        if (currentPullRequest !== undefined) current.unshift(currentPullRequest);

        for (const context of synchronized) {
          await checkpoint("loaded-context-progress");
          if (context.kind !== "pull-request") continue;
          const progress = await this.progressFor(context, owner.repositoryRoot, signal, feedbackContext);
          assertCurrent();
          if (progress !== undefined) progressByContextId[context.contextId] = progress;
        }
      } else if (snapshot.context.kind === "workspace") {
        current.push(this.syntheticWorkspace(snapshot));
      }
    }

    const hiddenContextIds = new Set(await this.visibility.readHiddenContextIds());
    const project = async (): Promise<readonly ReviewContextListItem[]> => {
      assertCurrent();
      const savedValues: ReviewContextState[] = [];
      for (const context of saved.values()) { savedValues.push(context); await checkpoint("copied-saved-context"); }
      assertCurrent();
      const cacheByContextId: Record<string, ReviewContextCacheStatus> = {};
      for (const [contextId, status] of this.cacheStatusByContextId) {
        cacheByContextId[contextId] = status;
        await checkpoint("copied-cache-status");
      }
      return projectReviewContextsCooperatively(
        { current, saved: savedValues, hiddenContextIds, progressByContextId, cacheByContextId },
        { item: (kind) => checkpoint(kind), isCurrent: work.isCurrent }
      );
    };
    this.pendingProjection = project;
    const projected = await project();
    if (feedbackContext !== undefined) {
      const completed = observedPullRequestContextsByOperation.get(feedbackContext)?.size ?? 0;
      reportActiveOperationProgress({
        stage: "pull-request-contexts",
        completed,
        total: completed,
      }, feedbackContext);
    }
    return projected;
  }

  /** Commits cache entries only after the final retryable read is accepted. */
  public async publishLoaded(): Promise<readonly ReviewContextListItem[] | undefined> {
    const publishes = this.pendingCachePublishes;
    this.pendingCachePublishes = [];
    for (const publish of publishes) await publish();
    const projection = this.pendingProjection;
    this.pendingProjection = undefined;
    return projection?.();
  }

  public deferCachePublish(publish: () => Promise<void>): void {
    this.pendingCachePublishes.push(publish);
  }

  public async augmentCurrentContextCandidates(
    localCandidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<readonly CurrentContextUiSnapshot[]> {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Current Context refresh was superseded.", "AbortError");
    };
    const work = this.createWork(signal);
    const candidates = new Map<string, CurrentContextUiSnapshot>();
    for (const candidate of localCandidates) {
      assertCurrent();
      await work.item("collected-current-candidate");
      candidates.set(this.candidateKey(candidate), candidate);
      const owner = localOwner(candidate);
      if (owner === undefined) continue;
      this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
      const persisted = await this.repository.listRepositoryContexts(owner.repositoryId);
      assertCurrent();
      const synchronized = await this.readSynchronizedRepository(owner, persisted, signal, feedbackContext);
      assertCurrent();
      const preferredContextId = this.currentPullRequestSelection.read(
        owner.repositoryId,
        owner.headRevision,
      );
      const pullRequest = findCurrentPullRequestContext(
        synchronized,
        owner.repositoryId,
        owner.headRevision,
        preferredContextId,
        this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
      );
      if (pullRequest === undefined || pullRequest.pullRequest === undefined) continue;
      const progress = await this.progressFor(pullRequest, owner.repositoryRoot, signal, feedbackContext, false);
      assertCurrent();
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
    let sorted: CurrentContextUiSnapshot[] = [];
    for (const candidate of candidates.values()) {
      await work.item("copied-current-candidate");
      sorted.push(candidate);
    }
    for (let width = 1; width < sorted.length; width *= 2) {
      const next: CurrentContextUiSnapshot[] = [];
      for (let start = 0; start < sorted.length; start += width * 2) {
        let left = start; let right = Math.min(start + width, sorted.length);
        const leftEnd = right; const rightEnd = Math.min(start + width * 2, sorted.length);
        while (left < leftEnd || right < rightEnd) {
          await work.item("sorted-current-candidate");
          const takeLeft = right >= rightEnd || (left < leftEnd && (
            this.kindOrder(sorted[left]!) - this.kindOrder(sorted[right]!) ||
            sorted[left]!.context.label.localeCompare(sorted[right]!.context.label)
          ) <= 0);
          next.push(takeLeft ? sorted[left++]! : sorted[right++]!);
        }
      }
      sorted = next;
    }
    return sorted;
  }

  private candidateKey(snapshot: CurrentContextUiSnapshot): string {
    return currentContextCandidateKey(snapshot);
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

  const workspaceFilesystemPath = (uri: vscode.Uri): string | undefined => workspaceUriToFilesystemPath(
    uri,
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
  );

  /** Collects only current, local opened-document hints for this repository. */
  const openedEncodingHints = (repositoryRoot: string): Readonly<Record<string, string>> => {
    const hints: Record<string, string> = {};
    const pathApi = PATH_SEMANTICS === "windows" ? path.win32 : path.posix;
    for (const document of vscode.workspace.textDocuments) {
      const documentPath = workspaceFilesystemPath(document.uri);
      if (document.isClosed || document.encoding.length === 0 || documentPath === undefined) continue;
      const relative = pathApi.relative(repositoryRoot, documentPath);
      if (relative.length === 0 || pathApi.isAbsolute(relative) || relative === ".." ||
          relative.startsWith(`..${pathApi.sep}`)) continue;
      hints[relative.split(pathApi.sep).join("/")] = document.encoding;
    }
    return hints;
  };

  const inspectActiveRepository = async (): Promise<LocalGitRepository> => {
    const filesystemPath = (document: vscode.TextDocument): string | undefined => workspaceFilesystemPath(document.uri);
    const active = vscode.window.activeTextEditor?.document;
    const knownRootPaths = (await options.enumerateCurrentContexts()).flatMap((snapshot) => {
      const selection = snapshot.context.selection;
      return selection?.kind === "branch" || selection?.kind === "detached" || selection?.kind === "pull-request"
        ? [selection.repositoryRoot]
        : [];
    });
    const resolved = await resolveReviewContextsRepository({
      activeDocumentPath: active === undefined ? undefined : filesystemPath(active),
      openedDocumentPaths: (vscode.workspace.textDocuments ?? []).map(filesystemPath),
      knownRootPaths,
      workspaceFolderPaths: (vscode.workspace.workspaceFolders ?? []).map((folder) => workspaceFilesystemPath(folder.uri)),
      inspectRepository: (startPath) => options.git.inspectRepository(startPath),
      requestSelection: options.requestRepositorySelection ?? (async (candidates) => {
        const choices = candidates.map((candidate) => ({
          label: candidate.repository.rootPath,
          candidate
        }));
        return (await vscode.window.showQuickPick(choices, {
          placeHolder: "Gitリポジトリを選択"
        }))?.candidate;
      })
    });
    const verified = await options.git.inspectRepository(resolved.rootPath);
    if (verified.kind !== "repository" ||
        verified.repository.rootPath !== resolved.rootPath ||
        verified.repository.repositoryId !== resolved.repositoryId) {
      throw new ReviewContextsRepositorySelectionCancelled();
    }
    return verified.repository;
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
    descriptor: Parameters<PullRequestReviewRuntimeRegistration["readTextContent"]>[0],
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<RevisionTextContentReadResult> => {
    if (signal?.aborted) throw new DOMException("PR content acquisition was superseded.", "AbortError");
    const local = await options.git.readTextFileAtRevision(
      root,
      descriptor.revision,
      descriptor.filePath,
      descriptor.fileSystemPathSemantics,
      feedbackContext,
      signal,
    );
    if (local.kind === "found") return local;
    if (local.kind === "invalid-encoding") return local;
    const remote = await createPullRequestRemote(identity, token).readFile(
      identity,
      descriptor.revision,
      descriptor.filePath,
      feedbackContext,
      signal,
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
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    deferCachePublish = false,
  ) => {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("PR progress acquisition was superseded.", "AbortError");
    };
    assertCurrent();
    const root = await resolveRepositoryRoot(context.repositoryId);
    assertCurrent();
    const identity = repositoryIdentity(context);
    const token = await auth.getAccessToken(identity.host, signal);
    assertCurrent();
    const local: LocalPullRequestDiffPort = forceRemote
      ? { loadDiff: async () => ({ kind: "unavailable" as const, reason: "git-unavailable" as const }) }
      : new LocalGitPullRequestDiffAdapter(gitExecutor, root);
    const remote = createPullRequestRemote(identity, token);
    const acquisition = options.createPullRequestDiffAcquisition?.({ local, remote }) ??
      new PullRequestDiffAcquisitionService({ local, remote });
    const route = resolveReviewStateStorageRoute(uris, {
      kind: "pull-request",
      repositoryId: context.repositoryId,
      contextId: context.contextId,
    });
    if (route.cacheDirectory === undefined) {
      throw new Error("Pull-request cache requires a repository storage route");
    }
    const notifyStorageLockDiagnostic = (diagnostic: StorageRootLockDiagnostic): void => {
      reportActiveStorageLockDiagnostic(diagnostic, feedbackContext);
    };
    const cache = new GitHubPullRequestCacheService({
      acquisition,
      storage: options.createPullRequestCacheStorage?.(route.cacheDirectory, notifyStorageLockDiagnostic) ??
        new NodeGitHubPullRequestCacheStorage({
          cacheDirectory: route.cacheDirectory,
          notifyStorageLockDiagnostic,
        }),
      freshnessMs: CACHE_FRESHNESS_MS,
    });
    let result = await cache.acquireRead(diffRequest(context), feedbackContext, signal);
    assertCurrent();
    const publish = async (): Promise<void> => {
      result = await cache.publish(diffRequest(context), result, feedbackContext, signal);
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
    };
    if (deferCachePublish) sourceRef.current?.deferCachePublish(publish);
    else await publish();
    if (result.kind === "acquired") {
      options.registerPullRequestReviewDiff({
        repositoryId: context.repositoryId,
        repositoryRoot: root,
        fileSystemPathSemantics: PATH_SEMANTICS,
        snapshot: result.snapshot,
        readTextContent: (descriptor, registrationFeedbackContext, registrationSignal) => {
          return readReviewDiffContent(
            root,
            identity,
            token,
            descriptor,
            registrationFeedbackContext,
            registrationSignal,
          );
        },
      });
    }
    return { result, root, identity, token };
  };

  const cacheStatusByContextId = new Map<string, ReviewContextCacheStatus>();

  const progressFor = async (
    context: ReviewContextState,
    _repositoryRoot: string,
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    deferCachePublish = true,
  ): Promise<ReviewContextListProgress | undefined> => {
    const { result } = await acquire(context, false, signal, feedbackContext, deferCachePublish);
    if (result.kind !== "acquired") {
      throw new OperationDiagnosticError({
        code: "PR_PROGRESS_UNAVAILABLE",
        attempts: result.attempts,
      });
    }
    return options.getPullRequestReviewProgress(context.contextId, feedbackContext, signal);
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

  /**
   * Reads remote lifecycle metadata into an ephemeral projection.  Refresh is
   * allowed to retry this acquisition; persistent Review State is changed only
   * by explicit synchronization commands below.
   */
  const readSynchronizedRepository = async (
    owner: LocalRepositoryOwner,
    persisted: readonly ReviewContextState[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    onPullRequestContextSynchronized?: (contextId: string) => void,
  ): Promise<readonly ReviewContextState[]> => {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Review Contexts refresh was superseded.", "AbortError");
    };
    const projected: ReviewContextState[] = [];
    for (const context of persisted) {
      assertCurrent();
      if (context.kind !== "pull-request" || context.pullRequest === undefined) {
        projected.push(context);
        continue;
      }
      const identity = repositoryIdentity(context);
      const token = await auth.getAccessToken(identity.host, signal);
      assertCurrent();
      const latest = await createPullRequestLifecycle(identity, token).fetchCurrent(
        identity,
        context.pullRequest.number,
        feedbackContext,
        signal,
      );
      assertCurrent();
      if (latest.kind !== "available") {
        throw new OperationDiagnosticError({
          code: "GITHUB_PR_DETECTION_UNAVAILABLE",
          reason: latest.reason,
        });
      }
      onPullRequestContextSynchronized?.(context.contextId);
      projected.push({
        ...context,
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
    return projected;
  };

  const source = new T405ReviewContextsSource(
    repository,
    visibility,
    currentPullRequestSelection,
    options.enumerateCurrentContexts,
    synchronizeRepository,
    readSynchronizedRepository,
    progressFor,
    cacheStatusByContextId,
    options.reviewContextsWork,
  );
  sourceRef.current = source;

  const detectPullRequest = async (
    local: LocalGitRepository,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<void> => {
    const isDetectionAborted = (): boolean => signal?.aborted === true;
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

    const token = await auth.getAccessToken(identity.host, signal, true);
    if (isDetectionAborted()) throw new DOMException("PR detection was superseded.", "AbortError");
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
    let search = await createPullRequestSearch(identity, token).findOpenByHead(identity, local.head);
    if (isDetectionAborted()) throw new DOMException("PR detection was superseded.", "AbortError");
    if (
      token !== undefined &&
      search.kind === "unavailable" &&
      search.reason === "api" &&
      search.httpStatus === 404
    ) {
      const reselectedToken = await auth.getAccessToken(identity.host, signal, true, true);
      if (isDetectionAborted()) throw new DOMException("PR detection was superseded.", "AbortError");
      if (reselectedToken !== undefined) {
        search = await createPullRequestSearch(identity, reselectedToken).findOpenByHead(identity, local.head);
        if (isDetectionAborted()) throw new DOMException("PR detection was superseded.", "AbortError");
      }
    }
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
          openedEncodingHints(local.rootPath),
        );
        await contextStateService.create(
          { contextState: state, globalState: preparedGlobal.nextGlobalState },
          preparedGlobal.expectedGlobalState,
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
          feedbackContext,
        );
      }
    }
  };

  const preparePullRequestCandidateForExplicitContextSelection = async (
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<void> => {
    if (signal?.aborted === true) throw new DOMException("Current Context selection was superseded.", "AbortError");
    let local: LocalGitRepository;
    try {
      local = await inspectActiveRepository();
    } catch (error) {
      if (error instanceof ReviewContextsRepositorySelectionCancelled) return;
      throw error;
    }
    if (local.head === undefined || local.remote === undefined) return;
    const identity = parseGitHubRemote(local.remote.rawUrl);
    if (identity === undefined) return;
    const persisted = await repository.listRepositoryContexts(local.repositoryId);
    const current = findCurrentPullRequestContext(
      persisted,
      local.repositoryId,
      local.head,
      currentPullRequestSelection.read(local.repositoryId, local.head),
      currentPullRequestSelection.prefersBranch(local.repositoryId, local.head),
    );
    if (current !== undefined) return;
    await detectPullRequest(local, feedbackContext, signal);
  };

  const controller = new ReviewContextsController({
    visibility,
    setPullRequestLayerEnabled: async (context, enabled, _feedbackContext) => {
      void _feedbackContext;
      const pullRequest = context.pullRequest;
      if (pullRequest === undefined) throw new Error("PR context is required");
      await contextStateService.update({
        repositoryId: context.repositoryId,
        identity: pullRequestIdentity(context),
        pullRequest: { ...pullRequest, decorationEnabled: enabled },
      });
    },
    refreshPullRequestCache: async (context, feedbackContext) => {
      const { result } = await acquire(context, true, undefined, feedbackContext);
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
    openPullRequestDiff: async (context, feedbackContext) => {
      const { result } = await acquire(context, false, undefined, feedbackContext);
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
    redetectPullRequest: async (feedbackContext) => {
      const local = await inspectActiveRepository();
      await detectPullRequest(local, feedbackContext);
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
    preparePullRequestCandidateForExplicitContextSelection,
    augmentCurrentContextCandidates: (localCandidates, signal, feedbackContext) =>
      source.augmentCurrentContextCandidates(localCandidates, signal, feedbackContext),
    getCancellationSnapshotForTest: async () => ({
      providerProjection: (registered.getProjectionSnapshotForTest?.() ?? []).map((item) => item.context.contextId),
      authoritativeContextCounts: await Promise.all(source.repositoryIds().map(async (repositoryId) => ({
        repositoryId,
        count: (await repository.listRepositoryContexts(repositoryId)).length,
      }))),
    }),
    workspaceUriToFilesystemPathForTest: (uri) => workspaceFilesystemPath(uri),
  };
}

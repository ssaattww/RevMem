import path from "node:path";
import * as vscode from "vscode";

import { NodeSha256StableHash } from "../../adapters/crypto/index";
import {
  FetchGitHubPullRequestAdapter,
  FetchGitHubPullRequestDiffAdapter,
  FetchGitHubPullRequestLifecycleAdapter,
  NodeGitHubPullRequestCacheStorage,
  VsCodeGitHubAuthenticationProvider,
  createNodeGitHubPullRequestContextStateService,
  gitHubApiBaseUrl,
  parseGitHubRemote,
} from "../../adapters/github/index";
import type { GitHubPullRequestLifecycleResult } from "../../adapters/github/fetch-github-pull-request-lifecycle-adapter";
import { fetchGitHubPullRequestMergeBase } from "../../adapters/github/fetch-github-pull-request-merge-base";
import {
  LocalGitPullRequestDiffAdapter,
  NodeGitCommandExecutor,
  type LocalGitAdapter,
  type LocalGitRepository,
} from "../../adapters/local-git/index";
import {
  resolveReviewStateStorageRoute,
  type StorageRootLockDiagnostic,
  type ReviewStateCommit,
  type ReviewStateCreateTransactionLike,
  type ReviewStateRepositorySnapshot,
  type ReviewStateRepositoryTarget,
  type ReviewStateRepositoryTransactionLike,
  type ReviewStateTransactionLike,
  type ReviewStateStorageUris,
} from "../../adapters/state-repository/index";
import { resolveReviewRangeMappingOptions } from "../../application/configuration/review-range-mapping-options";
import type {
  GitCommitReviewDiffDocumentDescriptor,
  RevisionTextContentReadResult,
} from "../../application/diff-document/index";
import {
  GitHubPullRequestCacheService,
  type GitHubPullRequestCacheStorage,
  type PullRequestDiffAcquisitionPort,
} from "../../application/github-pr-cache/index";
import type { ReviewHistoryRecorder } from "../../application/review-history/index";
import {
  GitHubPullRequestContextResolver,
  createGitHubPullRequestContextIdFromRepositoryId,
  type GitHubPullRequestCandidate,
  type GitHubRepositoryIdentity,
} from "../../application/github-pr-context/index";
import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestRemoteDataPort,
} from "../../application/github-pr-diff/index";
import {
  reportActiveOperationProgress,
  reportActivePullRequestRefresh,
  reportActiveStorageLockDiagnostic,
  type PullRequestRefreshStage,
  type PullRequestRefreshStatus,
  type PullRequestRefreshReasonCode,
  type OperationFeedbackContext,
} from "../../application/operation-feedback/index";
import {
  clearPullRequestLifecycleOperationCache,
  PullRequestLifecycleOperationCacheRegistry,
  type PullRequestLifecycleOperationCache,
} from "./pull-request-lifecycle-operation-cache";

let pullRequestDetectionGeneration = 0;
const pullRequestLifecycleOperationCaches = new PullRequestLifecycleOperationCacheRegistry();
const fetchPullRequestLifecycle = async (
  identity: GitHubRepositoryIdentity,
  token: string | undefined,
  number: number,
  feedbackContext: OperationFeedbackContext | undefined,
  signal: AbortSignal | undefined,
  operationCache?: PullRequestLifecycleOperationCache,
): Promise<GitHubPullRequestLifecycleResult> => {
  const key = JSON.stringify([identity.host.toLowerCase(), identity.owner.toLowerCase(), identity.repository.toLowerCase(), number, "pull-request-lifecycle-v1"]);
  let read = operationCache?.lifecycleReads.get(key);
  if (read === undefined) {
    read = Promise.resolve().then(() => createPullRequestLifecycle(
      identity, token, operationCache?.mergeBaseReads, operationCache?.mergeBaseResults, operationCache?.mergeBaseGeneration,
    )
      .fetchCurrent(identity, number, feedbackContext, signal));
    operationCache?.lifecycleReads.set(key, read);
  }
  try {
    const result = await read;
    if (signal?.aborted === true) throw new DOMException("PR lifecycle read was superseded.", "AbortError");
    if (result.kind !== "available" && operationCache?.lifecycleReads.get(key) === read) operationCache.lifecycleReads.delete(key);
    return result;
  } catch (error) {
    if (operationCache?.lifecycleReads.get(key) === read) operationCache.lifecycleReads.delete(key);
    throw error;
  }
};
import {
  OperationDiagnosticError,
  reportActiveOperationFailure,
} from "../../application/operation-feedback/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type SelectedReviewContext,
  type GitRevisionMappingSource,
} from "../../application/review-context/index";
import { linkAbortSignal } from "./link-abort-signal";
import {
  PullRequestRevisionEvidenceLoader,
  ReviewContextsController,
  findCurrentPullRequestContext,
  resolveCurrentPullRequestContext,
  projectReviewContextsCooperatively,
  type ReviewContextCacheStatus,
  type ReviewContextListItem,
  type ReviewContextListProgress,
  type PullRequestRedetectionDisposition,
} from "../../application/review-contexts/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../core/contracts/index";
import type { CurrentContextUiSnapshot } from "../../ui/current-context/index";
import {
  VscodeCurrentPullRequestSelectionStore,
  VscodeReviewContextVisibilityStore,
  registerReviewContextsRuntime,
  type RegisteredReviewContextsRuntime,
  type ReviewContextsRuntimeSource,
} from "../../ui/review-contexts/index";
import type { PullRequestReviewRuntimeRegistration } from "../pull-request/pull-request-review-runtime";
import { synchronizePullRequestOwner } from "../pull-request/owner-pull-request-synchronization";
import { workspaceUriToFilesystemPath } from "../../application/review-context/repository-resolution";
import {
  currentContextCandidateKey,
  resolveUniqueRepositoryRoot
} from "../../ui/current-context/root-scoped-candidate-identity";
import {
  ReviewContextsRepositorySelectionCancelled,
  resolveReviewContextsRepository,
  type ReviewContextsRepositorySelection
} from "../../application/review-contexts/repository-selection";
import { currentGlobalForNewPullRequest } from "../pull-request/new-pull-request-global-composition";

const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const PATH_SEMANTICS = process.platform === "win32" ? "windows" as const : "posix" as const;
const observedPullRequestContextsByOperation = new WeakMap<OperationFeedbackContext, Set<string>>();

export interface T405ReviewContextsRuntimeOptions {
  readonly context: vscode.ExtensionContext;
  readonly git: LocalGitAdapter & GitRevisionMappingSource;
  readonly enumerateCurrentContexts: (signal?: AbortSignal) => Promise<readonly CurrentContextUiSnapshot[]>;
  readonly refreshDecorations: () => Promise<void>;
  readonly refreshCurrentContext: (feedbackContext?: OperationFeedbackContext) => Promise<void>;
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
  loadRepositorySnapshot?(repositoryId: string): Promise<ReviewStateRepositorySnapshot | undefined>;
  commitRepository?(transaction: Readonly<ReviewStateRepositoryTransactionLike>): Promise<void>;
  commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void>;
  create(transaction: Readonly<ReviewStateCreateTransactionLike>): Promise<void>;
}

export interface RegisteredT405ReviewContextsRuntime
extends RegisteredReviewContextsRuntime {
  /** Arms one accepted Current Context PR preparation for its direct dependent tree refresh. */
  acceptCurrentContextPreparation?(selection: SelectedReviewContext | undefined): void;
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
  /** Test-only projection counter for refresh-path regression checks. */
  getProjectionGenerationCountForTest?(): number;
}

interface LocalRepositoryOwner {
  readonly repositoryId: string;
  readonly repositoryRoot: string;
  readonly headRevision: string;
  readonly pullRequestSynchronizationRevision: string;
  readonly branchRef?: string;
  readonly snapshot: CurrentContextUiSnapshot;
}

interface PreparedCurrentContext {
  readonly owner: LocalRepositoryOwner;
  readonly synchronized: readonly ReviewContextState[];
  readonly pullRequest: ReviewContextState;
  readonly progress: ReviewContextListProgress | undefined;
}

const preparedCurrentContextKey = (selection: Extract<SelectedReviewContext, { readonly kind: "pull-request" }>): string =>
  [selection.repositoryId, selection.repositoryRoot, selection.contextId, selection.headRevision].join("\0");

const localCandidatePreparationKey = (selection: SelectedReviewContext): string => JSON.stringify(selection);

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

/** Rejects a cache/acquisition result that cannot represent this pinned PR state. */
const matchesImmutablePullRequestSnapshot = (
  context: ReviewContextState,
  snapshot: PullRequestReviewRuntimeRegistration["snapshot"],
): boolean => context.kind === "pull-request" && context.pullRequest !== undefined &&
  snapshot.contextId === context.contextId &&
  snapshot.baseSha === context.pullRequest.baseSha &&
  snapshot.headSha === context.pullRequest.headSha &&
  snapshot.originalDiffId === `${context.pullRequest.baseSha}..${context.pullRequest.headSha}`;

const createPullRequestSearch = (
  identity: GitHubRepositoryIdentity,
  token: string | undefined,
  onDiagnostic?: ConstructorParameters<typeof FetchGitHubPullRequestAdapter>[0]["onDiagnostic"],
  mergeBaseReads?: PullRequestLifecycleOperationCache["mergeBaseReads"],
  mergeBaseResults?: PullRequestLifecycleOperationCache["mergeBaseResults"],
  mergeBaseGeneration?: PullRequestLifecycleOperationCache["mergeBaseGeneration"],
): FetchGitHubPullRequestAdapter => {
  const apiBaseUrl = gitHubApiBaseUrl(identity.host);
  return token === undefined
    ? new FetchGitHubPullRequestAdapter({ apiBaseUrl, ...(onDiagnostic === undefined ? {} : { onDiagnostic }), ...(mergeBaseReads === undefined ? {} : { mergeBaseReads }), ...(mergeBaseResults === undefined ? {} : { mergeBaseResults }), ...(mergeBaseGeneration === undefined ? {} : { mergeBaseGeneration }) })
    : new FetchGitHubPullRequestAdapter({ apiBaseUrl, token, ...(onDiagnostic === undefined ? {} : { onDiagnostic }), ...(mergeBaseReads === undefined ? {} : { mergeBaseReads }), ...(mergeBaseResults === undefined ? {} : { mergeBaseResults }), ...(mergeBaseGeneration === undefined ? {} : { mergeBaseGeneration }) });
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
  mergeBaseReads?: Map<string, Promise<Awaited<ReturnType<typeof fetchGitHubPullRequestMergeBase>>>>,
  mergeBaseResults?: PullRequestLifecycleOperationCache["mergeBaseResults"],
  mergeBaseGeneration?: PullRequestLifecycleOperationCache["mergeBaseGeneration"],
): FetchGitHubPullRequestLifecycleAdapter => {
  const apiBaseUrl = gitHubApiBaseUrl(identity.host);
  return token === undefined
    ? new FetchGitHubPullRequestLifecycleAdapter({ apiBaseUrl, ...(mergeBaseReads === undefined ? {} : { mergeBaseReads }), ...(mergeBaseResults === undefined ? {} : { mergeBaseResults }), ...(mergeBaseGeneration === undefined ? {} : { mergeBaseGeneration }) })
    : new FetchGitHubPullRequestLifecycleAdapter({ apiBaseUrl, token, ...(mergeBaseReads === undefined ? {} : { mergeBaseReads }), ...(mergeBaseResults === undefined ? {} : { mergeBaseResults }), ...(mergeBaseGeneration === undefined ? {} : { mergeBaseGeneration }) });
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
      pullRequestSynchronizationRevision: snapshot.context.pullRequestSynchronizationRevision ?? headRevision,
      branchRef: selection.branchRef,
      snapshot,
    };
  }
  if (selection?.kind === "detached") {
    return {
      repositoryId: selection.repositoryId,
      repositoryRoot: selection.repositoryRoot,
      headRevision: selection.headRevision,
      pullRequestSynchronizationRevision: selection.headRevision,
      snapshot,
    };
  }
  return undefined;
};

interface PendingReviewContextsPublication {
  readonly cachePublishes: Array<() => Promise<void>>;
  projection?: readonly ReviewContextListItem[];
}

class T405ReviewContextsSource implements ReviewContextsRuntimeSource {
  private readonly roots = new Map<string, Set<string>>();
  private readonly pendingPublicationsBySignal = new WeakMap<AbortSignal, PendingReviewContextsPublication>();
  private pendingUnscopedPublication: PendingReviewContextsPublication | undefined;
  private projectionGenerationCount = 0;
  private readonly preparedCurrentContexts = new Map<string, PreparedCurrentContext>();
  private readonly preparedLocalCandidates = new Map<string, readonly CurrentContextUiSnapshot[]>();
  private acceptedCurrentContext: PreparedCurrentContext | undefined;
  private acceptedLocalCandidates: readonly CurrentContextUiSnapshot[] | undefined;

  public constructor(
    private readonly repository: T405ReviewStateRepository,
    private readonly visibility: VscodeReviewContextVisibilityStore,
    private readonly currentPullRequestSelection: VscodeCurrentPullRequestSelectionStore,
    private readonly enumerateCurrentContexts: (signal?: AbortSignal) => Promise<readonly CurrentContextUiSnapshot[]>,
    /** Performs state mutation only for explicit synchronization commands. */
    private readonly synchronizeRepository: (
      owner: LocalRepositoryOwner,
      persisted: readonly ReviewContextState[],
      signal?: AbortSignal,
      feedbackContext?: OperationFeedbackContext,
      operationCache?: PullRequestLifecycleOperationCache,
    ) => Promise<boolean>,
    /** Acquires a current projection without mutating persisted Review State. */
    private readonly readSynchronizedRepository: (
      owner: LocalRepositoryOwner,
      persisted: readonly ReviewContextState[],
      signal?: AbortSignal,
      feedbackContext?: OperationFeedbackContext,
      onPullRequestContextSynchronized?: (contextId: string) => void,
      operationCache?: PullRequestLifecycleOperationCache,
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

  private async synchronizeTrackingTarget(
    owner: LocalRepositoryOwner,
    persisted: readonly ReviewContextState[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    operationCache?: PullRequestLifecycleOperationCache,
  ): Promise<readonly ReviewContextState[]> {
    if (owner.pullRequestSynchronizationRevision === owner.headRevision) return persisted;
    const completed = await this.synchronizeRepository(owner, persisted, signal, feedbackContext, operationCache);
    if (!completed) return persisted;
    return this.repository.listRepositoryContexts(owner.repositoryId);
  }

  public async load(
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<readonly ReviewContextListItem[]> {
    const pendingPublication: PendingReviewContextsPublication = { cachePublishes: [] };
    if (signal === undefined) this.pendingUnscopedPublication = pendingPublication;
    else this.pendingPublicationsBySignal.set(signal, pendingPublication);
    // Preparation is consumed only by the immediately following dependent
    // refresh. An independent Tree command always performs fresh acquisition.
    const acceptedPreparation = this.acceptedCurrentContext;
    const acceptedLocalCandidates = this.acceptedLocalCandidates;
    this.acceptedCurrentContext = undefined;
    this.acceptedLocalCandidates = undefined;
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Review Contexts refresh was superseded.", "AbortError");
    };
    const work = this.createWork(signal);
    const operationCache = pullRequestLifecycleOperationCaches.forOperation(feedbackContext);
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

    for (const snapshot of acceptedLocalCandidates ?? await this.enumerateCurrentContexts(signal)) {
      assertCurrent();
      await checkpoint("enumerated-current-context");
      const owner = localOwner(snapshot);
      if (owner !== undefined) {
        this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
        reportRepository(owner.repositoryId);
        const preparedForOwner = acceptedPreparation !== undefined &&
          acceptedPreparation.owner.repositoryId === owner.repositoryId &&
          acceptedPreparation.owner.repositoryRoot === owner.repositoryRoot &&
          acceptedPreparation.owner.headRevision === owner.headRevision &&
          acceptedPreparation.owner.pullRequestSynchronizationRevision === owner.pullRequestSynchronizationRevision
          ? acceptedPreparation
          : undefined;
        const synchronized = preparedForOwner === undefined
          ? await (async () => {
              let persisted: readonly ReviewContextState[] = await this.repository.listRepositoryContexts(owner.repositoryId);
              assertCurrent();
              persisted = await this.synchronizeTrackingTarget(owner, persisted, signal, feedbackContext, operationCache);
              assertCurrent();
              return this.readSynchronizedRepository(
                owner,
                persisted,
                signal,
                feedbackContext,
                reportPullRequestContext,
                operationCache,
              );
            })()
          : preparedForOwner.synchronized;
        assertCurrent();
        for (const context of synchronized) {
          saved.set(context.contextId, context);
          if (context.kind === "pull-request") reportPullRequestContext(context.contextId);
          await checkpoint("collected-saved-context");
        }

        const preferredContextId = this.currentPullRequestSelection.read(
          owner.repositoryId,
          owner.headRevision,
        );
        if (owner.branchRef !== undefined) {
          const branch = synchronized.find((context) =>
            context.kind === "branch" && context.branch?.refName === owner.branchRef
          );
          current.push(branch ?? this.syntheticBranch(snapshot, owner.repositoryId, owner.branchRef));
        }
        const currentPullRequest = findCurrentPullRequestContext(
          synchronized,
          owner.repositoryId,
          owner.pullRequestSynchronizationRevision,
          preferredContextId,
          this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
        );
        if (currentPullRequest !== undefined) current.unshift(currentPullRequest);

        for (const context of synchronized) {
          await checkpoint("loaded-context-progress");
          if (context.kind !== "pull-request") continue;
          const progress = preparedForOwner !== undefined &&
            context.contextId === preparedForOwner.pullRequest.contextId &&
            context.pullRequest?.baseSha === preparedForOwner.pullRequest.pullRequest?.baseSha &&
            context.pullRequest?.headSha === preparedForOwner.pullRequest.pullRequest?.headSha
            ? preparedForOwner.progress
            : await this.progressFor(context, owner.repositoryRoot, signal, feedbackContext);
          assertCurrent();
          if (progress !== undefined) progressByContextId[context.contextId] = progress;
        }
      } else if (snapshot.context.kind === "workspace") {
        current.push(this.syntheticWorkspace(snapshot));
      }
    }

    const hiddenContextIds = new Set(await this.visibility.readHiddenContextIds());
    const project = async (): Promise<readonly ReviewContextListItem[]> => {
      this.projectionGenerationCount += 1;
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
    const projected = await project();
    pendingPublication.projection = projected;
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
  public async publishLoaded(signal?: AbortSignal): Promise<readonly ReviewContextListItem[] | undefined> {
    const pendingPublication = signal === undefined
      ? this.pendingUnscopedPublication
      : this.pendingPublicationsBySignal.get(signal);
    if (signal === undefined) this.pendingUnscopedPublication = undefined;
    else this.pendingPublicationsBySignal.delete(signal);
    if (pendingPublication === undefined) return undefined;
    const publishes = pendingPublication.cachePublishes;
    if (publishes.length === 0) {
      return undefined;
    }
    for (const publish of publishes) await publish();
    const projection = pendingPublication.projection;
    if (projection === undefined) return undefined;
    return projection.map((item) => {
      if (item.context.kind !== "pull-request") return item;
      const cache = this.cacheStatusByContextId.get(item.context.contextId);
      if (cache === undefined) {
        if (item.cache === undefined) return item;
        const withoutCache = { ...item };
        delete withoutCache.cache;
        return withoutCache;
      }
      return { ...item, cache };
    });
  }

  public projectionGenerationCountForTest(): number {
    return this.projectionGenerationCount;
  }

  public deferCachePublish(publish: () => Promise<void>, signal?: AbortSignal): void {
    const pendingPublication = signal === undefined
      ? this.pendingUnscopedPublication
      : this.pendingPublicationsBySignal.get(signal);
    if (pendingPublication === undefined) {
      throw new Error("Deferred PR cache publication has no active Review Contexts load.");
    }
    pendingPublication.cachePublishes.push(publish);
  }

  public async augmentCurrentContextCandidates(
    localCandidates: readonly CurrentContextUiSnapshot[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<readonly CurrentContextUiSnapshot[]> {
    this.preparedCurrentContexts.clear();
    this.preparedLocalCandidates.clear();
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Current Context refresh was superseded.", "AbortError");
    };
    const work = this.createWork(signal);
    const operationCache = pullRequestLifecycleOperationCaches.forOperation(feedbackContext);
    const candidates = new Map<string, CurrentContextUiSnapshot>();
    for (const candidate of localCandidates) {
      assertCurrent();
      await work.item("collected-current-candidate");
      candidates.set(this.candidateKey(candidate), candidate);
      if (candidate.context.selection !== undefined) {
        this.preparedLocalCandidates.set(
          localCandidatePreparationKey(candidate.context.selection),
          localCandidates,
        );
      }
      const owner = localOwner(candidate);
      if (owner === undefined) continue;
      this.rememberRoot(owner.repositoryId, owner.repositoryRoot);
      let persisted: readonly ReviewContextState[] = await this.repository.listRepositoryContexts(owner.repositoryId);
      assertCurrent();
      persisted = await this.synchronizeTrackingTarget(owner, persisted, signal, feedbackContext, operationCache);
      assertCurrent();
      const synchronized = await this.readSynchronizedRepository(owner, persisted, signal, feedbackContext, undefined, operationCache);
      assertCurrent();
      const preferredContextId = this.currentPullRequestSelection.read(
        owner.repositoryId,
        owner.headRevision,
      );
      const selectionDecision = resolveCurrentPullRequestContext(
        synchronized,
        owner.repositoryId,
        owner.pullRequestSynchronizationRevision,
        preferredContextId,
        this.currentPullRequestSelection.prefersBranch(owner.repositoryId, owner.headRevision),
      );
      const localBranch = localCandidates.find((candidate) => {
        const candidateOwner = localOwner(candidate);
        return candidateOwner?.repositoryId === owner.repositoryId &&
          candidateOwner.branchRef === owner.branchRef && candidate.context.kind === "branch";
      });
      if (localBranch !== undefined) {
        const withProvenance: CurrentContextUiSnapshot = {
          ...localBranch,
          context: {
            ...localBranch.context,
            selectionReason: selectionDecision.reason,
            pullRequestCandidateCount: selectionDecision.candidateCount,
          },
        };
        candidates.set(this.candidateKey(withProvenance), withProvenance);
      }
      const pullRequest = selectionDecision.context;
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
          selectionReason: selectionDecision.reason,
          pullRequestCandidateCount: selectionDecision.candidateCount,
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
      const selection = projected.context.selection;
      if (selection?.kind === "pull-request") {
        this.preparedCurrentContexts.set(
          preparedCurrentContextKey(selection),
          { owner, synchronized, pullRequest, progress },
        );
        this.preparedLocalCandidates.set(localCandidatePreparationKey(selection), localCandidates);
      }
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

  public acceptCurrentContextPreparation(selection: SelectedReviewContext | undefined): void {
    this.acceptedLocalCandidates = selection === undefined
      ? undefined
      : this.preparedLocalCandidates.get(localCandidatePreparationKey(selection));
    this.acceptedCurrentContext = selection?.kind === "pull-request"
      ? this.preparedCurrentContexts.get(preparedCurrentContextKey(selection))
      : undefined;
    this.preparedCurrentContexts.clear();
    this.preparedLocalCandidates.clear();
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
    async (evidence, preparedCurrent) => {
      const current = preparedCurrent ?? await repository.load({
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

  const readReviewDiffContents = async (
    root: string,
    identity: GitHubRepositoryIdentity,
    token: string | undefined,
    descriptors: readonly GitCommitReviewDiffDocumentDescriptor[],
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<readonly RevisionTextContentReadResult[]> => {
    if (descriptors.length === 0) return [];
    if (signal?.aborted) throw new DOMException("PR content acquisition was superseded.", "AbortError");
    const first = descriptors[0]!;
    if (descriptors.some((descriptor) => descriptor.revision !== first.revision ||
      descriptor.fileSystemPathSemantics !== first.fileSystemPathSemantics)) {
      throw new Error("Bulk PR text reads must use one immutable revision and path policy");
    }
    const local = await options.git.readTextFilesAtRevision(
      root,
      first.revision,
      descriptors.map((descriptor) => descriptor.filePath),
      first.fileSystemPathSemantics,
      feedbackContext,
      signal,
    );
    if (signal?.aborted) throw new DOMException("PR content acquisition was superseded.", "AbortError");
    const remote = createPullRequestRemote(identity, token);
    return Promise.all(descriptors.map(async (descriptor) => {
      const result = local.get(descriptor.filePath) ?? { kind: "missing-file" as const };
      if (result.kind === "found" || result.kind === "invalid-encoding") return result;
      const fallback = await remote.readFile(
        identity,
        descriptor.revision,
        descriptor.filePath,
        feedbackContext,
        signal,
      );
      if (fallback.kind === "found") return fallback;
      if (fallback.kind === "binary") return { kind: "invalid-encoding" as const, encoding: "utf-8" as const };
      if (fallback.reason === "missing-revision") return { kind: "missing-revision" as const };
      return result.kind === "missing-revision"
        ? { kind: "missing-revision" as const }
        : { kind: "missing-file" as const };
    }));
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
    if (result.kind === "acquired" && !matchesImmutablePullRequestSnapshot(context, result.snapshot)) {
      throw new Error("Pull-request diff snapshot does not match the selected immutable context.");
    }
    const publish = async (): Promise<void> => {
      result = await cache.publish(diffRequest(context), result, feedbackContext, signal);
      assertCurrent();
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
    if (deferCachePublish) sourceRef.current?.deferCachePublish(publish, signal);
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
        readTextContents: (descriptors, registrationFeedbackContext, registrationSignal) =>
          readReviewDiffContents(
            root,
            identity,
            token,
            descriptors,
            registrationFeedbackContext,
            registrationSignal,
          ),
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
    persisted: readonly ReviewContextState[],
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
    operationCache?: PullRequestLifecycleOperationCache,
  ): Promise<boolean> => {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) {
        throw new DOMException("PR synchronization was superseded.", "AbortError");
      }
    };
    if (repository.loadRepositorySnapshot === undefined || repository.commitRepository === undefined) {
      // Compatibility for injected legacy repositories. Resolve every lifecycle
      // read first so an unavailable sibling cannot leave a partial metadata update.
      const updates: Array<Parameters<typeof contextStateService.update>[0]> = [];
      for (const context of persisted) {
        assertCurrent();
        if (context.kind !== "pull-request" || context.pullRequest === undefined) continue;
        const identity = repositoryIdentity(context);
        const token = await auth.getAccessToken(identity.host, signal);
        assertCurrent();
        const latest = await fetchPullRequestLifecycle(identity, token, context.pullRequest.number, feedbackContext, signal, operationCache);
        assertCurrent();
        if (latest.kind !== "available") return false;
        if (
          context.pullRequest.baseSha !== latest.metadata.baseSha ||
          context.pullRequest.headSha !== latest.metadata.headSha
        ) {
          throw new Error("Pull-request revision synchronization requires repository-owner atomic commit support.");
        }
        updates.push({
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
      for (const update of updates) {
        assertCurrent();
        await contextStateService.update(update);
      }
      return true;
    }

    const result = await synchronizePullRequestOwner(
      { repositoryId: owner.repositoryId, headRevision: owner.pullRequestSynchronizationRevision },
      {
        repository: {
          loadRepositorySnapshot: (repositoryId) => {
            const loadRepositorySnapshot = repository.loadRepositorySnapshot;
            if (loadRepositorySnapshot === undefined) {
              throw new Error("Review-state repository does not support repository-owner snapshot loading.");
            }
            return loadRepositorySnapshot.call(repository, repositoryId);
          },
          commitRepository: (transaction) => {
            const commitRepository = repository.commitRepository;
            if (commitRepository === undefined) {
              throw new Error("Review-state repository does not support repository-owner atomic commits.");
            }
            return commitRepository.call(repository, transaction);
          },
        },
        resolveUpdate: async (context, operationSignal) => {
          if (context.kind !== "pull-request" || context.pullRequest === undefined) return undefined;
          const identity = repositoryIdentity(context);
          const token = await auth.getAccessToken(identity.host, operationSignal);
          const latest = await fetchPullRequestLifecycle(identity, token, context.pullRequest.number, feedbackContext, operationSignal, operationCache);
          if (latest.kind !== "available") return undefined;
          return {
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
          };
        },
        prepareUpdate: (input, current) => contextStateService.prepareUpdate(input, current),
        prepareOwnerGlobal: async (currentGlobal, targetRevision, operationSignal) => {
          const current = gitContextResolver.resolve({
            repositoryId: owner.repositoryId,
            rootPath: owner.repositoryRoot,
            branch: owner.branchRef === undefined
              ? { kind: "detached" }
              : { kind: "branch", fullRef: owner.branchRef },
            head: targetRevision,
          });
          const reviewRangeConfiguration = vscode.workspace.getConfiguration("reviewRange");
          const prepared = await currentGlobalForNewPullRequest(
            { loadGlobal: async () => structuredClone(currentGlobal) },
            current,
            gitContextRevisionMapper,
            resolveReviewRangeMappingOptions({
              ignoreWhitespaceChanges: reviewRangeConfiguration.get("ignoreWhitespaceChanges", false),
              ignoreEolChanges: reviewRangeConfiguration.get("ignoreEolChanges", false),
            }),
            openedEncodingHints(owner.repositoryRoot),
          );
          if (operationSignal?.aborted === true) {
            throw new DOMException("PR synchronization was superseded.", "AbortError");
          }
          return prepared.nextGlobalState;
        },
        recordPreparedUpdateHistory: (prepared) => contextStateService.recordPreparedUpdateHistory(prepared),
      },
      signal,
    );
    return result.unavailableContextIds.length === 0;
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
    operationCache?: PullRequestLifecycleOperationCache,
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
      const latest = await fetchPullRequestLifecycle(identity, token, context.pullRequest.number, feedbackContext, signal, operationCache);
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
          // Only explicit owner synchronization can advance persisted ranges.
          // Tree, cache acquisition, progress and diff registration share this
          // pinned comparison even while the remote PR has advanced.
          baseSha: context.pullRequest.baseSha,
          headSha: context.pullRequest.headSha,
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
    synchronizeBeforeSearch = true,
  ): Promise<void> => {
    const lifecycleCache = pullRequestLifecycleOperationCaches.forOperation(feedbackContext);
    const detectionGeneration = ++pullRequestDetectionGeneration;
    const reportDetection = (
      stage: PullRequestRefreshStage,
      status: PullRequestRefreshStatus,
      details: { durationMs?: number; ordinal?: number; reasonCode?: PullRequestRefreshReasonCode } = {},
    ): void => reportActivePullRequestRefresh(feedbackContext, {
      generation: detectionGeneration,
      trigger: "pr-redetection",
      stage,
      status,
      ...details,
    });
    const timed = async <T>(stage: PullRequestRefreshStage, action: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      reportDetection(stage, "started");
      try {
        const value = await action();
        reportDetection(stage, "succeeded", { durationMs: Math.max(0, Date.now() - startedAt) });
        return value;
      } catch (error) {
        reportDetection(stage, signal?.aborted === true ? "cancelled" : "failed", {
          durationMs: Math.max(0, Date.now() - startedAt),
          reasonCode: signal?.aborted === true ? "superseded-by-newer-generation" : "refresh-failed",
        });
        throw error;
      }
    };
    const requestStartedAt = Date.now();
    reportDetection("refresh-request", "started");
    try {
    const isDetectionAborted = (): boolean => signal?.aborted === true;
    const assertDetectionCurrent = (): void => {
      if (isDetectionAborted()) throw new DOMException("PR detection was superseded.", "AbortError");
    };
    if (local.head === undefined || local.remote === undefined) {
      throw new Error("PR再検出にはHEADとGit remoteが必要です。");
    }
    const identity = parseGitHubRemote(local.remote.rawUrl);
    if (identity === undefined) throw new Error("GitHub remoteを解決できません。");
    const localHead = local.head;
    if (localHead === undefined) throw new Error("PR再検出にはHEADが必要です。");
    const pullRequestSynchronizationRevision = (await timed("repository-inspection", async () =>
      await options.git.resolveIdentityRemoteTrackingRevision(local, signal))) ?? localHead;
    assertDetectionCurrent();
    const persistedBefore = await timed("repository-inspection", () => repository.listRepositoryContexts(local.repositoryId));
    assertDetectionCurrent();
    let synchronizationCompleted = false;
    if (synchronizeBeforeSearch) {
      synchronizationCompleted = await timed("repository-sync", () => synchronizeRepository({
        repositoryId: local.repositoryId,
        repositoryRoot: local.rootPath,
        headRevision: localHead,
        pullRequestSynchronizationRevision,
        ...(local.branch.kind === "branch" ? { branchRef: local.branch.fullRef } : {}),
        snapshot: {
          context: { kind: "branch", label: "active", headRevision: localHead },
          progress: undefined,
        },
      }, persistedBefore, signal, feedbackContext, lifecycleCache));
      assertDetectionCurrent();
    }

    const token = await timed("authentication", () => auth.getAccessToken(identity.host, signal, true));
    assertDetectionCurrent();
    const resolver = new GitHubPullRequestContextResolver({
      chooseCandidate: async (candidates) => {
        const items = candidates.map((candidate) => ({
          label: `PR #${candidate.number}: ${candidate.title}`,
          description: candidate.url,
          candidate,
        }));
        const cancellation = new vscode.CancellationTokenSource();
        const disposeAbortSelection = linkAbortSignal(signal, () => cancellation.cancel());
        const selectionStartedAt = Date.now();
        reportDetection("candidate-selection", "started");
        try {
          const selected = await vscode.window.showQuickPick(
            items,
            { placeHolder: "現在HEADのPRを選択" },
            cancellation.token,
          );
          if (selected === undefined) {
            reportDetection("candidate-selection", "cancelled", {
              durationMs: Math.max(0, Date.now() - selectionStartedAt),
              reasonCode: signal?.aborted === true ? "superseded-by-newer-generation" : "quick-pick-cancelled",
            });
            return undefined;
          }
          reportDetection("candidate-selection", "succeeded", { durationMs: Math.max(0, Date.now() - selectionStartedAt) });
          return selected.candidate;
        } catch (error) {
          reportDetection("candidate-selection", signal?.aborted === true ? "cancelled" : "failed", {
            durationMs: Math.max(0, Date.now() - selectionStartedAt),
            reasonCode: signal?.aborted === true ? "superseded-by-newer-generation" : "refresh-failed",
          });
          throw error;
        } finally {
          disposeAbortSelection();
          cancellation.dispose();
        }
      },
    });
    const searchDiagnostic = (event: import("../../adapters/github/fetch-github-pull-request-adapter").GitHubPullRequestSearchPhaseDiagnostic): void => {
      reportDetection(event.stage, event.status === "failed" ? "failed" : event.status, {
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ordinal: event.ordinal,
        ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
      });
    };
    let search = await createPullRequestSearch(identity, token, searchDiagnostic, lifecycleCache.mergeBaseReads, lifecycleCache.mergeBaseResults, lifecycleCache.mergeBaseGeneration).findOpenByHead(identity, pullRequestSynchronizationRevision, signal);
    assertDetectionCurrent();
    if (
      token !== undefined &&
      search.kind === "unavailable" &&
      search.reason === "api" &&
      search.httpStatus === 404
    ) {
      const reselectedToken = await timed("authentication", () => auth.getAccessToken(identity.host, signal, true, true));
      assertDetectionCurrent();
      if (reselectedToken !== undefined) {
        clearPullRequestLifecycleOperationCache(lifecycleCache);
        search = await createPullRequestSearch(identity, reselectedToken, searchDiagnostic, lifecycleCache.mergeBaseReads, lifecycleCache.mergeBaseResults, lifecycleCache.mergeBaseGeneration).findOpenByHead(identity, pullRequestSynchronizationRevision, signal);
        assertDetectionCurrent();
      }
    }
    const resolution = await resolver.resolveSearchResult(search);
    assertDetectionCurrent();
    if (resolution.kind === "pull-request") {
      const state = pullRequestState(local.repositoryId, identity, resolution.pullRequest);
      let existing = await timed("context-save", () => contextStateService.load(local.repositoryId, pullRequestIdentity(state)));
      assertDetectionCurrent();
      if (existing !== undefined) {
        const detectedPullRequest = state.pullRequest!;
        const persistedPullRequest = existing.contextState.pullRequest;
        if (
          !synchronizationCompleted ||
          persistedPullRequest === undefined ||
          persistedPullRequest.baseSha !== detectedPullRequest.baseSha ||
          persistedPullRequest.headSha !== detectedPullRequest.headSha
        ) {
          synchronizationCompleted = await timed("repository-sync", () => synchronizeRepository({
            repositoryId: local.repositoryId,
            repositoryRoot: local.rootPath,
            headRevision: localHead,
            pullRequestSynchronizationRevision,
            ...(local.branch.kind === "branch" ? { branchRef: local.branch.fullRef } : {}),
            snapshot: {
              context: { kind: "branch", label: "active", headRevision: localHead },
              progress: undefined,
            },
          }, persistedBefore, signal, feedbackContext, lifecycleCache));
          assertDetectionCurrent();
          existing = await timed("context-save", () => contextStateService.load(local.repositoryId, pullRequestIdentity(state)));
          assertDetectionCurrent();
        }
        const synchronizedPullRequest = existing?.contextState.pullRequest;
        if (
          !synchronizationCompleted ||
          existing === undefined ||
          synchronizedPullRequest === undefined ||
          synchronizedPullRequest.baseSha !== detectedPullRequest.baseSha ||
          synchronizedPullRequest.headSha !== detectedPullRequest.headSha
        ) {
          throw new Error("Selected pull-request revision was not published by repository-owner synchronization.");
        }
      } else {
        // Authentication/search may have recovered after the initial lifecycle
        // read, or explicit selection may have skipped that read altogether.
        // Complete the whole owner boundary before publishing a new Context.
        if (!synchronizationCompleted) {
          synchronizationCompleted = await timed("repository-sync", () => synchronizeRepository({
            repositoryId: local.repositoryId,
            repositoryRoot: local.rootPath,
            headRevision: localHead,
            pullRequestSynchronizationRevision,
            ...(local.branch.kind === "branch" ? { branchRef: local.branch.fullRef } : {}),
            snapshot: {
              context: { kind: "branch", label: "active", headRevision: localHead },
              progress: undefined,
            },
          }, persistedBefore, signal, feedbackContext, lifecycleCache));
          assertDetectionCurrent();
        }
        if (!synchronizationCompleted) {
          throw new Error("Repository-owner synchronization must complete before creating a new pull-request context.");
        }

        const current = gitContextResolver.resolve({
          repositoryId: local.repositoryId,
          rootPath: local.rootPath,
          branch: local.branch,
          head: pullRequestSynchronizationRevision,
        });
        const reviewRangeConfiguration = vscode.workspace.getConfiguration("reviewRange");
        const preparedGlobal = await timed("global-state-preparation", () => currentGlobalForNewPullRequest(
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
        ));
        assertDetectionCurrent();
        await timed("context-save", () => contextStateService.create(
          { contextState: state, globalState: preparedGlobal.nextGlobalState },
          preparedGlobal.expectedGlobalState,
          signal,
        ));
      }
      assertDetectionCurrent();
      await currentPullRequestSelection.select(
        local.repositoryId,
        local.head,
        state.contextId,
      );
    } else {
      assertDetectionCurrent();
      await currentPullRequestSelection.selectBranch(local.repositoryId, local.head);
      if (search.kind === "unavailable") {
        reportActiveOperationFailure(
          "PRを再検出",
          new OperationDiagnosticError({code: "GITHUB_PR_DETECTION_UNAVAILABLE", reason: search.reason}),
          feedbackContext,
        );
      }
    }
    reportDetection("refresh-request", "succeeded", { durationMs: Math.max(0, Date.now() - requestStartedAt) });
    } catch (error) {
      reportDetection("refresh-request", signal?.aborted === true ? "cancelled" : "failed", {
        durationMs: Math.max(0, Date.now() - requestStartedAt),
        reasonCode: signal?.aborted === true ? "superseded-by-newer-generation" : "refresh-failed",
      });
      throw error;
    }
  };

  const preparePullRequestCandidateForExplicitContextSelection = async (
    signal?: AbortSignal,
    feedbackContext?: OperationFeedbackContext,
  ): Promise<void> => {
    const isSelectionAborted = (): boolean => signal?.aborted === true;
    if (isSelectionAborted()) throw new DOMException("Current Context selection was superseded.", "AbortError");
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
    const pullRequestSynchronizationRevision = await options.git.resolveIdentityRemoteTrackingRevision(local, signal) ?? local.head;
    if (isSelectionAborted()) throw new DOMException("Current Context selection was superseded.", "AbortError");
    const persisted = await repository.listRepositoryContexts(local.repositoryId);
    const current = findCurrentPullRequestContext(
      persisted,
      local.repositoryId,
      pullRequestSynchronizationRevision,
      currentPullRequestSelection.read(local.repositoryId, local.head),
      currentPullRequestSelection.prefersBranch(local.repositoryId, local.head),
    );
    if (current !== undefined) return;
    await detectPullRequest(local, feedbackContext, signal, false);
  };

  let activeRedetection: {
    readonly requestHint: string | undefined;
    repositoryGeneration?: string;
    phase: "repository-inspection" | "detection";
    readonly cancellation: AbortController;
    promise: Promise<PullRequestRedetectionDisposition>;
  } | undefined;
  const repositoryGeneration = (local: LocalGitRepository): string => JSON.stringify([
    local.repositoryId,
    local.rootPath,
    local.head ?? null,
    local.branch.kind === "branch" ? local.branch.fullRef : "detached",
    local.remote?.rawUrl ?? null,
  ]);
  const redetectPullRequest = async (
    feedbackContext?: OperationFeedbackContext,
    externalSignal?: AbortSignal,
  ): Promise<PullRequestRedetectionDisposition> => {
    if (externalSignal?.aborted === true) throw new DOMException("PR detection was superseded.", "AbortError");
    const requestHint = vscode.window.activeTextEditor?.document.uri.toString(true);
    let preInspectedRepository: LocalGitRepository | undefined;
    if (
      requestHint !== undefined &&
      activeRedetection?.phase === "detection" &&
      activeRedetection.requestHint === requestHint &&
      !activeRedetection.cancellation.signal.aborted
    ) {
      const observed = await inspectActiveRepository();
      if (externalSignal !== undefined && externalSignal.aborted) {
        throw new DOMException("PR detection was superseded.", "AbortError");
      }
      preInspectedRepository = observed;
      const latest = activeRedetection;
      if (
        latest?.phase === "detection" &&
        latest.requestHint === requestHint &&
        !latest.cancellation.signal.aborted &&
        latest.repositoryGeneration === repositoryGeneration(observed)
      ) {
        reportActivePullRequestRefresh(feedbackContext, {
          generation: pullRequestDetectionGeneration,
          trigger: "pr-redetection",
          stage: "refresh-request",
          status: "coalesced",
          reasonCode: "duplicate-trigger-coalesced",
        });
        await latest.promise;
        return "coalesced";
      }
    }
    activeRedetection?.cancellation.abort();
    const cancellation = new AbortController();
    const abort = (): void => cancellation.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    const record: {
      readonly requestHint: string | undefined;
      repositoryGeneration?: string;
      phase: "repository-inspection" | "detection";
      readonly cancellation: AbortController;
      promise: Promise<PullRequestRedetectionDisposition>;
    } = {
      requestHint,
      phase: "repository-inspection",
      cancellation,
      promise: Promise.resolve("completed"),
    };
    activeRedetection = record;
    const waitForActiveRequest = <T>(work: Promise<T>): Promise<T> => {
      const signal = cancellation.signal;
      if (signal.aborted) return Promise.reject(new DOMException("PR detection was superseded.", "AbortError"));
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          reject(new DOMException("PR detection was superseded.", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        work.then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    };
    record.promise = (async (): Promise<PullRequestRedetectionDisposition> => {
      const local = await waitForActiveRequest(
        preInspectedRepository === undefined ? inspectActiveRepository() : Promise.resolve(preInspectedRepository),
      );
      if (activeRedetection !== record || cancellation.signal.aborted) {
        throw new DOMException("PR detection was superseded.", "AbortError");
      }
      record.repositoryGeneration = repositoryGeneration(local);
      record.phase = "detection";
      await detectPullRequest(local, feedbackContext, cancellation.signal);
      return "completed";
    })().finally(() => {
      externalSignal?.removeEventListener("abort", abort);
      if (activeRedetection === record) activeRedetection = undefined;
    });
    return record.promise;
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
    redetectPullRequest,
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
    refreshCurrentContext: options.refreshCurrentContext,
    reportError: async (error) => {
      await vscode.window.showErrorMessage(
        `Review Contexts操作に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  return {
    ...registered,
    acceptCurrentContextPreparation: (selection) => source.acceptCurrentContextPreparation(selection),
    preparePullRequestCandidateForExplicitContextSelection,
    augmentCurrentContextCandidates: (localCandidates, signal, feedbackContext) =>
      source.augmentCurrentContextCandidates(localCandidates, signal,feedbackContext),
    getCancellationSnapshotForTest: async () => ({
      providerProjection: (registered.getProjectionSnapshotForTest?.() ?? []).map((item) => item.context.contextId),
      authoritativeContextCounts: await Promise.all(source.repositoryIds().map(async (repositoryId) => ({
        repositoryId,
        count: (await repository.listRepositoryContexts(repositoryId)).length,
      }))),
    }),
    workspaceUriToFilesystemPathForTest: (uri) => workspaceFilesystemPath(uri),
    getProjectionGenerationCountForTest: () => source.projectionGenerationCountForTest(),
  };
}

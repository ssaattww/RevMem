import {
  DocumentReviewStateSessionProvider as BaseProvider,
  type DocumentEditorReviewDescriptor,
  type DocumentNormalEditorDecorationState,
  type DocumentNormalEditorReviewStateSession,
  type DocumentReviewOwner,
  type DocumentReviewStateRepository,
  type DocumentReviewStateSessionProviderOptions
} from "./document-review-state-session-provider";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget
} from "../state-repository/index";
import {
  type WorkspaceEditorReviewDescriptor,
  type WorkspaceNormalEditorDecorationState,
  WorkspaceReviewStateSessionProvider
} from "../workspace-review-state/index";
import type {
  LineInterval,
  OwnerReconciliationSourceSnapshot,
  ReconciledReviewContextState,
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import {
  normalizeLineIntervals,
  subtractLineIntervals
} from "../../core/intervals/index";
import {
  markReviewedRanges,
  unmarkReviewedRanges,
  type ReviewStateFileTarget,
  type ReviewStateTransaction
} from "../../core/review-state/index";

interface Plan {
  readonly contextState: ReconciledReviewContextState;
  readonly globalState: RepositoryGlobalState;
  readonly changed: boolean;
  readonly protectedReviewed: readonly LineInterval[];
  readonly protectedUnreviewed: readonly LineInterval[];
}

const clone = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const nonRepositoryInspector = {
  inspectRepository: async () => ({
    kind: "not-repository" as const,
    gitVersion: "fallback-reader"
  })
};

const reviewed = (state: DocumentNormalEditorDecorationState): LineInterval[] => {
  const contextFile = state.contextState.files[state.target.fileId];
  const globalFile = state.globalState.files[state.target.fileId];
  return normalizeLineIntervals([
    ...(contextFile?.modifiedReviewed ?? []),
    ...(globalFile?.reviewed ?? [])
  ]);
};

const newest = (values: readonly (string | undefined)[]): string | undefined =>
  values.filter((value): value is string => value !== undefined).sort().at(-1);

const sameIntervals = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): boolean => {
  const a = normalizeLineIntervals(left);
  const b = normalizeLineIntervals(right);
  return a.length === b.length && a.every((value, index) => {
    const other = b[index];
    return other !== undefined &&
      value.startLine === other.startLine &&
      value.endLineExclusive === other.endLineExclusive;
  });
};

const sameSnapshot = (
  left: OwnerReconciliationSourceSnapshot,
  right: OwnerReconciliationSourceSnapshot
): boolean =>
  left.sourceOwner === right.sourceOwner &&
  left.sourceRepositoryId === right.sourceRepositoryId &&
  left.sourceContextId === right.sourceContextId &&
  left.sourceFileId === right.sourceFileId &&
  left.contentHash === right.contentHash &&
  left.lineCount === right.lineCount &&
  left.sourceCreatedAt === right.sourceCreatedAt &&
  left.sourceUpdatedAt === right.sourceUpdatedAt &&
  sameIntervals(left.reviewed, right.reviewed);

const laterThan = (left: string, right: string | undefined): boolean => {
  if (right === undefined) {
    return true;
  }
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime > rightTime;
};

class CapturingRepository implements DocumentReviewStateRepository {
  private captured: ReviewStateTransaction | undefined;
  private readonly loaded = new Map<string, ReviewStateCommit | undefined>();

  public constructor(private readonly delegate: DocumentReviewStateRepository) {}

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const key = this.key(target);
    if (!this.loaded.has(key)) {
      const value = await this.delegate.load(target);
      this.loaded.set(key, value === undefined ? undefined : clone(value));
    }
    const value = this.loaded.get(key);
    return value === undefined ? undefined : clone(value);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    await this.delegate.save(target, commit);
    const persisted = await this.delegate.load(target);
    this.loaded.set(
      this.key(target),
      persisted === undefined ? clone(commit) : clone(persisted)
    );
  }

  public async commit(transaction: Readonly<ReviewStateTransaction>): Promise<void> {
    if (this.captured !== undefined) {
      throw new Error("Document owner initialization attempted more than one promotion commit.");
    }
    this.captured = clone(transaction);
  }

  public capturedTransaction(): ReviewStateTransaction | undefined {
    return this.captured === undefined ? undefined : clone(this.captured);
  }

  private key(target: ReviewStateRepositoryTarget): string {
    return `${target.kind}\0${target.repositoryId}\0${target.contextId}`;
  }
}

/** Routes and reconciles document review state with one observation per lower owner. */
export class DocumentReviewStateSessionProvider {
  private readonly decorationProvider: BaseProvider;
  private readonly now: () => Date;

  /** Creates a provider that applies lower-owner migration only through one complete-snapshot reconciliation commit. */
  public constructor(
    private readonly options: DocumentReviewStateSessionProviderOptions
  ) {
    this.decorationProvider = new BaseProvider(options);
    this.now = options.now ?? (() => new Date());
  }

  /** Opens the routed owner and reconciles eligible lower-owner ranges without observing any source more than once. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const repository = new CapturingRepository(this.options.repository);
    const workspaceProvider = this.cachingWorkspaceProvider(repository);
    const baseProvider = new BaseProvider({
      ...this.options,
      repository,
      workspaceProvider
    });
    const externalReader = new BaseProvider({
      ...this.options,
      repository,
      workspaceProvider,
      gitInspector: nonRepositoryInspector
    });
    const opened = await baseProvider.open(descriptor);
    const persisted = await repository.load(this.repositoryTarget(opened));
    const target: DocumentNormalEditorReviewStateSession = {
      ...opened,
      ...(persisted === undefined
        ? {}
        : {
            contextState: clone(persisted.contextState),
            globalState: clone(persisted.globalState)
          }),
      committer: this.options.repository
    };
    const sources = await this.lowerSources(
      target.owner,
      descriptor,
      workspaceProvider,
      externalReader
    );
    return this.reconcile(target, sources, repository.capturedTransaction());
  }

  /** Loads routed decoration state without triggering reconciliation or persistence. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.decorationProvider.loadForDecoration(descriptor);
  }

  private repositoryTarget(
    session: DocumentNormalEditorReviewStateSession
  ): ReviewStateRepositoryTarget {
    return {
      kind: session.owner === "git" ? "git" : session.owner,
      repositoryId: session.contextState.repositoryId,
      contextId: session.contextState.contextId
    };
  }

  private cachingWorkspaceProvider(
    repository: CapturingRepository
  ): WorkspaceReviewStateSessionProvider {
    const delegate = this.options.workspaceProvider;
    const cache = new Map<string, WorkspaceNormalEditorDecorationState | undefined>();
    return {
      open: async (descriptor: WorkspaceEditorReviewDescriptor) => ({
        ...(await delegate.open(descriptor)),
        committer: repository
      }),
      loadForDecoration: async (descriptor: WorkspaceEditorReviewDescriptor) => {
        const key = JSON.stringify(descriptor);
        if (!cache.has(key)) {
          const value = await delegate.loadForDecoration(descriptor);
          cache.set(key, value === undefined ? undefined : clone(value));
        }
        const value = cache.get(key);
        return value === undefined ? undefined : clone(value);
      }
    } as unknown as WorkspaceReviewStateSessionProvider;
  }

  private async lowerSources(
    owner: DocumentReviewOwner,
    descriptor: DocumentEditorReviewDescriptor,
    workspaceProvider: WorkspaceReviewStateSessionProvider,
    externalReader: BaseProvider
  ): Promise<readonly (DocumentNormalEditorDecorationState | undefined)[]> {
    if (owner === "external-file") {
      return [];
    }
    const external = await externalReader.loadForDecoration({
      documentUri: descriptor.documentUri,
      documentFsPath: descriptor.documentFsPath,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      lineCount: descriptor.lineCount,
      contentHash: descriptor.contentHash
    });
    if (owner === "workspace") {
      return [external];
    }
    const workspace = descriptor.workspace;
    if (workspace === undefined) {
      return [undefined, external];
    }
    const state = await workspaceProvider.loadForDecoration({
      workspaceFolderUri: workspace.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: workspace.relativePath,
      workspaceDisplayName: workspace.displayName,
      lineCount: descriptor.lineCount,
      contentHash: descriptor.contentHash
    });
    return [
      state === undefined
        ? undefined
        : {
            owner: "workspace",
            contextState: clone(state.contextState),
            globalState: clone(state.globalState),
            target: { ...state.target }
          },
      external
    ];
  }

  private async reconcile(
    target: DocumentNormalEditorReviewStateSession,
    sources: readonly (DocumentNormalEditorDecorationState | undefined)[],
    promotion: ReviewStateTransaction | undefined
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const occurredAt = this.now().toISOString();
    let plan: Plan = {
      contextState: clone<ReconciledReviewContextState>(target.contextState),
      globalState: clone(target.globalState),
      changed: promotion !== undefined,
      protectedReviewed: [],
      protectedUnreviewed: []
    };
    for (const source of sources) {
      if (source !== undefined && source.owner !== "git") {
        plan = this.planSource(target.target, plan, source, occurredAt);
      }
    }
    if (!plan.changed) {
      return target;
    }
    const transaction: ReviewStateTransaction = {
      operation: promotion?.operation ?? "mark-ranges-reviewed",
      repositoryId: target.contextState.repositoryId,
      contextId: target.contextState.contextId,
      fileId: target.target.fileId,
      expected: {
        contextState: clone(target.contextState),
        globalState: clone(target.globalState)
      },
      next: {
        contextState: clone(plan.contextState),
        globalState: clone(plan.globalState)
      }
    };
    await this.options.repository.commit(transaction);
    return {
      ...target,
      contextState: clone(plan.contextState),
      globalState: clone(plan.globalState),
      committer: this.options.repository
    };
  }

  private planSource(
    target: ReviewStateFileTarget,
    current: Plan,
    source: DocumentNormalEditorDecorationState,
    occurredAt: string
  ): Plan {
    if (source.owner === "git" ||
        source.target.contentHash !== target.contentHash ||
        source.target.lineCount !== target.lineCount) {
      return current;
    }
    const sourceReviewed = reviewed(source);
    const sourceContextFile = source.contextState.files[source.target.fileId];
    const sourceGlobalFile = source.globalState.files[source.target.fileId];
    const targetReviewed = reviewed({
      owner: "git",
      contextState: current.contextState,
      globalState: current.globalState,
      target
    });
    const key = this.sourceKey(source);
    const baseline = current.contextState.ownerReconciliation?.[key];
    const matching = baseline !== undefined &&
      baseline.sourceOwner === source.owner &&
      baseline.sourceRepositoryId === source.contextState.repositoryId &&
      baseline.sourceContextId === source.contextState.contextId &&
      baseline.sourceFileId === source.target.fileId &&
      baseline.contentHash === source.target.contentHash &&
      baseline.lineCount === source.target.lineCount &&
      baseline.sourceCreatedAt === source.contextState.createdAt;

    let additions: LineInterval[] = [];
    let removals: LineInterval[] = [];
    if (matching) {
      additions = subtractLineIntervals(sourceReviewed, baseline.reviewed);
      removals = subtractLineIntervals(baseline.reviewed, sourceReviewed);
    } else if (targetReviewed.length === 0) {
      additions = sourceReviewed;
    } else if (!sameIntervals(sourceReviewed, targetReviewed)) {
      const targetContextFile = current.contextState.files[target.fileId];
      const targetGlobalFile = current.globalState.files[target.fileId];
      if (laterThan(source.contextState.createdAt, newest([
        targetContextFile?.updatedAt,
        targetGlobalFile?.updatedAt
      ]))) {
        additions = subtractLineIntervals(sourceReviewed, targetReviewed);
      }
    }

    const explicitRemovals = removals;
    additions = subtractLineIntervals(additions, current.protectedUnreviewed);
    removals = subtractLineIntervals(removals, current.protectedReviewed);
    const protectedReviewed = normalizeLineIntervals([
      ...current.protectedReviewed,
      ...subtractLineIntervals(sourceReviewed, current.protectedUnreviewed)
    ]);
    const protectedUnreviewed = normalizeLineIntervals([
      ...current.protectedUnreviewed,
      ...subtractLineIntervals(explicitRemovals, current.protectedReviewed)
    ]);
    const snapshot: OwnerReconciliationSourceSnapshot = {
      sourceOwner: source.owner,
      sourceRepositoryId: source.contextState.repositoryId,
      sourceContextId: source.contextState.contextId,
      sourceFileId: source.target.fileId,
      ...(source.target.contentHash === undefined
        ? {}
        : { contentHash: source.target.contentHash }),
      lineCount: source.target.lineCount,
      reviewed: sourceReviewed.map((interval) => ({ ...interval })),
      sourceCreatedAt: source.contextState.createdAt,
      sourceUpdatedAt: newest([
        sourceContextFile?.updatedAt,
        sourceGlobalFile?.updatedAt
      ]) ?? source.contextState.updatedAt
    };
    if (additions.length === 0 && removals.length === 0 &&
        baseline !== undefined && sameSnapshot(baseline, snapshot)) {
      return { ...current, protectedReviewed, protectedUnreviewed };
    }
    const states = this.applyDelta(
      current.contextState,
      current.globalState,
      target,
      additions,
      removals,
      occurredAt
    );
    return {
      contextState: {
        ...clone(states.contextState),
        ownerReconciliation: {
          ...(current.contextState.ownerReconciliation ?? {}),
          [key]: snapshot
        },
        updatedAt: occurredAt
      },
      globalState: clone(states.globalState),
      changed: true,
      protectedReviewed,
      protectedUnreviewed
    };
  }

  private applyDelta(
    contextState: ReviewContextState,
    globalState: RepositoryGlobalState,
    target: ReviewStateFileTarget,
    additions: readonly LineInterval[],
    removals: readonly LineInterval[],
    occurredAt: string
  ): { readonly contextState: ReviewContextState; readonly globalState: RepositoryGlobalState } {
    let context = clone<ReviewContextState>(contextState);
    let global = clone<RepositoryGlobalState>(globalState);
    if (removals.length > 0) {
      const transaction = unmarkReviewedRanges({
        contextState: context,
        globalState: global,
        target,
        intervals: removals,
        occurredAt
      });
      context = clone<ReviewContextState>(transaction.next.contextState);
      global = clone<RepositoryGlobalState>(transaction.next.globalState);
    }
    if (additions.length > 0) {
      const transaction = markReviewedRanges({
        contextState: context,
        globalState: global,
        target,
        intervals: additions,
        occurredAt
      });
      context = clone<ReviewContextState>(transaction.next.contextState);
      global = clone<RepositoryGlobalState>(transaction.next.globalState);
    }
    return { contextState: context, globalState: global };
  }

  private sourceKey(source: DocumentNormalEditorDecorationState): string {
    return `owner-source:${this.options.stableHash.digest([
      "owner-reconciliation-source",
      source.owner,
      source.contextState.repositoryId,
      source.contextState.contextId,
      source.target.fileId
    ].join("\0"))}`;
  }
}

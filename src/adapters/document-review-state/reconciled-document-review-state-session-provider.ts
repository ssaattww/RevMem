import {
  DocumentReviewStateSessionProvider as BaseDocumentReviewStateSessionProvider,
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

interface OwnerSourceSnapshot {
  readonly sourceOwner: Exclude<DocumentReviewOwner, "git">;
  readonly sourceRepositoryId: string;
  readonly sourceContextId: string;
  readonly sourceFileId: string;
  readonly contentHash?: string;
  readonly lineCount: number;
  readonly reviewed: readonly LineInterval[];
  readonly sourceCreatedAt: string;
  readonly sourceUpdatedAt: string;
}

interface ReconciledReviewContextState extends ReviewContextState {
  readonly ownerReconciliation?: Readonly<Record<string, OwnerSourceSnapshot>>;
}

interface PlannedReconciliationState {
  readonly contextState: ReconciledReviewContextState;
  readonly globalState: RepositoryGlobalState;
  readonly changed: boolean;
}

const cloneValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const nonRepositoryInspector = {
  inspectRepository: async () => ({
    kind: "not-repository" as const,
    gitVersion: "fallback-reader"
  })
};

const normalizedReviewed = (
  state: DocumentNormalEditorDecorationState
): LineInterval[] => {
  const contextFile = state.contextState.files[state.target.fileId];
  const globalFile = state.globalState.files[state.target.fileId];
  return normalizeLineIntervals([
    ...(contextFile?.modifiedReviewed ?? []),
    ...(globalFile?.reviewed ?? [])
  ]);
};

const newestTimestamp = (
  values: readonly (string | undefined)[]
): string | undefined => values
  .filter((value): value is string => value !== undefined)
  .sort()
  .at(-1);

const sameIntervals = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): boolean => {
  const normalizedLeft = normalizeLineIntervals(left);
  const normalizedRight = normalizeLineIntervals(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((interval, index) => {
      const candidate = normalizedRight[index];
      return candidate !== undefined &&
        interval.startLine === candidate.startLine &&
        interval.endLineExclusive === candidate.endLineExclusive;
    });
};

const sameSourceSnapshot = (
  left: OwnerSourceSnapshot,
  right: OwnerSourceSnapshot
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

/**
 * Captures the base provider's initial promotion transaction without publishing it.
 * Initialization and stale-state sanitization still delegate to the real repository.
 */
class CapturingDocumentReviewStateRepository
implements DocumentReviewStateRepository {
  private capturedTransaction: ReviewStateTransaction | undefined;

  public constructor(
    private readonly delegate: DocumentReviewStateRepository
  ) {}

  public load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    return this.delegate.load(target);
  }

  public save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    return this.delegate.save(target, commit);
  }

  public async commit(
    transaction: Readonly<ReviewStateTransaction>
  ): Promise<void> {
    if (this.capturedTransaction !== undefined) {
      throw new Error(
        "Document owner initialization attempted more than one promotion commit."
      );
    }
    this.capturedTransaction = cloneValue(transaction) as ReviewStateTransaction;
  }

  public getCapturedTransaction(): ReviewStateTransaction | undefined {
    return this.capturedTransaction === undefined
      ? undefined
      : cloneValue(this.capturedTransaction) as ReviewStateTransaction;
  }
}

/**
 * Adds owner-recovery reconciliation to the base document router.
 *
 * The base provider still resolves ownership, initializes target storage, and sanitizes
 * stale target state. Any initial lower-owner promotion is captured in memory. All source
 * deltas and baseline metadata are then committed together in one real CAS transaction.
 */
export class DocumentReviewStateSessionProvider {
  private readonly readProvider: BaseDocumentReviewStateSessionProvider;
  private readonly externalReader: BaseDocumentReviewStateSessionProvider;
  private readonly now: () => Date;

  public constructor(
    private readonly options: DocumentReviewStateSessionProviderOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.readProvider = new BaseDocumentReviewStateSessionProvider(options);
    this.externalReader = new BaseDocumentReviewStateSessionProvider({
      ...options,
      gitInspector: nonRepositoryInspector
    });
  }

  /** Opens the active owner and publishes all certain source changes atomically. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const capturingRepository = new CapturingDocumentReviewStateRepository(
      this.options.repository
    );
    const baseProvider = new BaseDocumentReviewStateSessionProvider({
      ...this.options,
      repository: capturingRepository,
      workspaceProvider: this.capturingWorkspaceProvider(capturingRepository)
    });
    const openedSession = await baseProvider.open(descriptor);
    const targetSession: DocumentNormalEditorReviewStateSession = {
      ...openedSession,
      committer: this.options.repository
    };
    const sources = await this.loadLowerOwnerSources(
      targetSession.owner,
      descriptor
    );
    return this.reconcileCertainSources(
      targetSession,
      sources,
      capturingRepository.getCapturedTransaction()
    );
  }

  /** Keeps decoration reads non-mutating. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.readProvider.loadForDecoration(descriptor);
  }

  private capturingWorkspaceProvider(
    capturingRepository: CapturingDocumentReviewStateRepository
  ): WorkspaceReviewStateSessionProvider {
    const delegate = this.options.workspaceProvider;
    return {
      open: async (descriptor: WorkspaceEditorReviewDescriptor) => {
        const session = await delegate.open(descriptor);
        return {
          ...session,
          committer: capturingRepository
        };
      },
      loadForDecoration: (descriptor: WorkspaceEditorReviewDescriptor) =>
        delegate.loadForDecoration(descriptor)
    } as unknown as WorkspaceReviewStateSessionProvider;
  }

  private async loadLowerOwnerSources(
    targetOwner: DocumentReviewOwner,
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<readonly (DocumentNormalEditorDecorationState | undefined)[]> {
    if (targetOwner === "external-file") {
      return [];
    }

    const externalSource = await this.externalReader.loadForDecoration(
      this.externalDescriptor(descriptor)
    );
    if (targetOwner === "workspace") {
      return [externalSource];
    }

    return [
      await this.loadWorkspaceSource(descriptor),
      externalSource
    ];
  }

  private externalDescriptor(
    descriptor: DocumentEditorReviewDescriptor
  ): DocumentEditorReviewDescriptor {
    return {
      documentUri: descriptor.documentUri,
      documentFsPath: descriptor.documentFsPath,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      lineCount: descriptor.lineCount,
      contentHash: descriptor.contentHash
    };
  }

  private async loadWorkspaceSource(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    const workspace = descriptor.workspace;
    if (workspace === undefined) {
      return undefined;
    }

    const state = await this.options.workspaceProvider.loadForDecoration(
      this.toWorkspaceDescriptor(descriptor, workspace)
    );
    return state === undefined
      ? undefined
      : this.workspaceDecorationState(state);
  }

  private toWorkspaceDescriptor(
    descriptor: DocumentEditorReviewDescriptor,
    workspace: NonNullable<DocumentEditorReviewDescriptor["workspace"]>
  ): WorkspaceEditorReviewDescriptor {
    return {
      workspaceFolderUri: workspace.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: workspace.relativePath,
      workspaceDisplayName: workspace.displayName,
      lineCount: descriptor.lineCount,
      contentHash: descriptor.contentHash
    };
  }

  private workspaceDecorationState(
    state: WorkspaceNormalEditorDecorationState
  ): DocumentNormalEditorDecorationState {
    return {
      owner: "workspace",
      contextState: cloneValue(state.contextState),
      globalState: cloneValue(state.globalState),
      target: { ...state.target }
    };
  }

  private async reconcileCertainSources(
    targetSession: DocumentNormalEditorReviewStateSession,
    sources: readonly (DocumentNormalEditorDecorationState | undefined)[],
    capturedPromotion: ReviewStateTransaction | undefined
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const occurredAt = this.now().toISOString();
    let planned: PlannedReconciliationState = {
      contextState: cloneValue(targetSession.contextState) as ReconciledReviewContextState,
      globalState: cloneValue(targetSession.globalState) as RepositoryGlobalState,
      changed: capturedPromotion !== undefined
    };

    for (const source of sources) {
      if (source === undefined || source.owner === "git") {
        continue;
      }
      planned = this.planCertainSource(
        targetSession.target,
        planned,
        source,
        occurredAt
      );
    }

    if (!planned.changed) {
      return targetSession;
    }

    const expectedContextState = capturedPromotion === undefined
      ? targetSession.contextState
      : capturedPromotion.expected.contextState;
    const expectedGlobalState = capturedPromotion === undefined
      ? targetSession.globalState
      : capturedPromotion.expected.globalState;
    const finalTransaction: ReviewStateTransaction = {
      operation: capturedPromotion?.operation ?? "mark-ranges-reviewed",
      repositoryId: targetSession.contextState.repositoryId,
      contextId: targetSession.contextState.contextId,
      fileId: targetSession.target.fileId,
      expected: {
        contextState: cloneValue(expectedContextState) as ReviewContextState,
        globalState: cloneValue(expectedGlobalState) as RepositoryGlobalState
      },
      next: {
        contextState: cloneValue(planned.contextState) as ReviewContextState,
        globalState: cloneValue(planned.globalState) as RepositoryGlobalState
      }
    };

    await this.options.repository.commit(finalTransaction);
    return {
      ...targetSession,
      contextState: cloneValue(planned.contextState) as ReviewContextState,
      globalState: cloneValue(planned.globalState) as RepositoryGlobalState,
      committer: this.options.repository
    };
  }

  private planCertainSource(
    target: ReviewStateFileTarget,
    current: PlannedReconciliationState,
    source: DocumentNormalEditorDecorationState,
    occurredAt: string
  ): PlannedReconciliationState {
    if (source.owner === "git") {
      return current;
    }
    if (
      source.target.contentHash !== target.contentHash ||
      source.target.lineCount !== target.lineCount
    ) {
      return current;
    }

    const sourceContextFile = source.contextState.files[source.target.fileId];
    const sourceGlobalFile = source.globalState.files[source.target.fileId];
    const sourceReviewed = normalizedReviewed(source);
    const targetState: DocumentNormalEditorDecorationState = {
      owner: "git",
      contextState: current.contextState,
      globalState: current.globalState,
      target
    };
    const targetReviewed = normalizedReviewed(targetState);
    const sourceKey = this.sourceKey(source);
    const baseline = current.contextState.ownerReconciliation?.[sourceKey];
    const matchingBaseline = baseline !== undefined &&
      baseline.sourceOwner === source.owner &&
      baseline.sourceRepositoryId === source.contextState.repositoryId &&
      baseline.sourceContextId === source.contextState.contextId &&
      baseline.sourceFileId === source.target.fileId &&
      baseline.contentHash === source.target.contentHash &&
      baseline.lineCount === source.target.lineCount;

    let additions: LineInterval[] = [];
    let removals: LineInterval[] = [];
    if (matchingBaseline) {
      additions = subtractLineIntervals(sourceReviewed, baseline.reviewed);
      removals = subtractLineIntervals(baseline.reviewed, sourceReviewed);
    } else if (targetReviewed.length === 0) {
      additions = sourceReviewed;
    } else if (!sameIntervals(sourceReviewed, targetReviewed)) {
      const targetContextFile = current.contextState.files[target.fileId];
      const targetGlobalFile = current.globalState.files[target.fileId];
      const targetUpdatedAt = newestTimestamp([
        targetContextFile?.updatedAt,
        targetGlobalFile?.updatedAt
      ]);
      if (laterThan(source.contextState.createdAt, targetUpdatedAt)) {
        additions = subtractLineIntervals(sourceReviewed, targetReviewed);
      }
    }

    const nextSnapshot: OwnerSourceSnapshot = {
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
      sourceUpdatedAt: newestTimestamp([
        sourceContextFile?.updatedAt,
        sourceGlobalFile?.updatedAt
      ]) ?? source.contextState.updatedAt
    };

    if (
      additions.length === 0 &&
      removals.length === 0 &&
      baseline !== undefined &&
      sameSourceSnapshot(baseline, nextSnapshot)
    ) {
      return current;
    }

    const afterIntervals = this.applyIntervalDelta(
      current.contextState,
      current.globalState,
      target,
      additions,
      removals,
      occurredAt
    );
    const finalContextState: ReconciledReviewContextState = {
      ...cloneValue(afterIntervals.contextState),
      ownerReconciliation: {
        ...(current.contextState.ownerReconciliation ?? {}),
        [sourceKey]: nextSnapshot
      },
      updatedAt: occurredAt
    };

    return {
      contextState: finalContextState,
      globalState: cloneValue(afterIntervals.globalState) as RepositoryGlobalState,
      changed: true
    };
  }

  private applyIntervalDelta(
    contextState: ReviewContextState,
    globalState: RepositoryGlobalState,
    target: ReviewStateFileTarget,
    additions: readonly LineInterval[],
    removals: readonly LineInterval[],
    occurredAt: string
  ): {
    readonly contextState: ReviewContextState;
    readonly globalState: RepositoryGlobalState;
  } {
    let nextContextState = cloneValue(contextState) as ReviewContextState;
    let nextGlobalState = cloneValue(globalState) as RepositoryGlobalState;

    if (removals.length > 0) {
      const removal = unmarkReviewedRanges({
        contextState: nextContextState,
        globalState: nextGlobalState,
        target,
        intervals: removals,
        occurredAt
      });
      nextContextState = cloneValue(removal.next.contextState) as ReviewContextState;
      nextGlobalState = cloneValue(removal.next.globalState) as RepositoryGlobalState;
    }

    if (additions.length > 0) {
      const addition = markReviewedRanges({
        contextState: nextContextState,
        globalState: nextGlobalState,
        target,
        intervals: additions,
        occurredAt
      });
      nextContextState = cloneValue(addition.next.contextState) as ReviewContextState;
      nextGlobalState = cloneValue(addition.next.globalState) as RepositoryGlobalState;
    }

    return {
      contextState: nextContextState,
      globalState: nextGlobalState
    };
  }

  private sourceKey(source: DocumentNormalEditorDecorationState): string {
    const digest = this.options.stableHash.digest([
      "owner-reconciliation-source",
      source.owner,
      source.contextState.repositoryId,
      source.contextState.contextId,
      source.target.fileId
    ].join("\0"));
    return `owner-source:${digest}`;
  }
}

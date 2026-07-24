import {
  DocumentReviewStateSessionProvider as BaseDocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor,
  type DocumentNormalEditorDecorationState,
  type DocumentNormalEditorReviewStateSession,
  type DocumentReviewOwner,
  type DocumentReviewStateSessionProviderOptions
} from "./document-review-state-session-provider";
import type {
  WorkspaceEditorReviewDescriptor,
  WorkspaceNormalEditorDecorationState
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
 * Adds owner-recovery reconciliation to the base document router.
 *
 * The base provider remains responsible for ownership, identity, revision certainty,
 * initialization, and read-only decoration loading. This provider records the last
 * certain lower-owner snapshot in the active context and applies only the later delta.
 */
export class DocumentReviewStateSessionProvider {
  private readonly baseProvider: BaseDocumentReviewStateSessionProvider;
  private readonly externalReader: BaseDocumentReviewStateSessionProvider;
  private readonly now: () => Date;

  public constructor(
    private readonly options: DocumentReviewStateSessionProviderOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.baseProvider = new BaseDocumentReviewStateSessionProvider(options);
    this.externalReader = new BaseDocumentReviewStateSessionProvider({
      ...options,
      gitInspector: nonRepositoryInspector
    });
  }

  /** Opens the active owner and reconciles certain lower-owner changes. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const targetSession = await this.baseProvider.open(descriptor);
    const sources = await this.loadLowerOwnerSources(
      targetSession.owner,
      descriptor
    );
    return this.reconcileCertainSources(targetSession, sources);
  }

  /** Keeps decoration reads non-mutating. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.baseProvider.loadForDecoration(descriptor);
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
    sources: readonly (DocumentNormalEditorDecorationState | undefined)[]
  ): Promise<DocumentNormalEditorReviewStateSession> {
    let current = targetSession;
    for (const source of sources) {
      if (source === undefined || source.owner === "git") {
        continue;
      }
      current = await this.reconcileCertainSource(current, source);
    }
    return current;
  }

  private async reconcileCertainSource(
    targetSession: DocumentNormalEditorReviewStateSession,
    source: DocumentNormalEditorDecorationState
  ): Promise<DocumentNormalEditorReviewStateSession> {
    if (source.owner === "git") {
      return targetSession;
    }
    if (
      source.target.contentHash !== targetSession.target.contentHash ||
      source.target.lineCount !== targetSession.target.lineCount
    ) {
      return targetSession;
    }

    const sourceContextFile = source.contextState.files[source.target.fileId];
    const sourceGlobalFile = source.globalState.files[source.target.fileId];
    if (sourceContextFile === undefined && sourceGlobalFile === undefined) {
      return targetSession;
    }

    const sourceReviewed = normalizedReviewed(source);
    const targetState: DocumentNormalEditorDecorationState = {
      owner: targetSession.owner,
      contextState: targetSession.contextState,
      globalState: targetSession.globalState,
      target: targetSession.target
    };
    const targetReviewed = normalizedReviewed(targetState);
    const sourceKey = this.sourceKey(source);
    const contextState = targetSession.contextState as ReconciledReviewContextState;
    const baseline = contextState.ownerReconciliation?.[sourceKey];
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
    } else if (sameIntervals(sourceReviewed, targetReviewed)) {
      // The base provider already performed the initial promotion. Only record a baseline.
    } else {
      const targetContextFile = targetSession.contextState.files[targetSession.target.fileId];
      const targetGlobalFile = targetSession.globalState.files[targetSession.target.fileId];
      const targetUpdatedAt = newestTimestamp([
        targetContextFile?.updatedAt,
        targetGlobalFile?.updatedAt
      ]);
      if (laterThan(source.contextState.createdAt, targetUpdatedAt)) {
        // A fallback owner created after the higher-owner state can only contribute additions.
        additions = subtractLineIntervals(sourceReviewed, targetReviewed);
      }
      // Legacy ambiguous snapshots establish a baseline without modifying higher-owner ranges.
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

    const previousSnapshot = contextState.ownerReconciliation?.[sourceKey];
    if (
      additions.length === 0 &&
      removals.length === 0 &&
      previousSnapshot !== undefined &&
      sameIntervals(previousSnapshot.reviewed, nextSnapshot.reviewed)
    ) {
      return targetSession;
    }

    if (
      additions.length === 0 &&
      removals.length === 0 &&
      targetReviewed.length === 0
    ) {
      return targetSession;
    }

    const occurredAt = this.now().toISOString();
    const transaction = this.reconciliationTransaction(
      targetSession,
      additions,
      removals,
      occurredAt
    );
    const nextContextState = cloneValue(
      transaction.next.contextState
    ) as ReconciledReviewContextState;
    const finalContextState: ReconciledReviewContextState = {
      ...nextContextState,
      ownerReconciliation: {
        ...(contextState.ownerReconciliation ?? {}),
        [sourceKey]: nextSnapshot
      },
      updatedAt: occurredAt
    };
    const finalTransaction: ReviewStateTransaction = {
      ...transaction,
      next: {
        contextState: finalContextState,
        globalState: cloneValue(
          transaction.next.globalState
        ) as RepositoryGlobalState
      }
    };

    await targetSession.committer.commit(finalTransaction);
    return {
      ...targetSession,
      contextState: cloneValue(finalContextState) as ReviewContextState,
      globalState: cloneValue(finalTransaction.next.globalState) as RepositoryGlobalState
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

  private reconciliationTransaction(
    targetSession: DocumentNormalEditorReviewStateSession,
    additions: readonly LineInterval[],
    removals: readonly LineInterval[],
    occurredAt: string
  ): ReviewStateTransaction {
    const common = {
      contextState: targetSession.contextState,
      globalState: targetSession.globalState,
      target: targetSession.target,
      occurredAt
    };
    let transaction: ReviewStateTransaction | undefined;

    if (removals.length > 0) {
      transaction = unmarkReviewedRanges({
        ...common,
        intervals: removals
      });
    }

    if (additions.length > 0) {
      const additionTransaction = markReviewedRanges({
        ...common,
        ...(transaction === undefined
          ? {}
          : {
              contextState: transaction.next.contextState,
              globalState: transaction.next.globalState
            }),
        intervals: additions
      });
      transaction = transaction === undefined
        ? additionTransaction
        : {
            ...additionTransaction,
            expected: transaction.expected
          };
    }

    return transaction ?? markReviewedRanges({
      ...common,
      intervals: []
    });
  }
}

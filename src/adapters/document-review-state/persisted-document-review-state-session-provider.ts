import { gitInspectionStartPath } from "../local-git/index";
import type { NonGitSnapshotTracker } from "../../application/non-git-snapshots/index";
import {
  GitHistoryRewriteRecoveryCoordinator,
  gitGlobalSnapshotScope
} from "../../application/history-rewrite-recovery/git-context-recovery";
import {
  registerGitHistoryRewriteRecovery,
  type GitRevisionMappingSource,
  type SelectedReviewContext
} from "../../application/review-context/index";
import type { StableHash } from "../../application/workspace-identity/index";
import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import type {
  DeepReadonly,
  ReviewStateFileTarget
} from "../../core/review-state/index";
import {
  GitContextDocumentReviewStateSessionProvider
} from "./git-context-document-review-state-session-provider";
import type {
  DocumentReviewStateSessionProviderOptions
} from "./git-context-document-review-state-session-provider";
import type {
  DocumentEditorReviewDescriptor,
  DocumentNormalEditorDecorationState,
  DocumentNormalEditorReviewStateSession
} from "./document-review-state-session-provider";

interface HistoryRewriteSnapshotWorkspaceProvider {
  readonly historyRewriteSnapshotTracker: NonGitSnapshotTracker;
}

interface SnapshotCoordinates {
  readonly contextScope: string;
  readonly globalScope: string;
  readonly fileId: string;
}

const isRevisionSource = (
  value: unknown
): value is GitRevisionMappingSource => value !== null &&
  typeof value === "object" &&
  "objectExists" in value &&
  typeof value.objectExists === "function" &&
  "diffRevisions" in value &&
  typeof value.diffRevisions === "function" &&
  "readTextFileAtRevision" in value &&
  typeof value.readTextFileAtRevision === "function";

const historyRewriteSnapshotTrackerOf = (
  value: unknown
): NonGitSnapshotTracker | undefined => {
  if (
    value === null ||
    typeof value !== "object" ||
    !("historyRewriteSnapshotTracker" in value)
  ) {
    return undefined;
  }
  const provider = value as HistoryRewriteSnapshotWorkspaceProvider;
  return provider.historyRewriteSnapshotTracker;
};

const lineCountOf = (content: string): number =>
  content.split(/\r\n|\r|\n/u).length;

const coordinatesOf = (
  contextState: Readonly<ReviewContextState>,
  target: Readonly<ReviewStateFileTarget>
): SnapshotCoordinates => ({
  contextScope: contextState.contextId,
  globalScope: gitGlobalSnapshotScope(contextState.repositoryId),
  fileId: target.fileId
});

const stateMatchesTarget = (
  contextState: DeepReadonly<ReviewContextState>,
  globalState: DeepReadonly<RepositoryGlobalState>,
  target: Readonly<ReviewStateFileTarget>
): boolean => {
  const contextFile = contextState.files[target.fileId];
  const globalFile = globalState.files[target.fileId];
  return contextFile !== undefined &&
    globalFile !== undefined &&
    contextFile.currentPath === target.currentPath &&
    globalFile.currentPath === target.currentPath &&
    contextFile.revisionId === target.revisionId &&
    globalFile.revisionId === target.revisionId &&
    contextFile.lineCount === target.lineCount &&
    contextFile.contentHash === target.contentHash &&
    globalFile.contentHash === target.contentHash;
};

export class DocumentReviewStateSessionProvider {
  private readonly delegate: GitContextDocumentReviewStateSessionProvider;
  private readonly revisionSource: GitRevisionMappingSource | undefined;
  private readonly snapshotTracker: NonGitSnapshotTracker | undefined;
  private readonly stableHash: StableHash;
  private readonly nowMilliseconds: () => number;
  private snapshotCommitQueue: Promise<void> = Promise.resolve();

  public constructor(options: DocumentReviewStateSessionProviderOptions) {
    this.revisionSource = options.gitRevisionSource ??
      (isRevisionSource(options.gitInspector) ? options.gitInspector : undefined);
    this.snapshotTracker = historyRewriteSnapshotTrackerOf(options.workspaceProvider);
    this.stableHash = options.stableHash;
    this.nowMilliseconds = () => (options.now?.() ?? new Date()).getTime();

    if (this.revisionSource !== undefined && this.snapshotTracker !== undefined) {
      registerGitHistoryRewriteRecovery(
        this.revisionSource,
        new GitHistoryRewriteRecoveryCoordinator({
          source: this.revisionSource,
          stableHash: options.stableHash,
          snapshotTracker: this.snapshotTracker
        })
      );
    }
    this.delegate = new GitContextDocumentReviewStateSessionProvider(options);
  }

  public async open(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const session = await this.delegate.open(descriptor, selection);
    if (
      session.owner !== "git" ||
      this.revisionSource === undefined ||
      this.snapshotTracker === undefined
    ) {
      return session;
    }

    const coordinates = coordinatesOf(session.contextState, session.target);
    const content = await this.readProvenContent(descriptor, session.target);
    await this.replaceSnapshots(
      coordinates,
      content,
      session.contextState,
      session.globalState,
      session.target
    );

    const delegateCommitter = session.committer;
    return {
      ...session,
      committer: {
        commit: (transaction) => this.enqueueSnapshotCommit(async () => {
          await delegateCommitter.commit(transaction);
          try {
            const nextContent = await this.readProvenContent(
              descriptor,
              session.target
            );
            await this.replaceSnapshots(
              coordinates,
              nextContent,
              transaction.next.contextState,
              transaction.next.globalState,
              session.target
            );
          } catch {
            await this.invalidateSnapshots(coordinates).catch(() => undefined);
          }
        })
      }
    };
  }

  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.delegate.loadForDecoration(descriptor, selection);
  }

  public dispose(): void {
    this.delegate.dispose();
  }

  private enqueueSnapshotCommit(operation: () => Promise<void>): Promise<void> {
    const result = this.snapshotCommitQueue.then(operation, operation);
    this.snapshotCommitQueue = result.catch(() => undefined);
    return result;
  }

  private async readProvenContent(
    descriptor: DocumentEditorReviewDescriptor,
    target: Readonly<ReviewStateFileTarget>
  ): Promise<string | undefined> {
    if (
      this.revisionSource === undefined ||
      target.contentHash === undefined
    ) {
      return undefined;
    }
    try {
      const result = await this.revisionSource.readTextFileAtRevision(
        gitInspectionStartPath(
          descriptor.documentFsPath,
          descriptor.fileSystemPathSemantics
        ),
        target.revisionId,
        target.currentPath,
        descriptor.fileSystemPathSemantics
      );
      if (
        result.kind !== "found" ||
        this.stableHash.digest(result.content) !== target.contentHash ||
        lineCountOf(result.content) !== target.lineCount
      ) {
        return undefined;
      }
      return result.content;
    } catch {
      return undefined;
    }
  }

  private async replaceSnapshots(
    coordinates: SnapshotCoordinates,
    content: string | undefined,
    contextState: DeepReadonly<ReviewContextState>,
    globalState: DeepReadonly<RepositoryGlobalState>,
    target: Readonly<ReviewStateFileTarget>
  ): Promise<void> {
    if (
      content === undefined ||
      !stateMatchesTarget(contextState, globalState, target)
    ) {
      await this.invalidateSnapshots(coordinates);
      return;
    }
    const contextFile = contextState.files[target.fileId];
    const globalFile = globalState.files[target.fileId];
    if (contextFile === undefined || globalFile === undefined) {
      await this.invalidateSnapshots(coordinates);
      return;
    }

    const now = this.nowMilliseconds();
    try {
      await this.snapshotTracker?.saveLatest({
        workspaceContextId: coordinates.contextScope,
        fileId: coordinates.fileId,
        content,
        reviewedRanges: contextFile.modifiedReviewed
      }, now);
      await this.snapshotTracker?.saveLatest({
        workspaceContextId: coordinates.globalScope,
        fileId: coordinates.fileId,
        content,
        reviewedRanges: globalFile.reviewed
      }, now);
    } catch (error) {
      await this.invalidateSnapshots(coordinates).catch(() => undefined);
      throw error;
    }
  }

  private async invalidateSnapshots(
    coordinates: SnapshotCoordinates
  ): Promise<void> {
    if (this.snapshotTracker === undefined) {
      return;
    }
    await this.snapshotTracker.invalidateLatest(
      coordinates.contextScope,
      coordinates.fileId
    );
    await this.snapshotTracker.invalidateLatest(
      coordinates.globalScope,
      coordinates.fileId
    );
  }
}

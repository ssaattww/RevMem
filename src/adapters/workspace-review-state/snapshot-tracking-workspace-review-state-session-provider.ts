import { NonGitSnapshotTracker } from "../../application/non-git-snapshots/index";
import type { WorkspaceIdentityService } from "../../application/workspace-identity/index";
import type { RepositoryGlobalState, ReviewContextState } from "../../core/contracts/index";
import { markReviewedRanges, unmarkFileReviewed, type ReviewStateTransaction } from "../../core/review-state/index";
import {
  WorkspaceReviewStateSessionProvider,
  type WorkspaceEditorReviewDescriptor,
  type WorkspaceNormalEditorDecorationState,
  type WorkspaceNormalEditorReviewStateSession,
  type WorkspaceReviewStateSessionProviderOptions,
} from "./workspace-review-state-session-provider";

export interface SnapshotTrackingWorkspaceReviewStateSessionProviderOptions
  extends WorkspaceReviewStateSessionProviderOptions {
  readonly snapshotTracker: NonGitSnapshotTracker;
  readonly resolveContent: (descriptor: WorkspaceEditorReviewDescriptor) => string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class SnapshotTrackingWorkspaceReviewStateSessionProvider
  extends WorkspaceReviewStateSessionProvider {
  private readonly identityService: WorkspaceIdentityService;
  private readonly snapshotTracker: NonGitSnapshotTracker;
  private readonly resolveContent: (descriptor: WorkspaceEditorReviewDescriptor) => string;
  private readonly nowMilliseconds: () => number;

  public constructor(options: SnapshotTrackingWorkspaceReviewStateSessionProviderOptions) {
    super(options);
    this.identityService = options.identityService;
    this.snapshotTracker = options.snapshotTracker;
    this.resolveContent = options.resolveContent;
    this.nowMilliseconds = () => (options.now?.() ?? new Date()).getTime();
  }

  /** Reuses the same T601 generation store for Git history-rewrite recovery. */
  public get historyRewriteSnapshotTracker(): NonGitSnapshotTracker {
    return this.snapshotTracker;
  }

  public override async open(
    descriptor: WorkspaceEditorReviewDescriptor,
  ): Promise<WorkspaceNormalEditorReviewStateSession> {
    const content = this.resolveContent(descriptor);
    const identity = this.identityService.resolve({
      workspaceFolderUri: descriptor.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.relativePath,
    });
    const now = this.nowMilliseconds();
    const snapshotId = await this.snapshotTracker.latestSnapshotId(identity.workspaceContextId, identity.fileId);
    const mapped = snapshotId === undefined
      ? undefined
      : await this.snapshotTracker.map(snapshotId, content, now);

    let session = await super.open(descriptor);
    // The latest pointer is the complete authority for this file.  A persisted
    // same-content range is not independent evidence and must never survive a
    // missing, corrupt, expired, or ambiguous latest generation.
    // Close the pointer before publishing any replacement state. A failure in
    // either state transition leaves this file fail-closed rather than allowing
    // the prior generation to be replayed on the next open.
    await this.snapshotTracker.invalidateLatest(identity.workspaceContextId, identity.fileId);
    session = await this.clearCurrentEvidence(session, now);
    if (mapped?.status === "mapped" && mapped.reviewedRanges.length > 0) {
      const transaction = markReviewedRanges({
        contextState: session.contextState,
        globalState: session.globalState,
        target: session.target,
        intervals: mapped.reviewedRanges,
        occurredAt: new Date(now).toISOString(),
      });
      await session.committer.commit(transaction);
      session = {
        ...session,
        contextState: clone(transaction.next.contextState) as ReviewContextState,
        globalState: clone(transaction.next.globalState) as RepositoryGlobalState,
      };
    }

    await this.saveCurrentSnapshot(session, content, now);
    const delegate = session.committer;
    return {
      ...session,
      committer: {
        commit: async (transaction) => this.commitWithSnapshot(descriptor, transaction, () => delegate.commit(transaction)),
      },
    };
  }

  /** Preserves generation safety when a document-owner adapter wraps this provider's committer. */
  public async commitWithSnapshot(
    descriptor: WorkspaceEditorReviewDescriptor,
    transaction: Readonly<ReviewStateTransaction>,
    commitState: () => Promise<void>,
  ): Promise<void> {
    const identity = this.identityService.resolve({ workspaceFolderUri: descriptor.workspaceFolderUri, documentUri: descriptor.documentUri, fileSystemPathSemantics: descriptor.fileSystemPathSemantics, relativePath: descriptor.relativePath });
    // Once state advances, an older generation must never be eligible if writing
    // the replacement snapshot fails. This deliberately favours unreviewed UI.
    await this.snapshotTracker.invalidateLatest(identity.workspaceContextId, identity.fileId);
    await commitState();
    await this.snapshotTracker.saveLatest({
      workspaceContextId: identity.workspaceContextId,
      fileId: identity.fileId,
      content: this.resolveContent(descriptor),
      reviewedRanges: transaction.next.contextState.files[identity.fileId]?.modifiedReviewed ?? [],
    }, this.nowMilliseconds());
  }

  public override async loadForDecoration(
    descriptor: WorkspaceEditorReviewDescriptor,
  ): Promise<WorkspaceNormalEditorDecorationState | undefined> {
    const base = await super.loadForDecoration(descriptor);
    if (base === undefined) return undefined;
    const identity = this.identityService.resolve({
      workspaceFolderUri: descriptor.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.relativePath,
    });
    const snapshotId = await this.snapshotTracker.latestSnapshotId(identity.workspaceContextId, identity.fileId);
    const mapped = snapshotId === undefined
      ? undefined
      : await this.snapshotTracker.map(snapshotId, this.resolveContent(descriptor), this.nowMilliseconds());
    const cleared = this.clearDecorationEvidence(base, this.nowMilliseconds());
    if (mapped?.status !== "mapped" || mapped.reviewedRanges.length === 0) return cleared;
    const transaction = markReviewedRanges({
      contextState: cleared.contextState,
      globalState: cleared.globalState,
      target: cleared.target,
      intervals: mapped.reviewedRanges,
      occurredAt: new Date(this.nowMilliseconds()).toISOString(),
    });
    return { ...cleared, contextState: clone(transaction.next.contextState) as ReviewContextState, globalState: clone(transaction.next.globalState) as RepositoryGlobalState };
  }

  private async saveCurrentSnapshot(
    session: WorkspaceNormalEditorReviewStateSession,
    content: string,
    now: number,
  ): Promise<void> {
    await this.snapshotTracker.saveLatest({
      workspaceContextId: session.contextState.contextId,
      fileId: session.target.fileId,
      content,
      reviewedRanges:
        session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [],
    }, now);
  }

  private async clearCurrentEvidence(
    session: WorkspaceNormalEditorReviewStateSession,
    now: number,
  ): Promise<WorkspaceNormalEditorReviewStateSession> {
    if (!hasReviewedEvidence(session.contextState, session.globalState, session.target.fileId)) return session;
    const transaction = unmarkFileReviewed({
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      occurredAt: new Date(now).toISOString(),
    });
    await session.committer.commit(transaction);
    return { ...session, contextState: clone(transaction.next.contextState) as ReviewContextState, globalState: clone(transaction.next.globalState) as RepositoryGlobalState };
  }

  private clearDecorationEvidence(
    state: WorkspaceNormalEditorDecorationState,
    now: number,
  ): WorkspaceNormalEditorDecorationState {
    if (!hasReviewedEvidence(state.contextState, state.globalState, state.target.fileId)) return state;
    const transaction = unmarkFileReviewed({ contextState: state.contextState, globalState: state.globalState, target: state.target, occurredAt: new Date(now).toISOString() });
    return { ...state, contextState: clone(transaction.next.contextState) as ReviewContextState, globalState: clone(transaction.next.globalState) as RepositoryGlobalState };
  }

}

const hasReviewedEvidence = (contextState: ReviewContextState, globalState: RepositoryGlobalState, fileId: string): boolean =>
  (contextState.files[fileId]?.modifiedReviewed.length ?? 0) > 0 ||
  (globalState.files[fileId]?.reviewed.length ?? 0) > 0;

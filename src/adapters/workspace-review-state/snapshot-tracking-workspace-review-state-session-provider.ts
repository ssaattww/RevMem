import { NonGitSnapshotTracker } from "../../application/non-git-snapshots/index";
import type { WorkspaceIdentityService } from "../../application/workspace-identity/index";
import type { RepositoryGlobalState, ReviewContextState } from "../../core/contracts/index";
import { markReviewedRanges, type ReviewStateTransaction } from "../../core/review-state/index";
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
    if (snapshotId === undefined) return base;
    const mapped = await this.snapshotTracker.map(snapshotId, this.resolveContent(descriptor), this.nowMilliseconds());
    if (mapped.status !== "mapped" || mapped.reviewedRanges.length === 0) return base;
    const transaction = markReviewedRanges({
      contextState: base.contextState,
      globalState: base.globalState,
      target: base.target,
      intervals: mapped.reviewedRanges,
      occurredAt: new Date(this.nowMilliseconds()).toISOString(),
    });
    return { ...base, contextState: clone(transaction.next.contextState) as ReviewContextState, globalState: clone(transaction.next.globalState) as RepositoryGlobalState };
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

}

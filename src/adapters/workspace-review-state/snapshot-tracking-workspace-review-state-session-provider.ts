import {
  type NonGitSnapshotStorage,
  NonGitSnapshotTracker,
} from "../../application/non-git-snapshots/index";
import type { WorkspaceIdentityService } from "../../application/workspace-identity/index";
import type { RepositoryGlobalState, ReviewContextState } from "../../core/contracts/index";
import { markReviewedRanges } from "../../core/review-state/index";
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
  readonly snapshotStorage: NonGitSnapshotStorage;
  readonly resolveContent: (descriptor: WorkspaceEditorReviewDescriptor) => string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class SnapshotTrackingWorkspaceReviewStateSessionProvider
  extends WorkspaceReviewStateSessionProvider {
  private readonly identityService: WorkspaceIdentityService;
  private readonly snapshotTracker: NonGitSnapshotTracker;
  private readonly snapshotStorage: NonGitSnapshotStorage;
  private readonly resolveContent: (descriptor: WorkspaceEditorReviewDescriptor) => string;
  private readonly nowMilliseconds: () => number;

  public constructor(options: SnapshotTrackingWorkspaceReviewStateSessionProviderOptions) {
    super(options);
    this.identityService = options.identityService;
    this.snapshotTracker = options.snapshotTracker;
    this.snapshotStorage = options.snapshotStorage;
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
    const snapshotId = await this.findLatestSnapshot(identity.workspaceContextId, identity.fileId, now);
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
        commit: async (transaction) => {
          await delegate.commit(transaction);
          await this.snapshotTracker.save({
            workspaceContextId: identity.workspaceContextId,
            fileId: identity.fileId,
            content,
            reviewedRanges:
              transaction.next.contextState.files[identity.fileId]?.modifiedReviewed ?? [],
          }, this.nowMilliseconds());
        },
      },
    };
  }

  public override async loadForDecoration(
    descriptor: WorkspaceEditorReviewDescriptor,
  ): Promise<WorkspaceNormalEditorDecorationState | undefined> {
    const base = await super.loadForDecoration(descriptor);
    if (base !== undefined) {
      return base;
    }
    return undefined;
  }

  private async saveCurrentSnapshot(
    session: WorkspaceNormalEditorReviewStateSession,
    content: string,
    now: number,
  ): Promise<void> {
    await this.snapshotTracker.save({
      workspaceContextId: session.contextState.contextId,
      fileId: session.target.fileId,
      content,
      reviewedRanges:
        session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [],
    }, now);
  }

  private async findLatestSnapshot(
    workspaceContextId: string,
    fileId: string,
    now: number,
  ): Promise<string | undefined> {
    const entries = [...this.snapshotStorage.entries()].sort(
      ([leftId, left], [rightId, right]) =>
        right.createdAt - left.createdAt || rightId.localeCompare(leftId),
    );
    for (const [snapshotId] of entries) {
      const state = await this.snapshotTracker.restore(snapshotId, now);
      if (state?.workspaceContextId === workspaceContextId && state.fileId === fileId) {
        return snapshotId;
      }
    }
    return undefined;
  }
}

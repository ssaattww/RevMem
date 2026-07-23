import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget
} from "../state-repository/index";
import type {
  NormalEditorReviewStateSession
} from "../../application/review-commands/index";
import {
  type FileSystemPathSemantics,
  type ResourceUri,
  WorkspaceIdentityService
} from "../../application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../core/contracts/index";
import type {
  ReviewStateFileTarget,
  ReviewStateTransactionCommitter
} from "../../core/review-state/index";

/** Document and workspace information collected by the VS Code UI adapter. */
export interface WorkspaceEditorReviewDescriptor {
  readonly workspaceFolderUri: ResourceUri;
  readonly documentUri: ResourceUri;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  readonly relativePath: string;
  readonly workspaceDisplayName: string;
  readonly lineCount: number;
  readonly contentHash: string;
}

/** Mutable snapshots returned by this adapter and accepted by the readonly command contract. */
export interface WorkspaceNormalEditorReviewStateSession
  extends NormalEditorReviewStateSession {
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
  readonly target: ReviewStateFileTarget;
  readonly committer: ReviewStateTransactionCommitter;
}

/** Persistence subset needed to load, initialize, sanitize, and commit one session. */
export interface WorkspaceReviewStateRepository
  extends ReviewStateTransactionCommitter {
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void>;
}

/** Constructor dependencies for workspace fallback review-state sessions. */
export interface WorkspaceReviewStateSessionProviderOptions {
  readonly identityService: WorkspaceIdentityService;
  readonly repository: WorkspaceReviewStateRepository;
  readonly now?: () => Date;
}

const cloneValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const withoutKey = <Value>(
  values: Readonly<Record<string, Value>>,
  key: string
): Record<string, Value> =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([entryKey]) => entryKey !== key)
      .map(([entryKey, value]) => [entryKey, cloneValue(value)])
  );

const assertNonEmptyString = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
};

const assertLineCount = (lineCount: number): void => {
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) {
    throw new RangeError("lineCount must be a non-negative safe integer.");
  }
};

const validateLoadedCommit = (
  commit: ReviewStateCommit,
  target: ReviewStateRepositoryTarget,
  workspaceId: string,
  revisionId: string
): void => {
  if (
    commit.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION ||
    commit.contextState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION ||
    commit.globalState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION
  ) {
    throw new Error("Persisted workspace review state uses an unsupported schema version.");
  }

  if (
    commit.contextState.repositoryId !== target.repositoryId ||
    commit.globalState.repositoryId !== target.repositoryId
  ) {
    throw new Error("Persisted workspace review state has a different repository identity.");
  }

  if (commit.contextState.contextId !== target.contextId) {
    throw new Error("Persisted workspace review state has a different context identity.");
  }

  if (
    commit.contextState.kind !== "workspace" ||
    commit.contextState.workspace?.workspaceId !== workspaceId
  ) {
    throw new Error("Persisted review context is not the expected workspace context.");
  }

  if (
    commit.contextState.workspace.snapshotRevision !== revisionId ||
    commit.globalState.currentRevisionId !== revisionId
  ) {
    throw new Error("Persisted workspace review state is not mapped to the live revision.");
  }
};

const createInitialCommit = (
  repositoryId: string,
  contextId: string,
  workspaceId: string,
  revisionId: string,
  displayName: string,
  occurredAt: string
): ReviewStateCommit => {
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "workspace",
    repositoryId,
    displayName,
    workspace: {
      workspaceId,
      snapshotRevision: revisionId
    },
    files: {},
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: revisionId,
    files: {},
    updatedAt: occurredAt
  };

  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState,
    globalState
  };
};

/**
 * Resolves non-Git workspace identity and returns mapped state for normal-editor commands.
 *
 * Until edit-event mapping is connected by T107, a content-hash mismatch invalidates only
 * the current file before a new command is evaluated. This preserves certainty without
 * relabeling stale reviewed ranges onto changed content.
 */
export class WorkspaceReviewStateSessionProvider {
  private readonly now: () => Date;

  public constructor(
    private readonly options: WorkspaceReviewStateSessionProviderOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async open(
    descriptor: WorkspaceEditorReviewDescriptor
  ): Promise<WorkspaceNormalEditorReviewStateSession> {
    assertLineCount(descriptor.lineCount);
    assertNonEmptyString(descriptor.contentHash, "contentHash");

    const identity = this.options.identityService.resolve({
      workspaceFolderUri: descriptor.workspaceFolderUri,
      documentUri: descriptor.documentUri,
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      relativePath: descriptor.relativePath
    });
    const revisionId = `workspace-live:${identity.workspaceId}`;
    const target: ReviewStateRepositoryTarget = {
      kind: "workspace",
      repositoryId: identity.repositoryId,
      contextId: identity.workspaceContextId
    };
    const occurredAt = this.now().toISOString();
    const displayName = descriptor.workspaceDisplayName.trim().length === 0
      ? "Workspace review"
      : descriptor.workspaceDisplayName;

    let commit = await this.options.repository.load(target);
    if (commit === undefined) {
      commit = createInitialCommit(
        identity.repositoryId,
        identity.workspaceContextId,
        identity.workspaceId,
        revisionId,
        displayName,
        occurredAt
      );
      await this.options.repository.save(target, commit);
    } else {
      validateLoadedCommit(
        commit,
        target,
        identity.workspaceId,
        revisionId
      );
    }

    const contextFile = commit.contextState.files[identity.fileId];
    const globalFile = commit.globalState.files[identity.fileId];
    const contextFileIsStale = contextFile !== undefined && (
      contextFile.contentHash !== descriptor.contentHash ||
      contextFile.revisionId !== revisionId ||
      contextFile.lineCount !== descriptor.lineCount ||
      contextFile.currentPath !== identity.relativePath
    );
    const globalFileIsStale = globalFile !== undefined && (
      globalFile.contentHash !== descriptor.contentHash ||
      globalFile.revisionId !== revisionId ||
      globalFile.currentPath !== identity.relativePath
    );

    if (contextFileIsStale || globalFileIsStale) {
      commit = {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState: {
          ...cloneValue(commit.contextState),
          files: withoutKey(commit.contextState.files, identity.fileId),
          updatedAt: occurredAt
        },
        globalState: {
          ...cloneValue(commit.globalState),
          files: withoutKey(commit.globalState.files, identity.fileId),
          updatedAt: occurredAt
        }
      };
      await this.options.repository.save(target, commit);
    }

    return {
      contextState: cloneValue(commit.contextState),
      globalState: cloneValue(commit.globalState),
      target: {
        fileId: identity.fileId,
        currentPath: identity.relativePath,
        revisionId,
        lineCount: descriptor.lineCount,
        contentHash: descriptor.contentHash
      },
      committer: this.options.repository
    };
  }
}

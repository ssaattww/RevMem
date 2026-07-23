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
  /** URI of the workspace folder used to derive the stable non-Git workspace identity. */
  readonly workspaceFolderUri: ResourceUri;
  /** URI of the active document used with the folder and relative path to derive the stable file identity. */
  readonly documentUri: ResourceUri;
  /** Path rules used by identity resolution to normalize the workspace and document URIs. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Workspace-relative path that must identify the document beneath `workspaceFolderUri`. */
  readonly relativePath: string;
  /** Display label persisted for an initial workspace context; blank values use the provider default. */
  readonly workspaceDisplayName: string;
  /** Current document line count; it must be a non-negative safe integer and becomes the returned target line count. */
  readonly lineCount: number;
  /** Current document content hash; it must be non-empty and mismatch removes only this file's stale reviewed state. */
  readonly contentHash: string;
}

/** Mutable snapshots returned by this adapter and accepted by the readonly command contract. */
export interface WorkspaceNormalEditorReviewStateSession
  extends NormalEditorReviewStateSession {
  /** Mutable clone of the mapped workspace context state returned for command transaction construction. */
  readonly contextState: ReviewContextState;
  /** Mutable clone of the mapped repository-wide Global state returned for command transaction construction. */
  readonly globalState: RepositoryGlobalState;
  /** Current workspace file identity, live workspace revision, line count, and content hash aligned with both snapshots. */
  readonly target: ReviewStateFileTarget;
  /** Atomic compare-and-replace committer that persists complete context and Global transaction snapshots together. */
  readonly committer: ReviewStateTransactionCommitter;
}

/** Persistence subset needed to load, initialize, sanitize, and commit one session. */
export interface WorkspaceReviewStateRepository
  extends ReviewStateTransactionCommitter {
  /**
   * Loads the complete persisted snapshot selected by the workspace target.
   *
   * @returns The current commit, or `undefined` when the workspace has not been initialized.
   * @throws Propagates persistence, parse, and validation failures without producing a session.
   */
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  /**
   * Persists an initial or sanitized complete workspace snapshot before it is returned to commands.
   *
   * @throws Propagates persistence failure; the provider does not return a session after the failed save.
   */
  save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void>;
}

/** Constructor dependencies for workspace fallback review-state sessions. */
export interface WorkspaceReviewStateSessionProviderOptions {
  /** Resolves stable workspace, context, repository, and file identities from UI descriptor values. */
  readonly identityService: WorkspaceIdentityService;
  /** Loads, initializes, sanitizes, and atomically commits workspace review state. */
  readonly repository: WorkspaceReviewStateRepository;
  /** Optional clock for initial and sanitization timestamps; wall-clock time is used when omitted. */
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
 * Until edit-event mapping is connected by T201, a content-hash mismatch invalidates only
 * the current file before a new command is evaluated. This preserves certainty without
 * relabeling stale reviewed ranges onto changed content.
 */
export class WorkspaceReviewStateSessionProvider {
  private readonly now: () => Date;

  /**
   * Creates a workspace-session provider without resolving identity or accessing persistence.
   *
   * @param options UI identity, persistence, and optional clock dependencies used by `open`.
   */
  public constructor(
    private readonly options: WorkspaceReviewStateSessionProviderOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Resolves a non-Git workspace session for the current editor descriptor.
   *
   * It validates line count and content hash, derives a stable workspace/file identity,
   * loads or initializes the workspace snapshot, and removes only the current file when
   * revision, hash, path, or line-count certainty no longer matches. Returned state is cloned
   * and the repository remains the atomic CAS committer for later command transactions.
   *
   * @returns Mapped mutable snapshots and target metadata aligned to the current descriptor.
   * @throws Propagates descriptor validation, identity resolution, persisted-state validation, load, or save failure without returning a session.
   */
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

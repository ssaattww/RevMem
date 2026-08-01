import path from "node:path";

import type {
  LocalGitRepository,
  LocalGitRepositoryInspection
} from "../local-git/index";
import {
  StaleReviewStateError
} from "../state-repository/index";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget
} from "../state-repository/index";
import {
  type WorkspaceEditorReviewDescriptor,
  type WorkspaceNormalEditorDecorationState,
  type WorkspaceReviewStateRepository,
  WorkspaceReviewStateSessionProvider
} from "../workspace-review-state/index";
import type {
  NormalEditorReviewStateSession
} from "../../application/review-commands/index";
import type {
  FileSystemPathSemantics,
  ResourceUri,
  StableHash
} from "../../application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../core/contracts/index";
import {
  markReviewedRanges,
  type ReviewStateFileTarget,
  type ReviewStateTransactionCommitter
} from "../../core/review-state/index";
import { ReviewHistoryRecorder } from "../../application/review-history/index";

/** Git ownership inspection needed by document routing. */
export interface DocumentGitInspector {
  /** Inspects the nearest filesystem ancestor and returns either its Git ownership or a classified non-repository result. */
  inspectRepository(startPath: string): Promise<LocalGitRepositoryInspection>;
}

/** Optional workspace membership retained only for the non-Git fallback and migration. */
export interface DocumentWorkspaceDescriptor {
  /** Workspace root retained to derive the non-Git workspace owner identity. */
  readonly workspaceFolderUri: ResourceUri;
  /** Repository-relative document path used only by workspace fallback persistence. */
  readonly relativePath: string;
  /** Human-readable workspace name retained in workspace context metadata. */
  readonly displayName: string;
}

/** Filesystem-backed editor document resolved independently from workspace membership. */
export interface DocumentEditorReviewDescriptor {
  /** URI identity of the open editor; query and fragment are rejected for filesystem-backed documents. */
  readonly documentUri: ResourceUri;
  /** Native filesystem path used to inspect Git ownership. */
  readonly documentFsPath: string;
  /** Explicit path rules used to normalize both filesystem and URI identities. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Optional workspace membership considered only after Git ownership is unavailable. */
  readonly workspace?: DocumentWorkspaceDescriptor;
  /** Current document line count used to validate every persisted interval. */
  readonly lineCount: number;
  /** Current content identity used to reject stale persisted file ranges. */
  readonly contentHash: string;
}

/** Persistence boundary shared by Git, workspace, and external-file sessions. */
export type DocumentReviewStateRepository = WorkspaceReviewStateRepository;

/** Active owner selected for one document. */
export type DocumentReviewOwner = "git" | "workspace" | "external-file";

/** Routed command session with the selected ownership exposed for diagnostics and tests. */
export interface DocumentNormalEditorReviewStateSession
  extends NormalEditorReviewStateSession {
  /** Owner selected by routing and exposed so callers never infer persistence ownership from workspace membership. */
  readonly owner: DocumentReviewOwner;
  /** Complete current context snapshot paired atomically with {@link globalState}. */
  readonly contextState: ReviewContextState;
  /** Complete owner-wide snapshot paired atomically with {@link contextState}. */
  readonly globalState: RepositoryGlobalState;
  /** Current file identity and revision that every state operation must target. */
  readonly target: ReviewStateFileTarget;
  /** Full-snapshot transaction boundary that rejects stale context or owner-wide Global state. */
  readonly committer: ReviewStateTransactionCommitter;
}

/** Routed read-only decoration state. */
export interface DocumentNormalEditorDecorationState {
  /** Owner from which these read-only decoration ranges were loaded. */
  readonly owner: DocumentReviewOwner;
  /** Current context snapshot used for context-specific decorations. */
  readonly contextState: ReviewContextState;
  /** Owner-wide snapshot used for reusable reviewed-range decorations. */
  readonly globalState: RepositoryGlobalState;
  /** File identity that constrains the returned decoration state. */
  readonly target: ReviewStateFileTarget;
}

/** Constructor dependencies for document ownership routing. */
export interface DocumentReviewStateSessionProviderOptions {
  /** Git classification boundary consulted before workspace fallback routing. */
  readonly gitInspector: DocumentGitInspector;
  /** Persistence boundary that stores complete context and owner-wide Global snapshots. */
  readonly repository: DocumentReviewStateRepository;
  /** Non-Git workspace session provider reused for fallback and source promotion. */
  readonly workspaceProvider: WorkspaceReviewStateSessionProvider;
  /** Stable digest provider used to derive owner, context, and file identities. */
  readonly stableHash: StableHash;
  /** Optional UTC clock used for created and updated timestamps; the system clock is used when omitted. */
  readonly now?: () => Date;
  /** Optional append-only recorder invoked after conservative edited-file invalidation commits. */
  readonly historyRecorder?: ReviewHistoryRecorder;
}

interface OwnedMapping {
  readonly owner: "git" | "external-file";
  readonly repositoryTarget: ReviewStateRepositoryTarget;
  readonly contextState: ReviewContextState;
  readonly target: ReviewStateFileTarget;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:(?:\/|$)/u;
const WINDOWS_DRIVE_SEGMENT_PATTERN = /^[A-Za-z]:$/u;

const pathApiFor = (semantics: FileSystemPathSemantics): typeof path.posix =>
  semantics === "windows" ? path.win32 : path.posix;

const cloneValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const assertNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty string without null characters.`);
  }
};

const assertLineCount = (lineCount: number): void => {
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) {
    throw new RangeError("lineCount must be a non-negative safe integer.");
  }
};

const withoutKey = <Value>(
  values: Readonly<Record<string, Value>>,
  key: string
): Record<string, Value> => Object.fromEntries(
  Object.entries(values)
    .filter(([entryKey]) => entryKey !== key)
    .map(([entryKey, value]) => [entryKey, cloneValue(value)])
);

const normalizeAbsoluteUriPath = (
  value: string,
  pathSemantics: FileSystemPathSemantics
): string => {
  assertNonEmpty(value, "document URI path");
  const source = pathSemantics === "windows"
    ? value.replaceAll("\\", "/")
    : value;
  const absolute =
    pathSemantics === "windows" && WINDOWS_DRIVE_PATH_PATTERN.test(source)
      ? `/${source}`
      : source;
  if (!absolute.startsWith("/")) {
    throw new TypeError("document URI path must be absolute.");
  }

  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        throw new TypeError("document URI path must not escape its root.");
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const normalized = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return pathSemantics === "windows" ? normalized.toLowerCase() : normalized;
};

const encodeCanonicalPath = (value: string): string => value
  .split("/")
  .map((segment) =>
    WINDOWS_DRIVE_SEGMENT_PATTERN.test(segment)
      ? `${segment[0]}:`
      : encodeURIComponent(segment)
  )
  .join("/");

const canonicalDocumentUri = (
  uri: ResourceUri,
  pathSemantics: FileSystemPathSemantics
): string => {
  assertNonEmpty(uri.scheme, "document URI scheme");
  const scheme = uri.scheme.toLowerCase();
  if (!URI_SCHEME_PATTERN.test(scheme)) {
    throw new TypeError("document URI scheme is invalid.");
  }
  const authority = (uri.authority ?? "").toLowerCase();
  if (/[/\\?#]/u.test(authority)) {
    throw new TypeError("document URI authority contains a delimiter.");
  }
  if ((uri.query ?? "").length > 0 || (uri.fragment ?? "").length > 0) {
    throw new TypeError("filesystem document URI query and fragment must be empty.");
  }

  const normalizedPath = normalizeAbsoluteUriPath(uri.path, pathSemantics);
  return `${scheme}://${authority}${encodeCanonicalPath(normalizedPath)}`;
};

const contextRevision = (state: ReviewContextState): string | undefined =>
  state.kind === "pull-request"
    ? state.pullRequest?.headSha
    : state.kind === "branch"
      ? state.branch?.headRevision
      : state.kind === "workspace"
        ? state.workspace?.snapshotRevision
        : state.externalFile?.snapshotRevision;

/** Routes normal-editor state by Git ownership before considering workspace membership. */
export class DocumentReviewStateSessionProvider {
  private readonly now: () => Date;

  /** Creates a router that gives discovered Git ownership priority over workspace and external-file fallbacks. */
  public constructor(
    private readonly options: DocumentReviewStateSessionProviderOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** Opens a writable session owned by Git, a non-Git workspace, or an external file. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    this.validateDescriptor(descriptor);
    const inspection = await this.options.gitInspector.inspectRepository(
      pathApiFor(descriptor.fileSystemPathSemantics).dirname(
        descriptor.documentFsPath
      )
    );

    if (inspection.kind === "repository") {
      const session = await this.openOwned(
        this.resolveGitMapping(descriptor, inspection.repository)
      );
      return this.promoteFirstCertainSource(session, [
        await this.loadWorkspaceSource(descriptor),
        await this.loadExternalSource(descriptor)
      ]);
    }

    if (descriptor.workspace !== undefined) {
      const externalSource = await this.loadExternalSource(descriptor);
      const workspaceSession = await this.options.workspaceProvider.open(
        this.toWorkspaceDescriptor(descriptor)
      );
      return this.promoteFirstCertainSource(
        {
          owner: "workspace",
          contextState: cloneValue(workspaceSession.contextState),
          globalState: cloneValue(workspaceSession.globalState),
          target: { ...workspaceSession.target },
          committer: workspaceSession.committer
        },
        [externalSource]
      );
    }

    return this.openOwned(this.resolveExternalMapping(descriptor));
  }

  /** Loads only the currently selected owner and never initializes or promotes state. */
  public async loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    this.validateDescriptor(descriptor);
    const inspection = await this.options.gitInspector.inspectRepository(
      pathApiFor(descriptor.fileSystemPathSemantics).dirname(
        descriptor.documentFsPath
      )
    );

    if (inspection.kind === "repository") {
      return this.loadOwnedForDecoration(
        this.resolveGitMapping(descriptor, inspection.repository)
      );
    }

    if (descriptor.workspace !== undefined) {
      const state = await this.options.workspaceProvider.loadForDecoration(
        this.toWorkspaceDescriptor(descriptor)
      );
      return state === undefined ? undefined : this.workspaceDecorationState(state);
    }

    return this.loadOwnedForDecoration(this.resolveExternalMapping(descriptor));
  }

  private validateDescriptor(descriptor: DocumentEditorReviewDescriptor): void {
    assertNonEmpty(descriptor.documentFsPath, "documentFsPath");
    assertNonEmpty(descriptor.contentHash, "contentHash");
    assertLineCount(descriptor.lineCount);
    if (
      descriptor.fileSystemPathSemantics !== "windows" &&
      descriptor.fileSystemPathSemantics !== "posix"
    ) {
      throw new TypeError(
        'fileSystemPathSemantics must be either "windows" or "posix".'
      );
    }
  }

  private toWorkspaceDescriptor(
    descriptor: DocumentEditorReviewDescriptor
  ): WorkspaceEditorReviewDescriptor {
    const workspace = descriptor.workspace;
    if (workspace === undefined) {
      throw new Error("workspace descriptor is required.");
    }

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

  private createId(domain: string, ...parts: readonly string[]): string {
    const digest = this.options.stableHash.digest([domain, ...parts].join("\0"));
    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }
    return `${domain}:${digest}`;
  }

  private resolveGitMapping(
    descriptor: DocumentEditorReviewDescriptor,
    repository: LocalGitRepository
  ): OwnedMapping {
    const pathApi = pathApiFor(descriptor.fileSystemPathSemantics);
    const relativePath = pathApi.relative(
      pathApi.resolve(repository.rootPath),
      pathApi.resolve(descriptor.documentFsPath)
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relativePath)
    ) {
      throw new Error("document path is outside the resolved Git working tree.");
    }

    const normalizedRelativePath = relativePath.split(pathApi.sep).join("/");
    const currentPath = descriptor.fileSystemPathSemantics === "windows"
      ? normalizedRelativePath.toLowerCase()
      : normalizedRelativePath;
    const branchRef = repository.branch.kind === "branch"
      ? repository.branch.fullRef
      : `HEAD@${repository.head ?? "unknown"}`;
    const revisionId = repository.head ?? `unborn:${branchRef}`;
    const contextId = this.createId(
      repository.branch.kind === "branch" ? "branch-context" : "detached-context",
      repository.repositoryId,
      branchRef
    );
    const fileId = this.createId(
      "repository-file",
      repository.repositoryId,
      currentPath
    );
    const timestamp = this.now().toISOString();

    return {
      owner: "git",
      repositoryTarget: {
        kind: "git",
        repositoryId: repository.repositoryId,
        contextId
      },
      contextState: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextId,
        kind: "branch",
        repositoryId: repository.repositoryId,
        displayName: branchRef,
        branch: {
          refName: branchRef,
          headRevision: revisionId
        },
        files: {},
        createdAt: timestamp,
        updatedAt: timestamp
      },
      target: {
        fileId,
        currentPath,
        revisionId,
        lineCount: descriptor.lineCount,
        contentHash: descriptor.contentHash
      }
    };
  }

  private resolveExternalMapping(
    descriptor: DocumentEditorReviewDescriptor
  ): OwnedMapping {
    const canonicalUri = canonicalDocumentUri(
      descriptor.documentUri,
      descriptor.fileSystemPathSemantics
    );
    const repositoryId = this.createId("external-file-repository", canonicalUri);
    const ownerId = this.createId("external-file-owner", canonicalUri);
    const contextId = this.createId("external-file-context", canonicalUri);
    const fileId = this.createId("external-file", canonicalUri);
    const revisionId = `external-live:${ownerId}`;
    const timestamp = this.now().toISOString();

    return {
      owner: "external-file",
      repositoryTarget: {
        kind: "external-file",
        repositoryId,
        contextId
      },
      contextState: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextId,
        kind: "external-file",
        repositoryId,
        displayName: canonicalUri,
        externalFile: {
          canonicalUri,
          snapshotRevision: revisionId
        },
        files: {},
        createdAt: timestamp,
        updatedAt: timestamp
      },
      target: {
        fileId,
        currentPath: canonicalUri,
        revisionId,
        lineCount: descriptor.lineCount,
        contentHash: descriptor.contentHash
      }
    };
  }

  private initialCommit(mapping: OwnedMapping): ReviewStateCommit {
    return {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: cloneValue(mapping.contextState),
      globalState: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: mapping.repositoryTarget.repositoryId,
        currentRevisionId: mapping.target.revisionId,
        files: {},
        updatedAt: mapping.contextState.updatedAt
      }
    };
  }

  private validateLoadedIdentity(
    commit: ReviewStateCommit,
    mapping: OwnedMapping
  ): void {
    if (
      commit.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION ||
      commit.contextState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION ||
      commit.globalState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION
    ) {
      throw new Error("persisted document review state uses an unsupported schema version.");
    }
    if (
      commit.contextState.repositoryId !== mapping.repositoryTarget.repositoryId ||
      commit.globalState.repositoryId !== mapping.repositoryTarget.repositoryId ||
      commit.contextState.contextId !== mapping.repositoryTarget.contextId ||
      commit.contextState.kind !== mapping.contextState.kind
    ) {
      throw new Error("persisted document review state has a different owner identity.");
    }
    if (
      mapping.owner === "git" &&
      commit.contextState.branch?.refName !== mapping.contextState.branch?.refName
    ) {
      throw new Error("persisted Git review state has a different branch identity.");
    }
    if (
      mapping.owner === "external-file" &&
      commit.contextState.externalFile?.canonicalUri !==
        mapping.contextState.externalFile?.canonicalUri
    ) {
      throw new Error("persisted external-file state has a different canonical URI.");
    }
  }

  /** Resolves the stable mapped file identity retained by a Git rename. */
  private resolvePersistedFileMapping(
    commit: ReviewStateCommit,
    mapping: OwnedMapping
  ): OwnedMapping {
    if (mapping.owner !== "git") {
      return mapping;
    }

    const matchingFileIds = new Set<string>();
    for (const [fileId, file] of Object.entries(commit.contextState.files)) {
      if (file.currentPath === mapping.target.currentPath) {
        matchingFileIds.add(fileId);
      }
    }
    for (const [fileId, file] of Object.entries(commit.globalState.files)) {
      if (file.currentPath === mapping.target.currentPath) {
        matchingFileIds.add(fileId);
      }
    }

    if (matchingFileIds.size > 1) {
      throw new Error(
        "persisted Git review state has conflicting file identities for the current path."
      );
    }
    const fileId = matchingFileIds.values().next().value as string | undefined;
    if (fileId === undefined) {
      return mapping;
    }
    return {
      ...mapping,
      target: {
        ...mapping.target,
        fileId
      }
    };
  }

  private async openOwned(
    mapping: OwnedMapping
  ): Promise<DocumentNormalEditorReviewStateSession> {
    let commit = await this.options.repository.load(mapping.repositoryTarget);
    if (commit === undefined) {
      commit = this.initialCommit(mapping);
      await this.options.repository.save(mapping.repositoryTarget, commit);
      await this.options.historyRecorder?.recordContextCreated(commit.contextState);
    } else {
      this.validateLoadedIdentity(commit, mapping);
      if (
        contextRevision(commit.contextState) !== mapping.target.revisionId ||
        commit.globalState.currentRevisionId !== mapping.target.revisionId
      ) {
        throw new Error(
          "persisted review state requires revision mapping before it can be used."
        );
      }
      mapping = this.resolvePersistedFileMapping(commit, mapping);
    }

    const { contextStale, globalStale } = this.staleFileState(commit, mapping);

    if (contextStale || globalStale) {
      commit = await this.removeStaleFile(mapping, commit);
    }

    return {
      owner: mapping.owner,
      contextState: cloneValue(commit.contextState),
      globalState: cloneValue(commit.globalState),
      target: { ...mapping.target },
      committer: this.options.repository
    };
  }

  /** Removes one stale file through a complete-snapshot CAS and replans from the latest owner-wide state after a concurrent update. */
  private async removeStaleFile(
    mapping: OwnedMapping,
    initial: ReviewStateCommit
  ): Promise<ReviewStateCommit> {
    let current = initial;
    while (true) {
      const { contextStale, globalStale } = this.staleFileState(current, mapping);
      if (!contextStale && !globalStale) {
        return current;
      }
      const updatedAt = this.now().toISOString();
      const next: ReviewStateCommit = {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState: {
          ...cloneValue(current.contextState),
          files: contextStale
            ? withoutKey(current.contextState.files, mapping.target.fileId)
            : cloneValue(current.contextState.files),
          updatedAt
        },
        globalState: {
          ...cloneValue(current.globalState),
          files: globalStale
            ? withoutKey(current.globalState.files, mapping.target.fileId)
            : cloneValue(current.globalState.files),
          updatedAt
        }
      };
      try {
        await this.options.repository.commit({
          operation: "unmark-file-reviewed",
          repositoryId: mapping.repositoryTarget.repositoryId,
          contextId: mapping.repositoryTarget.contextId,
          fileId: mapping.target.fileId,
          expected: {
            contextState: current.contextState,
            globalState: current.globalState
          },
          next: {
            contextState: next.contextState,
            globalState: next.globalState
          }
        });
        if (contextStale) {
          await this.options.historyRecorder?.recordEditInvalidation(
            next.contextState,
            mapping.target,
            current.contextState.files[mapping.target.fileId]?.modifiedReviewed ?? [],
            next.contextState.files[mapping.target.fileId]?.modifiedReviewed ?? []
          );
        }
        return next;
      } catch (error) {
        if (!(error instanceof StaleReviewStateError)) {
          throw error;
        }
        const latest = await this.options.repository.load(mapping.repositoryTarget);
        if (latest === undefined) {
          throw new Error(
            "persisted review state disappeared during stale-file cleanup.",
            { cause: error }
          );
        }
        this.validateLoadedIdentity(latest, mapping);
        if (
          contextRevision(latest.contextState) !== mapping.target.revisionId ||
          latest.globalState.currentRevisionId !== mapping.target.revisionId
        ) {
          throw new Error(
            "persisted review state requires revision mapping before it can be used.",
            { cause: error }
          );
        }
        mapping = this.resolvePersistedFileMapping(latest, mapping);
        current = latest;
      }
    }
  }

  /** Re-evaluates each complete snapshot side so a cleanup retry removes only file state that is still stale for the current descriptor. */
  private staleFileState(
    commit: ReviewStateCommit,
    mapping: OwnedMapping
  ): { readonly contextStale: boolean; readonly globalStale: boolean } {
    const contextFile = commit.contextState.files[mapping.target.fileId];
    const globalFile = commit.globalState.files[mapping.target.fileId];
    return {
      contextStale: contextFile !== undefined && (
        contextFile.contentHash !== mapping.target.contentHash ||
        contextFile.revisionId !== mapping.target.revisionId ||
        contextFile.lineCount !== mapping.target.lineCount ||
        contextFile.currentPath !== mapping.target.currentPath
      ),
      globalStale: globalFile !== undefined && (
        globalFile.contentHash !== mapping.target.contentHash ||
        globalFile.revisionId !== mapping.target.revisionId ||
        globalFile.currentPath !== mapping.target.currentPath
      )
    };
  }

  private async loadOwnedForDecoration(
    mapping: OwnedMapping
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    const commit = await this.options.repository.load(mapping.repositoryTarget);
    if (commit === undefined) {
      return undefined;
    }
    this.validateLoadedIdentity(commit, mapping);
    mapping = this.resolvePersistedFileMapping(commit, mapping);

    const contextFile = commit.contextState.files[mapping.target.fileId];
    const globalFile = commit.globalState.files[mapping.target.fileId];
    const contextStale =
      contextRevision(commit.contextState) !== mapping.target.revisionId ||
      (contextFile !== undefined && (
        contextFile.contentHash !== mapping.target.contentHash ||
        contextFile.revisionId !== mapping.target.revisionId ||
        contextFile.lineCount !== mapping.target.lineCount ||
        contextFile.currentPath !== mapping.target.currentPath
      ));
    const globalStale =
      commit.globalState.currentRevisionId !== mapping.target.revisionId ||
      (globalFile !== undefined && (
        globalFile.contentHash !== mapping.target.contentHash ||
        globalFile.revisionId !== mapping.target.revisionId ||
        globalFile.currentPath !== mapping.target.currentPath
      ));

    return {
      owner: mapping.owner,
      contextState: {
        ...cloneValue(commit.contextState),
        files: contextStale
          ? withoutKey(commit.contextState.files, mapping.target.fileId)
          : cloneValue(commit.contextState.files)
      },
      globalState: {
        ...cloneValue(commit.globalState),
        files: globalStale
          ? withoutKey(commit.globalState.files, mapping.target.fileId)
          : cloneValue(commit.globalState.files)
      },
      target: { ...mapping.target }
    };
  }

  private async loadWorkspaceSource(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    if (descriptor.workspace === undefined) {
      return undefined;
    }
    const state = await this.options.workspaceProvider.loadForDecoration(
      this.toWorkspaceDescriptor(descriptor)
    );
    return state === undefined ? undefined : this.workspaceDecorationState(state);
  }

  private loadExternalSource(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.loadOwnedForDecoration(this.resolveExternalMapping(descriptor));
  }

  private async promoteFirstCertainSource(
    targetSession: DocumentNormalEditorReviewStateSession,
    sources: readonly (DocumentNormalEditorDecorationState | undefined)[]
  ): Promise<DocumentNormalEditorReviewStateSession> {
    if (
      targetSession.contextState.files[targetSession.target.fileId] !== undefined ||
      targetSession.globalState.files[targetSession.target.fileId] !== undefined
    ) {
      return targetSession;
    }

    for (const source of sources) {
      if (source === undefined) {
        continue;
      }
      const contextFile = source.contextState.files[source.target.fileId];
      const globalFile = source.globalState.files[source.target.fileId];
      if (
        source.target.contentHash !== targetSession.target.contentHash ||
        source.target.lineCount !== targetSession.target.lineCount
      ) {
        continue;
      }
      const intervals = [
        ...(contextFile?.modifiedReviewed ?? []),
        ...(globalFile?.reviewed ?? [])
      ];
      if (intervals.length === 0) {
        continue;
      }

      const transaction = markReviewedRanges({
        contextState: targetSession.contextState,
        globalState: targetSession.globalState,
        target: targetSession.target,
        intervals,
        occurredAt: this.now().toISOString()
      });
      await targetSession.committer.commit(transaction);
      return {
        ...targetSession,
        contextState: cloneValue(transaction.next.contextState) as ReviewContextState,
        globalState: cloneValue(transaction.next.globalState) as RepositoryGlobalState
      };
    }

    return targetSession;
  }
}

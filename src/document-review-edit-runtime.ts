import { randomUUID } from "node:crypto";
import path from "node:path";

import type { LocalGitAdapter, LocalGitRepository } from "./adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  StaleReviewStateError,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris,
  type ReviewStateTransactionLike
} from "./adapters/state-repository/index";
import { mapRepositoryGlobalStateThroughDocumentChanges } from "./application/global-review-mapping/index";
import { ReviewHistoryRecorder } from "./application/review-history/index";
import {
  WorkspaceIdentityService,
  type FileSystemPathSemantics,
  type ResourceUri,
  type StableHash
} from "./application/workspace-identity/index";
import type {
  FileReviewState,
  GlobalFileReviewState
} from "./core/contracts/index";
import {
  mapReviewedRangesThroughDocumentChanges,
  type DocumentContentChange,
  type RangeMappingOptions
} from "./core/range-mapping/index";
import type { SelectedReviewContext } from "./application/review-context/selected-review-context";

/** Workspace ownership evidence captured at the VS Code document boundary. */
export interface DocumentReviewEditWorkspaceSnapshot {
  readonly workspaceFolderUri: ResourceUri;
  readonly relativePath: string;
}

/** Immutable text snapshot captured synchronously at the VS Code document-event boundary. */
export interface DocumentReviewEditSnapshot {
  readonly documentKey: string;
  readonly documentUri: ResourceUri;
  readonly documentFsPath: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  readonly workspace?: DocumentReviewEditWorkspaceSnapshot;
  readonly text: string;
  readonly lineCount: number;
  readonly contentHash: string;
}

/** One VS Code-compatible content-change transaction whose coordinates refer to the immediately previous snapshot. */
export interface DocumentReviewEditRequest {
  readonly after: DocumentReviewEditSnapshot;
  readonly changes: readonly DocumentContentChange[];
  readonly options: Readonly<RangeMappingOptions>;
  /** Current Context accepted before this document event was queued. */
  readonly selectedContext?: SelectedReviewContext;
}

/** Observable disposition of one live-edit persistence request. */
export type DocumentReviewEditResult = "applied" | "no-op" | "unsupported-owner";

type DocumentReviewEditRepository = {
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void>;
};

type DocumentReviewEditHistoryRecorder = Pick<
  ReviewHistoryRecorder,
  "recordDocumentEditMapping"
>;

interface DocumentReviewEditRuntimeOptions {
  readonly storageUris: ReviewStateStorageUris;
  readonly repository?: DocumentReviewEditRepository;
  readonly historyRecorder?: DocumentReviewEditHistoryRecorder;
  readonly gitInspector: Pick<LocalGitAdapter, "inspectRepository">;
  readonly stableHash: StableHash;
  readonly now?: () => Date;
}

type FileDisposition = "missing" | "before" | "after" | "stale";

interface OwnerMappingBase {
  readonly repositoryTarget: ReviewStateRepositoryTarget;
  readonly repositoryId: string;
  readonly contextId: string;
  readonly revisionId: string;
  readonly currentPath: string;
  readonly defaultFileId: string;
}

interface GitOwnerMapping extends OwnerMappingBase {
  readonly kind: "git";
  readonly branchRef: string;
}

interface WorkspaceOwnerMapping extends OwnerMappingBase {
  readonly kind: "workspace";
  readonly workspaceId: string;
}

interface PullRequestOwnerMapping extends OwnerMappingBase {
  readonly kind: "pull-request";
  readonly pullRequestNumber: number;
}

type OwnerMapping = GitOwnerMapping | WorkspaceOwnerMapping | PullRequestOwnerMapping;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const withoutKey = <Value>(
  values: Readonly<Record<string, Value>>,
  key: string
): Record<string, Value> => Object.fromEntries(
  Object.entries(values)
    .filter(([entryKey]) => entryKey !== key)
    .map(([entryKey, value]) => [entryKey, clone(value)])
);

const pathApiFor = (semantics: FileSystemPathSemantics): typeof path.posix =>
  semantics === "windows" ? path.win32 : path.posix;

/**
 * Maps live filesystem edits through persisted Context and owner-wide Global state.
 * Same-document work is ordered locally while the persistence/history adapters provide
 * the shared same-process serialization boundary used by command and edit runtimes.
 */
export class DocumentReviewEditRuntime {
  private readonly repository: DocumentReviewEditRepository;
  private readonly historyRecorder: DocumentReviewEditHistoryRecorder;
  private readonly workspaceIdentityService: WorkspaceIdentityService;
  private readonly now: () => Date;
  private readonly observed = new Map<string, DocumentReviewEditSnapshot>();
  private readonly tails = new Map<string, Promise<void>>();

  public constructor(private readonly options: DocumentReviewEditRuntimeOptions) {
    this.repository = options.repository ?? new FileSystemReviewStateRepository({
      storageUris: options.storageUris
    });
    this.historyRecorder = options.historyRecorder ?? new ReviewHistoryRecorder({
      sessionId: randomUUID(),
      createEventId: randomUUID,
      appender: new JsonlReviewHistoryStore({ storageUris: options.storageUris })
    });
    this.workspaceIdentityService = new WorkspaceIdentityService(options.stableHash);
    this.now = options.now ?? (() => new Date());
  }

  /** Seeds or replaces the immediate pre-change snapshot for one open document. */
  public observe(snapshot: DocumentReviewEditSnapshot): void {
    this.observed.set(snapshot.documentKey, clone(snapshot));
  }

  /** Drops an editor snapshot after the document closes. */
  public forget(documentKey: string): void {
    this.observed.delete(documentKey);
  }

  /** Captures the already-observed pre-change snapshot and queues mapping in document order. */
  public apply(request: DocumentReviewEditRequest): Promise<DocumentReviewEditResult> {
    const before = this.observed.get(request.after.documentKey);
    this.observed.set(request.after.documentKey, clone(request.after));
    if (before === undefined || request.changes.length === 0) {
      return Promise.resolve("no-op");
    }

    const input = {
      before: clone(before),
      after: clone(request.after),
      changes: request.changes.map((change) => ({
        range: {
          start: { ...change.range.start },
          end: { ...change.range.end }
        },
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text
      })),
      options: { ...request.options },
      selectedContext: request.selectedContext === undefined
        ? undefined
        : { ...request.selectedContext }
    };
    const previous = this.tails.get(request.after.documentKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.persist(input));
    const tail = operation.then(() => undefined, () => undefined);
    this.tails.set(request.after.documentKey, tail);
    void tail.finally(() => {
      if (this.tails.get(request.after.documentKey) === tail) {
        this.tails.delete(request.after.documentKey);
      }
    });
    return operation;
  }

  /** Waits for every queued document mapping before extension deactivation. */
  public async drain(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }

  private async persist(input: {
    readonly before: DocumentReviewEditSnapshot;
    readonly after: DocumentReviewEditSnapshot;
    readonly changes: readonly DocumentContentChange[];
    readonly options: Readonly<RangeMappingOptions>;
    readonly selectedContext?: SelectedReviewContext;
  }): Promise<DocumentReviewEditResult> {
    this.assertSameDocument(input.before, input.after);
    const pathApi = pathApiFor(input.after.fileSystemPathSemantics);
    const inspection = await this.options.gitInspector.inspectRepository(
      pathApi.dirname(input.after.documentFsPath)
    );
    let owner = inspection.kind === "repository"
      ? this.resolveSelectedPullRequestOwner(input.after, inspection.repository, input.selectedContext)
        ?? this.resolveGitOwner(input.after, inspection.repository)
      : this.resolveWorkspaceOwner(input.after);
    if (owner === undefined) return "unsupported-owner";

    let current = await this.repository.load(owner.repositoryTarget);
    if (current === undefined && owner.kind === "pull-request" && inspection.kind === "repository") {
      owner = this.resolveGitOwner(input.after, inspection.repository);
      current = await this.repository.load(owner.repositoryTarget);
    }
    if (current === undefined) return "no-op";

    for (;;) {
      this.validateCommitIdentity(current, owner);
      const fileId = this.resolveFileId(current, owner);
      const contextFile = current.contextState.files[fileId];
      const globalFile = current.globalState.files[fileId];
      if (contextFile === undefined && globalFile === undefined) return "no-op";

      const contextDisposition = this.contextDisposition(
        contextFile,
        owner,
        input.before,
        input.after
      );
      const globalDisposition = this.globalDisposition(
        globalFile,
        owner,
        input.before,
        input.after
      );
      if (
        (contextDisposition === "missing" || contextDisposition === "after") &&
        (globalDisposition === "missing" || globalDisposition === "after")
      ) return "no-op";

      const updatedAt = this.now().toISOString();
      const next = this.mapNextCommit({
        current,
        owner,
        fileId,
        contextDisposition,
        globalDisposition,
        before: input.before,
        after: input.after,
        changes: input.changes,
        options: input.options,
        updatedAt
      });

      try {
        await this.repository.commit({
          repositoryId: owner.repositoryId,
          contextId: owner.contextId,
          expected: {
            contextState: current.contextState,
            globalState: current.globalState
          },
          next: {
            contextState: next.contextState,
            globalState: next.globalState
          }
        });
        await this.historyRecorder.recordDocumentEditMapping(
          current,
          next,
          fileId,
          updatedAt
        );
        return "applied";
      } catch (error) {
        if (!(error instanceof StaleReviewStateError)) throw error;
        const latest = await this.repository.load(owner.repositoryTarget);
        if (latest === undefined) {
          throw new Error(
            "review state disappeared while a live document edit was being mapped.",
            { cause: error }
          );
        }
        current = latest;
      }
    }
  }

  private mapNextCommit(input: {
    readonly current: ReviewStateCommit;
    readonly owner: OwnerMapping;
    readonly fileId: string;
    readonly contextDisposition: FileDisposition;
    readonly globalDisposition: FileDisposition;
    readonly before: DocumentReviewEditSnapshot;
    readonly after: DocumentReviewEditSnapshot;
    readonly changes: readonly DocumentContentChange[];
    readonly options: Readonly<RangeMappingOptions>;
    readonly updatedAt: string;
  }): ReviewStateCommit {
    const previousContextFile = input.current.contextState.files[input.fileId];
    let contextFiles = clone(input.current.contextState.files);
    if (input.contextDisposition === "before" && previousContextFile !== undefined) {
      const mapped = mapReviewedRangesThroughDocumentChanges({
        beforeText: input.before.text,
        reviewed: previousContextFile.modifiedReviewed,
        changes: input.changes,
        options: input.options
      });
      if (mapped.lineCount !== input.after.lineCount) {
        throw new Error(
          "VS Code document line count does not match the deterministic edit mapping result."
        );
      }
      contextFiles[input.fileId] = {
        ...clone(previousContextFile),
        modifiedReviewed: mapped.reviewed,
        contentHash: input.after.contentHash,
        lineCount: input.after.lineCount,
        updatedAt: input.updatedAt
      };
    } else if (input.contextDisposition === "stale") {
      contextFiles = withoutKey(contextFiles, input.fileId);
    }

    let globalState = clone(input.current.globalState);
    if (input.globalDisposition === "before") {
      globalState = mapRepositoryGlobalStateThroughDocumentChanges({
        globalState: input.current.globalState,
        fileId: input.fileId,
        beforeText: input.before.text,
        changes: input.changes,
        newRevisionId: input.owner.revisionId,
        newContentHash: input.after.contentHash,
        updatedAt: input.updatedAt,
        options: input.options
      });
    } else if (input.globalDisposition === "stale") {
      globalState = {
        ...globalState,
        files: withoutKey(globalState.files, input.fileId),
        updatedAt: input.updatedAt
      };
    }

    const contextChanged =
      input.contextDisposition === "before" || input.contextDisposition === "stale";
    return {
      schemaVersion: input.current.schemaVersion,
      contextState: {
        ...clone(input.current.contextState),
        files: contextFiles,
        ...(contextChanged ? { updatedAt: input.updatedAt } : {})
      },
      globalState
    };
  }

  private resolveGitOwner(
    snapshot: DocumentReviewEditSnapshot,
    repository: LocalGitRepository
  ): GitOwnerMapping {
    const pathApi = pathApiFor(snapshot.fileSystemPathSemantics);
    const relativePath = pathApi.relative(
      pathApi.resolve(repository.rootPath),
      pathApi.resolve(snapshot.documentFsPath)
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relativePath)
    ) throw new Error("document path is outside the resolved Git working tree.");
    if (repository.head === undefined) {
      throw new Error("live edit mapping requires a concrete Git HEAD revision.");
    }

    const normalizedPath = relativePath.split(pathApi.sep).join("/");
    const currentPath = snapshot.fileSystemPathSemantics === "windows"
      ? normalizedPath.toLowerCase()
      : normalizedPath;
    const branchRef = repository.branch.kind === "branch"
      ? repository.branch.fullRef
      : `HEAD@${repository.head}`;
    const contextId = this.createId(
      repository.branch.kind === "branch" ? "branch-context" : "detached-context",
      repository.repositoryId,
      branchRef
    );
    return {
      kind: "git",
      repositoryTarget: {
        kind: "git",
        repositoryId: repository.repositoryId,
        contextId
      },
      repositoryId: repository.repositoryId,
      contextId,
      revisionId: repository.head,
      branchRef,
      currentPath,
      defaultFileId: this.createId("repository-file", repository.repositoryId, currentPath)
    };
  }

  private resolveSelectedPullRequestOwner(
    snapshot: DocumentReviewEditSnapshot,
    repository: LocalGitRepository,
    selectedContext: SelectedReviewContext | undefined
  ): PullRequestOwnerMapping | undefined {
    if (
      selectedContext?.kind !== "pull-request" ||
      selectedContext.repositoryId !== repository.repositoryId ||
      selectedContext.repositoryRoot !== repository.rootPath ||
      selectedContext.headRevision !== repository.head
    ) return undefined;
    if (repository.head === undefined) return undefined;
    const pathApi = pathApiFor(snapshot.fileSystemPathSemantics);
    const relativePath = pathApi.relative(
      pathApi.resolve(repository.rootPath),
      pathApi.resolve(snapshot.documentFsPath)
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relativePath)
    ) return undefined;
    const normalizedPath = relativePath.split(pathApi.sep).join("/");
    const currentPath = snapshot.fileSystemPathSemantics === "windows"
      ? normalizedPath.toLowerCase()
      : normalizedPath;
    return {
      kind: "pull-request",
      repositoryTarget: {
        kind: "pull-request",
        repositoryId: selectedContext.repositoryId,
        contextId: selectedContext.contextId
      },
      repositoryId: selectedContext.repositoryId,
      contextId: selectedContext.contextId,
      revisionId: selectedContext.headRevision,
      pullRequestNumber: selectedContext.pullRequestNumber,
      currentPath,
      defaultFileId: this.createId("repository-file", selectedContext.repositoryId, currentPath)
    };
  }

  private resolveWorkspaceOwner(
    snapshot: DocumentReviewEditSnapshot
  ): WorkspaceOwnerMapping | undefined {
    if (snapshot.workspace === undefined) return undefined;
    const identity = this.workspaceIdentityService.resolve({
      workspaceFolderUri: snapshot.workspace.workspaceFolderUri,
      documentUri: snapshot.documentUri,
      fileSystemPathSemantics: snapshot.fileSystemPathSemantics,
      relativePath: snapshot.workspace.relativePath
    });
    const revisionId = `workspace-live:${identity.workspaceId}`;
    return {
      kind: "workspace",
      repositoryTarget: {
        kind: "workspace",
        repositoryId: identity.repositoryId,
        contextId: identity.workspaceContextId
      },
      repositoryId: identity.repositoryId,
      contextId: identity.workspaceContextId,
      revisionId,
      workspaceId: identity.workspaceId,
      currentPath: identity.relativePath,
      defaultFileId: identity.fileId
    };
  }

  private resolveFileId(commit: ReviewStateCommit, owner: OwnerMapping): string {
    const contextMatches = Object.entries(commit.contextState.files)
      .filter(([, file]) => file.currentPath === owner.currentPath)
      .map(([fileId]) => fileId);
    const globalMatches = Object.entries(commit.globalState.files)
      .filter(([, file]) => file.currentPath === owner.currentPath)
      .map(([fileId]) => fileId);
    const identities = new Set([...contextMatches, ...globalMatches]);
    if (identities.size > 1) {
      throw new Error(
        "live edit mapping found conflicting persisted file identities for one current path."
      );
    }
    const resolved = identities.values().next().value as string | undefined ?? owner.defaultFileId;
    if (owner.kind === "workspace" && resolved !== owner.defaultFileId) {
      throw new Error("workspace live edit mapping found a persisted file identity mismatch.");
    }
    return resolved;
  }

  private contextDisposition(
    file: FileReviewState | undefined,
    owner: OwnerMapping,
    before: DocumentReviewEditSnapshot,
    after: DocumentReviewEditSnapshot
  ): FileDisposition {
    if (file === undefined) return "missing";
    if (file.currentPath !== owner.currentPath || file.revisionId !== owner.revisionId) {
      return "stale";
    }
    if (file.contentHash === after.contentHash && file.lineCount === after.lineCount) {
      return "after";
    }
    if (file.contentHash === before.contentHash && file.lineCount === before.lineCount) {
      return "before";
    }
    return "stale";
  }

  private globalDisposition(
    file: GlobalFileReviewState | undefined,
    owner: OwnerMapping,
    before: DocumentReviewEditSnapshot,
    after: DocumentReviewEditSnapshot
  ): FileDisposition {
    if (file === undefined) return "missing";
    if (file.currentPath !== owner.currentPath || file.revisionId !== owner.revisionId) {
      return "stale";
    }
    if (file.contentHash === after.contentHash) return "after";
    if (file.contentHash === before.contentHash) return "before";
    return "stale";
  }

  private validateCommitIdentity(commit: ReviewStateCommit, owner: OwnerMapping): void {
    if (
      commit.contextState.repositoryId !== owner.repositoryId ||
      commit.globalState.repositoryId !== owner.repositoryId ||
      commit.contextState.contextId !== owner.contextId ||
      commit.globalState.currentRevisionId !== owner.revisionId
    ) {
      throw new Error(
        "persisted review state no longer matches the owner observed for the live edit."
      );
    }
    if (owner.kind === "git") {
      if (
        commit.contextState.kind !== "branch" ||
        commit.contextState.branch?.refName !== owner.branchRef ||
        commit.contextState.branch?.headRevision !== owner.revisionId
      ) {
        throw new Error(
          "persisted review state no longer matches the Git owner observed for the live edit."
        );
      }
      return;
    }
    if (owner.kind === "pull-request") {
      if (
        commit.contextState.kind !== "pull-request" ||
        commit.contextState.pullRequest?.number !== owner.pullRequestNumber ||
        commit.contextState.pullRequest?.headSha !== owner.revisionId
      ) {
        throw new Error(
          "persisted review state no longer matches the selected pull-request owner observed for the live edit."
        );
      }
      return;
    }
    if (
      commit.contextState.kind !== "workspace" ||
      commit.contextState.workspace?.workspaceId !== owner.workspaceId ||
      commit.contextState.workspace?.snapshotRevision !== owner.revisionId
    ) {
      throw new Error(
        "persisted review state no longer matches the workspace owner observed for the live edit."
      );
    }
  }

  private assertSameDocument(
    before: DocumentReviewEditSnapshot,
    after: DocumentReviewEditSnapshot
  ): void {
    if (
      before.documentKey !== after.documentKey ||
      before.documentFsPath !== after.documentFsPath ||
      before.fileSystemPathSemantics !== after.fileSystemPathSemantics ||
      before.documentUri.scheme !== after.documentUri.scheme ||
      before.documentUri.authority !== after.documentUri.authority ||
      before.documentUri.path !== after.documentUri.path ||
      JSON.stringify(before.workspace ?? null) !== JSON.stringify(after.workspace ?? null)
    ) throw new Error("document identity changed within one content-change transaction.");
  }

  private createId(domain: string, ...parts: readonly string[]): string {
    const digest = this.options.stableHash.digest([domain, ...parts].join("\0"));
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }
    return `${domain}:${digest}`;
  }
}

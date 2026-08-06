import { NodeSha256StableHash } from "./adapters/crypto/index";
import {
  NodeGlobalUnderstandingFileSource
} from "./adapters/repository-files/node-global-understanding-file-source";
import {
  NodeRepositoryFileEnumerator
} from "./adapters/repository-files/node-repository-file-enumerator";
import {
  FileSystemReviewStateRepository,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "./adapters/state-repository/index";
import {
  GlobalUnderstandingBackgroundRecalculator,
  InMemoryGlobalUnderstandingProgressCache
} from "./application/global-understanding/index";
import {
  type FileSystemPathSemantics,
  type ResourceUri,
  WorkspaceIdentityService
} from "./application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState
} from "./core/contracts/index";
import { ReviewFileExclusionPolicy } from "./core/file-exclusion/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import type {
  GlobalUnderstandingRuntimeSource,
  GlobalUnderstandingTreeSnapshot
} from "./ui/global-understanding/index";

export interface T505GlobalUnderstandingSourceDependencies {
  readonly storageUris: ReviewStateStorageUris;
  readonly readExcludeGlobs: () => readonly string[];
  readonly fileSystemPathSemantics?: FileSystemPathSemantics;
  readonly yieldControl?: () => void | Promise<void>;
}

interface ResolvedGlobalUnderstandingOwner {
  readonly repositoryRoot: string;
  readonly target: ReviewStateRepositoryTarget;
  readonly currentRevisionId: string;
}

const syntheticWorkspaceDocument = (workspace: ResourceUri): ResourceUri => ({
  scheme: workspace.scheme,
  authority: workspace.authority,
  path: `${workspace.path.replace(/\/$/u, "")}/.review-range-global-identity`,
  query: "",
  fragment: ""
});

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const emptyGlobalState = (
  repositoryId: string,
  currentRevisionId: string
): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId,
  files: {},
  updatedAt: new Date(0).toISOString()
});

/** Composition-root source that joins T503 enumeration, T504 calculation, and persisted Global state. */
export class T505GlobalUnderstandingSource
implements GlobalUnderstandingRuntimeSource {
  private readonly repository: FileSystemReviewStateRepository;
  private readonly cache = new InMemoryGlobalUnderstandingProgressCache();
  private readonly identity = new WorkspaceIdentityService(
    new NodeSha256StableHash()
  );
  private readonly pathSemantics: FileSystemPathSemantics;
  private readonly yieldControl: () => void | Promise<void>;
  private currentContext: CurrentContextUiSnapshot | undefined;

  public constructor(
    private readonly dependencies: T505GlobalUnderstandingSourceDependencies
  ) {
    this.repository = new FileSystemReviewStateRepository({
      storageUris: dependencies.storageUris
    });
    this.pathSemantics = dependencies.fileSystemPathSemantics ??
      (process.platform === "win32" ? "windows" : "posix");
    this.yieldControl = dependencies.yieldControl ?? defaultYieldControl;
  }

  public setContext(snapshot: CurrentContextUiSnapshot | undefined): void {
    this.currentContext = snapshot;
  }

  public async recalculate(): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return undefined;

    const policy = new ReviewFileExclusionPolicy({
      userGlobs: this.dependencies.readExcludeGlobs()
    });
    const enumeration = await new NodeRepositoryFileEnumerator(policy).enumerate(
      owner.repositoryRoot
    );
    const persisted = await this.repository.loadGlobal(owner.target);
    const globalState =
      persisted?.currentRevisionId === owner.currentRevisionId
        ? persisted
        : emptyGlobalState(
            owner.target.repositoryId,
            owner.currentRevisionId
          );
    const recalculator = new GlobalUnderstandingBackgroundRecalculator({
      source: new NodeGlobalUnderstandingFileSource(
        owner.repositoryRoot,
        this.pathSemantics
      ),
      cache: this.cache,
      yieldControl: this.yieldControl
    });
    const result = await recalculator.recalculate({
      globalState,
      included: enumeration.included,
      configurationKey: JSON.stringify(policy.getUserGlobs())
    });

    return {
      progress: result.progress,
      excludedFileCount: enumeration.excluded.length,
      prunedExcludedDirectoryCount: enumeration.excludedDirectories.length
    };
  }

  private resolveOwner(
    snapshot: CurrentContextUiSnapshot | undefined
  ): ResolvedGlobalUnderstandingOwner | undefined {
    const selection = snapshot?.context.selection;
    if (snapshot === undefined || selection === undefined) return undefined;

    if (selection.kind === "branch") {
      const currentRevisionId = snapshot.context.headRevision;
      if (currentRevisionId === undefined) return undefined;
      return {
        repositoryRoot: selection.repositoryRoot,
        target: {
          kind: "git",
          repositoryId: selection.repositoryId,
          contextId: `global-understanding:${selection.repositoryId}`
        },
        currentRevisionId
      };
    }

    if (selection.kind === "detached") {
      return {
        repositoryRoot: selection.repositoryRoot,
        target: {
          kind: "git",
          repositoryId: selection.repositoryId,
          contextId: `global-understanding:${selection.repositoryId}`
        },
        currentRevisionId: selection.headRevision
      };
    }

    if (snapshot.context.detail === undefined) return undefined;
    const identity = this.identity.resolve({
      workspaceFolderUri: selection.workspaceFolderUri,
      documentUri: syntheticWorkspaceDocument(selection.workspaceFolderUri),
      fileSystemPathSemantics: this.pathSemantics,
      relativePath: ".review-range-global-identity"
    });
    return {
      repositoryRoot: snapshot.context.detail,
      target: {
        kind: "workspace",
        repositoryId: identity.repositoryId,
        contextId: identity.workspaceContextId
      },
      currentRevisionId: `workspace-live:${identity.workspaceId}`
    };
  }
}

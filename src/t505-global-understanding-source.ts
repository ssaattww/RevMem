import { NodeSha256StableHash } from "./adapters/crypto/index";
import { NodeRepositoryFilePathEnumerator } from "./adapters/repository-files/node-repository-file-path-enumerator";
import { FileSystemReviewStateRepository, type ReviewStateRepositoryTarget, type ReviewStateStorageUris } from "./adapters/state-repository/index";
import type { ReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { GlobalUnderstandingBackgroundRecalculator, InMemoryGlobalUnderstandingProgressCache, type GlobalUnderstandingFileSource, type LoadedGlobalUnderstandingFile } from "./application/global-understanding/index";
import { requireCanonicalRepositoryRelativePath } from "./application/repository-path/index";
import { type FileSystemPathSemantics, type ResourceUri, WorkspaceIdentityService } from "./application/workspace-identity/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState } from "./core/contracts/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import type { GlobalUnderstandingRuntimeSource, GlobalUnderstandingTreeSnapshot } from "./ui/global-understanding/index";

export type T505GlobalUnderstandingExclusionPolicy = Pick<ReviewFileExclusionPolicyService, "evaluate" | "evaluateDirectory" | "getRevision">;

export interface T505GlobalUnderstandingOwner {
  readonly repositoryRoot: string;
  readonly target: ReviewStateRepositoryTarget;
  readonly currentRevisionId: string;
}

export interface T505GlobalUnderstandingSourceDependencies {
  readonly storageUris: ReviewStateStorageUris;
  readonly exclusionPolicy: T505GlobalUnderstandingExclusionPolicy;
  readonly readOpenDocuments?: (owner: Readonly<T505GlobalUnderstandingOwner>) => readonly LoadedGlobalUnderstandingFile[];
  readonly fileSystemPathSemantics?: FileSystemPathSemantics;
  readonly yieldControl?: () => void | Promise<void>;
}

const syntheticWorkspaceDocument = (workspace: ResourceUri): ResourceUri => ({
  scheme: workspace.scheme,
  authority: workspace.authority,
  path: `${workspace.path.replace(/\/$/u, "")}/.review-range-global-identity`,
  query: "",
  fragment: ""
});

const defaultYieldControl = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const emptyGlobalState = (repositoryId: string, currentRevisionId: string): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId,
  files: {},
  updatedAt: new Date(0).toISOString()
});

const ownerEvidenceKey = (owner: T505GlobalUnderstandingOwner): string =>
  `${JSON.stringify(owner.target)}\0${owner.currentRevisionId}`;

const stableOpenedEvidence = (
  snapshot: LoadedGlobalUnderstandingFile,
  path: string
): LoadedGlobalUnderstandingFile => ({
  path,
  revisionId: snapshot.revisionId,
  lineCount: snapshot.lineCount,
  nonEmptyLines: [...snapshot.nonEmptyLines],
  contentHash: snapshot.contentHash,
  cacheKey: snapshot.cacheKey
});

/**
 * Composition-root source for Global understanding.
 *
 * Issue #59 deliberately separates cheap repository path discovery from line
 * evidence. Only files observed through an open VS Code document contribute to
 * the line denominator; their last observed evidence remains available after the
 * editor closes for the lifetime of this Extension Host.
 */
export class T505GlobalUnderstandingSource implements GlobalUnderstandingRuntimeSource {
  private readonly repository: FileSystemReviewStateRepository;
  private readonly cache = new InMemoryGlobalUnderstandingProgressCache();
  private readonly identity = new WorkspaceIdentityService(new NodeSha256StableHash());
  private readonly pathSemantics: FileSystemPathSemantics;
  private readonly yieldControl: () => void | Promise<void>;
  private readonly openedEvidenceByOwner = new Map<string, Map<string, LoadedGlobalUnderstandingFile>>();
  private currentContext: CurrentContextUiSnapshot | undefined;

  public constructor(private readonly dependencies: T505GlobalUnderstandingSourceDependencies) {
    this.repository = new FileSystemReviewStateRepository({ storageUris: dependencies.storageUris });
    this.pathSemantics = dependencies.fileSystemPathSemantics ?? (process.platform === "win32" ? "windows" : "posix");
    this.yieldControl = dependencies.yieldControl ?? defaultYieldControl;
  }

  public setContext(snapshot: CurrentContextUiSnapshot | undefined): void { this.currentContext = snapshot; }

  public async recalculate(): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return undefined;

    const pathEnumeration = await new NodeRepositoryFilePathEnumerator(
      this.dependencies.exclusionPolicy
    ).enumerate(owner.repositoryRoot);
    const evidenceByPath = this.captureOpenedDocuments(owner);
    const candidatePaths = new Set(pathEnumeration.includedPaths);
    const openedByPath = new Map(
      [...evidenceByPath].filter(([repositoryPath]) => candidatePaths.has(repositoryPath))
    );
    const included = [...openedByPath].map(([repositoryPath, evidence]) => ({
      path: repositoryPath,
      nonEmptyLineCount: evidence.nonEmptyLines.length
    }));

    const persisted = await this.repository.loadGlobal(owner.target);
    const globalState = persisted?.currentRevisionId === owner.currentRevisionId
      ? persisted
      : emptyGlobalState(owner.target.repositoryId, owner.currentRevisionId);
    const source: GlobalUnderstandingFileSource = {
      load: async (repositoryPath, revisionId) => {
        const evidence = openedByPath.get(repositoryPath);
        if (evidence === undefined) {
          throw new Error(`Opened Global evidence is unavailable: ${repositoryPath}`);
        }
        if (evidence.revisionId !== revisionId) {
          throw new Error(`Opened document revision does not match current owner revision: ${repositoryPath}`);
        }
        return { ...evidence, nonEmptyLines: [...evidence.nonEmptyLines] };
      }
    };
    const recalculator = new GlobalUnderstandingBackgroundRecalculator({
      source,
      cache: this.cache,
      yieldControl: this.yieldControl
    });
    const result = await recalculator.recalculate({
      globalState,
      included,
      openFilePaths: [...openedByPath.keys()],
      configurationKey: `exclusion-policy:${this.dependencies.exclusionPolicy.getRevision()}`
    });
    return {
      progress: result.progress,
      openedFileCount: openedByPath.size,
      unopenedFileCount: Math.max(0, pathEnumeration.includedPaths.length - openedByPath.size),
      excludedFileCount: pathEnumeration.excluded.length,
      prunedExcludedDirectoryCount: pathEnumeration.excludedDirectories.length
    };
  }

  private captureOpenedDocuments(
    owner: T505GlobalUnderstandingOwner
  ): ReadonlyMap<string, LoadedGlobalUnderstandingFile> {
    const key = ownerEvidenceKey(owner);
    let retained = this.openedEvidenceByOwner.get(key);
    if (retained === undefined) {
      retained = new Map<string, LoadedGlobalUnderstandingFile>();
      this.openedEvidenceByOwner.set(key, retained);
    }

    const current = new Map<string, LoadedGlobalUnderstandingFile>();
    for (const snapshot of this.dependencies.readOpenDocuments?.(owner) ?? []) {
      const canonicalPath = requireCanonicalRepositoryRelativePath(snapshot.path, this.pathSemantics);
      if (snapshot.revisionId !== owner.currentRevisionId) {
        throw new Error(`Open document revision does not match current owner revision: ${canonicalPath}`);
      }
      if (current.has(canonicalPath)) {
        throw new Error(`Duplicate open document path: ${canonicalPath}`);
      }
      const live = { ...snapshot, path: canonicalPath, nonEmptyLines: [...snapshot.nonEmptyLines] };
      current.set(canonicalPath, live);
      retained.set(canonicalPath, stableOpenedEvidence(snapshot, canonicalPath));
    }

    const combined = new Map(retained);
    for (const [repositoryPath, snapshot] of current) combined.set(repositoryPath, snapshot);
    return combined;
  }

  private resolveOwner(snapshot: CurrentContextUiSnapshot | undefined): T505GlobalUnderstandingOwner | undefined {
    const selection = snapshot?.context.selection;
    if (snapshot === undefined || selection === undefined) return undefined;

    if (selection.kind === "pull-request") {
      return {
        repositoryRoot: selection.repositoryRoot,
        target: {
          kind: "pull-request",
          repositoryId: selection.repositoryId,
          contextId: selection.contextId
        },
        currentRevisionId: selection.headRevision
      };
    }
    if (selection.kind === "branch") {
      const currentRevisionId = snapshot.context.headRevision;
      if (currentRevisionId === undefined) return undefined;
      return {
        repositoryRoot: selection.repositoryRoot,
        target: { kind: "git", repositoryId: selection.repositoryId, contextId: `global-understanding:${selection.repositoryId}` },
        currentRevisionId
      };
    }
    if (selection.kind === "detached") {
      return {
        repositoryRoot: selection.repositoryRoot,
        target: { kind: "git", repositoryId: selection.repositoryId, contextId: `global-understanding:${selection.repositoryId}` },
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
      target: { kind: "workspace", repositoryId: identity.repositoryId, contextId: identity.workspaceContextId },
      currentRevisionId: `workspace-live:${identity.workspaceId}`
    };
  }
}

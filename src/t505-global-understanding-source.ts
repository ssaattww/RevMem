import { NodeSha256StableHash } from "./adapters/crypto/index";
import { NodeRepositoryFilePathEnumerator } from "./adapters/repository-files/node-repository-file-path-enumerator";
import { FileSystemReviewStateRepository, type ReviewStateRepositoryTarget, type ReviewStateStorageUris } from "./adapters/state-repository/index";
import type { ReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { GlobalUnderstandingBackgroundRecalculator, InMemoryGlobalUnderstandingProgressCache, type GlobalUnderstandingFileSource, type LoadedGlobalUnderstandingFile } from "./application/global-understanding/index";
import {
  readRegisteredPullRequestGlobalHeadFiles,
  type PullRequestGlobalHeadFile,
} from "./application/global-understanding/pull-request-global-head-file-registry";
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
  readonly readPullRequestHeadFiles?: (
    owner: Readonly<T505GlobalUnderstandingOwner>,
    candidatePaths: ReadonlySet<string>
  ) => Promise<readonly PullRequestGlobalHeadFile[]>;
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

const ownerIdentityKey = (owner: T505GlobalUnderstandingOwner): string =>
  JSON.stringify(owner.target);

const ownerEvidenceKey = (owner: T505GlobalUnderstandingOwner): string =>
  `${ownerIdentityKey(owner)}\0${owner.currentRevisionId}`;

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
 * evidence. Ordinary files contribute only after they have been opened. When a
 * pull request is the active context, every reviewable changed HEAD-side file is
 * scanned in full once from the immutable PR snapshot, cached by exact PR HEAD,
 * and promoted to the same opened evidence set. Working-tree path existence does
 * not gate immutable PR evidence. Only the active revision is retained per owner.
 */
export class T505GlobalUnderstandingSource implements GlobalUnderstandingRuntimeSource {
  private readonly repository: FileSystemReviewStateRepository;
  private readonly cache = new InMemoryGlobalUnderstandingProgressCache();
  private readonly stableHash = new NodeSha256StableHash();
  private readonly identity = new WorkspaceIdentityService(new NodeSha256StableHash());
  private readonly pathSemantics: FileSystemPathSemantics;
  private readonly yieldControl: () => void | Promise<void>;
  private readonly openedEvidenceByOwner = new Map<string, Map<string, LoadedGlobalUnderstandingFile>>();
  private readonly pullRequestEvidenceByOwner = new Map<string, Map<string, LoadedGlobalUnderstandingFile>>();
  private readonly activeEvidenceKeyByOwner = new Map<string, string>();
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
    this.activateEvidenceRevision(owner);

    const pathEnumeration = await new NodeRepositoryFilePathEnumerator(
      this.dependencies.exclusionPolicy
    ).enumerate(owner.repositoryRoot);
    this.requireActiveEvidenceKey(owner);
    const candidatePaths = new Set<string>();
    for (const repositoryPath of pathEnumeration.includedPaths) {
      const canonicalPath = this.canonicalEvidencePath(repositoryPath);
      if (candidatePaths.has(canonicalPath)) {
        throw new Error(`Duplicate Global candidate path: ${canonicalPath}`);
      }
      candidatePaths.add(canonicalPath);
    }
    const pullRequestHeadPaths = await this.capturePullRequestHeadFiles(owner, candidatePaths);
    const availablePaths = new Set([...candidatePaths, ...pullRequestHeadPaths]);
    const evidenceByPath = this.captureOpenedDocuments(owner);
    const openedByPath = new Map(
      [...evidenceByPath].filter(([repositoryPath]) => availablePaths.has(repositoryPath))
    );
    const included = [...openedByPath].map(([repositoryPath, evidence]) => ({
      path: repositoryPath,
      nonEmptyLineCount: evidence.nonEmptyLines.length
    }));

    const persisted = await this.repository.loadGlobal(owner.target);
    this.requireActiveEvidenceKey(owner);
    const globalState = persisted?.currentRevisionId === owner.currentRevisionId
      ? persisted
      : emptyGlobalState(owner.target.repositoryId, owner.currentRevisionId);
    const source: GlobalUnderstandingFileSource = {
      load: async (repositoryPath, revisionId) => {
        this.requireActiveEvidenceKey(owner);
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
    this.requireActiveEvidenceKey(owner);
    return {
      progress: result.progress,
      openedFileCount: openedByPath.size,
      unopenedFileCount: Math.max(0, availablePaths.size - openedByPath.size),
      excludedFileCount: pathEnumeration.excluded.length,
      prunedExcludedDirectoryCount: pathEnumeration.excludedDirectories.length
    };
  }

  private activateEvidenceRevision(owner: T505GlobalUnderstandingOwner): string {
    const identityKey = ownerIdentityKey(owner);
    const nextEvidenceKey = ownerEvidenceKey(owner);
    const previousEvidenceKey = this.activeEvidenceKeyByOwner.get(identityKey);
    if (previousEvidenceKey !== undefined && previousEvidenceKey !== nextEvidenceKey) {
      this.openedEvidenceByOwner.delete(previousEvidenceKey);
      this.pullRequestEvidenceByOwner.delete(previousEvidenceKey);
    }
    this.activeEvidenceKeyByOwner.set(identityKey, nextEvidenceKey);
    return nextEvidenceKey;
  }

  private requireActiveEvidenceKey(owner: T505GlobalUnderstandingOwner): string {
    const identityKey = ownerIdentityKey(owner);
    const expectedEvidenceKey = ownerEvidenceKey(owner);
    if (this.activeEvidenceKeyByOwner.get(identityKey) !== expectedEvidenceKey) {
      throw new Error("Global owner revision changed during recalculation");
    }
    return expectedEvidenceKey;
  }

  private retainedOpenedEvidence(owner: T505GlobalUnderstandingOwner): Map<string, LoadedGlobalUnderstandingFile> {
    const key = this.requireActiveEvidenceKey(owner);
    let retained = this.openedEvidenceByOwner.get(key);
    if (retained === undefined) {
      retained = new Map<string, LoadedGlobalUnderstandingFile>();
      this.openedEvidenceByOwner.set(key, retained);
    }
    return retained;
  }

  private async capturePullRequestHeadFiles(
    owner: T505GlobalUnderstandingOwner,
    candidatePaths: ReadonlySet<string>
  ): Promise<ReadonlySet<string>> {
    if (owner.target.kind !== "pull-request") return new Set<string>();

    this.requireActiveEvidenceKey(owner);
    const snapshots = this.dependencies.readPullRequestHeadFiles === undefined
      ? await readRegisteredPullRequestGlobalHeadFiles({
          contextId: owner.target.contextId,
          headRevision: owner.currentRevisionId,
          candidatePaths,
        })
      : await this.dependencies.readPullRequestHeadFiles(owner, candidatePaths);
    const key = this.requireActiveEvidenceKey(owner);
    let parsed = this.pullRequestEvidenceByOwner.get(key);
    if (parsed === undefined) {
      parsed = new Map<string, LoadedGlobalUnderstandingFile>();
      this.pullRequestEvidenceByOwner.set(key, parsed);
    }
    const retained = this.retainedOpenedEvidence(owner);
    const seen = new Set<string>();
    const acceptedPaths = new Set<string>();

    for (const snapshot of snapshots) {
      const sourcePath = requireCanonicalRepositoryRelativePath(snapshot.path, this.pathSemantics);
      if (this.dependencies.exclusionPolicy.evaluate({ path: sourcePath, isBinary: false }).excluded) continue;
      const canonicalPath = this.canonicalEvidencePath(sourcePath);
      if (snapshot.revisionId !== owner.currentRevisionId) {
        throw new Error(`PR HEAD evidence revision does not match current owner revision: ${canonicalPath}`);
      }
      if (seen.has(canonicalPath)) {
        throw new Error(`Duplicate PR HEAD evidence path: ${canonicalPath}`);
      }
      seen.add(canonicalPath);
      acceptedPaths.add(canonicalPath);

      let evidence = parsed.get(canonicalPath);
      if (evidence === undefined) {
        const lines = snapshot.content.split(/\r\n|\r|\n/u);
        const nonEmptyLines: number[] = [];
        for (let line = 0; line < lines.length; line += 1) {
          if (lines[line]!.trim().length > 0) nonEmptyLines.push(line);
        }
        const contentHash = this.stableHash.digest(snapshot.content);
        evidence = {
          path: canonicalPath,
          revisionId: owner.currentRevisionId,
          lineCount: lines.length,
          nonEmptyLines,
          contentHash,
          cacheKey: `pr-head:${owner.target.repositoryId}:${owner.target.contextId}:${owner.currentRevisionId}:${canonicalPath}:${contentHash}`
        };
        parsed.set(canonicalPath, evidence);
      }
      retained.set(canonicalPath, stableOpenedEvidence(evidence, canonicalPath));
    }
    return acceptedPaths;
  }

  private captureOpenedDocuments(
    owner: T505GlobalUnderstandingOwner
  ): ReadonlyMap<string, LoadedGlobalUnderstandingFile> {
    const retained = this.retainedOpenedEvidence(owner);
    const current = new Map<string, LoadedGlobalUnderstandingFile>();
    for (const snapshot of this.dependencies.readOpenDocuments?.(owner) ?? []) {
      const canonicalPath = this.canonicalEvidencePath(snapshot.path);
      if (snapshot.revisionId !== owner.currentRevisionId) {
        throw new Error(`Open document revision does not match current owner revision: ${canonicalPath}`);
      }
      if (current.has(canonicalPath)) {
        throw new Error(`Duplicate open document path: ${canonicalPath}`);
      }
      const live = { ...snapshot, path: canonicalPath, nonEmptyLines: [...snapshot.nonEmptyLines] };
      current.set(canonicalPath, live);
      retained.set(canonicalPath, stableOpenedEvidence(live, canonicalPath));
    }

    const combined = new Map(retained);
    for (const [repositoryPath, snapshot] of current) combined.set(repositoryPath, snapshot);
    return combined;
  }

  private canonicalEvidencePath(value: string): string {
    const canonical = requireCanonicalRepositoryRelativePath(value, this.pathSemantics);
    return this.pathSemantics === "windows" ? canonical.toLowerCase() : canonical;
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

import path from "node:path";

import { NodeSha256StableHash } from "../../adapters/crypto/index";
import { NodeGlobalUnderstandingFileExcludedError, NodeGlobalUnderstandingFileSource } from "../../adapters/repository-files/node-global-understanding-file-source";
import { NodeRepositoryFilePathEnumerator } from "../../adapters/repository-files/node-repository-file-path-enumerator";
import { FileSystemReviewStateRepository, type ReviewStateRepositoryTarget, type ReviewStateStorageUris } from "../../adapters/state-repository/index";
import type { ReviewFileExclusionPolicyService } from "../../application/file-exclusion/review-file-exclusion-policy-service";
import { FolderUnderstandingScopeController, GlobalUnderstandingBackgroundRecalculator, InMemoryGlobalUnderstandingProgressCache, type GlobalUnderstandingFileSource, type LoadedGlobalUnderstandingFile } from "../../application/global-understanding/index";
import {
  readRegisteredPullRequestGlobalHeadFiles,
  type PullRequestGlobalHeadFile,
} from "../../application/global-understanding/pull-request-global-head-file-registry";
import { attachGlobalUnderstandingFailureDiagnostic, type GlobalUnderstandingFailureStage } from "../../application/operation-feedback/operation-feedback";
import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import { type FileSystemPathSemantics, type ResourceUri, WorkspaceIdentityService } from "../../application/workspace-identity/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState } from "../../core/contracts/index";
import type { CurrentContextUiSnapshot } from "../../ui/current-context/index";
import type { GlobalUnderstandingFileOpenTarget, GlobalUnderstandingTreeSnapshot } from "../../ui/global-understanding/global-understanding-ui-model";
import type { GlobalUnderstandingRuntimeSource } from "../../ui/global-understanding/index";

/** Exclusion-policy surface required while discovering folder-scoped evidence. */
export type T505GlobalUnderstandingExclusionPolicy = Pick<ReviewFileExclusionPolicyService, "evaluate" | "evaluateDirectory" | "getRevision">;

/** Immutable repository owner and revision selected for one recalculation. */
export interface T505GlobalUnderstandingOwner {
  /** Filesystem root used only for repository I/O. */
  readonly repositoryRoot: string;
  /** Canonical repository/context identity used for persisted state. */
  readonly target: ReviewStateRepositoryTarget;
  /** Revision whose evidence may be published by the current generation. */
  readonly currentRevisionId: string;
}

/** Composition dependencies for the folder-aware T505 source. */
export interface T505GlobalUnderstandingSourceDependencies {
  /** Storage locations for durable Global understanding state. */
  readonly storageUris: ReviewStateStorageUris;
  /** Policy applied before any file or directory evidence is read. */
  readonly exclusionPolicy: T505GlobalUnderstandingExclusionPolicy;
  /**
   * Reads already-open working-tree evidence for the selected owner.
   * The candidate predicate must be applied before materializing document bodies.
   */
  readonly readOpenDocuments?: (
    owner: Readonly<T505GlobalUnderstandingOwner>,
    isCandidatePath?: (repositoryPath: string) => boolean
  ) => readonly LoadedGlobalUnderstandingFile[];
  /** Reads immutable pull-request HEAD evidence for the supplied candidate paths. */
  readonly readPullRequestHeadFiles?: (
    owner: Readonly<T505GlobalUnderstandingOwner>,
    candidatePaths: ReadonlySet<string>,
    signal?: AbortSignal
  ) => Promise<readonly PullRequestGlobalHeadFile[]>;
  /** Path comparison rules for the selected workspace platform. */
  readonly fileSystemPathSemantics?: FileSystemPathSemantics;
  /** Cooperative scheduler hook used between bounded work batches. */
  readonly yieldControl?: () => void | Promise<void>;
  /** Optional deterministic scheduler evidence for large-workload tests. */
  readonly accountWorkBatch?: (entry: Readonly<{ kind: string; count: number }>) => void;
  /** Optional T610 lifecycle owner. When absent this source retains the legacy repository-wide enumeration contract. */
  readonly folderScopes?: FolderUnderstandingScopeController;
  /** Reads the next-open-only descendant-start setting. It never changes an existing scope. */
  readonly readAutoStartDescendants?: () => boolean;
  /** Resolves a filesystem root to an unambiguous canonical workspace URI identity. */
  readonly resolveRepositoryRootUri?: (repositoryRoot: string) => ResourceUri | undefined;
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

const ownerIdentityKey = (owner: T505GlobalUnderstandingOwner, scopeRoot: string): string =>
  JSON.stringify([owner.target, scopeRoot]);

const ownerEvidenceKey = (owner: T505GlobalUnderstandingOwner, scopeRoot: string): string =>
  `${ownerIdentityKey(owner, scopeRoot)}\0${owner.currentRevisionId}`;
const resourceIdentity = (uri: ResourceUri): string =>
  [uri.scheme, uri.authority, uri.path, uri.query ?? "", uri.fragment ?? ""].join("\0");

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
  private readonly lastSnapshotByEvidenceKey = new Map<string, GlobalUnderstandingTreeSnapshot>();
  private readonly countedAsOpenedPathsByEvidenceKey = new Map<string, Set<string>>();
  private currentContext: CurrentContextUiSnapshot | undefined;
  private readonly folderScopes: FolderUnderstandingScopeController | undefined;

  public constructor(private readonly dependencies: T505GlobalUnderstandingSourceDependencies) {
    this.repository = new FileSystemReviewStateRepository({ storageUris: dependencies.storageUris });
    this.pathSemantics = dependencies.fileSystemPathSemantics ?? (process.platform === "win32" ? "windows" : "posix");
    this.yieldControl = dependencies.yieldControl ?? defaultYieldControl;
    this.folderScopes = dependencies.folderScopes;
  }

  /** Replaces the selected context used by subsequent recalculations. */
  public setContext(snapshot: CurrentContextUiSnapshot | undefined): void { this.currentContext = snapshot; }

  /** Recalculates an immutable Tree snapshot for the current folder scopes. */
  public async recalculate(
    signal?: AbortSignal,
    publishProgress?: (snapshot: GlobalUnderstandingTreeSnapshot) => void | Promise<void>
  ): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    };
    assertCurrent();
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return undefined;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return undefined;
    await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot);
    const evidenceKey = this.activateEvidenceRevision(owner);
    let sourcePathPending = 0;
    const sourcePathStep = async (kind: string, checkCurrent: () => void = assertCurrent): Promise<void> => {
      this.dependencies.accountWorkBatch?.({ kind, count: 1 });
      sourcePathPending += 1;
      if (sourcePathPending < 128) return;
      sourcePathPending = 0;
      await this.yieldControl();
      checkCurrent();
      this.requireActiveEvidenceKey(owner);
    };
    const flushSourcePath = async (checkCurrent: () => void = assertCurrent): Promise<void> => {
      if (sourcePathPending === 0) return;
      sourcePathPending = 0;
      await this.yieldControl();
      checkCurrent();
      this.requireActiveEvidenceKey(owner);
    };
    const sortSourcePaths = async (values: string[], checkCurrent: () => void = assertCurrent): Promise<string[]> => {
      if (values.length < 2) return values;
      let source = values;
      let target = new Array<string>(values.length);
      for (let width = 1; width < source.length; width *= 2) {
        for (let left = 0; left < source.length; left += width * 2) {
          const middle = Math.min(left + width, source.length);
          const right = Math.min(left + width * 2, source.length);
          let first = left;
          let second = middle;
          for (let output = left; output < right; output += 1) {
            if (first < middle && (second >= right || source[first]! <= source[second]!)) {
              target[output] = source[first++]!;
            } else {
              target[output] = source[second++]!;
            }
            await sourcePathStep("source-path-sort", checkCurrent);
          }
        }
        const previous = source; source = target; target = previous;
      }
      await flushSourcePath(checkCurrent);
      return source;
    };
    const activeFolders = this.folderScopes?.activeFolders(owner.target.repositoryId, scopeRoot) ?? [""];
    if (activeFolders.length === 0 && this.folderScopes !== undefined) return this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey);
    const persisted = await this.repository.loadGlobal(owner.target);
    assertCurrent();
    this.requireActiveEvidenceKey(owner);
    const previousSnapshot = this.lastSnapshotByEvidenceKey.get(evidenceKey);
    const countedAsOpenedPaths = new Set(this.countedAsOpenedPathsByEvidenceKey.get(evidenceKey) ?? []);
    const files: GlobalUnderstandingTreeSnapshot["progress"]["files"][number][] = [];
    const discoveredFilePaths = new Set<string>();
    const provisionalDiscoveredFilePaths = new Set<string>();
    const acceptedFolders = new Set<string>();
    let excludedFileCount = 0;
    let prunedExcludedDirectoryCount = 0;
    const scopeWork: Array<{
      readonly folder: string;
      readonly generation: number;
      readonly scopeSignal: AbortSignal | undefined;
      readonly pathEnumeration: Awaited<ReturnType<NodeRepositoryFilePathEnumerator["enumerate"]>>;
      readonly candidatePaths: ReadonlySet<string>;
    }> = [];
    for (const folder of activeFolders) {
      const generation = this.folderScopes?.begin(owner.target.repositoryId, scopeRoot, folder) ?? 0;
      if (generation < 0) continue;
      const folderSignal = this.folderScopes?.signal(owner.target.repositoryId, scopeRoot, folder);
      const scopeSignal = signal === undefined
        ? folderSignal
        : folderSignal === undefined ? signal : AbortSignal.any([signal, folderSignal]);
      const assertScopeCurrent = (): void => {
        assertCurrent();
        if (scopeSignal?.aborted === true) throw new DOMException("Folder understanding scope was superseded.", "AbortError");
      };
      try {
        await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey));
        assertScopeCurrent();
        const enumerator = new NodeRepositoryFilePathEnumerator(this.dependencies.exclusionPolicy, {
          maxEntriesPerStage: 128, yieldControl: this.yieldControl,
          accountWorkBatch: this.dependencies.accountWorkBatch === undefined ? undefined : (entry) => this.dependencies.accountWorkBatch?.(entry)
        });
        const pathEnumeration = this.folderScopes === undefined
          ? await enumerator.enumerate(owner.repositoryRoot, scopeSignal)
          : await enumerator.enumerateDirectFolders(owner.repositoryRoot, [folder], scopeSignal);
        assertScopeCurrent();
        for (const child of pathEnumeration.directDirectories ?? []) {
          await sourcePathStep("source-path-candidate", assertScopeCurrent);
          this.folderScopes?.discoverInactive(owner.target.repositoryId, scopeRoot, child);
        }
        const candidatePaths = new Set<string>();
        for (const value of pathEnumeration.includedPaths) {
          await sourcePathStep("source-path-canonicalize", assertScopeCurrent);
          const canonicalPath = this.canonicalEvidencePath(value);
          candidatePaths.add(canonicalPath);
          provisionalDiscoveredFilePaths.add(canonicalPath);
        }
        await flushSourcePath(assertScopeCurrent);
        scopeWork.push({ folder, generation, scopeSignal, pathEnumeration, candidatePaths });
        await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey, provisionalDiscoveredFilePaths));
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.folderScopes?.fail(owner.target.repositoryId, scopeRoot, folder, generation);
          await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey, provisionalDiscoveredFilePaths));
          throw attachGlobalUnderstandingFailureDiagnostic(error, {
            stage: "path-discovery", operation: "folder-scope-refresh",
            scope: folder.length === 0 ? "repository-root" : "folder",
            discoveredFileCount: provisionalDiscoveredFilePaths.size, processedFileCount: 0
          });
        }
      }
    }
    if (scopeWork.length === 0) return this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey);
    const sharedCapture = await (async (): Promise<Readonly<{
      pullRequestHeadPaths: ReadonlySet<string>;
      evidenceByPath: ReadonlyMap<string, LoadedGlobalUnderstandingFile>;
      globalState: RepositoryGlobalState;
    }> | undefined> => {
      while (true) {
        assertCurrent();
        const currentScopeWork = scopeWork.filter((scope) => scope.scopeSignal?.aborted !== true);
        if (currentScopeWork.length === 0) return undefined;
        const ownerCandidatePaths = new Set<string>();
        for (const scope of currentScopeWork) {
          for (const repositoryPath of scope.candidatePaths) {
            await sourcePathStep("source-path-owner-candidate");
            ownerCandidatePaths.add(repositoryPath);
          }
        }
        await flushSourcePath();
        const captureSignals = [signal, ...currentScopeWork.map((scope) => scope.scopeSignal)]
          .filter((candidate): candidate is AbortSignal => candidate !== undefined);
        const captureSignal = captureSignals.length === 0 ? undefined : AbortSignal.any(captureSignals);
        try {
          const pullRequestHeadPaths = await this.capturePullRequestHeadFiles(owner, ownerCandidatePaths, captureSignal);
          const captureCandidatePaths = new Set<string>();
          for (const repositoryPath of ownerCandidatePaths) {
            await sourcePathStep("source-path-capture-candidate");
            captureCandidatePaths.add(repositoryPath);
          }
          for (const repositoryPath of pullRequestHeadPaths) {
            await sourcePathStep("source-path-capture-candidate");
            captureCandidatePaths.add(repositoryPath);
          }
          await flushSourcePath();
          const evidenceByPath = await this.captureOpenedDocuments(owner, captureCandidatePaths, captureSignal);
          const globalState = persisted?.currentRevisionId === owner.currentRevisionId
            ? await this.projectGlobalStatePaths(persisted, captureCandidatePaths, captureSignal)
            : emptyGlobalState(owner.target.repositoryId, owner.currentRevisionId);
          if (captureSignal?.aborted === true) throw new DOMException("Folder understanding owner capture was superseded.", "AbortError");
          return { pullRequestHeadPaths, evidenceByPath, globalState };
        } catch (error) {
          assertCurrent();
          if (error instanceof DOMException && error.name === "AbortError") continue;
          for (const scope of currentScopeWork) {
            if (scope.scopeSignal?.aborted !== true) {
              this.folderScopes?.fail(owner.target.repositoryId, scopeRoot, scope.folder, scope.generation);
            }
          }
          await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey, provisionalDiscoveredFilePaths));
          throw attachGlobalUnderstandingFailureDiagnostic(error, {
            stage: "owner-capture", operation: "folder-scope-refresh",
            scope: currentScopeWork.some((scope) => scope.folder.length === 0) ? "repository-root" : "folder",
            discoveredFileCount: provisionalDiscoveredFilePaths.size, processedFileCount: 0
          });
        }
      }
    })();
    if (sharedCapture === undefined) return this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey);
    const { pullRequestHeadPaths, evidenceByPath, globalState } = sharedCapture;
    assertCurrent();
    for (const { folder, generation, scopeSignal, pathEnumeration, candidatePaths } of scopeWork) {
      const assertScopeCurrent = (): void => {
        assertCurrent();
        if (scopeSignal?.aborted === true) throw new DOMException("Folder understanding scope was superseded.", "AbortError");
      };
      let scopeFailureStage: GlobalUnderstandingFailureStage = "scope-processing";
      let scopeProcessedFileCount = 0;
      try {
        assertScopeCurrent();
        const belongsDirectlyToFolder = (repositoryPath: string): boolean =>
          this.folderScopes === undefined ||
          (repositoryPath.includes("/") ? repositoryPath.slice(0, repositoryPath.lastIndexOf("/")) : "") === folder;
        const availablePaths = new Set<string>();
        for (const repositoryPath of candidatePaths) {
          await sourcePathStep("source-path-available", assertScopeCurrent);
          if (belongsDirectlyToFolder(repositoryPath)) availablePaths.add(repositoryPath);
        }
        for (const repositoryPath of pullRequestHeadPaths) {
          await sourcePathStep("source-path-available", assertScopeCurrent);
          if (belongsDirectlyToFolder(repositoryPath)) availablePaths.add(repositoryPath);
        }
        await flushSourcePath(assertScopeCurrent);
        const loadedByPath = new Map<string, LoadedGlobalUnderstandingFile>();
        const countedAsOpenedForFolder = new Set<string>();
        const dynamicallyExcludedPaths = new Set<string>();
        const included: Array<{ readonly path: string; readonly nonEmptyLineCount: number }> = [];
        for (const [repositoryPath, evidence] of evidenceByPath) {
          await sourcePathStep("source-path-evidence-index", assertScopeCurrent);
          if (!availablePaths.has(repositoryPath)) continue;
          loadedByPath.set(repositoryPath, evidence);
          countedAsOpenedForFolder.add(repositoryPath);
          included.push({ path: repositoryPath, nonEmptyLineCount: evidence.nonEmptyLines.length });
          scopeProcessedFileCount += 1;
        }
        await flushSourcePath(assertScopeCurrent);
        if (this.folderScopes !== undefined && owner.target.kind !== "pull-request") {
          scopeFailureStage = "content-read";
          const fileSource = new NodeGlobalUnderstandingFileSource(owner.repositoryRoot, this.pathSemantics);
          for (const repositoryPath of [...availablePaths]) {
            await sourcePathStep("source-path-unopened-evidence", assertScopeCurrent);
            if (loadedByPath.has(repositoryPath)) continue;
            try {
              const evidence = await fileSource.load(repositoryPath, owner.currentRevisionId, {
                maxWorkBytes: 64 * 1024,
                yieldControl: this.yieldControl,
                signal: scopeSignal
              });
              assertScopeCurrent();
              loadedByPath.set(repositoryPath, evidence);
              included.push({ path: repositoryPath, nonEmptyLineCount: evidence.nonEmptyLines.length });
            } catch (error) {
              if (!(error instanceof NodeGlobalUnderstandingFileExcludedError)) throw error;
              availablePaths.delete(repositoryPath);
              provisionalDiscoveredFilePaths.delete(repositoryPath);
              dynamicallyExcludedPaths.add(repositoryPath);
            }
            scopeProcessedFileCount += 1;
          }
          await flushSourcePath(assertScopeCurrent);
        }
        scopeFailureStage = "calculation";
        const source: GlobalUnderstandingFileSource = { load: async (repositoryPath, revisionId) => {
          assertScopeCurrent();
          const evidence = loadedByPath.get(repositoryPath);
          if (evidence === undefined) throw new Error(`Global evidence is unavailable: ${repositoryPath}`);
          if (evidence.revisionId !== revisionId) throw new Error(`Global evidence revision does not match current owner revision: ${repositoryPath}`);
          return evidence.validateCurrent === undefined
            ? this.copyOpenedEvidence(evidence, repositoryPath, scopeSignal, "copied-loaded-non-empty-line")
            : evidence;
        } };
        const recalculator = new GlobalUnderstandingBackgroundRecalculator({ source, cache: this.cache, yieldControl: this.yieldControl, accountWorkBatch: this.dependencies.accountWorkBatch });
        const result = await recalculator.recalculate({
          globalState, included, openFilePaths: [...countedAsOpenedForFolder],
          configurationKey: `exclusion-policy:${this.dependencies.exclusionPolicy.getRevision()}`,
          signal: scopeSignal
        });
        assertScopeCurrent();
        this.requireActiveEvidenceKey(owner);
        const direct: typeof result.progress.files[number][] = [];
        let reviewed = 0;
        let total = 0;
        for (const file of result.progress.files) {
          await sourcePathStep("source-path-progress", assertScopeCurrent);
          if (!belongsDirectlyToFolder(file.path)) continue;
          direct.push(file);
          reviewed += file.reviewedNonEmptyLineCount;
          total += file.totalNonEmptyLineCount;
        }
        await flushSourcePath(assertScopeCurrent);
        if (!this.folderScopes?.accept(owner.target.repositoryId, scopeRoot, folder, generation, { reviewed, total }) && this.folderScopes !== undefined) continue;
        acceptedFolders.add(folder);
        for (const repositoryPath of [...countedAsOpenedPaths]) {
          if (belongsDirectlyToFolder(repositoryPath)) countedAsOpenedPaths.delete(repositoryPath);
        }
        for (const repositoryPath of countedAsOpenedForFolder) countedAsOpenedPaths.add(repositoryPath);
        await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey, provisionalDiscoveredFilePaths));
        assertCurrent();
        this.requireActiveEvidenceKey(owner);
        for (const file of direct) {
          await sourcePathStep("source-path-progress-collect", assertScopeCurrent);
          files.push(file);
        }
        for (const repositoryPath of availablePaths) {
          await sourcePathStep("source-path-discovered", assertScopeCurrent);
          discoveredFilePaths.add(repositoryPath);
        }
        await flushSourcePath(assertScopeCurrent);
        excludedFileCount += pathEnumeration.excluded.length + dynamicallyExcludedPaths.size;
        prunedExcludedDirectoryCount += pathEnumeration.excludedDirectories.length;
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.folderScopes?.fail(owner.target.repositoryId, scopeRoot, folder, generation);
          await publishProgress?.(this.lifecycleSnapshot(this.folderScopes, owner, scopeRoot, evidenceKey, provisionalDiscoveredFilePaths, files));
          throw attachGlobalUnderstandingFailureDiagnostic(error, {
            stage: scopeFailureStage, operation: "folder-scope-refresh",
            scope: folder.length === 0 ? "repository-root" : "folder",
            discoveredFileCount: provisionalDiscoveredFilePaths.size, processedFileCount: scopeProcessedFileCount
          });
        }
      }
    }
    assertCurrent();
    const directFolderOf = (repositoryPath: string): string =>
      repositoryPath.includes("/") ? repositoryPath.slice(0, repositoryPath.lastIndexOf("/")) : "";
    const progressByPath = new Map<string, GlobalUnderstandingTreeSnapshot["progress"]["files"][number]>();
    for (const file of files) {
      await sourcePathStep("source-path-progress-index");
      progressByPath.set(file.path, file);
    }
    const previousProgressByPath = new Map<string, GlobalUnderstandingTreeSnapshot["progress"]["files"][number]>();
    for (const file of previousSnapshot?.progress.files ?? []) {
      await sourcePathStep("source-path-previous-progress");
      previousProgressByPath.set(file.path, file);
    }
    const previousTargetByPath = new Map<string, GlobalUnderstandingFileOpenTarget>();
    for (const target of previousSnapshot?.fileOpenTargets ?? []) {
      await sourcePathStep("source-path-previous-target");
      previousTargetByPath.set(target.repositoryPath, target);
    }
    for (const repositoryPath of previousSnapshot?.discoveredFilePaths ?? []) {
      await sourcePathStep("source-path-retained");
      if (acceptedFolders.has(directFolderOf(repositoryPath))) continue;
      discoveredFilePaths.add(repositoryPath);
      const previousProgress = previousProgressByPath.get(repositoryPath);
      if (previousProgress !== undefined) progressByPath.set(repositoryPath, previousProgress);
    }
    await flushSourcePath();
    const finalFiles: GlobalUnderstandingTreeSnapshot["progress"]["files"][number][] = [];
    let reviewed = 0;
    let total = 0;
    for (const file of progressByPath.values()) {
      await sourcePathStep("source-path-final-progress");
      finalFiles.push(file);
      reviewed += file.reviewedNonEmptyLineCount;
      total += file.totalNonEmptyLineCount;
    }
    const displayedFilePaths: string[] = [];
    for (const repositoryPath of discoveredFilePaths) {
      await sourcePathStep("source-path-display-candidate");
      displayedFilePaths.push(repositoryPath);
    }
    await flushSourcePath();
    const sortedDisplayedFilePaths = await sortSourcePaths(displayedFilePaths);
    const fileOpenTargets: GlobalUnderstandingFileOpenTarget[] = [];
    for (const repositoryPath of sortedDisplayedFilePaths) {
      await sourcePathStep("source-path-open-target");
      const directFolder = directFolderOf(repositoryPath);
      const previousTarget = !acceptedFolders.has(directFolder) ? previousTargetByPath.get(repositoryPath) : undefined;
      if (previousTarget !== undefined) {
        fileOpenTargets.push(previousTarget);
      } else if (owner.target.kind !== "pull-request" || pullRequestHeadPaths.has(repositoryPath)) {
        fileOpenTargets.push(this.createFileOpenTarget(owner, repositoryPath));
      }
    }
    await flushSourcePath();
    const folders = this.folderScopes?.snapshots(owner.target.repositoryId, scopeRoot).map((folder) => ({
      path: folder.path,
      state: folder.state,
      reviewedNonEmptyLineCount: folder.total.reviewed,
      totalNonEmptyLineCount: folder.total.total,
      partial: !folder.total.complete
    }));
    const repositoryPartial = folders?.some((folder) => folder.partial) === true;
    const snapshot: GlobalUnderstandingTreeSnapshot = {
      progress: { reviewedNonEmptyLineCount: reviewed, totalNonEmptyLineCount: total, progress: total === 0 ? 1 : reviewed / total, files: finalFiles },
      discoveredFilePaths: sortedDisplayedFilePaths,
      ...(fileOpenTargets.length === 0 ? {} : { fileOpenTargets }),
      openedFileCount: sortedDisplayedFilePaths.filter((repositoryPath) => countedAsOpenedPaths.has(repositoryPath)).length,
      unopenedFileCount: sortedDisplayedFilePaths.filter((repositoryPath) => !countedAsOpenedPaths.has(repositoryPath)).length,
      excludedFileCount,
      prunedExcludedDirectoryCount,
      ...(folders === undefined ? {} : { folders }),
      ...(repositoryPartial ? { repositoryPartial: true } : {})
    };
    const activeEvidenceKey = this.requireActiveEvidenceKey(owner);
    this.lastSnapshotByEvidenceKey.set(activeEvidenceKey, snapshot);
    this.countedAsOpenedPathsByEvidenceKey.set(
      activeEvidenceKey,
      new Set(sortedDisplayedFilePaths.filter((repositoryPath) => countedAsOpenedPaths.has(repositoryPath)))
    );
    return snapshot;
  }

  /**
   * Observes a real opened document. Its canonical in-root folder may start once;
   * stopped ancestors, foreign roots, and stale context changes never auto-resume.
   */
  public async observeFileOpen(repositoryPath: string): Promise<void> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return;
    await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot);
    const relativePath = path.isAbsolute(repositoryPath)
      ? path.relative(owner.repositoryRoot, repositoryPath).split(path.sep).join("/")
      : repositoryPath;
    if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../")) return;
    const folder = relativePath.split("/").slice(0, -1).join("/");
    if (this.folderScopes?.isStopped(owner.target.repositoryId, scopeRoot, folder) === true) return;
    const autoStartDescendants = this.dependencies.readAutoStartDescendants?.() ?? false;
    if (!autoStartDescendants) {
      this.folderScopes?.openFile(owner.target.repositoryId, scopeRoot, relativePath, false);
      return;
    }
    const folders = await new NodeRepositoryFilePathEnumerator(this.dependencies.exclusionPolicy, { maxEntriesPerStage: 128, yieldControl: this.yieldControl, accountWorkBatch: this.dependencies.accountWorkBatch })
      .enumerateSubtreeFolders(owner.repositoryRoot, folder, undefined, (candidate) => this.folderScopes?.isStopped(owner.target.repositoryId, scopeRoot, candidate) === true);
    await this.folderScopes?.start(owner.target.repositoryId, scopeRoot, folder, folders);
  }

  /** Returns true only for an entry under the selected canonical owner with an already-active scope. */
  public isActiveFolderEntry(repositoryPath: string): boolean {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return false;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return false;
    const relativePath = path.isAbsolute(repositoryPath)
      ? path.relative(owner.repositoryRoot, repositoryPath).split(path.sep).join("/")
      : repositoryPath;
    if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../")) return false;
    const folder = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
    return this.folderScopes?.activeFolders(owner.target.repositoryId, scopeRoot).some((active) =>
      folder === active || folder.startsWith(`${active}/`) || active.startsWith(`${folder}/`)
    ) ?? true;
  }

  /** Resolves an editor resource to its canonical folder only for the selected owner. */
  public folderPathForEntry(repositoryPath: string): string | undefined {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined || this.scopeRoot(owner) === undefined) return undefined;
    const relativePath = path.isAbsolute(repositoryPath)
      ? path.relative(owner.repositoryRoot, repositoryPath).split(path.sep).join("/")
      : repositoryPath;
    if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../")) return undefined;
    const canonicalPath = requireCanonicalRepositoryRelativePath(relativePath, this.pathSemantics, "Global Understanding editor resource");
    return canonicalPath.includes("/") ? canonicalPath.slice(0, canonicalPath.lastIndexOf("/")) : "";
  }

  /** Stops the selected current scope only after its explicit marker is durable. */
  public async stopFolder(folderPath: string): Promise<void> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner !== undefined) { const scopeRoot = this.scopeRoot(owner); if (scopeRoot !== undefined) { await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot); await this.folderScopes?.stop(owner.target.repositoryId, scopeRoot, folderPath); } }
  }

  /** Explicitly starts a canonical current folder subtree, pruning stopped descendants. */
  public async startFolder(folderPath: string): Promise<void> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return;
    await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot);
    // Validate before any filesystem composition so a traversal marker cannot
    // cause subtree discovery outside the selected repository root.
    this.folderScopes?.state(owner.target.repositoryId, scopeRoot, folderPath);
    const folders = await new NodeRepositoryFilePathEnumerator(this.dependencies.exclusionPolicy, { maxEntriesPerStage: 128, yieldControl: this.yieldControl, accountWorkBatch: this.dependencies.accountWorkBatch })
      .enumerateSubtreeFolders(owner.repositoryRoot, folderPath, undefined, (candidate) => candidate !== folderPath && this.folderScopes?.isStopped(owner.target.repositoryId, scopeRoot, candidate) === true);
    await this.folderScopes?.start(owner.target.repositoryId, scopeRoot, folderPath, folders);
  }

  /** Removes the selected explicit stop and lets the next refresh validate a new generation. */
  public async resumeFolder(folderPath: string): Promise<void> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner !== undefined) { const scopeRoot = this.scopeRoot(owner); if (scopeRoot !== undefined) { await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot); await this.folderScopes?.resume(owner.target.repositoryId, scopeRoot, folderPath); } }
  }

  private lifecycleSnapshot(
    controller: FolderUnderstandingScopeController | undefined,
    owner: T505GlobalUnderstandingOwner,
    scopeRoot: string,
    evidenceKey: string,
    provisionalDiscoveredFilePaths?: ReadonlySet<string>,
    currentProgressFiles: readonly GlobalUnderstandingTreeSnapshot["progress"]["files"][number][] = []
  ): GlobalUnderstandingTreeSnapshot {
    const folders = controller?.snapshots(owner.target.repositoryId, scopeRoot).map((folder) => ({
      path: folder.path, state: folder.state, reviewedNonEmptyLineCount: folder.total.reviewed,
      totalNonEmptyLineCount: folder.total.total, partial: !folder.total.complete
    }));
    const previous = this.lastSnapshotByEvidenceKey.get(evidenceKey);
    const repositoryPartial = folders?.some((folder) => folder.partial) === true;
    if (provisionalDiscoveredFilePaths === undefined || provisionalDiscoveredFilePaths.size === 0) {
      if (previous === undefined) {
        return {
          progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] },
          openedFileCount: 0, unopenedFileCount: 0, excludedFileCount: 0, prunedExcludedDirectoryCount: 0,
          ...(folders === undefined ? {} : { folders }),
          ...(repositoryPartial ? { repositoryPartial: true } : {})
        };
      }
      return {
        progress: previous.progress,
        ...(previous.discoveredFilePaths === undefined ? {} : { discoveredFilePaths: previous.discoveredFilePaths }),
        ...(previous.fileOpenTargets === undefined ? {} : { fileOpenTargets: previous.fileOpenTargets }),
        openedFileCount: previous.openedFileCount,
        unopenedFileCount: previous.unopenedFileCount,
        excludedFileCount: previous.excludedFileCount,
        prunedExcludedDirectoryCount: previous.prunedExcludedDirectoryCount,
        ...(folders === undefined ? {} : { folders }),
        ...(repositoryPartial ? { repositoryPartial: true } : {})
      };
    }

    const discovered = new Set(previous?.discoveredFilePaths ?? previous?.progress.files.map((file) => file.path) ?? []);
    for (const repositoryPath of provisionalDiscoveredFilePaths) discovered.add(repositoryPath);
    const discoveredFilePaths = [...discovered].sort();
    const discoveredSet = new Set(discoveredFilePaths);
    const progressByPath = new Map<string, GlobalUnderstandingTreeSnapshot["progress"]["files"][number]>();
    for (const file of previous?.progress.files ?? []) {
      if (discoveredSet.has(file.path)) progressByPath.set(file.path, file);
    }
    for (const file of currentProgressFiles) {
      if (discoveredSet.has(file.path)) progressByPath.set(file.path, file);
    }
    const progressFiles = [...progressByPath.values()];
    let reviewedNonEmptyLineCount = 0;
    let totalNonEmptyLineCount = 0;
    for (const file of progressFiles) {
      reviewedNonEmptyLineCount += file.reviewedNonEmptyLineCount;
      totalNonEmptyLineCount += file.totalNonEmptyLineCount;
    }
    const openedPaths = this.countedAsOpenedPathsByEvidenceKey.get(evidenceKey) ?? new Set<string>();
    const openedFileCount = discoveredFilePaths.filter((repositoryPath) => openedPaths.has(repositoryPath)).length;
    const previousTargets = new Map((previous?.fileOpenTargets ?? []).map((target) => [target.repositoryPath, target] as const));
    const fileOpenTargets: GlobalUnderstandingFileOpenTarget[] = [];
    for (const repositoryPath of discoveredFilePaths) {
      const previousTarget = previousTargets.get(repositoryPath);
      if (previousTarget !== undefined) fileOpenTargets.push(previousTarget);
      else if (owner.target.kind !== "pull-request") fileOpenTargets.push(this.createFileOpenTarget(owner, repositoryPath));
    }
    return {
      progress: {
        reviewedNonEmptyLineCount,
        totalNonEmptyLineCount,
        progress: totalNonEmptyLineCount === 0 ? 1 : reviewedNonEmptyLineCount / totalNonEmptyLineCount,
        files: progressFiles
      },
      discoveredFilePaths,
      ...(fileOpenTargets.length === 0 ? {} : { fileOpenTargets }),
      openedFileCount,
      unopenedFileCount: discoveredFilePaths.length - openedFileCount,
      excludedFileCount: previous?.excludedFileCount ?? 0,
      prunedExcludedDirectoryCount: previous?.prunedExcludedDirectoryCount ?? 0,
      ...(folders === undefined ? {} : { folders }),
      ...(repositoryPartial ? { repositoryPartial: true } : {})
    };
  }

  private createFileOpenTarget(
    owner: T505GlobalUnderstandingOwner,
    repositoryPath: string
  ): GlobalUnderstandingFileOpenTarget {
    const canonicalPath = requireCanonicalRepositoryRelativePath(
      repositoryPath,
      this.pathSemantics,
      "Global understanding file path"
    );
    const common = {
      repositoryId: owner.target.repositoryId,
      contextId: owner.target.contextId,
      revisionId: owner.currentRevisionId,
      repositoryPath: canonicalPath
    };
    if (owner.target.kind === "pull-request") {
      return {
        kind: "pull-request-head",
        ...common,
        fileSystemPathSemantics: this.pathSemantics
      };
    }
    return {
      kind: "working-tree",
      ...common,
      filePath: path.join(owner.repositoryRoot, ...canonicalPath.split("/"))
    };
  }

  private activateEvidenceRevision(owner: T505GlobalUnderstandingOwner): string {
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) throw new Error("Global repository root identity is unavailable");
    const identityKey = ownerIdentityKey(owner, scopeRoot);
    const nextEvidenceKey = ownerEvidenceKey(owner, scopeRoot);
    const previousEvidenceKey = this.activeEvidenceKeyByOwner.get(identityKey);
    if (previousEvidenceKey !== undefined && previousEvidenceKey !== nextEvidenceKey) {
      this.openedEvidenceByOwner.delete(previousEvidenceKey);
      this.pullRequestEvidenceByOwner.delete(previousEvidenceKey);
      this.lastSnapshotByEvidenceKey.delete(previousEvidenceKey);
      this.countedAsOpenedPathsByEvidenceKey.delete(previousEvidenceKey);
    }
    this.activeEvidenceKeyByOwner.set(identityKey, nextEvidenceKey);
    return nextEvidenceKey;
  }

  private requireActiveEvidenceKey(owner: T505GlobalUnderstandingOwner): string {
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) throw new Error("Global repository root identity is unavailable");
    const identityKey = ownerIdentityKey(owner, scopeRoot);
    const expectedEvidenceKey = ownerEvidenceKey(owner, scopeRoot);
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
    candidatePaths: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<ReadonlySet<string>> {
    if (owner.target.kind !== "pull-request") return new Set<string>();

    this.requireActiveEvidenceKey(owner);
    const snapshots = this.dependencies.readPullRequestHeadFiles === undefined
      ? await readRegisteredPullRequestGlobalHeadFiles({
          contextId: owner.target.contextId,
          headRevision: owner.currentRevisionId,
          candidatePaths,
          signal,
        })
      : await this.dependencies.readPullRequestHeadFiles(owner, candidatePaths, signal);
    const key = this.requireActiveEvidenceKey(owner);
    const parsed = new Map(this.pullRequestEvidenceByOwner.get(key));
    const retained = new Map(this.retainedOpenedEvidence(owner));
    const seen = new Set<string>();
    const acceptedPaths = new Set<string>();

    let pending = 0;
    const checkpoint = async (): Promise<void> => {
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
      if (++pending < 128) return;
      pending = 0;
      await this.yieldControl();
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    };
    for (const snapshot of snapshots) {
      await checkpoint();
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
        const nonEmptyLines: number[] = [];
        let line = 0;
        let nonEmpty = false;
        for (let index = 0; index < snapshot.content.length; index += 1) {
          const character = snapshot.content[index]!;
          if (character === "\r" || character === "\n") {
            if (nonEmpty) nonEmptyLines.push(line);
            line += 1; nonEmpty = false;
            if (character === "\r" && snapshot.content[index + 1] === "\n") index += 1;
          } else if (character.trim().length > 0) nonEmpty = true;
          await checkpoint();
        }
        if (nonEmpty) nonEmptyLines.push(line);
        const contentHash = await this.stableHash.digestCooperatively(snapshot.content, 128, this.yieldControl, () => signal?.aborted !== true);
        if (contentHash === undefined) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
        evidence = {
          path: canonicalPath,
          revisionId: owner.currentRevisionId,
          lineCount: line + 1,
          nonEmptyLines,
          contentHash,
          cacheKey: `pr-head:${owner.target.repositoryId}:${owner.target.contextId}:${owner.currentRevisionId}:${canonicalPath}:${contentHash}`
        };
        parsed.set(canonicalPath, evidence);
      }
      retained.set(canonicalPath, await this.copyOpenedEvidence(evidence, canonicalPath, signal, "copied-pr-non-empty-line"));
    }
    if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    this.pullRequestEvidenceByOwner.set(key, parsed);
    this.openedEvidenceByOwner.set(key, retained);
    return acceptedPaths;
  }

  private async captureOpenedDocuments(
    owner: T505GlobalUnderstandingOwner,
    candidatePaths: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<ReadonlyMap<string, LoadedGlobalUnderstandingFile>> {
    if (owner.target.kind === "pull-request") {
      const immutable = this.pullRequestEvidenceByOwner.get(this.requireActiveEvidenceKey(owner)) ?? new Map<string, LoadedGlobalUnderstandingFile>();
      return new Map([...immutable].filter(([repositoryPath]) => candidatePaths.has(repositoryPath)));
    }
    const retained = new Map(this.retainedOpenedEvidence(owner));
    const current = new Map<string, LoadedGlobalUnderstandingFile>();
    let pending = 0;
    const isCandidatePath = (repositoryPath: string): boolean =>
      candidatePaths.has(this.canonicalEvidencePath(repositoryPath));
    for (const snapshot of this.dependencies.readOpenDocuments?.(owner, isCandidatePath) ?? []) {
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
      if (++pending >= 128) { pending = 0; await this.yieldControl(); }
      const canonicalPath = this.canonicalEvidencePath(snapshot.path);
      if (!candidatePaths.has(canonicalPath)) continue;
      if (snapshot.revisionId !== owner.currentRevisionId) {
        throw new Error(`Open document revision does not match current owner revision: ${canonicalPath}`);
      }
      if (current.has(canonicalPath)) {
        throw new Error(`Duplicate open document path: ${canonicalPath}`);
      }
      const live = await this.copyOpenedEvidence(snapshot, canonicalPath, signal, "copied-open-non-empty-line");
      current.set(canonicalPath, live);
      retained.set(canonicalPath, await this.copyOpenedEvidence(live, canonicalPath, signal, "retained-open-non-empty-line"));
    }

    const combined = new Map([...retained].filter(([repositoryPath]) => candidatePaths.has(repositoryPath)));
    for (const [repositoryPath, snapshot] of current) combined.set(repositoryPath, snapshot);
    if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    this.openedEvidenceByOwner.set(this.requireActiveEvidenceKey(owner), retained);
    return combined;
  }

  private async copyOpenedEvidence(
    snapshot: LoadedGlobalUnderstandingFile,
    repositoryPath: string,
    signal: AbortSignal | undefined,
    kind: string
  ): Promise<LoadedGlobalUnderstandingFile> {
    const nonEmptyLines: number[] = [];
    let pending = 0;
    for (const line of snapshot.nonEmptyLines) {
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
      nonEmptyLines.push(line);
      pending += 1;
      if (pending < 128) continue;
      this.dependencies.accountWorkBatch?.({ kind, count: pending });
      pending = 0;
      await this.yieldControl();
    }
    if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    return {
      path: repositoryPath,
      revisionId: snapshot.revisionId,
      lineCount: snapshot.lineCount,
      nonEmptyLines,
      contentHash: snapshot.contentHash,
      cacheKey: snapshot.cacheKey
    };
  }

  private async projectGlobalStatePaths(
    state: RepositoryGlobalState,
    candidatePaths: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<RepositoryGlobalState> {
    const files: RepositoryGlobalState["files"] = {};
    const fileIdByPath = new Map<string, string>();
    let pending = 0;
    for (const fileId in state.files) {
      if (!Object.hasOwn(state.files, fileId)) continue;
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
      if (++pending >= 128) { pending = 0; await this.yieldControl(); }
      const file = state.files[fileId]!;
      const currentPath = this.canonicalEvidencePath(file.currentPath);
      if (!candidatePaths.has(currentPath)) continue;
      const existingFileId = fileIdByPath.get(currentPath);
      if (existingFileId !== undefined && existingFileId !== fileId) {
        throw new Error(`Persisted Global state has conflicting file identities for ${currentPath}`);
      }
      fileIdByPath.set(currentPath, fileId);
      const reviewed = [] as typeof file.reviewed extends readonly (infer T)[] ? T[] : never[];
      for (const interval of file.reviewed) {
        if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
        if (++pending >= 128) { pending = 0; await this.yieldControl(); }
        reviewed.push({ ...interval } as never);
      }
      files[fileId] = { ...file, currentPath, reviewed };
    }
    return {
      ...state,
      files
    };
  }

  private canonicalEvidencePath(value: string): string {
    const canonical = requireCanonicalRepositoryRelativePath(value, this.pathSemantics);
    return this.pathSemantics === "windows" ? canonical.toLowerCase() : canonical;
  }

  /** Keeps filesystem access and opaque URI identity separate; supplied production resolver fails closed. */
  private scopeRoot(owner: T505GlobalUnderstandingOwner): string | undefined {
    if (this.dependencies.resolveRepositoryRootUri === undefined) return owner.repositoryRoot;
    const uri = this.dependencies.resolveRepositoryRootUri(owner.repositoryRoot);
    return uri === undefined ? undefined : resourceIdentity(uri);
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

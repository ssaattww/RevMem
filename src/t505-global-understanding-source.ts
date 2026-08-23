import path from "node:path";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { NodeRepositoryFilePathEnumerator } from "./adapters/repository-files/node-repository-file-path-enumerator";
import { FileSystemReviewStateRepository, type ReviewStateRepositoryTarget, type ReviewStateStorageUris } from "./adapters/state-repository/index";
import type { ReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { FolderUnderstandingScopeController, GlobalUnderstandingBackgroundRecalculator, InMemoryGlobalUnderstandingProgressCache, type GlobalUnderstandingFileSource, type LoadedGlobalUnderstandingFile } from "./application/global-understanding/index";
import {
  readRegisteredPullRequestGlobalHeadFiles,
  type PullRequestGlobalHeadFile,
} from "./application/global-understanding/pull-request-global-head-file-registry";
import { requireCanonicalRepositoryRelativePath } from "./application/repository-path/index";
import { type FileSystemPathSemantics, type ResourceUri, WorkspaceIdentityService } from "./application/workspace-identity/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState } from "./core/contracts/index";
import type { CurrentContextUiSnapshot } from "./ui/current-context/index";
import type { GlobalUnderstandingFileOpenTarget, GlobalUnderstandingTreeSnapshot } from "./ui/global-understanding/global-understanding-ui-model";
import type { GlobalUnderstandingRuntimeSource } from "./ui/global-understanding/index";

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

const ownerIdentityKey = (owner: T505GlobalUnderstandingOwner): string =>
  JSON.stringify(owner.target);

const ownerEvidenceKey = (owner: T505GlobalUnderstandingOwner): string =>
  `${ownerIdentityKey(owner)}\0${owner.currentRevisionId}`;
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
  private currentContext: CurrentContextUiSnapshot | undefined;
  private readonly folderScopes: FolderUnderstandingScopeController | undefined;

  public constructor(private readonly dependencies: T505GlobalUnderstandingSourceDependencies) {
    this.repository = new FileSystemReviewStateRepository({ storageUris: dependencies.storageUris });
    this.pathSemantics = dependencies.fileSystemPathSemantics ?? (process.platform === "win32" ? "windows" : "posix");
    this.yieldControl = dependencies.yieldControl ?? defaultYieldControl;
    this.folderScopes = dependencies.folderScopes;
  }

  public setContext(snapshot: CurrentContextUiSnapshot | undefined): void { this.currentContext = snapshot; }

  public async recalculate(signal?: AbortSignal): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const assertCurrent = (): void => {
      if (signal?.aborted === true) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
    };
    assertCurrent();
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return undefined;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return undefined;
    await this.folderScopes?.restore(owner.target.repositoryId, scopeRoot);
    this.activateEvidenceRevision(owner);
    const activeFolders = this.folderScopes?.activeFolders(owner.target.repositoryId, scopeRoot) ?? [""];
    if (activeFolders.length === 0 && this.folderScopes !== undefined) return this.emptySnapshot(this.folderScopes, owner, scopeRoot);
    const persisted = await this.repository.loadGlobal(owner.target);
    assertCurrent();
    this.requireActiveEvidenceKey(owner);
    const files: GlobalUnderstandingTreeSnapshot["progress"]["files"][number][] = [];
    const openTargets: GlobalUnderstandingFileOpenTarget[] = [];
    let openedFileCount = 0;
    let unopenedFileCount = 0;
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
        const enumerator = new NodeRepositoryFilePathEnumerator(this.dependencies.exclusionPolicy, {
          maxEntriesPerStage: 128, yieldControl: this.yieldControl,
          accountWorkBatch: this.dependencies.accountWorkBatch === undefined ? undefined : (entry) => this.dependencies.accountWorkBatch?.(entry)
        });
        const pathEnumeration = this.folderScopes === undefined
          ? await enumerator.enumerate(owner.repositoryRoot, scopeSignal)
          : await enumerator.enumerateDirectFolders(owner.repositoryRoot, [folder], scopeSignal);
        assertScopeCurrent();
        for (const child of pathEnumeration.directDirectories ?? []) {
          this.folderScopes?.discoverInactive(owner.target.repositoryId, scopeRoot, child);
        }
        const candidatePaths = new Set(pathEnumeration.includedPaths.map((value) => this.canonicalEvidencePath(value)));
        scopeWork.push({ folder, generation, scopeSignal, pathEnumeration, candidatePaths });
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.folderScopes?.fail(owner.target.repositoryId, scopeRoot, folder, generation);
          throw error;
        }
      }
    }
    if (scopeWork.length === 0) return this.emptySnapshot(this.folderScopes, owner, scopeRoot);
    const ownerCandidatePaths = new Set(scopeWork.flatMap((scope) => [...scope.candidatePaths]));
    const pullRequestHeadPaths = await this.capturePullRequestHeadFiles(owner, ownerCandidatePaths, signal);
    assertCurrent();
    const evidenceByPath = await this.captureOpenedDocuments(owner, signal);
    const globalState = persisted?.currentRevisionId === owner.currentRevisionId
      ? await this.projectGlobalStatePaths(persisted, signal)
      : emptyGlobalState(owner.target.repositoryId, owner.currentRevisionId);
    assertCurrent();
    for (const { folder, generation, scopeSignal, pathEnumeration, candidatePaths } of scopeWork) {
      const assertScopeCurrent = (): void => {
        assertCurrent();
        if (scopeSignal?.aborted === true) throw new DOMException("Folder understanding scope was superseded.", "AbortError");
      };
      try {
        assertScopeCurrent();
        const belongsDirectlyToFolder = (repositoryPath: string): boolean =>
          this.folderScopes === undefined ||
          (repositoryPath.includes("/") ? repositoryPath.slice(0, repositoryPath.lastIndexOf("/")) : "") === folder;
        const availablePaths = new Set(
          [...candidatePaths, ...pullRequestHeadPaths].filter(belongsDirectlyToFolder)
        );
        const openedByPath = new Map<string, LoadedGlobalUnderstandingFile>();
        const included: Array<{ readonly path: string; readonly nonEmptyLineCount: number }> = [];
        for (const [repositoryPath, evidence] of evidenceByPath) {
          assertScopeCurrent();
          if (!availablePaths.has(repositoryPath)) continue;
          openedByPath.set(repositoryPath, evidence);
          included.push({ path: repositoryPath, nonEmptyLineCount: evidence.nonEmptyLines.length });
        }
        const source: GlobalUnderstandingFileSource = { load: async (repositoryPath, revisionId) => {
          assertScopeCurrent();
          const evidence = openedByPath.get(repositoryPath);
          if (evidence === undefined) throw new Error(`Opened Global evidence is unavailable: ${repositoryPath}`);
          if (evidence.revisionId !== revisionId) throw new Error(`Opened document revision does not match current owner revision: ${repositoryPath}`);
          return this.copyOpenedEvidence(evidence, repositoryPath, scopeSignal, "copied-loaded-non-empty-line");
        } };
        const recalculator = new GlobalUnderstandingBackgroundRecalculator({ source, cache: this.cache, yieldControl: this.yieldControl, accountWorkBatch: this.dependencies.accountWorkBatch });
        const result = await recalculator.recalculate({
          globalState, included, openFilePaths: [...openedByPath.keys()],
          configurationKey: `exclusion-policy:${this.dependencies.exclusionPolicy.getRevision()}`,
          signal: scopeSignal
        });
        assertScopeCurrent();
        this.requireActiveEvidenceKey(owner);
        const direct = result.progress.files.filter((file) => belongsDirectlyToFolder(file.path));
        const reviewed = direct.reduce((total, file) => total + file.reviewedNonEmptyLineCount, 0);
        const total = direct.reduce((sum, file) => sum + file.totalNonEmptyLineCount, 0);
        if (!this.folderScopes?.accept(owner.target.repositoryId, scopeRoot, folder, generation, { reviewed, total }) && this.folderScopes !== undefined) continue;
        files.push(...direct);
        openTargets.push(...direct.map((file) => this.createFileOpenTarget(owner, file.path)));
        openedFileCount += openedByPath.size;
        unopenedFileCount += Math.max(0, availablePaths.size - openedByPath.size);
        excludedFileCount += pathEnumeration.excluded.length;
        prunedExcludedDirectoryCount += pathEnumeration.excludedDirectories.length;
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.folderScopes?.fail(owner.target.repositoryId, scopeRoot, folder, generation);
          throw error;
        }
      }
    }
    assertCurrent();
    const reviewed = files.reduce((total, file) => total + file.reviewedNonEmptyLineCount, 0);
    const total = files.reduce((sum, file) => sum + file.totalNonEmptyLineCount, 0);
    const fileOpenTargets: GlobalUnderstandingFileOpenTarget[] = [];
    fileOpenTargets.push(...openTargets);
    const folders = this.folderScopes?.snapshots(owner.target.repositoryId, scopeRoot).map((folder) => ({
      path: folder.path,
      state: folder.state,
      reviewedNonEmptyLineCount: folder.total.reviewed,
      totalNonEmptyLineCount: folder.total.total,
      partial: !folder.total.complete
    }));
    const repositoryPartial = folders?.some((folder) => folder.partial) === true;
    return {
      progress: { reviewedNonEmptyLineCount: reviewed, totalNonEmptyLineCount: total, progress: total === 0 ? 1 : reviewed / total, files },
      ...(fileOpenTargets.length === 0 ? {} : { fileOpenTargets }),
      openedFileCount,
      unopenedFileCount,
      excludedFileCount,
      prunedExcludedDirectoryCount,
      ...(folders === undefined ? {} : { folders }),
      ...(repositoryPartial ? { repositoryPartial: true } : {})
    };
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
    const relativePath = path.isAbsolute(repositoryPath)
      ? path.relative(owner.repositoryRoot, repositoryPath).split(path.sep).join("/")
      : repositoryPath;
    if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith("../")) return;
    const folder = relativePath.split("/").slice(0, -1).join("/");
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
    if (owner !== undefined) { const scopeRoot = this.scopeRoot(owner); if (scopeRoot !== undefined) await this.folderScopes?.stop(owner.target.repositoryId, scopeRoot, folderPath); }
  }

  /** Explicitly starts a canonical current folder subtree, pruning stopped descendants. */
  public async startFolder(folderPath: string): Promise<void> {
    const owner = this.resolveOwner(this.currentContext);
    if (owner === undefined) return;
    const scopeRoot = this.scopeRoot(owner);
    if (scopeRoot === undefined) return;
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
    if (owner !== undefined) { const scopeRoot = this.scopeRoot(owner); if (scopeRoot !== undefined) await this.folderScopes?.resume(owner.target.repositoryId, scopeRoot, folderPath); }
  }

  private emptySnapshot(controller?: FolderUnderstandingScopeController, owner?: T505GlobalUnderstandingOwner, scopeRoot?: string): GlobalUnderstandingTreeSnapshot {
    const folders = controller === undefined || owner === undefined || scopeRoot === undefined ? undefined : controller.snapshots(owner.target.repositoryId, scopeRoot).map((folder) => ({
      path: folder.path, state: folder.state, reviewedNonEmptyLineCount: folder.total.reviewed,
      totalNonEmptyLineCount: folder.total.total, partial: !folder.total.complete
    }));
    return { progress: { reviewedNonEmptyLineCount: 0, totalNonEmptyLineCount: 0, progress: 1, files: [] }, openedFileCount: 0, unopenedFileCount: 0, excludedFileCount: 0, prunedExcludedDirectoryCount: 0, ...(folders === undefined ? {} : { folders }), ...(folders?.some((folder) => folder.partial) === true ? { repositoryPartial: true } : {}) };
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
        })
      : await this.dependencies.readPullRequestHeadFiles(owner, candidatePaths);
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
    signal?: AbortSignal
  ): Promise<ReadonlyMap<string, LoadedGlobalUnderstandingFile>> {
    const retained = new Map(this.retainedOpenedEvidence(owner));
    const current = new Map<string, LoadedGlobalUnderstandingFile>();
    let pending = 0;
    for (const snapshot of this.dependencies.readOpenDocuments?.(owner) ?? []) {
      if (signal?.aborted) throw new DOMException("Global understanding refresh was superseded.", "AbortError");
      if (++pending >= 128) { pending = 0; await this.yieldControl(); }
      const canonicalPath = this.canonicalEvidencePath(snapshot.path);
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

    const combined = new Map(retained);
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

import {
  OperationCancelledError,
  runWithActiveOperationFeedback,
  type OperationFeedbackContext,
} from "./application/operation-feedback/index";
import type {
  GitCommitReviewDiffDocumentDescriptor,
  RevisionTextContentReadResult,
} from "./application/diff-document/index";
import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
} from "./application/diff-document/index";
import {
  registerPullRequestGlobalHeadFileProvider,
  type PullRequestGlobalHeadFile,
} from "./application/global-understanding/pull-request-global-head-file-registry";
import { requireCanonicalRepositoryRelativePath } from "./application/repository-path/index";
import {
  DiffEditorReviewCommandService,
  type DiffEditorReviewCommandDependencies,
} from "./application/review-commands/index";
import type { ReviewStateTransaction } from "./core/review-state/index";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
} from "./adapters/state-repository/index";
import type { FileSystemPathSemantics } from "./application/workspace-identity/index";
import type { ReviewFileExclusionPolicy } from "./core/file-exclusion/index";
import {
  calculatePullRequestDiffProgress,
  calculatePullRequestDiffProgressCooperatively,
  type PullRequestDiffFileProgress,
  type PullRequestDiffProgress,
  type PullRequestDiffSnapshot,
} from "./core/pr-progress/index";
import {
  ReviewDiffEditorController,
  ReviewDiffTextDocumentContentProvider,
  type ReviewDiffEditorHost,
} from "./ui/diff-editor/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestLineReviewability,
} from "./ui/pr-progress/index";

export interface PullRequestReviewRuntimeRepository {
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void>;
}

export interface PullRequestReviewRuntimeRegistration {
  readonly repositoryId: string;
  readonly repositoryRoot: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  readonly snapshot: PullRequestDiffSnapshot;
  readonly readTextContent: (
    descriptor: GitCommitReviewDiffDocumentDescriptor,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ) => Promise<RevisionTextContentReadResult>;
}

export interface PullRequestReviewRuntimeOptions<Uri> {
  readonly repository: PullRequestReviewRuntimeRepository;
  readonly requestHistory: (transaction: Readonly<ReviewStateTransaction>) => void | Promise<void>;
  readonly diffHost: ReviewDiffEditorHost<Uri>;
  readonly openFile?: (uri: Uri) => Promise<void>;
  readonly getExclusionPolicy: () => ReviewFileExclusionPolicy;
  /** Optional deterministic scheduler seam; production keeps the 128-item default. */
  readonly progressWork?: {
    readonly maxItems?: number;
    readonly yieldControl?: () => void | Promise<void>;
    readonly account?: (count: number) => void;
    readonly onYield?: (completedItems: number) => void;
  };
}

export interface PullRequestReviewCommandDependencies<Editor>
extends Omit<DiffEditorReviewCommandDependencies<Editor>, "openSession" | "requestHistory"> {
  readonly getDocumentUri: (editor: Editor) => string;
}

interface PullRequestFullTextCache {
  readonly baseSha: string;
  readonly headSha: string;
  readonly files: Map<string, Promise<RevisionTextContentReadResult>>;
}

interface CalculatedPullRequestProgress {
  readonly registration: PullRequestReviewRuntimeRegistration;
  readonly persisted: ReviewStateCommit;
  readonly progress: PullRequestDiffProgress;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const targetFor = (registration: PullRequestReviewRuntimeRegistration): ReviewStateRepositoryTarget => ({
  kind: "pull-request",
  repositoryId: registration.repositoryId,
  contextId: registration.snapshot.contextId,
});

const fullTextCacheKey = (revision: string, repositoryPath: string): string =>
  `${revision}\0${repositoryPath}`;

const throwIfProgressCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new DOMException("PR Progress refresh was superseded.", "AbortError");
};

interface ProgressWork {
  item(): Promise<void>;
}

const sameRegistrationSnapshot = (
  left: PullRequestReviewRuntimeRegistration,
  right: PullRequestReviewRuntimeRegistration
): boolean => left.repositoryId === right.repositoryId &&
  left.snapshot.contextId === right.snapshot.contextId &&
  left.snapshot.baseSha === right.snapshot.baseSha &&
  left.snapshot.headSha === right.snapshot.headSha &&
  left.snapshot.originalDiffId === right.snapshot.originalDiffId;

/**
 * Shared T405 runtime for persisted GitHub PR contexts. It reuses the canonical
 * T302 virtual URI, T303 command service, and T304 progress calculator instead
 * of defining a parallel diff protocol.
 */
export class PullRequestReviewRuntime<Uri> {
  private readonly registrations = new Map<string, PullRequestReviewRuntimeRegistration>();
  private readonly fullTextCaches = new Map<string, PullRequestFullTextCache>();
  private readonly globalProviderDisposers = new Map<string, () => void>();
  private readonly codec = new ReviewDiffUriCodec();
  private readonly revisionTextContentProvider: RevisionTextContentProvider;
  private activeProgressContextId: string | undefined;
  private progressGeneration = 0;
  private progressCancellation: AbortController | undefined;
  public readonly documentContentProvider: ReviewDiffTextDocumentContentProvider;
  public readonly diffController: ReviewDiffEditorController<Uri>;
  public readonly progress: PullRequestProgressTreeDataProvider;

  public constructor(private readonly options: PullRequestReviewRuntimeOptions<Uri>) {
    this.revisionTextContentProvider = new RevisionTextContentProvider(this.codec, {
      readTextContent: async (descriptor) => {
        const registration = this.registrations.get(descriptor.contextId);
        if (registration === undefined) return { kind: "missing-context" };
        return registration.readTextContent({ ...descriptor });
      },
    });
    this.documentContentProvider = new ReviewDiffTextDocumentContentProvider(
      this.revisionTextContentProvider
    );
    this.diffController = new ReviewDiffEditorController(this.codec, options.diffHost);
    this.progress = new PullRequestProgressTreeDataProvider({
      openDiff: async (target) => {
        await this.openReviewDiff(
          target.contextId,
          target.file.fileId,
          target.file.path
        );
      },
      openFile: async (target) => {
        if (this.options.openFile === undefined) {
          throw new Error("Pull-request review file host is unavailable");
        }
        await this.options.openFile(this.options.diffHost.parseUri(
          this.createPresentFileDocumentUri(target)
        ));
      },
    });
  }

  public register(registration: PullRequestReviewRuntimeRegistration): void {
    const snapshot = registration.snapshot;
    if (snapshot.contextId.trim().length === 0) throw new TypeError("PR diff contextId must not be empty");
    if (registration.repositoryId.trim().length === 0) throw new TypeError("repositoryId must not be empty");
    if (registration.repositoryRoot.trim().length === 0) throw new TypeError("repositoryRoot must not be empty");
    if (snapshot.originalDiffId !== `${snapshot.baseSha}..${snapshot.headSha}`) {
      throw new Error("PR diff originalDiffId must match base/head revisions");
    }
    this.assertRegistrationHasOneToOneLogicalPaths(registration);
    const previous = this.registrations.get(snapshot.contextId);
    if (
      previous !== undefined &&
      this.activeProgressContextId === snapshot.contextId &&
      !sameRegistrationSnapshot(previous, registration)
    ) {
      this.clearProgress();
    }
    this.registrations.set(snapshot.contextId, {
      ...registration,
      snapshot: clone(snapshot),
    });
    const existingCache = this.fullTextCaches.get(snapshot.contextId);
    if (
      existingCache !== undefined &&
      (existingCache.baseSha !== snapshot.baseSha || existingCache.headSha !== snapshot.headSha)
    ) {
      this.fullTextCaches.delete(snapshot.contextId);
    }
    this.globalProviderDisposers.get(snapshot.contextId)?.();
    this.globalProviderDisposers.set(
      snapshot.contextId,
      registerPullRequestGlobalHeadFileProvider(snapshot.contextId, async (request) => {
        const current = this.registrations.get(snapshot.contextId);
        if (current === undefined || current.snapshot.headSha !== request.headRevision) return [];
        return this.readGlobalHeadFiles(snapshot.contextId, request.candidatePaths, request.signal);
      })
    );
  }

  public unregister(contextId: string): void {
    this.registrations.delete(contextId);
    this.fullTextCaches.delete(contextId);
    this.globalProviderDisposers.get(contextId)?.();
    this.globalProviderDisposers.delete(contextId);
    if (this.activeProgressContextId === contextId) this.clearProgress();
  }

  public hasContext(contextId: string): boolean {
    return this.registrations.has(contextId);
  }

  public createHeadFileDocumentUri(
    contextId: string,
    repositoryPath: string,
    revisionId: string
  ): string {
    const registration = this.requireRegistration(contextId);
    if (registration.snapshot.headSha !== revisionId) {
      throw new RangeError("Global PR file target is stale because the registered PR HEAD revision changed");
    }
    const file = registration.snapshot.files.find((candidate) =>
      candidate.newPath === repositoryPath
    );
    if (file === undefined) {
      throw new Error("Global PR file is unavailable at the requested HEAD revision");
    }
    if (file.status === "binary") {
      throw new Error("Binary PR files are unavailable as Global text documents");
    }
    return this.codec.encode({
      contextId,
      filePath: repositoryPath,
      fileSystemPathSemantics: registration.fileSystemPathSemantics,
      side: "modified",
      revisionSource: "git-commit",
      revision: revisionId
    });
  }

  /** Creates a present immutable PR Progress file target without falling back to the working tree. */
  public createPresentFileDocumentUri(target: PullRequestProgressTreeDiffTarget): string {
    const registration = this.requireRegistration(target.contextId);
    const { snapshot } = registration;
    if (
      target.snapshotId !== `${snapshot.contextId}:${snapshot.baseSha}:${snapshot.headSha}` ||
      target.baseSha !== snapshot.baseSha ||
      target.headSha !== snapshot.headSha ||
      target.originalDiffId !== snapshot.originalDiffId ||
      target.fileSystemPathSemantics !== registration.fileSystemPathSemantics
    ) {
      throw new RangeError("PR Progress file target is stale for the current immutable snapshot.");
    }
    const file = snapshot.files.find((candidate) => candidate.fileId === target.file.fileId);
    if (
      file === undefined ||
      file.oldPath !== target.file.oldPath ||
      file.newPath !== target.file.newPath ||
      file.status !== target.file.status
    ) {
      throw new RangeError("PR Progress file target is unavailable in the current immutable snapshot.");
    }
    const side = target.modified.kind === "present" ? target.modified : target.original;
    const sideName = target.modified.kind === "present" ? "modified" : "original";
    const expectedPath = sideName === "modified" ? file.newPath : file.oldPath;
    const expectedRevision = sideName === "modified" ? snapshot.headSha : snapshot.baseSha;
    if (
      side.kind !== "present" ||
      expectedPath === undefined ||
      side.filePath !== expectedPath ||
      side.revision !== expectedRevision
    ) {
      throw new RangeError("PR Progress file target does not identify a present immutable side.");
    }
    return this.codec.encode({
      contextId: target.contextId,
      filePath: side.filePath,
      fileSystemPathSemantics: target.fileSystemPathSemantics,
      side: sideName,
      revisionSource: "git-commit",
      revision: side.revision,
    });
  }

  /**
   * Fully scans every reviewable PR file once per immutable revision pair.
   * Existing/added/renamed/copied files are read from HEAD and returned for
   * Global opened evidence. Deleted files are read from BASE to complete the PR
   * scan, but are not returned because they do not exist in the Global HEAD.
   * Working-tree path discovery is diagnostic only and never gates immutable PR
   * snapshot content. A folder-generation cancellation stops before any later
   * immutable file read and invalidates an in-flight adapter request.
   */
  public async readGlobalHeadFiles(
    contextId: string,
    candidatePaths: ReadonlySet<string>,
    signal?: AbortSignal
  ): Promise<readonly PullRequestGlobalHeadFile[]> {
    const assertNotAborted = (): void => {
      if (signal?.aborted === true) throw new DOMException("Global PR evidence capture was superseded.", "AbortError");
    };
    const registration = this.requireRegistration(contextId);
    const { baseSha, headSha } = registration.snapshot;
    const cache = this.fullTextCacheFor(registration);

    void candidatePaths;
    const files: PullRequestGlobalHeadFile[] = [];
    const exclusionPolicy = this.options.getExclusionPolicy();
    for (const file of registration.snapshot.files) {
      assertNotAborted();
      if (file.status === "binary") continue;

      if (file.newPath !== undefined) {
        if (exclusionPolicy.evaluate({ path: file.newPath, isBinary: false }).excluded) continue;
        const result = await this.readCachedFullText(
          registration,
          cache,
          file.newPath,
          headSha,
          "modified",
          undefined,
          signal
        );
        assertNotAborted();
        if (result.kind === "invalid-encoding") continue;
        if (result.kind !== "found") {
          throw new Error(`PR HEAD file is unavailable for Global scan: ${file.newPath} (${result.kind})`);
        }
        files.push({
          path: this.canonicalRepositoryPath(registration, file.newPath),
          revisionId: headSha,
          content: result.content,
        });
        continue;
      }

      const deletedPath = file.oldPath;
      if (deletedPath === undefined) continue;
      if (exclusionPolicy.evaluate({ path: deletedPath, isBinary: false }).excluded) continue;
      const deleted = await this.readCachedFullText(
        registration,
        cache,
        deletedPath,
        baseSha,
        "original",
        undefined,
        signal
      );
      assertNotAborted();
      if (deleted.kind === "invalid-encoding") continue;
      if (deleted.kind !== "found") {
        throw new Error(`PR BASE file is unavailable for full scan: ${deletedPath} (${deleted.kind})`);
      }
    }
    return files;
  }

  private fullTextCacheFor(
    registration: PullRequestReviewRuntimeRegistration
  ): PullRequestFullTextCache {
    const { contextId, baseSha, headSha } = registration.snapshot;
    let cache = this.fullTextCaches.get(contextId);
    if (cache === undefined || cache.baseSha !== baseSha || cache.headSha !== headSha) {
      cache = {
        baseSha,
        headSha,
        files: new Map<string, Promise<RevisionTextContentReadResult>>(),
      };
      this.fullTextCaches.set(contextId, cache);
    }
    return cache;
  }

  private async readCachedFullText(
    registration: PullRequestReviewRuntimeRegistration,
    cache: PullRequestFullTextCache,
    repositoryPath: string,
    revision: string,
    side: "original" | "modified",
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<RevisionTextContentReadResult> {
    const key = fullTextCacheKey(revision, repositoryPath);
    let pending = cache.files.get(key);
    if (pending === undefined) {
      pending = registration.readTextContent({
        contextId: registration.snapshot.contextId,
        filePath: repositoryPath,
        fileSystemPathSemantics: registration.fileSystemPathSemantics,
        side,
        revisionSource: "git-commit",
        revision,
      }, feedbackContext, signal).catch((error: unknown) => {
        cache.files.delete(key);
        throw error;
      });
      cache.files.set(key, pending);
    }
    return pending;
  }

  public ownsDiffDocumentUri(uri: string): boolean {
    try {
      return this.registrations.has(this.codec.decode(uri).contextId);
    } catch {
      return false;
    }
  }

  public fileIdForDiffDocumentUri(uri: string): string {
    const descriptor = this.codec.decode(uri);
    const registration = this.requireRegistration(descriptor.contextId);
    return this.diffFileForDescriptor(registration, descriptor).fileId;
  }

  public sideForDiffDocumentUri(uri: string): "original" | "modified" {
    const descriptor = this.codec.decode(uri);
    this.requireRegistration(descriptor.contextId);
    return descriptor.side;
  }

  public async openReviewDiff(
    contextId: string,
    fileId: string,
    title?: string
  ): Promise<void> {
    const registration = this.requireRegistration(contextId);
    const file = registration.snapshot.files.find((candidate) => candidate.fileId === fileId);
    if (file === undefined) throw new Error("PR diff file is unavailable");
    if (file.status === "binary") throw new Error("Binary files are unsupported for line review");
    const logicalPath = file.newPath ?? file.oldPath ?? file.fileId;
    await this.diffController.openReviewDiff({
      contextId,
      fileSystemPathSemantics: registration.fileSystemPathSemantics,
      original: file.oldPath === undefined
        ? { kind: "absent", filePath: logicalPath, revision: registration.snapshot.baseSha }
        : { kind: "present", filePath: file.oldPath, revision: registration.snapshot.baseSha },
      modified: file.newPath === undefined
        ? { kind: "absent", filePath: logicalPath, revision: registration.snapshot.headSha }
        : { kind: "present", filePath: file.newPath, revision: registration.snapshot.headSha },
      title: title?.trim().length ? title : logicalPath,
    });
  }

  public async getProgress(
    contextId: string,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<Pick<PullRequestDiffProgress, "reviewedLineCount" | "totalLineCount" | "progress">> {
    return runWithActiveOperationFeedback("PR進捗を計算", async () => {
      const calculated = await this.calculateProgress(contextId, signal);
      return {
        reviewedLineCount: calculated.progress.reviewedLineCount,
        totalLineCount: calculated.progress.totalLineCount,
        progress: calculated.progress.progress,
      };
    }, { maxAttempts: 3, signal }, feedbackContext);
  }

  /** Replaces the dedicated T304 tree with the currently selected persisted GitHub PR. */
  public async activateProgress(contextId: string): Promise<void> {
    this.progressCancellation?.abort();
    const cancellation = new AbortController();
    this.progressCancellation = cancellation;
    const generation = ++this.progressGeneration;
    this.activeProgressContextId = contextId;
    this.progress.clear();
    const registration = this.requireRegistration(contextId);
    const assertCurrent = (): void => {
      if (!this.isCurrentProgressGeneration(contextId, generation, registration) || cancellation.signal.aborted) {
        throw new OperationCancelledError();
      }
    };
    try {
      await runWithActiveOperationFeedback(
        "PR進捗を計算",
        async (feedbackContext) => {
          const work = this.createProgressWork(cancellation.signal);
          const calculated = await this.calculateProgress(contextId, cancellation.signal, work);
          assertCurrent();
          const lineReviewabilityByFileId: Record<string, PullRequestLineReviewability> = {};
          for (const file of calculated.progress.files) {
            assertCurrent();
            await work.item();
            lineReviewabilityByFileId[file.fileId] = await this.lineReviewabilityFor(
              calculated.registration,
              file,
              feedbackContext,
              cancellation.signal,
            );
            assertCurrent();
          }
          assertCurrent();
          const { snapshot } = calculated.registration;
          await this.progress.replaceSnapshotIncrementally({
            snapshotId: `${snapshot.contextId}:${snapshot.baseSha}:${snapshot.headSha}`,
            contextId: snapshot.contextId,
            baseSha: snapshot.baseSha,
            headSha: snapshot.headSha,
            originalDiffId: snapshot.originalDiffId,
            fileSystemPathSemantics: calculated.registration.fileSystemPathSemantics,
            progress: calculated.progress,
            lineReviewabilityByFileId,
          }, {
            maxFilesPerStage: 128,
            yieldControl: () => new Promise<void>((resolve) => setImmediate(resolve)),
            isCurrent: () => this.isCurrentProgressGeneration(contextId, generation, registration) && !cancellation.signal.aborted,
          });
          assertCurrent();
        },
        { maxAttempts: 3, signal: cancellation.signal },
      );
    } catch (error) {
      if (!this.isCurrentProgressGeneration(contextId, generation, registration)) {
        throw error instanceof OperationCancelledError ? error : new OperationCancelledError();
      }
      this.progress.clear();
      throw error;
    } finally {
      if (this.progressCancellation === cancellation) this.progressCancellation = undefined;
    }
  }

  public async refreshActiveProgress(): Promise<void> {
    if (this.activeProgressContextId === undefined) return;
    await this.activateProgress(this.activeProgressContextId);
  }

  public clearProgress(): void {
    this.progressCancellation?.abort();
    this.progressCancellation = undefined;
    this.progressGeneration += 1;
    this.activeProgressContextId = undefined;
    this.progress.clear();
  }

  public createCommandService<Editor>(
    dependencies: PullRequestReviewCommandDependencies<Editor>
  ): DiffEditorReviewCommandService<Editor> {
    return new DiffEditorReviewCommandService({
      ...dependencies,
      openSession: async (editor) => this.openSession(
        dependencies.getDocumentUri(editor)
      ),
      requestHistory: (transaction) => this.options.requestHistory(transaction),
    });
  }

  public async openSession(uri: string, fileId?: string) {
    const descriptor = this.codec.decode(uri);
    const registration = this.requireRegistration(descriptor.contextId);
    const descriptorFile = this.diffFileForDescriptor(registration, descriptor);
    const diffFile = fileId === undefined
      ? descriptorFile
      : registration.snapshot.files.find((candidate) => candidate.fileId === fileId);
    if (diffFile === undefined || diffFile.status === "binary") {
      throw new Error("PR file is unavailable for line review");
    }
    if (diffFile.fileId !== descriptorFile.fileId) {
      throw new Error("PR diff document and requested file identity do not match");
    }
    const persisted = await this.options.repository.load(targetFor(registration));
    if (persisted === undefined) throw new Error("Persisted pull-request review context is unavailable");
    this.requireMatchingContext(registration, persisted);
    this.assertPersistedFileMappingsAreOneToOne(registration, persisted);
    const logicalPath = diffFile.newPath ?? diffFile.oldPath ?? diffFile.fileId;
    const resolvedFileId = this.persistedFileIdForPath(
      registration,
      persisted,
      logicalPath
    ) ?? diffFile.fileId;
    const persistedFile = persisted.contextState.files[resolvedFileId];
    const persistedGlobalFile = persisted.globalState.files[resolvedFileId];
    const targetPath = persistedFile?.currentPath ??
      persistedGlobalFile?.currentPath ??
      logicalPath;
    const modifiedLineCount = diffFile.newPath === undefined
      ? 0
      : persistedFile?.revisionId === registration.snapshot.headSha &&
          this.canonicalRepositoryPath(registration, persistedFile.currentPath) ===
            this.canonicalRepositoryPath(registration, diffFile.newPath)
        ? persistedFile.lineCount
        : await this.lineCount(
            registration.snapshot.contextId,
            diffFile.newPath,
            registration.snapshot.headSha,
            "modified"
          );
    const originalLineCount = diffFile.oldPath === undefined
      ? 0
      : await this.lineCount(
          registration.snapshot.contextId,
          diffFile.oldPath,
          registration.snapshot.baseSha,
          "original"
        );
    return {
      contextState: persisted.contextState,
      globalState: persisted.globalState,
      target: {
        fileId: resolvedFileId,
        currentPath: targetPath,
        revisionId: registration.snapshot.headSha,
        lineCount: modifiedLineCount,
      },
      diffId: registration.snapshot.originalDiffId,
      originalLineCount,
      originalDeletionIntervals: diffFile.hunks.flatMap((hunk) => hunk.lines.flatMap((line) =>
        line.kind === "deletion" && line.oldLine !== undefined
          ? [{ startLine: line.oldLine - 1, endLineExclusive: line.oldLine }]
          : []
      )),
      committer: {
        commit: (transaction: Readonly<ReviewStateTransactionLike>) => this.options.repository.commit(transaction),
      },
    };
  }

  private async calculateProgress(
    contextId: string,
    signal?: AbortSignal,
    work?: ProgressWork,
  ): Promise<CalculatedPullRequestProgress> {
    throwIfProgressCancelled(signal);
    const registration = this.requireRegistration(contextId);
    const persisted = await this.options.repository.load(targetFor(registration));
    throwIfProgressCancelled(signal);
    if (persisted === undefined) {
      throw new Error("Persisted pull-request review context is unavailable");
    }
    this.requireMatchingContext(registration, persisted);
    this.assertPersistedFileMappingsAreOneToOne(registration, persisted);
    const calculationInput = {
      diff: registration.snapshot,
      reviewContext: signal === undefined
        ? this.projectContextFileIdentities(registration, persisted)
        : await this.projectContextFileIdentitiesCooperatively(registration, persisted, signal, work ?? this.createProgressWork(signal)),
      exclusionPolicy: this.options.getExclusionPolicy(),
    };
    const progress = signal === undefined
      ? calculatePullRequestDiffProgress(calculationInput)
      : await calculatePullRequestDiffProgressCooperatively(calculationInput, {
        maxWorkItems: this.progressWorkItemLimit(),
        yieldControl: this.progressYieldControl(),
        isCurrent: () => !signal.aborted,
      });
    if (progress === undefined) {
      throwIfProgressCancelled(signal);
      throw new DOMException("PR Progress refresh was superseded.", "AbortError");
    }
    return { registration, persisted, progress };
  }

  private projectContextFileIdentities(
    registration: PullRequestReviewRuntimeRegistration,
    persisted: ReviewStateCommit
  ): ReviewStateCommit["contextState"] {
    const projected = clone(persisted.contextState);
    for (const diffFile of registration.snapshot.files) {
      const logicalPath = diffFile.newPath ?? diffFile.oldPath;
      if (logicalPath === undefined) continue;
      const matching = this.persistedContextFileForPath(
        registration,
        persisted,
        logicalPath
      );
      if (matching === undefined) continue;
      projected.files[diffFile.fileId] = {
        ...clone(matching.file),
        fileId: diffFile.fileId,
        currentPath: logicalPath,
      };
    }
    return projected;
  }

  /** Returns the immutable registered diff for normal-editor PR decoration composition. */
  public snapshotForContext(contextId: string): Readonly<PullRequestDiffSnapshot> | undefined {
    return this.registrations.get(contextId)?.snapshot;
  }

  private async projectContextFileIdentitiesCooperatively(
    registration: PullRequestReviewRuntimeRegistration,
    persisted: ReviewStateCommit,
    signal: AbortSignal,
    work: ProgressWork
  ): Promise<ReviewStateCommit["contextState"]> {
    const filesByPath = new Map<string, { readonly fileId: string; readonly file: ReviewStateCommit["contextState"]["files"][string] }>();
    const persistedFiles = persisted.contextState.files;
    for (const fileId in persistedFiles) {
      if (!Object.hasOwn(persistedFiles, fileId)) continue;
      await work.item();
      const file = persistedFiles[fileId]!;
      const path = this.canonicalRepositoryPath(registration, file.currentPath);
      if (filesByPath.has(path)) throw new Error(`Persisted PR context has conflicting file identities for ${path}`);
      filesByPath.set(path, { fileId, file });
    }
    const projectedFiles: ReviewStateCommit["contextState"]["files"] = {};
    for (const diffFile of registration.snapshot.files) {
      await work.item();
      const logicalPath = diffFile.newPath ?? diffFile.oldPath;
      if (logicalPath === undefined) continue;
      const matching = filesByPath.get(this.canonicalRepositoryPath(registration, logicalPath));
      if (matching === undefined) continue;
      // Progress needs only changed-file identities; retain no cloned unrelated state.
      projectedFiles[diffFile.fileId] = { ...matching.file, fileId: diffFile.fileId, currentPath: logicalPath };
    }
    throwIfProgressCancelled(signal);
    return { ...persisted.contextState, files: projectedFiles };
  }

  private progressWorkItemLimit(): number {
    return this.options.progressWork?.maxItems ?? 128;
  }

  private progressYieldControl(): () => void | Promise<void> {
    return this.options.progressWork?.yieldControl ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  }

  private createProgressWork(signal: AbortSignal): ProgressWork {
    const limit = this.progressWorkItemLimit();
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 128) {
      throw new RangeError("progressWork.maxItems must be a positive integer no greater than 128.");
    }
    let pending = 0;
    return {
      item: async (): Promise<void> => {
        throwIfProgressCancelled(signal);
        pending += 1;
        this.options.progressWork?.account?.(1);
        if (pending < limit) return;
        this.options.progressWork?.onYield?.(pending);
        pending = 0;
        await this.progressYieldControl()();
        throwIfProgressCancelled(signal);
      }
    };
  }

  private persistedContextFileForPath(
    registration: PullRequestReviewRuntimeRegistration,
    persisted: ReviewStateCommit,
    logicalPath: string
  ): { readonly fileId: string; readonly file: ReviewStateCommit["contextState"]["files"][string] } | undefined {
    const expectedPath = this.canonicalRepositoryPath(registration, logicalPath);
    const matches = Object.entries(persisted.contextState.files).filter(([, file]) =>
      this.canonicalRepositoryPath(registration, file.currentPath) === expectedPath
    );
    if (matches.length > 1) {
      throw new Error(`Persisted PR context has conflicting file identities for ${expectedPath}`);
    }
    const match = matches[0];
    return match === undefined ? undefined : { fileId: match[0], file: match[1] };
  }

  private persistedFileIdForPath(
    registration: PullRequestReviewRuntimeRegistration,
    persisted: ReviewStateCommit,
    logicalPath: string
  ): string | undefined {
    const expectedPath = this.canonicalRepositoryPath(registration, logicalPath);
    const fileIds = new Set<string>();
    for (const [fileId, file] of Object.entries(persisted.contextState.files)) {
      if (this.canonicalRepositoryPath(registration, file.currentPath) === expectedPath) {
        fileIds.add(fileId);
      }
    }
    for (const [fileId, file] of Object.entries(persisted.globalState.files)) {
      if (this.canonicalRepositoryPath(registration, file.currentPath) === expectedPath) {
        fileIds.add(fileId);
      }
    }
    if (fileIds.size > 1) {
      throw new Error(`Persisted PR state has conflicting file identities for ${expectedPath}`);
    }
    return fileIds.values().next().value as string | undefined;
  }

  private diffFileForDescriptor(
    registration: PullRequestReviewRuntimeRegistration,
    descriptor: ReturnType<ReviewDiffUriCodec["decode"]>
  ) {
    const descriptorPath = this.canonicalRepositoryPath(
      registration,
      descriptor.filePath
    );
    const matches = registration.snapshot.files.filter((file) => {
      const sourcePath = descriptor.side === "original"
        ? file.oldPath ?? file.newPath
        : file.newPath ?? file.oldPath;
      return sourcePath !== undefined &&
        this.canonicalRepositoryPath(registration, sourcePath) === descriptorPath;
    });
    if (matches.length !== 1) {
      throw new Error("Review diff document does not identify exactly one PR file");
    }
    return matches[0]!;
  }

  private async lineReviewabilityFor(
    registration: PullRequestReviewRuntimeRegistration,
    file: PullRequestDiffFileProgress,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<PullRequestLineReviewability> {
    if (file.status === "binary" || file.exclusionReason?.kind === "binary") {
      return { kind: "unsupported", reason: { kind: "binary" } };
    }
    // Excluded files have a zero effective denominator and never need content
    // acquisition merely to prepare a Tree node.
    if (file.excluded) return { kind: "reviewable" };
    const filePath = file.newPath ?? file.oldPath;
    if (filePath === undefined) {
      throw new Error(`PR progress file has no content path: ${file.fileId}`);
    }
    const modified = file.newPath !== undefined;
    const revision = modified
      ? registration.snapshot.headSha
      : registration.snapshot.baseSha;
    const result = await this.readCachedFullText(
      registration,
      this.fullTextCacheFor(registration),
      filePath,
      revision,
      modified ? "modified" : "original",
      feedbackContext,
      signal,
    );
    if (result.kind === "invalid-encoding") {
      return {
        kind: "unsupported",
        reason: { kind: "invalid-encoding", encoding: result.encoding },
      };
    }
    if (result.kind !== "found") {
      throw new Error(`PR progress text is unavailable for ${filePath} (${result.kind})`);
    }
    return { kind: "reviewable" };
  }

  private canonicalRepositoryPath(
    registration: PullRequestReviewRuntimeRegistration,
    repositoryPath: string
  ): string {
    const canonical = requireCanonicalRepositoryRelativePath(
      repositoryPath,
      registration.fileSystemPathSemantics
    );
    return registration.fileSystemPathSemantics === "windows"
      ? canonical.toLowerCase()
      : canonical;
  }

  private assertRegistrationHasOneToOneLogicalPaths(
    registration: PullRequestReviewRuntimeRegistration
  ): void {
    const currentFileIdByPath = new Map<string, string>();
    const originalFileByPath = new Map<string, {
      readonly fileId: string;
      readonly status: PullRequestDiffSnapshot["files"][number]["status"];
      readonly rawPath: string;
    }>();
    for (const file of registration.snapshot.files) {
      const currentPath = file.newPath ?? file.oldPath;
      if (currentPath !== undefined) {
        const canonicalCurrentPath = this.canonicalRepositoryPath(registration, currentPath);
        const existingCurrentFileId = currentFileIdByPath.get(canonicalCurrentPath);
        if (existingCurrentFileId !== undefined && existingCurrentFileId !== file.fileId) {
          throw new Error(
            `PR diff has case-colliding file identities after ${registration.fileSystemPathSemantics} canonicalization: ${canonicalCurrentPath}`
          );
        }
        currentFileIdByPath.set(canonicalCurrentPath, file.fileId);
      }
      if (file.oldPath !== undefined) {
        const canonicalOriginalPath = this.canonicalRepositoryPath(registration, file.oldPath);
        const existingOriginalFile = originalFileByPath.get(canonicalOriginalPath);
        const sharedCopiedSource = existingOriginalFile !== undefined &&
          existingOriginalFile.rawPath === file.oldPath &&
          (existingOriginalFile.status === "copied" || file.status === "copied");
        if (
          existingOriginalFile !== undefined &&
          existingOriginalFile.fileId !== file.fileId &&
          !sharedCopiedSource
        ) {
          throw new Error(
            `PR diff has case-colliding file identities after ${registration.fileSystemPathSemantics} canonicalization: ${canonicalOriginalPath}`
          );
        }
        if (existingOriginalFile === undefined) {
          originalFileByPath.set(canonicalOriginalPath, {
            fileId: file.fileId,
            status: file.status,
            rawPath: file.oldPath,
          });
        }
      }
    }
  }

  private assertPersistedFileMappingsAreOneToOne(
    registration: PullRequestReviewRuntimeRegistration,
    persisted: ReviewStateCommit
  ): void {
    const diffFileIdByPersistedFileId = new Map<string, string>();
    for (const diffFile of registration.snapshot.files) {
      const logicalPath = diffFile.newPath ?? diffFile.oldPath;
      if (logicalPath === undefined) continue;
      const persistedFileId = this.persistedFileIdForPath(
        registration,
        persisted,
        logicalPath
      );
      if (persistedFileId === undefined) continue;
      const previousDiffFileId = diffFileIdByPersistedFileId.get(persistedFileId);
      if (previousDiffFileId !== undefined && previousDiffFileId !== diffFile.fileId) {
        throw new Error(
          `Persisted PR file identity ${persistedFileId} maps to multiple diff files.`
        );
      }
      diffFileIdByPersistedFileId.set(persistedFileId, diffFile.fileId);
    }
  }

  private isCurrentProgressGeneration(
    contextId: string,
    generation: number,
    registration: PullRequestReviewRuntimeRegistration | undefined
  ): boolean {
    return this.activeProgressContextId === contextId &&
      this.progressGeneration === generation &&
      this.registrations.get(contextId) === registration;
  }

  private async lineCount(
    contextId: string,
    filePath: string,
    revision: string,
    side: "original" | "modified"
  ): Promise<number> {
    const content = await this.revisionTextContentProvider.provideTextDocumentContent(
      this.codec.encode({
        contextId,
        filePath,
        fileSystemPathSemantics: this.requireRegistration(contextId).fileSystemPathSemantics,
        side,
        revisionSource: "git-commit",
        revision,
      })
    );
    return content.split(/\r\n|\r|\n/u).length;
  }

  private requireRegistration(contextId: string): PullRequestReviewRuntimeRegistration {
    const registration = this.registrations.get(contextId);
    if (registration === undefined) throw new Error("Pull-request review runtime context is not registered");
    this.assertRegistrationHasOneToOneLogicalPaths(registration);
    return registration;
  }

  private requireMatchingContext(
    registration: PullRequestReviewRuntimeRegistration,
    commit: ReviewStateCommit
  ): void {
    const pullRequest = commit.contextState.pullRequest;
    if (
      commit.contextState.kind !== "pull-request" ||
      commit.contextState.contextId !== registration.snapshot.contextId ||
      commit.contextState.repositoryId !== registration.repositoryId ||
      pullRequest === undefined ||
      pullRequest.baseSha !== registration.snapshot.baseSha ||
      pullRequest.headSha !== registration.snapshot.headSha
    ) throw new Error("Persisted pull-request context does not match the registered diff revision");
  }
}

import { runWithActiveOperationFeedback } from "./application/operation-feedback/index";
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
  type PullRequestDiffProgress,
  type PullRequestDiffSnapshot,
} from "./core/pr-progress/index";
import {
  ReviewDiffEditorController,
  ReviewDiffTextDocumentContentProvider,
  type ReviewDiffEditorHost,
} from "./ui/diff-editor/index";

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
    descriptor: GitCommitReviewDiffDocumentDescriptor
  ) => Promise<RevisionTextContentReadResult>;
}

export interface PullRequestReviewRuntimeOptions<Uri> {
  readonly repository: PullRequestReviewRuntimeRepository;
  readonly requestHistory: (transaction: Readonly<ReviewStateTransaction>) => void | Promise<void>;
  readonly diffHost: ReviewDiffEditorHost<Uri>;
  readonly getExclusionPolicy: () => ReviewFileExclusionPolicy;
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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const targetFor = (registration: PullRequestReviewRuntimeRegistration): ReviewStateRepositoryTarget => ({
  kind: "pull-request",
  repositoryId: registration.repositoryId,
  contextId: registration.snapshot.contextId,
});

const fullTextCacheKey = (revision: string, repositoryPath: string): string =>
  `${revision}\0${repositoryPath}`;

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
  public readonly documentContentProvider: ReviewDiffTextDocumentContentProvider;
  public readonly diffController: ReviewDiffEditorController<Uri>;

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
  }

  public register(registration: PullRequestReviewRuntimeRegistration): void {
    const snapshot = registration.snapshot;
    if (snapshot.contextId.trim().length === 0) throw new TypeError("PR diff contextId must not be empty");
    if (registration.repositoryId.trim().length === 0) throw new TypeError("repositoryId must not be empty");
    if (registration.repositoryRoot.trim().length === 0) throw new TypeError("repositoryRoot must not be empty");
    if (snapshot.originalDiffId !== `${snapshot.baseSha}..${snapshot.headSha}`) {
      throw new Error("PR diff originalDiffId must match base/head revisions");
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
        return this.readGlobalHeadFiles(snapshot.contextId, request.candidatePaths);
      })
    );
  }

  public unregister(contextId: string): void {
    this.registrations.delete(contextId);
    this.fullTextCaches.delete(contextId);
    this.globalProviderDisposers.get(contextId)?.();
    this.globalProviderDisposers.delete(contextId);
  }

  public hasContext(contextId: string): boolean {
    return this.registrations.has(contextId);
  }

  /**
   * Fully scans every reviewable PR file once per immutable revision pair.
   * Existing/added/renamed/copied files are read from HEAD and returned for
   * Global opened evidence. Deleted files are read from BASE to complete the PR
   * scan, but are not returned because they do not exist in the Global HEAD.
   * Working-tree path discovery is diagnostic only and never gates immutable PR
   * snapshot content.
   */
  public async readGlobalHeadFiles(
    contextId: string,
    candidatePaths: ReadonlySet<string>
  ): Promise<readonly PullRequestGlobalHeadFile[]> {
    const registration = this.requireRegistration(contextId);
    const { baseSha, headSha } = registration.snapshot;
    let cache = this.fullTextCaches.get(contextId);
    if (cache === undefined || cache.baseSha !== baseSha || cache.headSha !== headSha) {
      cache = {
        baseSha,
        headSha,
        files: new Map<string, Promise<RevisionTextContentReadResult>>(),
      };
      this.fullTextCaches.set(contextId, cache);
    }

    void candidatePaths;
    const files: PullRequestGlobalHeadFile[] = [];
    const exclusionPolicy = this.options.getExclusionPolicy();
    for (const file of registration.snapshot.files) {
      if (file.status === "binary") continue;

      if (file.newPath !== undefined) {
        if (exclusionPolicy.evaluate({ path: file.newPath, isBinary: false }).excluded) continue;
        const result = await this.readCachedFullText(
          registration,
          cache,
          file.newPath,
          headSha,
          "modified"
        );
        if (result.kind === "invalid-encoding") continue;
        if (result.kind !== "found") {
          throw new Error(`PR HEAD file is unavailable for Global scan: ${file.newPath} (${result.kind})`);
        }
        files.push({
          path: file.newPath,
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
        "original"
      );
      if (deleted.kind === "invalid-encoding") continue;
      if (deleted.kind !== "found") {
        throw new Error(`PR BASE file is unavailable for full scan: ${deletedPath} (${deleted.kind})`);
      }
    }
    return files;
  }

  private async readCachedFullText(
    registration: PullRequestReviewRuntimeRegistration,
    cache: PullRequestFullTextCache,
    repositoryPath: string,
    revision: string,
    side: "original" | "modified"
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
      }).catch((error: unknown) => {
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
    const matches = registration.snapshot.files.filter((file) =>
      (descriptor.side === "original"
        ? file.oldPath ?? file.newPath
        : file.newPath ?? file.oldPath) === descriptor.filePath
    );
    if (matches.length !== 1) throw new Error("Review diff document does not identify exactly one PR file");
    return matches[0]!.fileId;
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

  public async getProgress(contextId: string): Promise<Pick<PullRequestDiffProgress, "reviewedLineCount" | "totalLineCount" | "progress">> {
    return runWithActiveOperationFeedback("PR進捗を計算", async () => {
      const registration = this.requireRegistration(contextId);
      const persisted = await this.options.repository.load(targetFor(registration));
      if (persisted === undefined) throw new Error("Persisted pull-request review context is unavailable");
      this.requireMatchingContext(registration, persisted);
      const progress = calculatePullRequestDiffProgress({
        diff: registration.snapshot,
        reviewContext: persisted.contextState,
        exclusionPolicy: this.options.getExclusionPolicy(),
      });
      return {
        reviewedLineCount: progress.reviewedLineCount,
        totalLineCount: progress.totalLineCount,
        progress: progress.progress,
      };
    });
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
    const resolvedFileId = fileId ?? this.fileIdForDiffDocumentUri(uri);
    const diffFile = registration.snapshot.files.find((candidate) => candidate.fileId === resolvedFileId);
    if (diffFile === undefined || diffFile.status === "binary") {
      throw new Error("PR file is unavailable for line review");
    }
    const persisted = await this.options.repository.load(targetFor(registration));
    if (persisted === undefined) throw new Error("Persisted pull-request review context is unavailable");
    this.requireMatchingContext(registration, persisted);
    const logicalPath = diffFile.newPath ?? diffFile.oldPath ?? diffFile.fileId;
    const persistedFile = persisted.contextState.files[resolvedFileId];
    const modifiedLineCount = diffFile.newPath === undefined
      ? 0
      : persistedFile?.revisionId === registration.snapshot.headSha && persistedFile.currentPath === diffFile.newPath
        ? persistedFile.lineCount
        : await this.lineCount(registration.snapshot.contextId, diffFile.newPath, registration.snapshot.headSha, "modified");
    const originalLineCount = diffFile.oldPath === undefined
      ? 0
      : await this.lineCount(registration.snapshot.contextId, diffFile.oldPath, registration.snapshot.baseSha, "original");
    return {
      contextState: persisted.contextState,
      globalState: persisted.globalState,
      target: {
        fileId: resolvedFileId,
        currentPath: logicalPath,
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

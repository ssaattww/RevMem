import {
  createNodeLocalGitAdapter,
  LocalGitPullRequestDiffAdapter,
  NodeGitCommandExecutor
} from "./adapters/local-git/index";
import { LocalGitRevisionTextContentSource } from "./adapters/diff-document/index";
import type { DebouncedReviewStateRepository } from "./adapters/state-repository/index";
import { PullRequestDiffAcquisitionService } from "./application/github-pr-diff/index";
import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider
} from "./application/diff-document/index";
import {
  DiffEditorReviewCommandService,
  type DiffEditorReviewCommandDependencies,
  type DiffEditorReviewStateSession
} from "./application/review-commands/index";
import type { ReviewHistoryRecorder } from "./application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "./core/contracts/index";
import {
  calculatePullRequestDiffProgress,
  type PullRequestDiffSnapshot
} from "./core/pr-progress/index";
import { ReviewFileExclusionPolicy } from "./core/file-exclusion/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeHost
} from "./ui/pr-progress/index";
import {
  ReviewDiffEditorController,
  ReviewDiffTextDocumentContentProvider,
  type ReviewDiffEditorHost
} from "./ui/diff-editor/index";

/** Immutable local base/head input supplied by the T306 fixture boundary. */
export interface LocalBaseHeadRuntimeInput {
  readonly workspaceRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
}

/** State owned by one initialized local base/head runtime. */
export interface LocalBaseHeadRuntimeSnapshot {
  readonly diff: PullRequestDiffSnapshot;
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
}

/** Creates the VS Code-facing components from runtime-owned ports rather than test-local fakes. */
export interface LocalBaseHeadRuntimeOptions<Uri> {
  readonly repository: DebouncedReviewStateRepository;
  readonly historyRecorder: ReviewHistoryRecorder;
  readonly diffHost: ReviewDiffEditorHost<Uri>;
  readonly progressHost: PullRequestProgressTreeHost;
  /** Returns the current T300 exclusion policy snapshot whenever progress is projected. */
  readonly getExclusionPolicy: () => ReviewFileExclusionPolicy;
  readonly now?: () => Date;
}

const contextIdFor = (input: LocalBaseHeadRuntimeInput): string =>
  `local-base-head:${input.baseSha}..${input.headSha}`;

const repositoryIdFor = (workspaceRoot: string): string =>
  `local-base-head:${workspaceRoot}`;

/**
 * Internal T306 composition for one local immutable base/head comparison.
 * It persists a pull-request-shaped local context without introducing the T404
 * GitHub PR lifecycle or any public extension contract.
 */
export class LocalBaseHeadRuntime<Uri> {
  private initialized: LocalBaseHeadRuntimeSnapshot | undefined;
  private target: { readonly kind: "pull-request"; readonly repositoryId: string; readonly contextId: string } | undefined;
  private workspaceRoot: string | undefined;
  private initializingContextId: string | undefined;
  private readonly uriCodec = new ReviewDiffUriCodec();
  private readonly revisionTextContentProvider: RevisionTextContentProvider;
  public readonly diffController: ReviewDiffEditorController<Uri>;
  public readonly documentContentProvider: ReviewDiffTextDocumentContentProvider;
  public readonly progress: PullRequestProgressTreeDataProvider;

  public constructor(private readonly options: LocalBaseHeadRuntimeOptions<Uri>) {
    const localGit = createNodeLocalGitAdapter();
    this.diffController = new ReviewDiffEditorController(this.uriCodec, options.diffHost);
    this.revisionTextContentProvider = new RevisionTextContentProvider(
      this.uriCodec, new LocalGitRevisionTextContentSource({
        resolveRepositoryRoot: async (contextId) =>
          this.initialized?.diff.contextId === contextId || this.initializingContextId === contextId
            ? this.workspaceRoot
            : undefined
      }, localGit)
    );
    this.documentContentProvider = new ReviewDiffTextDocumentContentProvider(
      this.revisionTextContentProvider
    );
    this.progress = new PullRequestProgressTreeDataProvider(options.progressHost);
  }

  /** Acquires and persists the exact local comparison before any command can operate on it. */
  public async initialize(input: LocalBaseHeadRuntimeInput): Promise<LocalBaseHeadRuntimeSnapshot> {
    const request = {
      contextId: contextIdFor(input),
      repository: { host: "local", owner: "workspace", repository: "base-head" },
      number: 1,
      baseSha: input.baseSha,
      headSha: input.headSha
    };
    this.workspaceRoot = input.workspaceRoot;
    this.initializingContextId = request.contextId;
    const acquired = await new PullRequestDiffAcquisitionService({
      local: new LocalGitPullRequestDiffAdapter(
        new NodeGitCommandExecutor(),
        input.workspaceRoot
      ),
      remote: {
        fetch: async () => ({ kind: "unavailable", reason: "api" }),
        readFile: async () => ({ kind: "unavailable", reason: "api" })
      }
    }).acquire(request);
    if (acquired.kind !== "acquired") {
      throw new Error("Local base/head diff acquisition was unavailable.");
    }

    const occurredAt = (this.options.now ?? (() => new Date()))().toISOString();
    const repositoryId = repositoryIdFor(input.workspaceRoot);
    const target = { kind: "pull-request" as const, repositoryId, contextId: request.contextId };
    const existing = await this.options.repository.load(target);
    const contextState = existing?.contextState ?? {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: request.contextId,
      kind: "pull-request" as const,
      repositoryId,
      displayName: "Local base/head",
      pullRequest: {
        host: request.repository.host,
        owner: request.repository.owner,
        repository: request.repository.repository,
        number: request.number,
        state: "open" as const,
        baseSha: input.baseSha,
        headSha: input.headSha
      },
      files: Object.fromEntries(await Promise.all(acquired.snapshot.files.map(async (file) => [file.fileId, {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: file.fileId,
        currentPath: file.newPath ?? file.oldPath ?? file.fileId,
        previousPaths: [],
        revisionId: input.headSha,
        modifiedReviewed: [],
        originalReviewedByDiff: {},
        lineCount: file.status === "binary" || file.newPath === undefined
          ? 0
          : await this.lineCountFor(request.contextId, file.newPath, input.headSha),
        updatedAt: occurredAt
      }]))),
      createdAt: occurredAt,
      updatedAt: occurredAt
    } satisfies ReviewContextState;
    const globalState = existing?.globalState ?? {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId,
      currentRevisionId: input.headSha,
      files: {},
      updatedAt: occurredAt
    } satisfies RepositoryGlobalState;
    if (existing === undefined) {
      await this.options.repository.save(target, {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState,
        globalState
      });
    }
    this.target = target;
    this.workspaceRoot = input.workspaceRoot;
    this.initializingContextId = undefined;
    const initialized = { diff: acquired.snapshot, contextState, globalState };
    this.initialized = initialized;
    this.replaceProgress(contextState);
    return initialized;
  }

  /** Opens a durable T303 session for one current local comparison file. */
  public async openSession(fileId: string): Promise<DiffEditorReviewStateSession> {
    if (this.initialized === undefined || this.target === undefined) {
      throw new Error("Local base/head runtime has not been initialized.");
    }
    const persisted = await this.options.repository.load(this.target);
    if (persisted === undefined) throw new Error("Local base/head state is unavailable.");
    const file = persisted.contextState.files[fileId];
    const diffFile = this.initialized.diff.files.find((candidate) => candidate.fileId === fileId);
    if (file === undefined || diffFile === undefined) throw new Error("Local base/head file is unavailable.");
    return {
      contextState: persisted.contextState,
      globalState: persisted.globalState,
      target: {
        fileId,
        currentPath: file.currentPath,
        revisionId: file.revisionId,
        lineCount: file.lineCount
      },
      diffId: this.initialized.diff.originalDiffId,
      originalLineCount: diffFile.oldPath === undefined
        ? 0
        : await this.lineCountFor(
          this.initialized.diff.contextId,
          diffFile.oldPath,
          this.initialized.diff.baseSha
        ),
      originalDeletionIntervals: diffFile.hunks.flatMap((hunk) => hunk.lines.flatMap((line) =>
        line.kind === "deletion" && line.oldLine !== undefined
          ? [{ startLine: line.oldLine - 1, endLineExclusive: line.oldLine }]
          : []
      )),
      committer: {
        commit: (transaction) => this.options.repository.commit(transaction)
      }
    };
  }

  /** Builds the durable T303 command service with the runtime history boundary. */
  public createCommandService<Editor>(
    dependencies: Omit<DiffEditorReviewCommandDependencies<Editor>, "openSession" | "requestHistory">
      & { readonly fileIdFor: (editor: Editor) => string }
  ): DiffEditorReviewCommandService<Editor> {
    return new DiffEditorReviewCommandService({
      ...dependencies,
      openSession: (editor) => this.openSession(dependencies.fileIdFor(editor)),
      requestHistory: (transaction) => this.options.historyRecorder.recordTransaction(
        transaction,
        transaction.operation === "mark-ranges-reviewed" || transaction.operation === "unmark-ranges-reviewed"
          ? "user-selection"
          : "user-file"
      ).then(() => this.refreshProgress())
    });
  }

  /** Resolves a current virtual diff URI to the one persistent local file state it represents. */
  public fileIdForDiffDocumentUri(uri: string): string {
    if (this.initialized === undefined) {
      throw new Error("Local base/head runtime has not been initialized.");
    }
    const descriptor = this.uriCodec.decode(uri);
    if (descriptor.contextId !== this.initialized.diff.contextId) {
      throw new Error("Review diff document does not belong to the local base/head runtime.");
    }
    const matches = this.initialized.diff.files.filter((file) =>
      (descriptor.side === "original" ? file.oldPath ?? file.newPath : file.newPath ?? file.oldPath) === descriptor.filePath
    );
    if (matches.length !== 1) {
      throw new Error("Review diff document does not identify exactly one local file.");
    }
    return matches[0]!.fileId;
  }

  /** Returns the focused virtual document side after proving it belongs to this runtime. */
  public sideForDiffDocumentUri(uri: string): "original" | "modified" {
    if (this.initialized === undefined) {
      throw new Error("Local base/head runtime has not been initialized.");
    }
    const descriptor = this.uriCodec.decode(uri);
    if (descriptor.contextId !== this.initialized.diff.contextId) {
      throw new Error("Review diff document does not belong to the local base/head runtime.");
    }
    return descriptor.side;
  }

  /** Reads the durable state used by the shared command service without exposing its repository boundary. */
  public async getPersistence(): Promise<{
    readonly contextState: ReviewContextState;
    readonly globalState: RepositoryGlobalState;
  }> {
    if (this.target === undefined) {
      throw new Error("Local base/head runtime has not been initialized.");
    }
    const persisted = await this.options.repository.load(this.target);
    if (persisted === undefined) throw new Error("Local base/head state is unavailable.");
    return {
      contextState: persisted.contextState,
      globalState: persisted.globalState
    };
  }

  /** Reloads durable state before replacing the T304 progress projection. */
  public async refreshProgress(): Promise<void> {
    if (this.initialized === undefined || this.target === undefined) return;
    const persisted = await this.options.repository.load(this.target);
    if (persisted === undefined) throw new Error("Local base/head state is unavailable.");
    this.initialized = {
      ...this.initialized,
      contextState: persisted.contextState,
      globalState: persisted.globalState
    };
    this.replaceProgress(persisted.contextState);
  }

  private replaceProgress(contextState: ReviewContextState): void {
    if (this.initialized === undefined) return;
    const diff = this.initialized.diff;
    this.progress.replaceSnapshot({
      snapshotId: `local-base-head:${diff.baseSha}..${diff.headSha}`,
      contextId: diff.contextId,
      baseSha: diff.baseSha,
      headSha: diff.headSha,
      originalDiffId: diff.originalDiffId,
      fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
      progress: calculatePullRequestDiffProgress({
        diff,
        reviewContext: contextState,
        exclusionPolicy: this.options.getExclusionPolicy()
      }),
      lineReviewabilityByFileId: Object.fromEntries(diff.files.map((file) => [
        file.fileId,
        file.status === "binary"
          ? { kind: "unsupported", reason: { kind: "binary" } }
          : { kind: "reviewable" }
      ]))
    });
  }

  private async lineCountFor(
    contextId: string,
    filePath: string,
    revision: string
  ): Promise<number> {
    const content = await this.revisionTextContentProvider.provideTextDocumentContent(
      this.uriCodec.encode({
        contextId,
        filePath,
        fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
        side: "modified",
        revisionSource: "git-commit",
        revision
      })
    );
    return content.split("\n").length;
  }
}

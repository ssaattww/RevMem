import path from "node:path";

import type {
  LocalGitRepository,
  LocalGitRepositoryInspection
} from "../local-git/index";
import {
  StaleReviewStateError,
  type ReviewStateCommit,
  type ReviewStateCreateTransactionLike,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../state-repository/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  PollingGitStateMonitor,
  type GitReviewContextRepositorySnapshot,
  type GitRevisionMappingSource,
  type GitStateInspectionPort,
  type GitStateObserver,
  type ResolvedGitReviewContext
} from "../../application/review-context/index";
import { sameResourceUri, type SelectedReviewContext } from "../../application/review-context/index";
import { ReviewHistoryRecorder } from "../../application/review-history/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../core/contracts/index";
import type { GitDiffMappingOptions } from "../../core/git-diff/index";
import {
  DocumentReviewStateSessionProvider as ReconciledDocumentReviewStateSessionProvider
} from "./reconciled-document-review-state-session-provider";
import type {
  DocumentEditorReviewDescriptor,
  DocumentGitInspector,
  DocumentNormalEditorDecorationState,
  DocumentNormalEditorReviewStateSession,
  DocumentReviewStateSessionProviderOptions as BaseDocumentReviewStateSessionProviderOptions
} from "./document-review-state-session-provider";

/** T205 dependencies added around the existing routed/reconciled document provider. */
export interface DocumentReviewStateSessionProviderOptions
extends BaseDocumentReviewStateSessionProviderOptions {
  /** Optional append-only recorder invoked only after context creation or revision mapping commits. */
  readonly historyRecorder?: ReviewHistoryRecorder;
  /** Optional explicit revision source; production normally reuses the Local Git inspector when it implements this port. */
  readonly gitRevisionSource?: GitRevisionMappingSource;
  /** Optional observation sink used by composition or tests to register inspected Git state. */
  readonly gitStateObserver?: GitStateObserver;
  /** Optional polling interval; defaults to one second. */
  readonly gitStateMonitorIntervalMs?: number;
  /** Optional mapping policy; both changes are significant by default. */
  readonly gitMappingOptions?: Readonly<GitDiffMappingOptions>;
}

interface OwnerGlobalLoader {
  loadGlobal(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit["globalState"] | undefined>;
}

interface OwnerGlobalCreator {
  create(transaction: Readonly<ReviewStateCreateTransactionLike>): Promise<void>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toSnapshot = (
  repository: LocalGitRepository
): GitReviewContextRepositorySnapshot => ({
  repositoryId: repository.repositoryId,
  rootPath: repository.rootPath,
  branch: repository.branch.kind === "branch"
    ? { kind: "branch", fullRef: repository.branch.fullRef }
    : { kind: "detached" },
  ...(repository.head === undefined ? {} : { head: repository.head })
});

const isRevisionSource = (
  value: unknown
): value is GitRevisionMappingSource => value !== null &&
  typeof value === "object" &&
  "objectExists" in value &&
  typeof value.objectExists === "function" &&
  "diffRevisions" in value &&
  typeof value.diffRevisions === "function" &&
  "readTextFileAtRevision" in value &&
  typeof value.readTextFileAtRevision === "function";

const isGlobalLoader = (value: unknown): value is OwnerGlobalLoader =>
  value !== null &&
  typeof value === "object" &&
  "loadGlobal" in value &&
  typeof value.loadGlobal === "function";

const isGlobalCreator = (value: unknown): value is OwnerGlobalCreator =>
  value !== null &&
  typeof value === "object" &&
  "create" in value &&
  typeof value.create === "function";

const revisionOf = (commit: ReviewStateCommit): string => {
  if (commit.contextState.kind !== "branch" || commit.contextState.branch === undefined) {
    throw new Error("Persisted Git context must use the branch context schema.");
  }
  return commit.contextState.branch.headRevision;
};

/**
 * Advances persisted Git state before delegating to existing ownership,
 * reconciliation, command, and decoration behavior.
 */
export class GitContextDocumentReviewStateSessionProvider {
  private readonly resolver: GitReviewContextResolver;
  private readonly revisionSource: GitRevisionMappingSource | undefined;
  private readonly mapper: GitContextRevisionMapper | undefined;
  private readonly monitor: PollingGitStateMonitor;
  private readonly knownDescriptors = new Map<string, DocumentEditorReviewDescriptor>();
  private readonly mappingOptions: Readonly<GitDiffMappingOptions>;

  /** Creates a provider that reuses existing persistence and reconciliation contracts. */
  public constructor(
    private readonly options: DocumentReviewStateSessionProviderOptions
  ) {
    this.resolver = new GitReviewContextResolver({
      stableHash: options.stableHash,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    this.revisionSource = options.gitRevisionSource ??
      (isRevisionSource(options.gitInspector) ? options.gitInspector : undefined);
    this.mapper = this.revisionSource === undefined
      ? undefined
      : new GitContextRevisionMapper({
          source: this.revisionSource,
          stableHash: options.stableHash,
          ...(options.now === undefined ? {} : { now: options.now })
        });
    this.mappingOptions = options.gitMappingOptions ?? {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    };
    this.monitor = new PollingGitStateMonitor({
      inspector: options.gitInspector as GitStateInspectionPort,
      ...(options.gitStateMonitorIntervalMs === undefined
        ? {}
        : { intervalMs: options.gitStateMonitorIntervalMs }),
      onDidChange: async (change) => {
        const snapshot = change.current;
        const descriptor = this.knownDescriptors.get(change.rootPath);
        if (snapshot !== undefined && descriptor !== undefined) {
          await this.prepareSnapshot(descriptor, false, snapshot, false);
        }
      }
    });
    this.monitor.start();
  }

  /** Maps or initializes the current Git context before opening a writable session. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorReviewStateSession> {
    if (selection?.kind === "workspace") {
      this.assertWorkspaceSelection(descriptor, selection);
      return this.createDelegate({ kind: "not-repository", gitVersion: "selected-workspace" })
        .open(descriptor);
    }
    const inspection = await this.inspectAndPrepare(descriptor, true);
    this.assertBranchSelection(inspection, selection);
    return this.createDelegate(inspection).open(descriptor);
  }

  /** Maps an existing current Git context before performing a read-only decoration load. */
  public async loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    if (selection?.kind === "workspace") {
      if (!this.workspaceSelectionMatches(descriptor, selection)) {
        return undefined;
      }
      return this.createDelegate({ kind: "not-repository", gitVersion: "selected-workspace" })
        .loadForDecoration(descriptor);
    }
    const inspection = await this.inspectAndPrepare(descriptor, false);
    if (!this.branchSelectionMatches(inspection, selection)) {
      return undefined;
    }
    return this.createDelegate(inspection).loadForDecoration(descriptor);
  }

  /** Stops polling; callers that own this provider may invoke it during deactivation. */
  public dispose(): void {
    this.monitor.dispose();
    this.knownDescriptors.clear();
  }

  private createDelegate(
    inspection: LocalGitRepositoryInspection
  ): ReconciledDocumentReviewStateSessionProvider {
    const cachedInspector: DocumentGitInspector = {
      inspectRepository: async () => clone(inspection)
    };
    return new ReconciledDocumentReviewStateSessionProvider({
      ...this.options,
      gitInspector: cachedInspector
    });
  }

  private workspaceSelectionMatches(
    descriptor: DocumentEditorReviewDescriptor,
    selection: Extract<SelectedReviewContext, { readonly kind: "workspace" }>
  ): boolean {
    return descriptor.workspace !== undefined &&
      sameResourceUri(descriptor.workspace.workspaceFolderUri, selection.workspaceFolderUri);
  }

  private assertWorkspaceSelection(
    descriptor: DocumentEditorReviewDescriptor,
    selection: Extract<SelectedReviewContext, { readonly kind: "workspace" }>
  ): void {
    if (!this.workspaceSelectionMatches(descriptor, selection)) {
      throw new Error("The selected workspace context does not own the active editor.");
    }
  }

  private branchSelectionMatches(
    inspection: LocalGitRepositoryInspection,
    selection: SelectedReviewContext | undefined
  ): boolean {
    if (selection === undefined) {
      return true;
    }
    if (selection.kind === "workspace") {
      return false;
    }
    if (inspection.kind !== "repository" ||
      inspection.repository.repositoryId !== selection.repositoryId ||
      inspection.repository.rootPath !== selection.repositoryRoot) {
      return false;
    }
    if (selection.kind === "branch") {
      return inspection.repository.branch.kind === "branch" &&
        inspection.repository.branch.fullRef === selection.branchRef;
    }
    return inspection.repository.branch.kind === "detached" &&
      inspection.repository.head === selection.headRevision;
  }

  private assertBranchSelection(
    inspection: LocalGitRepositoryInspection,
    selection: SelectedReviewContext | undefined
  ): void {
    if (!this.branchSelectionMatches(inspection, selection)) {
      throw new Error("The selected branch context does not own the active editor.");
    }
  }

  private async inspectAndPrepare(
    descriptor: DocumentEditorReviewDescriptor,
    initializeMissingContext: boolean
  ): Promise<LocalGitRepositoryInspection> {
    const inspectedPath = path.dirname(descriptor.documentFsPath);
    const inspection = await this.options.gitInspector.inspectRepository(inspectedPath);
    if (inspection.kind === "repository") {
      await this.prepareSnapshot(
        descriptor,
        initializeMissingContext,
        toSnapshot(inspection.repository)
      );
    }
    return clone(inspection);
  }

  private async prepareSnapshot(
    descriptor: DocumentEditorReviewDescriptor,
    initializeMissingContext: boolean,
    snapshot: GitReviewContextRepositorySnapshot,
    registerMonitorBaseline = true
  ): Promise<void> {
    this.knownDescriptors.set(snapshot.rootPath, clone(descriptor));
    const current = this.resolver.resolve(snapshot);
    await this.ensureMapped(
      current,
      descriptor,
      initializeMissingContext
    );
    if (registerMonitorBaseline) {
      this.monitor.observe(snapshot.rootPath, snapshot);
    }
    this.options.gitStateObserver?.observe(snapshot.rootPath, snapshot);
  }

  private async ensureMapped(
    current: ResolvedGitReviewContext,
    descriptor: DocumentEditorReviewDescriptor,
    initializeMissingContext: boolean
  ): Promise<void> {
    const target: ReviewStateRepositoryTarget = {
      kind: "git",
      repositoryId: current.repositoryId,
      contextId: current.contextId
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const commit = await this.options.repository.load(target);
      try {
        if (commit === undefined) {
          if (!initializeMissingContext) {
            return;
          }
          await this.initializeContext(current, target, descriptor);
          return;
        }
        if (
          revisionOf(commit) === current.revisionId &&
          commit.globalState.currentRevisionId === current.revisionId
        ) {
          return;
        }
        const mapped = await this.mapCommit(current, commit, descriptor);
        const next = mapped.commit;
        const transaction: ReviewStateTransactionLike = {
          repositoryId: current.repositoryId,
          contextId: current.contextId,
          expected: {
            contextState: clone(commit.contextState),
            globalState: clone(commit.globalState)
          },
          next: {
            contextState: clone(next.contextState),
            globalState: clone(next.globalState)
          }
        };
        await (
          this.options.repository as unknown as {
            commit(value: Readonly<ReviewStateTransactionLike>): Promise<void>;
          }
        ).commit(transaction);
        await this.options.historyRecorder?.recordRevisionMapping(
          { contextState: clone(commit.contextState), globalState: clone(commit.globalState) },
          { contextState: clone(next.contextState), globalState: clone(next.globalState) },
          mapped.unresolvedFileIds.length === 0 ? "git-revision-mapped" : "mapping-unresolved",
          mapped.unresolvedFileIds
        );
        return;
      } catch (error) {
        if (!(error instanceof StaleReviewStateError) || attempt === 2) {
          throw error;
        }
        if (!(await this.isCurrentGitSnapshot(current))) {
          return;
        }
      }
    }
  }

  /** Reinspects Git before retrying a stale persistence mapping so an older poll target cannot roll back a foreground snapshot. */
  private async isCurrentGitSnapshot(
    current: ResolvedGitReviewContext
  ): Promise<boolean> {
    const inspection = await this.options.gitInspector.inspectRepository(
      current.repositoryRoot
    );
    if (inspection.kind !== "repository") {
      return false;
    }
    const latest = this.resolver.resolve(toSnapshot(inspection.repository));
    return latest.contextId === current.contextId &&
      latest.revisionId === current.revisionId;
  }

  private async initializeContext(
    current: ResolvedGitReviewContext,
    target: ReviewStateRepositoryTarget,
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<void> {
    const global = isGlobalLoader(this.options.repository)
      ? await this.options.repository.loadGlobal(target)
      : undefined;
    const initial: ReviewStateCommit = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(current.contextState),
      globalState: global === undefined
        ? {
            schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
            repositoryId: current.repositoryId,
            currentRevisionId: current.revisionId,
            files: {},
            updatedAt: current.contextState.updatedAt
          }
        : clone(global)
    };
    const mapped =
      initial.globalState.currentRevisionId === current.revisionId
        ? { commit: initial, unresolvedFileIds: [] }
        : await this.mapCommit(current, initial, descriptor);
    if (isGlobalCreator(this.options.repository)) {
      await this.options.repository.create({
        repositoryId: current.repositoryId,
        contextId: current.contextId,
        expected: {
          contextState: undefined,
          globalState: global === undefined ? undefined : clone(global)
        },
        next: {
          contextState: clone(mapped.commit.contextState),
          globalState: clone(mapped.commit.globalState)
        }
      });
      await this.options.historyRecorder?.recordContextCreated(mapped.commit.contextState);
      return;
    }
    if (isGlobalLoader(this.options.repository)) {
      throw new Error(
        "Owner-wide Global initialization requires atomic context creation support."
      );
    }
    await this.options.repository.save(target, mapped.commit);
    await this.options.historyRecorder?.recordContextCreated(mapped.commit.contextState);
  }

  private async mapCommit(
    current: ResolvedGitReviewContext,
    commit: ReviewStateCommit,
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<{ readonly commit: ReviewStateCommit; readonly unresolvedFileIds: readonly string[] }> {
    if (this.mapper === undefined) {
      throw new Error(
        "Persisted Git state requires revision mapping, but no Git revision mapping source is available."
      );
    }
    const mapped = await this.mapper.map({
      current,
      contextState: clone(commit.contextState),
      globalState: clone(commit.globalState),
      fileSystemPathSemantics: descriptor.fileSystemPathSemantics,
      options: this.mappingOptions
    });
    return {
      commit: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextState: clone(mapped.contextState),
        globalState: clone(mapped.globalState)
      },
      unresolvedFileIds: [...mapped.unresolvedFileIds]
    };
  }
}

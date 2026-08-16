import { randomUUID } from "node:crypto";
import path from "node:path";

import type { LocalGitAdapter, LocalGitRepository } from "./adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  StaleReviewStateError,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "./adapters/state-repository/index";
import { mapRepositoryGlobalStateThroughDocumentChanges } from "./application/global-review-mapping/index";
import type {
  FileSystemPathSemantics,
  ResourceUri,
  StableHash
} from "./application/workspace-identity/index";
import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval
} from "./core/contracts/index";
import {
  mapReviewedRangesThroughDocumentChanges,
  type DocumentContentChange,
  type RangeMappingOptions
} from "./core/range-mapping/index";

/** Immutable text snapshot captured synchronously at the VS Code document-event boundary. */
export interface DocumentReviewEditSnapshot {
  readonly documentKey: string;
  readonly documentUri: ResourceUri;
  readonly documentFsPath: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  readonly text: string;
  readonly lineCount: number;
  readonly contentHash: string;
}

/** One VS Code-compatible content-change transaction whose coordinates refer to the immediately previous snapshot. */
export interface DocumentReviewEditRequest {
  readonly after: DocumentReviewEditSnapshot;
  readonly changes: readonly DocumentContentChange[];
  readonly options: Readonly<RangeMappingOptions>;
}

/** Observable disposition of one live-edit persistence request. */
export type DocumentReviewEditResult = "applied" | "no-op" | "unsupported-owner";

interface DocumentReviewEditRuntimeOptions {
  readonly storageUris: ReviewStateStorageUris;
  readonly gitInspector: Pick<LocalGitAdapter, "inspectRepository">;
  readonly stableHash: StableHash;
  readonly now?: () => Date;
}

type FileDisposition = "missing" | "before" | "after" | "stale";

interface GitOwnerMapping {
  readonly repositoryTarget: ReviewStateRepositoryTarget;
  readonly repositoryId: string;
  readonly contextId: string;
  readonly revisionId: string;
  readonly branchRef: string;
  readonly currentPath: string;
  readonly defaultFileId: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const withoutKey = <Value>(
  values: Readonly<Record<string, Value>>,
  key: string
): Record<string, Value> => Object.fromEntries(
  Object.entries(values)
    .filter(([entryKey]) => entryKey !== key)
    .map(([entryKey, value]) => [entryKey, clone(value)])
);

const sameIntervals = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): boolean => JSON.stringify(left) === JSON.stringify(right);

const pathApiFor = (semantics: FileSystemPathSemantics): typeof path.posix =>
  semantics === "windows" ? path.win32 : path.posix;

/**
 * Maps live Git working-tree edits through persisted Context and owner-wide Global state.
 * Each document is serialized independently and each state replacement is a complete CAS.
 */
export class DocumentReviewEditRuntime {
  private readonly repository: FileSystemReviewStateRepository;
  private readonly history: JsonlReviewHistoryStore;
  private readonly sessionId = randomUUID();
  private readonly now: () => Date;
  private readonly observed = new Map<string, DocumentReviewEditSnapshot>();
  private readonly tails = new Map<string, Promise<void>>();

  public constructor(private readonly options: DocumentReviewEditRuntimeOptions) {
    this.repository = new FileSystemReviewStateRepository({
      storageUris: options.storageUris
    });
    this.history = new JsonlReviewHistoryStore({ storageUris: options.storageUris });
    this.now = options.now ?? (() => new Date());
  }

  public observe(snapshot: DocumentReviewEditSnapshot): void {
    this.observed.set(snapshot.documentKey, clone(snapshot));
  }

  public forget(documentKey: string): void {
    this.observed.delete(documentKey);
  }

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
      options: { ...request.options }
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

  public async drain(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }

  private async persist(input: {
    readonly before: DocumentReviewEditSnapshot;
    readonly after: DocumentReviewEditSnapshot;
    readonly changes: readonly DocumentContentChange[];
    readonly options: Readonly<RangeMappingOptions>;
  }): Promise<DocumentReviewEditResult> {
    this.assertSameDocument(input.before, input.after);
    const pathApi = pathApiFor(input.after.fileSystemPathSemantics);
    const inspection = await this.options.gitInspector.inspectRepository(
      pathApi.dirname(input.after.documentFsPath)
    );
    if (inspection.kind !== "repository") return "unsupported-owner";

    const owner = this.resolveGitOwner(input.after, inspection.repository);
    let current = await this.repository.load(owner.repositoryTarget);
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
        await this.recordHistory(
          owner,
          fileId,
          current,
          next,
          updatedAt,
          input.after.lineCount,
          input.after.contentHash
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
    readonly owner: GitOwnerMapping;
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

  private async recordHistory(
    owner: GitOwnerMapping,
    fileId: string,
    previous: ReviewStateCommit,
    next: ReviewStateCommit,
    occurredAt: string,
    lineCount: number,
    contentHash: string
  ): Promise<void> {
    const previousContext = previous.contextState.files[fileId];
    const nextContext = next.contextState.files[fileId];
    const previousGlobal = previous.globalState.files[fileId];
    const nextGlobal = next.globalState.files[fileId];
    const previousRanges = previousContext?.modifiedReviewed ?? [];
    const nextRanges = nextContext?.modifiedReviewed ?? [];
    const globalPreviousRanges = previousGlobal?.reviewed ?? [];
    const globalNextRanges = nextGlobal?.reviewed ?? [];
    const metadataChanged =
      previousContext?.contentHash !== contentHash ||
      previousContext?.lineCount !== lineCount ||
      previousGlobal?.contentHash !== contentHash;
    if (
      !metadataChanged &&
      sameIntervals(previousRanges, nextRanges) &&
      sameIntervals(globalPreviousRanges, globalNextRanges)
    ) return;

    await this.history.append(
      {
        kind: "git",
        repositoryId: owner.repositoryId,
        contextId: owner.contextId
      },
      {
        schemaVersion: next.contextState.schemaVersion,
        eventId: randomUUID(),
        occurredAt,
        sessionId: this.sessionId,
        repositoryId: owner.repositoryId,
        contextId: owner.contextId,
        revisionId: owner.revisionId,
        type: "invalidated-by-edit",
        reason: "document-content-changed",
        filePath: owner.currentPath,
        diffSide: "modified",
        previousRanges: previousRanges.map((range) => ({ ...range })),
        nextRanges: nextRanges.map((range) => ({ ...range })),
        rangeRepresentation: "context-and-global",
        globalPreviousRanges: globalPreviousRanges.map((range) => ({ ...range })),
        globalNextRanges: globalNextRanges.map((range) => ({ ...range }))
      }
    );
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

  private resolveFileId(commit: ReviewStateCommit, owner: GitOwnerMapping): string {
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
    return identities.values().next().value as string | undefined ?? owner.defaultFileId;
  }

  private contextDisposition(
    file: FileReviewState | undefined,
    owner: GitOwnerMapping,
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
    owner: GitOwnerMapping,
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

  private validateCommitIdentity(commit: ReviewStateCommit, owner: GitOwnerMapping): void {
    if (
      commit.contextState.repositoryId !== owner.repositoryId ||
      commit.globalState.repositoryId !== owner.repositoryId ||
      commit.contextState.contextId !== owner.contextId ||
      commit.contextState.kind !== "branch" ||
      commit.contextState.branch?.refName !== owner.branchRef ||
      commit.contextState.branch?.headRevision !== owner.revisionId ||
      commit.globalState.currentRevisionId !== owner.revisionId
    ) {
      throw new Error(
        "persisted review state no longer matches the Git owner observed for the live edit."
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
      before.documentUri.path !== after.documentUri.path
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

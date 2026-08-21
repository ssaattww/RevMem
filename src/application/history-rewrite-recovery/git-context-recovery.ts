import type {
  FileReviewState,
  GlobalFileReviewState
} from "../../core/contracts/index";
import { REVIEW_RANGE_SCHEMA_VERSION } from "../../core/contracts/index";
import type { NonGitSnapshotTracker } from "../non-git-snapshots/index";
import type {
  GitHistoryRewriteRecoveryInput,
  GitHistoryRewriteRecoveryPort,
  GitHistoryRewriteRecoveryResult,
  GitRevisionMappingSource
} from "../review-context/contracts";
import type { StableHash } from "../workspace-identity/index";
import { NonGitSnapshotHistoryRewritePort } from "./adapters";
import {
  HistoryRewriteRecoveryService,
  type HistoryRewriteCurrentFile,
  type HistoryRewriteGitObjectPort
} from "./index";

export interface GitHistoryRewriteRecoveryCoordinatorOptions {
  readonly source: GitRevisionMappingSource;
  readonly stableHash: StableHash;
  readonly snapshotTracker: NonGitSnapshotTracker;
}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GLOBAL_SCOPE_PREFIX = "git-global:";

export const gitGlobalSnapshotScope = (repositoryId: string): string => {
  if (repositoryId.length === 0 || repositoryId.includes("\0")) {
    throw new TypeError("repositoryId must be non-empty and contain no null character.");
  }
  return `${GLOBAL_SCOPE_PREFIX}${repositoryId}`;
};

export class GitHistoryRewriteRecoveryCoordinator
implements GitHistoryRewriteRecoveryPort {
  private readonly recovery: HistoryRewriteRecoveryService;

  public constructor(
    private readonly coordinatorOptions: GitHistoryRewriteRecoveryCoordinatorOptions
  ) {
    const missingOldObject: HistoryRewriteGitObjectPort = {
      diff: async () => ({ kind: "missing-old-revision" })
    };
    this.recovery = new HistoryRewriteRecoveryService(
      missingOldObject,
      new NonGitSnapshotHistoryRewritePort(coordinatorOptions.snapshotTracker)
    );
  }

  public async recover(
    input: Readonly<GitHistoryRewriteRecoveryInput>
  ): Promise<GitHistoryRewriteRecoveryResult> {
    validateInput(input);
    const occurredAtMilliseconds = Date.parse(input.occurredAt);
    const catalog = await this.loadCurrentCatalog(input);
    const unresolved = new Set<string>();
    const contextFiles: Record<string, FileReviewState> = {};

    for (const file of Object.values(input.contextFiles)) {
      const candidates = candidatesFor(file.currentPath, input.currentCandidatePaths, catalog);
      const snapshotId = await this.ownedSnapshotId(
        input.current.contextId,
        file.fileId,
        occurredAtMilliseconds
      );
      const result = await this.recovery.recover({
        file,
        newRevisionId: input.current.revisionId,
        updatedAt: input.occurredAt,
        currentFiles: candidates,
        ...(snapshotId === undefined ? {} : { snapshotId }),
        now: occurredAtMilliseconds,
        options: input.options
      });
      if (result.status === "recovered") {
        contextFiles[file.fileId] = result.file;
        continue;
      }
      unresolved.add(file.fileId);
      const cleared = clearContextAtSamePath(
        file,
        input.current.revisionId,
        input.occurredAt,
        candidates
      );
      if (cleared !== undefined) {
        contextFiles[file.fileId] = cleared;
      }
    }

    const globalFiles: Record<string, GlobalFileReviewState> = {};
    const globalScope = gitGlobalSnapshotScope(input.current.repositoryId);
    for (const file of Object.values(input.globalFiles)) {
      const candidates = candidatesFor(file.currentPath, input.currentCandidatePaths, catalog);
      const snapshotId = await this.ownedSnapshotId(
        globalScope,
        file.fileId,
        occurredAtMilliseconds
      );
      const prior = await this.globalRecoveryInput(
        file,
        input.oldGlobalRevisionId,
        globalScope,
        snapshotId,
        candidates,
        occurredAtMilliseconds
      );
      if (prior !== undefined) {
        const result = await this.recovery.recover({
          file: prior,
          newRevisionId: input.current.revisionId,
          updatedAt: input.occurredAt,
          currentFiles: candidates,
          ...(snapshotId === undefined ? {} : { snapshotId }),
          now: occurredAtMilliseconds,
          options: input.options
        });
        if (result.status === "recovered") {
          globalFiles[file.fileId] = {
            fileId: file.fileId,
            currentPath: result.file.currentPath,
            revisionId: input.current.revisionId,
            reviewed: result.file.modifiedReviewed.map((range) => ({ ...range })),
            ...(result.file.contentHash === undefined
              ? {}
              : { contentHash: result.file.contentHash }),
            updatedAt: input.occurredAt
          };
          continue;
        }
      }
      unresolved.add(file.fileId);
      const cleared = clearGlobalAtSamePath(
        file,
        input.current.revisionId,
        input.occurredAt,
        candidates
      );
      if (cleared !== undefined) {
        globalFiles[file.fileId] = cleared;
      }
    }

    reconcileSharedFileIdentities(
      input,
      contextFiles,
      globalFiles,
      unresolved
    );
    removeConflictingDestinations(contextFiles, unresolved);
    removeConflictingDestinations(globalFiles, unresolved);
    return {
      contextFiles,
      globalFiles,
      unresolvedFileIds: [...unresolved].sort()
    };
  }

  private async ownedSnapshotId(
    scope: string,
    fileId: string,
    now: number
  ): Promise<string | undefined> {
    let snapshotId: string | undefined;
    try {
      snapshotId = await this.coordinatorOptions.snapshotTracker.latestSnapshotId(
        scope,
        fileId
      );
      if (snapshotId === undefined) {
        return undefined;
      }
      const restored = await this.coordinatorOptions.snapshotTracker.restore(
        snapshotId,
        now
      );
      if (
        restored === undefined ||
        restored.workspaceContextId !== scope ||
        restored.fileId !== fileId
      ) {
        return undefined;
      }
      return snapshotId;
    } catch {
      return undefined;
    }
  }

  private async loadCurrentCatalog(
    input: Readonly<GitHistoryRewriteRecoveryInput>
  ): Promise<ReadonlyMap<string, HistoryRewriteCurrentFile>> {
    const paths = new Set<string>(input.currentCandidatePaths);
    for (const file of Object.values(input.contextFiles)) {
      paths.add(file.currentPath);
    }
    for (const file of Object.values(input.globalFiles)) {
      paths.add(file.currentPath);
    }

    const catalog = new Map<string, HistoryRewriteCurrentFile>();
    for (const path of paths) {
      const read = await this.coordinatorOptions.source.readTextFileAtRevision(
        input.current.repositoryRoot,
        input.current.revisionId,
        path,
        input.fileSystemPathSemantics,
        undefined,
        undefined,
        input.encodingHintsByPath?.[path]
      );
      if (read.kind !== "found") continue;
      catalog.set(path, {
        fileId: `history-rewrite-candidate:${this.coordinatorOptions.stableHash.digest(path)}`,
        path,
        lineCount: lineCountOf(read.content),
        contentHash: this.coordinatorOptions.stableHash.digest(read.content),
        content: read.content
      });
    }
    return catalog;
  }

  private async globalRecoveryInput(
    file: Readonly<GlobalFileReviewState>,
    oldRevisionId: string,
    snapshotScope: string,
    snapshotId: string | undefined,
    candidates: readonly HistoryRewriteCurrentFile[],
    now: number
  ): Promise<FileReviewState | undefined> {
    let restoredContent: string | undefined;
    if (snapshotId !== undefined) {
      try {
        const restored = await this.coordinatorOptions.snapshotTracker.restore(snapshotId, now);
        if (
          restored !== undefined &&
          restored.workspaceContextId === snapshotScope &&
          restored.fileId === file.fileId
        ) {
          restoredContent = restored.content;
        }
      } catch {
        restoredContent = undefined;
      }
    }

    let lineCount: number | undefined;
    if (restoredContent !== undefined) {
      lineCount = lineCountOf(restoredContent);
    } else if (file.contentHash !== undefined) {
      const matching = candidates.filter(
        (candidate) => candidate.contentHash === file.contentHash
      );
      const counts = new Set(matching.map((candidate) => candidate.lineCount));
      if (matching.length > 0 && counts.size === 1) {
        lineCount = matching[0]?.lineCount;
      }
    }
    if (lineCount === undefined) {
      return undefined;
    }

    return {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: file.fileId,
      currentPath: file.currentPath,
      previousPaths: [],
      revisionId: oldRevisionId,
      modifiedReviewed: file.reviewed.map((range) => ({ ...range })),
      originalReviewedByDiff: {},
      ...(file.contentHash !== undefined
        ? { contentHash: file.contentHash }
        : restoredContent === undefined
          ? {}
          : { contentHash: this.coordinatorOptions.stableHash.digest(restoredContent) }),
      lineCount,
      updatedAt: file.updatedAt
    };
  }
}

function reconcileSharedFileIdentities(
  input: Readonly<GitHistoryRewriteRecoveryInput>,
  contextFiles: Record<string, FileReviewState>,
  globalFiles: Record<string, GlobalFileReviewState>,
  unresolved: Set<string>
): void {
  const shared = Object.keys(input.contextFiles).filter(
    (fileId) => input.globalFiles[fileId] !== undefined
  );
  for (const fileId of shared) {
    const context = contextFiles[fileId];
    const global = globalFiles[fileId];
    if (
      context !== undefined &&
      global !== undefined &&
      context.currentPath === global.currentPath
    ) {
      continue;
    }
    delete contextFiles[fileId];
    delete globalFiles[fileId];
    unresolved.add(fileId);
  }
}

function candidatesFor(
  oldPath: string,
  currentCandidatePaths: readonly string[],
  catalog: ReadonlyMap<string, HistoryRewriteCurrentFile>
): readonly HistoryRewriteCurrentFile[] {
  const paths = new Set<string>([oldPath, ...currentCandidatePaths]);
  return [...paths]
    .map((path) => catalog.get(path))
    .filter((candidate): candidate is HistoryRewriteCurrentFile => candidate !== undefined);
}

function clearContextAtSamePath(
  file: Readonly<FileReviewState>,
  newRevisionId: string,
  updatedAt: string,
  candidates: readonly HistoryRewriteCurrentFile[]
): FileReviewState | undefined {
  const current = candidates.find((candidate) => candidate.path === file.currentPath);
  if (current === undefined) {
    return undefined;
  }
  return {
    ...file,
    revisionId: newRevisionId,
    modifiedReviewed: [],
    originalReviewedByDiff: {},
    contentHash: current.contentHash,
    lineCount: current.lineCount,
    updatedAt
  };
}

function clearGlobalAtSamePath(
  file: Readonly<GlobalFileReviewState>,
  newRevisionId: string,
  updatedAt: string,
  candidates: readonly HistoryRewriteCurrentFile[]
): GlobalFileReviewState | undefined {
  const current = candidates.find((candidate) => candidate.path === file.currentPath);
  if (current === undefined) {
    return undefined;
  }
  return {
    fileId: file.fileId,
    currentPath: file.currentPath,
    revisionId: newRevisionId,
    reviewed: [],
    contentHash: current.contentHash,
    updatedAt
  };
}

function removeConflictingDestinations<
  File extends { readonly fileId: string; readonly currentPath: string }
>(
  files: Record<string, File>,
  unresolved: Set<string>
): void {
  const byPath = new Map<string, string[]>();
  for (const file of Object.values(files)) {
    const fileIds = byPath.get(file.currentPath) ?? [];
    fileIds.push(file.fileId);
    byPath.set(file.currentPath, fileIds);
  }
  for (const fileIds of byPath.values()) {
    if (fileIds.length < 2) {
      continue;
    }
    for (const fileId of fileIds) {
      delete files[fileId];
      unresolved.add(fileId);
    }
  }
}

function lineCountOf(content: string): number {
  return content.split(/\r\n|\r|\n/u).length;
}

function validateInput(input: Readonly<GitHistoryRewriteRecoveryInput>): void {
  if (
    !FULL_OBJECT_ID.test(input.oldContextRevisionId) ||
    !FULL_OBJECT_ID.test(input.oldGlobalRevisionId) ||
    !FULL_OBJECT_ID.test(input.current.revisionId)
  ) {
    throw new TypeError("History rewrite recovery requires full lowercase object IDs.");
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new TypeError("occurredAt must be an ISO-compatible timestamp.");
  }
  const paths = new Set<string>();
  for (const path of input.currentCandidatePaths) {
    if (path.length === 0 || path.includes("\0") || paths.has(path)) {
      throw new TypeError("Current candidate paths must be unique non-empty paths.");
    }
    paths.add(path);
  }
}

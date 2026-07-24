import { isDeepStrictEqual } from "node:util";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextKind,
  type ReviewContextState
} from "../../core/contracts/index";
import {
  FileSystemReviewStateRepository as AtomicFileSystemReviewStateRepository
} from "./file-system-review-state-repository";
import type {
  FileSystemReviewStateRepositoryOptions,
  PersistenceFailureNotification,
  PersistenceOperation,
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

const cloneValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const cloneCommit = (commit: ReviewStateCommit): ReviewStateCommit =>
  cloneValue(commit);

const transactionPairToCommit = (
  pair: ReviewStateTransactionLike["expected"]
): ReviewStateCommit => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextState: cloneValue(pair.contextState) as ReviewContextState,
  globalState: cloneValue(pair.globalState) as RepositoryGlobalState
});

const expectedContextKind = (
  target: ReviewStateRepositoryTarget
): ReviewContextKind => {
  switch (target.kind) {
    case "git":
      return "branch";
    case "pull-request":
      return "pull-request";
    case "workspace":
      return "workspace";
    case "external-file":
      return "external-file";
  }
};

const requireTargetContextKind = (
  target: ReviewStateRepositoryTarget,
  contextKind: ReviewContextKind
): void => {
  const expected = expectedContextKind(target);
  if (contextKind === expected) {
    return;
  }

  const label =
    target.kind === "git"
      ? "Git"
      : target.kind === "pull-request"
        ? "Pull-request"
        : target.kind === "workspace"
          ? "Workspace"
          : "External-file";
  const article = expected === "external-file" ? "an" : "a";
  throw new Error(
    `${label} persistence requires ${article} ${expected} review context`
  );
};

const requireMatchingIdentity = (
  transaction: Readonly<ReviewStateTransactionLike>
): ReviewStateRepositoryTarget => {
  const snapshots = [transaction.expected, transaction.next];

  for (const snapshot of snapshots) {
    if (
      snapshot.contextState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION ||
      snapshot.globalState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION
    ) {
      throw new Error(
        `Transaction snapshots must use schema version ${REVIEW_RANGE_SCHEMA_VERSION}`
      );
    }
    if (
      snapshot.contextState.repositoryId !== transaction.repositoryId ||
      snapshot.globalState.repositoryId !== transaction.repositoryId
    ) {
      throw new Error("Transaction repositoryId must match all state snapshots");
    }
    if (snapshot.contextState.contextId !== transaction.contextId) {
      throw new Error("Transaction contextId must match all context snapshots");
    }
  }

  if (
    transaction.expected.contextState.kind !==
    transaction.next.contextState.kind
  ) {
    throw new Error("Transaction cannot change review context kind");
  }

  const contextKind = transaction.next.contextState.kind;
  const kind =
    contextKind === "pull-request"
      ? "pull-request"
      : contextKind === "workspace"
        ? "workspace"
        : contextKind === "external-file"
          ? "external-file"
          : "git";
  const target: ReviewStateRepositoryTarget = {
    kind,
    repositoryId: transaction.repositoryId,
    contextId: transaction.contextId
  };
  requireTargetContextKind(target, contextKind);
  return target;
};

const persistedFilePath = (error: unknown, fallbackPath: string): string => {
  if (
    error !== null &&
    typeof error === "object" &&
    "filePath" in error &&
    typeof error.filePath === "string"
  ) {
    return error.filePath;
  }

  return fallbackPath;
};

/** Rejection raised when persisted state no longer equals transaction.expected. */
export class StaleReviewStateError extends Error {
  public constructor(
    public readonly target: ReviewStateRepositoryTarget
  ) {
    super(
      `Persisted review state for ${target.repositoryId}/${target.contextId} no longer matches transaction.expected`
    );
    this.name = "StaleReviewStateError";
  }
}

/**
 * Public filesystem repository that keeps one repository-wide Global state in
 * memory and commits Review State Service transactions by full-snapshot CAS.
 */
export class FileSystemReviewStateRepository {
  private readonly atomicRepository: AtomicFileSystemReviewStateRepository;
  private readonly currentGlobalByStorageRoot = new Map<
    string,
    RepositoryGlobalState
  >();

  public constructor(
    private readonly options: FileSystemReviewStateRepositoryOptions
  ) {
    this.atomicRepository = new AtomicFileSystemReviewStateRepository({
      ...options,
      notifyPersistenceFailure: undefined
    });
  }

  public getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const current = this.atomicRepository.getCurrent(target);
    if (current === undefined) {
      return undefined;
    }
    requireTargetContextKind(target, current.contextState.kind);

    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const repositoryGlobal = this.currentGlobalByStorageRoot.get(route.rootPath);

    return cloneCommit({
      ...current,
      globalState: repositoryGlobal ?? current.globalState
    });
  }

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    try {
      const loaded = await this.atomicRepository.load(target);
      if (loaded === undefined) {
        return undefined;
      }
      requireTargetContextKind(target, loaded.contextState.kind);

      this.recordRepositoryGlobal(target, loaded.globalState);
      return this.getCurrent(target);
    } catch (error) {
      await this.notifyFailure("load", target, route.statePointerPath, error);
      throw error;
    }
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    try {
      requireTargetContextKind(target, commit.contextState.kind);
      await this.atomicRepository.save(target, commit);
      this.recordRepositoryGlobal(target, commit.globalState);
    } catch (error) {
      await this.notifyFailure("save", target, route.statePointerPath, error);
      throw error;
    }
  }

  /**
   * Compares persisted complete context/Global snapshots and advances both only
   * when transaction.expected is still current.
   *
   * Cross-window serialization is added by T604; this method provides the T104
   * single-writer compare-and-replace boundary and never updates memory on failure.
   */
  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    const target = requireMatchingIdentity(transaction);
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    try {
      const reader = new AtomicFileSystemReviewStateRepository({
        ...this.options,
        notifyPersistenceFailure: undefined
      });
      const current = await reader.load(target);
      const expected = transactionPairToCommit(transaction.expected);

      if (
        current === undefined ||
        !isDeepStrictEqual(current.contextState, expected.contextState) ||
        !isDeepStrictEqual(current.globalState, expected.globalState)
      ) {
        throw new StaleReviewStateError(target);
      }

      const next = transactionPairToCommit(transaction.next);
      requireTargetContextKind(target, next.contextState.kind);
      await this.atomicRepository.save(target, next);
      this.recordRepositoryGlobal(target, next.globalState);
    } catch (error) {
      await this.notifyFailure("commit", target, route.statePointerPath, error);
      throw error;
    }
  }

  private recordRepositoryGlobal(
    target: ReviewStateRepositoryTarget,
    globalState: RepositoryGlobalState
  ): void {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    this.currentGlobalByStorageRoot.set(
      route.rootPath,
      cloneValue(globalState)
    );
  }

  private async notifyFailure(
    operation: PersistenceOperation,
    target: ReviewStateRepositoryTarget,
    fallbackPath: string,
    error: unknown
  ): Promise<void> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const notification: PersistenceFailureNotification = {
      operation,
      target: { ...target },
      route: { ...route },
      filePath: persistedFilePath(error, fallbackPath),
      error
    };

    await Promise.resolve(
      this.options.notifyPersistenceFailure?.(notification)
    ).catch(() => undefined);
  }
}

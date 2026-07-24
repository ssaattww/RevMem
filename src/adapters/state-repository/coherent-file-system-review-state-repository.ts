import { isDeepStrictEqual } from "node:util";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
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
        : "git";

  return {
    kind,
    repositoryId: transaction.repositoryId,
    contextId: transaction.contextId
  };
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
  /** Target whose persisted complete snapshot no longer matches the transaction's expected snapshot. */
  public readonly target: ReviewStateRepositoryTarget;

  /**
   * Creates a stale-state error for a defensive copy of the target being compared.
   *
   * @param target Target whose persisted complete snapshot differed from `transaction.expected`.
   */
  public constructor(target: ReviewStateRepositoryTarget) {
    const targetCopy = { ...target };
    super(
      `Persisted review state for ${targetCopy.repositoryId}/${targetCopy.contextId} no longer matches transaction.expected`
    );
    this.name = "StaleReviewStateError";
    this.target = targetCopy;
  }
}

/**
 * Public filesystem repository that keeps one repository-wide Global state in
 * memory and commits Review State Service transactions by full-snapshot CAS.
 * Inputs are cloned before persistence and `getCurrent`/`load` return clones, so
 * callers cannot alias mutable repository memory. Same-instance saves and commits
 * sharing a storage root are serialized; cross-window and cross-process locking
 * remains T604.
 */
export class FileSystemReviewStateRepository {
  private readonly atomicRepository: AtomicFileSystemReviewStateRepository;
  private readonly currentGlobalByStorageRoot = new Map<
    string,
    RepositoryGlobalState
  >();
  private readonly writeTailByStorageRoot = new Map<string, Promise<void>>();

  /**
   * Creates a repository using the supplied storage locations and optional persistence dependencies.
   *
   * @param options Dependencies retained for future operations; construction performs no I/O.
   */
  public constructor(
    private readonly options: FileSystemReviewStateRepositoryOptions
  ) {
    this.atomicRepository = new AtomicFileSystemReviewStateRepository({
      ...options,
      notifyPersistenceFailure: undefined
    });
  }

  /**
   * Returns the current in-memory complete snapshot for a target without reading disk.
   *
   * @returns A deep clone of the current state, or `undefined` when this instance has not loaded or saved the target successfully.
   * @throws Throws when the target cannot be routed from the configured storage URIs.
   */
  public getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const current = this.atomicRepository.getCurrent(target);
    if (current === undefined) {
      return undefined;
    }

    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const repositoryGlobal = this.currentGlobalByStorageRoot.get(route.rootPath);

    return cloneCommit({
      ...current,
      globalState: repositoryGlobal ?? current.globalState
    });
  }

  /**
   * Loads the current manifest-selected or workspace state into this instance.
   *
   * @returns A deep clone of the persisted complete snapshot, or `undefined` when no state exists for the target.
   * @throws Rejects on routing, validation, JSON, or filesystem failure after notifying the optional failure observer; notifier failures are ignored.
   */
  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    try {
      const loaded = await this.atomicRepository.load(target);
      if (loaded === undefined) {
        return undefined;
      }

      this.recordRepositoryGlobal(target, loaded.globalState);
      return this.getCurrent(target);
    } catch (error) {
      await this.notifyFailure("load", target, route.statePointerPath, error);
      throw error;
    }
  }

  /**
   * Validates and persists a complete snapshot, then updates this instance's memory only after persistence succeeds.
   * The complete repository write is serialized with commits sharing the storage root.
   *
   * @param commit Caller-owned snapshot copied before write; later caller mutation cannot alias repository memory.
   * @throws Rejects on invalid identity/schema or persistence failure, preserving the previous persisted and in-memory state; notifier failures are ignored.
   */
  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    await this.serializeWrite(route.rootPath, async () => {
      try {
        await this.atomicRepository.save(target, commit);
        this.recordRepositoryGlobal(target, commit.globalState);
      } catch (error) {
        await this.notifyFailure("save", target, route.statePointerPath, error);
        throw error;
      }
    });
  }

  /**
   * Compares persisted complete context/Global snapshots and advances both only
   * when transaction.expected is still current.
   *
   * This instance serializes saves and commits sharing a storage root so
   * read/compare/write is one same-process CAS boundary. Cross-window
   * serialization is added by T604; this method never updates memory on failure.
   *
   * @param transaction Caller-owned complete snapshots copied before comparison and persistence.
   * @throws Rejects with `StaleReviewStateError` when current persisted state differs from `expected`, or with validation/persistence errors; failure notification errors are ignored.
   */
  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    const target = requireMatchingIdentity(transaction);
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    await this.serializeWrite(route.rootPath, async () => {
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
        await this.atomicRepository.save(target, next);
        this.recordRepositoryGlobal(target, next.globalState);
      } catch (error) {
        await this.notifyFailure("commit", target, route.statePointerPath, error);
        throw error;
      }
    });
  }

  /**
   * Orders every same-instance save and commit for one storage root so manifest
   * read-modify-write and transaction CAS cannot interleave. The tail is released
   * in `finally`, including after a failed operation, so later writes can proceed.
   */
  private async serializeWrite<T>(
    storageRoot: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.writeTailByStorageRoot.get(storageRoot);
    let release: () => void = () => undefined;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.writeTailByStorageRoot.set(storageRoot, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.writeTailByStorageRoot.get(storageRoot) === tail) {
        this.writeTailByStorageRoot.delete(storageRoot);
      }
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

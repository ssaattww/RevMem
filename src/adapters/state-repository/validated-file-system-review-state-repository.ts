import type {
  RepositoryGlobalState
} from "../../core/contracts/index";
import {
  FileSystemReviewStateRepository as CoherentFileSystemReviewStateRepository,
  StaleReviewStateError
} from "./coherent-file-system-review-state-repository";
import type {
  FileSystemReviewStateRepositoryOptions,
  ReviewStateCommit,
  ReviewStateCreateTransactionLike,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "./contracts";
import { loadPersistedOwnerGlobal } from "./owner-global-state-loader";
import { validateOwnerReconciliation } from "./owner-reconciliation-validation";
import { resolveReviewStateStorageRoute } from "./storage-router";

export { StaleReviewStateError };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Public filesystem repository with validated metadata and owner-wide Global preservation. */
export class FileSystemReviewStateRepository
extends CoherentFileSystemReviewStateRepository {
  private readonly outerWriteTailByStorageRoot = new Map<string, Promise<void>>();

  /** Creates a repository that serializes writes per storage root while retaining the complete atomic snapshot contract. */
  public constructor(
    private readonly repositoryOptions: FileSystemReviewStateRepositoryOptions
  ) {
    super(repositoryOptions);
  }

  /** Returns the current in-memory complete snapshot after validating owner-reconciliation metadata. */
  public override getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const current = super.getCurrent(target);
    if (current !== undefined) {
      validateOwnerReconciliation(current.contextState);
    }
    return current;
  }

  /** Loads a complete persisted snapshot and rejects invalid owner-reconciliation metadata before exposing it. */
  public override async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const loaded = await super.load(target);
    if (loaded !== undefined) {
      validateOwnerReconciliation(loaded.contextState);
    }
    return loaded;
  }

  /** Loads the owner-wide Global document even when the selected context is absent. */
  public async loadGlobal(
    target: ReviewStateRepositoryTarget
  ): Promise<RepositoryGlobalState | undefined> {
    const loaded = await loadPersistedOwnerGlobal(this.repositoryOptions, target);
    return loaded === undefined ? undefined : clone(loaded);
  }

  /** Saves a complete snapshot while preserving an existing owner-wide Global state during new-context initialization. */
  public override async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    validateOwnerReconciliation(commit.contextState);
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );

    await this.serializeOuterWrite(route.rootPath, async () => {
      const currentContext = await super.load(target);
      const persistedGlobal = await this.loadGlobal(target);
      let nextCommit = clone(commit);
      const initializesWithEmptyGlobal =
        Object.keys(nextCommit.globalState.files).length === 0;

      if (
        currentContext === undefined &&
        persistedGlobal !== undefined &&
        initializesWithEmptyGlobal
      ) {
        if (
          persistedGlobal.currentRevisionId !==
          nextCommit.globalState.currentRevisionId
        ) {
          throw new Error(
            "persisted review state requires revision mapping before a new context can be initialized."
          );
        }
        nextCommit = {
          ...nextCommit,
          globalState: clone(persistedGlobal)
        };
      }

      await super.save(target, nextCommit);
    });
  }

  /** Atomically replaces matching complete context and Global snapshots after metadata validation and storage-root serialization. */
  public override async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    validateOwnerReconciliation(transaction.expected.contextState);
    validateOwnerReconciliation(transaction.next.contextState);
    const target: ReviewStateRepositoryTarget = {
      kind:
        transaction.next.contextState.kind === "pull-request"
          ? "pull-request"
          : transaction.next.contextState.kind === "workspace"
            ? "workspace"
            : transaction.next.contextState.kind === "external-file"
              ? "external-file"
              : "git",
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId
    };
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );

    await this.serializeOuterWrite(route.rootPath, () => super.commit(transaction));
  }

  /** Atomically creates a validated absent context after comparing the expected owner-wide Global snapshot. */
  public override async create(
    transaction: Readonly<ReviewStateCreateTransactionLike>
  ): Promise<void> {
    validateOwnerReconciliation(transaction.next.contextState);
    const target: ReviewStateRepositoryTarget = {
      kind:
        transaction.next.contextState.kind === "pull-request"
          ? "pull-request"
          : transaction.next.contextState.kind === "workspace"
            ? "workspace"
            : transaction.next.contextState.kind === "external-file"
              ? "external-file"
              : "git",
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId
    };
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );

    await this.serializeOuterWrite(route.rootPath, () => super.create(transaction));
  }

  private async serializeOuterWrite<T>(
    storageRoot: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.outerWriteTailByStorageRoot.get(storageRoot);
    let release: () => void = () => undefined;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.outerWriteTailByStorageRoot.set(storageRoot, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.outerWriteTailByStorageRoot.get(storageRoot) === tail) {
        this.outerWriteTailByStorageRoot.delete(storageRoot);
      }
    }
  }
}

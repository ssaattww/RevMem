import type {
  RepositoryGlobalState
} from "../../core/contracts/index";
import {
  FileSystemReviewStateRepository as CoherentFileSystemReviewStateRepository,
  StaleReviewStateError
} from "./coherent-file-system-review-state-repository";
import type {
  FileSystemReviewStateRepositoryOptions,
  PersistenceOperation,
  ReviewStateCommit,
  ReviewStateCreateTransactionLike,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "./contracts";
import { loadPersistedOwnerGlobal } from "./owner-global-state-loader";
import {
  preparePersistedReviewState,
  type PersistedReviewStatePreparation
} from "./persistence-schema-recovery";
import { validateOwnerReconciliation } from "./owner-reconciliation-validation";
import { resolveReviewStateStorageRoute } from "./storage-router";

export { StaleReviewStateError };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Public filesystem repository with validated metadata and owner-wide Global preservation. */
export class FileSystemReviewStateRepository
extends CoherentFileSystemReviewStateRepository {
  private readonly outerWriteTailByStorageRoot = new Map<string, Promise<void>>();
  private readonly uncertainTargets = new Set<string>();
  private readonly uncertainStorageRoots = new Set<string>();
  private readonly repositoryOptions: FileSystemReviewStateRepositoryOptions;

  /** Creates a repository that serializes writes per storage root while retaining the complete atomic snapshot contract. */
  public constructor(repositoryOptions: FileSystemReviewStateRepositoryOptions) {
    super(repositoryOptions);
    this.repositoryOptions = repositoryOptions;
  }

  /** Returns the current in-memory complete snapshot after validating owner-reconciliation metadata. */
  public override getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );
    if (
      this.uncertainTargets.has(this.targetKey(target)) ||
      this.uncertainStorageRoots.has(route.rootPath)
    ) {
      return undefined;
    }
    try {
      const current = super.getCurrent(target);
      if (current !== undefined) {
        validateOwnerReconciliation(current.contextState);
      }
      return current;
    } catch (error) {
      this.markUncertain(target, route.rootPath);
      throw error;
    }
  }

  /** Loads a complete persisted snapshot after migration/recovery and never exposes quarantined evidence. */
  public override async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );
    const preparation = await this.prepareTarget(target, "load");
    if (preparation === "uncertain") {
      return undefined;
    }
    try {
      const loaded = await super.load(target);
      if (loaded !== undefined) {
        validateOwnerReconciliation(loaded.contextState);
        this.clearUncertain(target, route.rootPath);
      }
      return loaded;
    } catch (error) {
      this.markUncertain(target, route.rootPath);
      throw error;
    }
  }

  /** Loads the owner-wide Global document only when its persisted state set is certain. */
  public async loadGlobal(
    target: ReviewStateRepositoryTarget
  ): Promise<RepositoryGlobalState | undefined> {
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );
    const preparation = await this.prepareTarget(target, "load");
    if (preparation === "uncertain") {
      return undefined;
    }
    try {
      const loaded = await loadPersistedOwnerGlobal(this.repositoryOptions, target);
      if (loaded !== undefined) {
        this.clearUncertain(target, route.rootPath);
      }
      return loaded === undefined ? undefined : clone(loaded);
    } catch (error) {
      this.markUncertain(target, route.rootPath);
      throw error;
    }
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
      const preparation = await this.prepareTarget(target, "save");
      const currentContext =
        preparation === "uncertain" ? undefined : await super.load(target);
      const persistedGlobal = await loadPersistedOwnerGlobal(
        this.repositoryOptions,
        target
      ).catch((error: unknown) => {
        if (preparation === "uncertain") {
          return undefined;
        }
        throw error;
      });
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
      this.clearUncertain(target, route.rootPath);
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

    await this.serializeOuterWrite(route.rootPath, async () => {
      if (await this.prepareTarget(target, "commit") === "uncertain") {
        throw new StaleReviewStateError(target);
      }
      await super.commit(transaction);
      this.clearUncertain(target, route.rootPath);
    });
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

    await this.serializeOuterWrite(route.rootPath, async () => {
      if (await this.prepareTarget(target, "commit") === "uncertain") {
        throw new StaleReviewStateError(target);
      }
      await super.create(transaction);
      this.clearUncertain(target, route.rootPath);
    });
  }

  private async prepareTarget(
    target: ReviewStateRepositoryTarget,
    operation: PersistenceOperation
  ): Promise<PersistedReviewStatePreparation> {
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );
    try {
      const preparation = await preparePersistedReviewState(
        this.repositoryOptions,
        target
      );
      if (preparation === "uncertain") {
        this.markUncertain(target, route.rootPath);
      }
      return preparation;
    } catch (error) {
      this.markUncertain(target, route.rootPath);
      await Promise.resolve(
        this.repositoryOptions.notifyPersistenceFailure?.({
          operation,
          target: { ...target },
          route: { ...route },
          filePath: route.statePointerPath,
          error
        })
      ).catch(() => undefined);
      throw error;
    }
  }

  private clearUncertain(
    target: ReviewStateRepositoryTarget,
    storageRoot: string
  ): void {
    this.uncertainTargets.delete(this.targetKey(target));
    this.uncertainStorageRoots.delete(storageRoot);
  }

  private markUncertain(
    target: ReviewStateRepositoryTarget,
    storageRoot?: string
  ): void {
    const route = storageRoot === undefined
      ? resolveReviewStateStorageRoute(this.repositoryOptions.storageUris, target)
      : undefined;
    this.uncertainTargets.add(this.targetKey(target));
    this.uncertainStorageRoots.add(storageRoot ?? route!.rootPath);
  }

  private targetKey(target: ReviewStateRepositoryTarget): string {
    const route = resolveReviewStateStorageRoute(
      this.repositoryOptions.storageUris,
      target
    );
    return `${route.rootPath}\u0000${target.contextId}`;
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

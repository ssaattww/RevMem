import {
  DebouncedReviewStateRepository as BaseDebouncedReviewStateRepository,
  type DebouncedReviewStateRepositoryOptions,
  type ReviewStatePersistenceDelegate,
} from "./debounced-review-state-repository";
import type {
  ReviewStateRepositorySnapshot,
  ReviewStateRepositoryTransactionLike,
} from "./owner-atomic-review-state-repository";

/**
 * Debounced repository composition that exposes repository-owner generation
 * reads/CAS while preserving the existing debounce queue as the single
 * same-Extension-Host serialization owner.
 */
interface RepositoryOwnerPersistenceDelegate extends ReviewStatePersistenceDelegate {
  loadRepositorySnapshot?(repositoryId: string): Promise<ReviewStateRepositorySnapshot | undefined>;
  commitRepository?(transaction: Readonly<ReviewStateRepositoryTransactionLike>): Promise<void>;
}

export class DebouncedReviewStateRepository extends BaseDebouncedReviewStateRepository {
  public constructor(
    private readonly ownerOptions: DebouncedReviewStateRepositoryOptions,
  ) {
    super(ownerOptions);
  }

  public async loadRepositorySnapshot(
    repositoryId: string,
  ): Promise<ReviewStateRepositorySnapshot | undefined> {
    return this.runRepositoryOwnerOperation(repositoryId, () => {
      const delegate = this.ownerOptions.delegate as RepositoryOwnerPersistenceDelegate;
      const loadRepositorySnapshot = delegate.loadRepositorySnapshot;
      if (loadRepositorySnapshot === undefined) {
        throw new Error("Review-state persistence delegate does not support repository-owner snapshot loading.");
      }
      return loadRepositorySnapshot.call(delegate, repositoryId);
    });
  }

  public async commitRepository(
    transaction: Readonly<ReviewStateRepositoryTransactionLike>,
  ): Promise<void> {
    await this.runRepositoryOwnerOperation(transaction.repositoryId, () => {
      const delegate = this.ownerOptions.delegate as RepositoryOwnerPersistenceDelegate;
      const commitRepository = delegate.commitRepository;
      if (commitRepository === undefined) {
        throw new Error("Review-state persistence delegate does not support repository-owner atomic commits.");
      }
      return commitRepository.call(delegate, transaction);
    });
  }
}

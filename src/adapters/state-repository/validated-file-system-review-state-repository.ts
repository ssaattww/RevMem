import {
  FileSystemReviewStateRepository as CoherentFileSystemReviewStateRepository,
  StaleReviewStateError
} from "./coherent-file-system-review-state-repository";
import type {
  FileSystemReviewStateRepositoryOptions,
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "./contracts";
import { validateOwnerReconciliation } from "./owner-reconciliation-validation";

export { StaleReviewStateError };

/** Public filesystem repository with validation for additive reconciliation metadata. */
export class FileSystemReviewStateRepository
extends CoherentFileSystemReviewStateRepository {
  public constructor(options: FileSystemReviewStateRepositoryOptions) {
    super(options);
  }

  public override getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const current = super.getCurrent(target);
    if (current !== undefined) {
      validateOwnerReconciliation(current.contextState);
    }
    return current;
  }

  public override async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const loaded = await super.load(target);
    if (loaded !== undefined) {
      validateOwnerReconciliation(loaded.contextState);
    }
    return loaded;
  }

  public override save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    validateOwnerReconciliation(commit.contextState);
    return super.save(target, commit);
  }

  public override commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    validateOwnerReconciliation(transaction.expected.contextState);
    validateOwnerReconciliation(transaction.next.contextState);
    return super.commit(transaction);
  }
}

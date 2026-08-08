import {
  createImmutablePullRequestRevisionMapper,
  GitHubPullRequestContextStateService,
  type ImmutablePullRequestRevisionEvidenceLoader,
} from "../../application/github-pr-context/index";
import { FileSystemReviewStateRepository } from "../state-repository/coherent-file-system-review-state-repository";
import type { ReviewStateStorageUris } from "../state-repository/contracts";

/**
 * Creates the T404 application service over the existing T104 authoritative
 * context/Global repository. No parallel range, path, or PR-layer document is
 * persisted by this adapter.
 */
export function createNodeGitHubPullRequestContextStateService(
  storageUris: ReviewStateStorageUris,
  loadRevisionEvidence: ImmutablePullRequestRevisionEvidenceLoader
): GitHubPullRequestContextStateService {
  return new GitHubPullRequestContextStateService(
    new FileSystemReviewStateRepository({ storageUris }),
    createImmutablePullRequestRevisionMapper(loadRevisionEvidence)
  );
}

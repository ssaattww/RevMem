import { randomUUID } from "node:crypto";
import {
  createImmutablePullRequestRevisionMapper,
  GitHubPullRequestContextStateService,
  type ImmutablePullRequestRevisionEvidenceLoader,
} from "../../application/github-pr-context/index";
import { ReviewHistoryRecorder } from "../../application/review-history/index";
import type { GitHubPullRequestContextRepositoryPort } from "../../application/github-pr-context/index";
import { FileSystemReviewStateRepository, JsonlReviewHistoryStore } from "../state-repository/index";
import type { ReviewStateStorageUris } from "../state-repository/contracts";

/**
 * Creates the T404 application service over the existing T104 authoritative
 * context/Global repository. No parallel range, path, or PR-layer document is
 * persisted by this adapter.
 */
export function createNodeGitHubPullRequestContextStateService(
  storageUris: ReviewStateStorageUris,
  loadRevisionEvidence: ImmutablePullRequestRevisionEvidenceLoader,
): GitHubPullRequestContextStateService;
export function createNodeGitHubPullRequestContextStateService(
  repository: GitHubPullRequestContextRepositoryPort,
  historyRecorder: Pick<ReviewHistoryRecorder, "recordContextCreated" | "recordRevisionMapping">,
  loadRevisionEvidence: ImmutablePullRequestRevisionEvidenceLoader,
): GitHubPullRequestContextStateService;
export function createNodeGitHubPullRequestContextStateService(
  storageUrisOrRepository: ReviewStateStorageUris | GitHubPullRequestContextRepositoryPort,
  historyRecorderOrEvidence:
    | Pick<ReviewHistoryRecorder, "recordContextCreated" | "recordRevisionMapping">
    | ImmutablePullRequestRevisionEvidenceLoader,
  injectedEvidence?: ImmutablePullRequestRevisionEvidenceLoader,
): GitHubPullRequestContextStateService {
  const injected = injectedEvidence !== undefined;
  const repository = injected
    ? storageUrisOrRepository as GitHubPullRequestContextRepositoryPort
    : new FileSystemReviewStateRepository({ storageUris: storageUrisOrRepository as ReviewStateStorageUris });
  const historyRecorder = injected
    ? historyRecorderOrEvidence as Pick<ReviewHistoryRecorder, "recordContextCreated" | "recordRevisionMapping">
    : new ReviewHistoryRecorder({
        sessionId: randomUUID(),
        createEventId: randomUUID,
        appender: new JsonlReviewHistoryStore({ storageUris: storageUrisOrRepository as ReviewStateStorageUris }),
      });
  const loadRevisionEvidence = (injected ? injectedEvidence : historyRecorderOrEvidence) as ImmutablePullRequestRevisionEvidenceLoader;
  return new GitHubPullRequestContextStateService(
    repository,
    createImmutablePullRequestRevisionMapper(loadRevisionEvidence),
    historyRecorder,
  );
}

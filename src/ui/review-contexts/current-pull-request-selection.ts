const DETACHED_HEAD_SCOPE = "<detached>";

/** Builds one branch-scoped durable key for an explicit Current Context choice. */
export const currentPullRequestSelectionKey = (
  repositoryId: string,
  headRevision: string,
  branchRef?: string,
): string => `${repositoryId}\0${branchRef ?? DETACHED_HEAD_SCOPE}\0${headRevision}`;

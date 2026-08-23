const DETACHED_HEAD_SCOPE = "<detached>";

/**
 * Builds the durable workspace-state key for an explicit Current Context choice.
 *
 * Branch identity is part of the key because two attached branches may point at
 * the same immutable HEAD while intentionally selecting different contexts.
 */
export const currentPullRequestSelectionKey = (
  repositoryId: string,
  headRevision: string,
  branchRef?: string,
): string => `${repositoryId}\0${branchRef ?? DETACHED_HEAD_SCOPE}\0${headRevision}`;

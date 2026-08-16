import type { ReviewContextState } from "../../core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Returns the single persisted open PR whose immutable head equals the local
 * repository HEAD. Zero or multiple matches deliberately return undefined so
 * T405 never invents an arbitrary current PR.
 */
export function findCurrentPullRequestContext(
  contexts: readonly ReviewContextState[],
  repositoryId: string,
  headRevision: string
): ReviewContextState | undefined {
  const matches = contexts.filter((context) =>
    context.kind === "pull-request" &&
    context.repositoryId === repositoryId &&
    context.pullRequest !== undefined &&
    context.pullRequest.state === "open" &&
    context.pullRequest.headSha === headRevision
  );
  return matches.length === 1 ? clone(matches[0]!) : undefined;
}

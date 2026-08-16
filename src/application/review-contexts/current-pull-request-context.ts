import type { ReviewContextState } from "../../core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Returns the persisted open PR whose immutable head equals the local
 * repository HEAD. A remembered explicit choice disambiguates multiple
 * same-HEAD PRs; otherwise multiple matches deliberately remain unresolved.
 */
export function findCurrentPullRequestContext(
  contexts: readonly ReviewContextState[],
  repositoryId: string,
  headRevision: string,
  preferredContextId?: string,
): ReviewContextState | undefined {
  const matches = contexts.filter((context) =>
    context.kind === "pull-request" &&
    context.repositoryId === repositoryId &&
    context.pullRequest !== undefined &&
    context.pullRequest.state === "open" &&
    context.pullRequest.headSha === headRevision
  );
  if (preferredContextId !== undefined) {
    const preferred = matches.find((context) => context.contextId === preferredContextId);
    if (preferred !== undefined) return clone(preferred);
  }
  return matches.length === 1 ? clone(matches[0]!) : undefined;
}

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
  suppressAutomaticSelection = false,
): ReviewContextState | undefined {
  return resolveCurrentPullRequestContext(
    contexts, repositoryId, headRevision, preferredContextId, suppressAutomaticSelection,
  ).context;
}

export type CurrentPullRequestSelectionReason =
  | "explicit-selection-kept"
  | "unique-pr-match"
  | "ambiguous-pr-match"
  | "no-matching-pr"
  | "no-selected-pr";

export interface CurrentPullRequestSelectionDecision {
  readonly context: ReviewContextState | undefined;
  readonly reason: CurrentPullRequestSelectionReason;
  readonly candidateCount: number;
}

/** Resolves the current PR and retains the safe, non-identifying decision provenance. */
export function resolveCurrentPullRequestContext(
  contexts: readonly ReviewContextState[],
  repositoryId: string,
  headRevision: string,
  preferredContextId?: string,
  suppressAutomaticSelection = false,
): CurrentPullRequestSelectionDecision {
  const matches = contexts.filter((context) =>
    context.kind === "pull-request" &&
    context.repositoryId === repositoryId &&
    context.pullRequest !== undefined &&
    context.pullRequest.state === "open" &&
    context.pullRequest.headSha === headRevision
  );
  if (preferredContextId !== undefined) {
    const preferred = matches.find((context) => context.contextId === preferredContextId);
    if (preferred !== undefined) return { context: clone(preferred), reason: "explicit-selection-kept", candidateCount: matches.length };
  }
  if (suppressAutomaticSelection) return {
    context: undefined,
    reason: matches.length === 0 ? "no-matching-pr" : "no-selected-pr",
    candidateCount: matches.length,
  };
  if (matches.length === 1) return { context: clone(matches[0]!), reason: "unique-pr-match", candidateCount: 1 };
  return {
    context: undefined,
    reason: matches.length === 0 ? "no-matching-pr" : "ambiguous-pr-match",
    candidateCount: matches.length,
  };
}

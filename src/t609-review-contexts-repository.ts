import {
  resolveCurrentContextRepositories,
  type CurrentContextRepositoryResolutionInput,
  type ResolvedRepositoryCandidate
} from "./t609-repository-resolution";

/** Review Contextsが複数repositoryを明示選択するUI境界。 */
export type ReviewContextsRepositorySelection = (
  candidates: readonly ResolvedRepositoryCandidate[]
) => Promise<ResolvedRepositoryCandidate | undefined>;

/**
 * Resolves the repository used by a Review Contexts command without requiring
 * an active Git editor.  Multiple candidates are never guessed.
 */
export const resolveReviewContextsRepository = async (
  input: CurrentContextRepositoryResolutionInput & {
    readonly requestSelection: ReviewContextsRepositorySelection;
  }
): Promise<ResolvedRepositoryCandidate["repository"]> => {
  const candidates = await resolveCurrentContextRepositories(input);
  if (candidates.length === 0) {
    throw new Error("Review Contexts repository is unavailable.");
  }
  if (candidates.length === 1) {
    return candidates[0]!.repository;
  }
  const selected = await input.requestSelection(candidates);
  if (selected === undefined || !candidates.includes(selected)) {
    throw new Error("Review Contexts repository selection was cancelled.");
  }
  return selected.repository;
};

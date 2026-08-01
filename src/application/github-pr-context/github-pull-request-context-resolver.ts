import type {
  GitHubPullRequestCandidate,
  GitHubPullRequestContextResolution,
  GitHubPullRequestContextResolverOptions,
  GitHubPullRequestSearchResult
} from "./contracts";

/** Resolves zero, one, or multiple HEAD-matching pull request candidates. */
export class GitHubPullRequestContextResolver {
  private readonly chooseCandidate: (
    candidates: readonly GitHubPullRequestCandidate[]
  ) => Promise<GitHubPullRequestCandidate | undefined>;

  public constructor(options: GitHubPullRequestContextResolverOptions) {
    this.chooseCandidate = options.chooseCandidate;
  }

  /** Resolves candidates already returned by the GitHub search boundary. */
  public async resolve(
    candidates: readonly GitHubPullRequestCandidate[]
  ): Promise<GitHubPullRequestContextResolution> {
    if (candidates.length === 0) {
      return { kind: "branch", reason: "not-found" };
    }
    if (candidates.length === 1) {
      return { kind: "pull-request", pullRequest: candidates[0]! };
    }

    const selected = await this.chooseCandidate(candidates);
    return selected === undefined
      ? { kind: "branch", reason: "cancelled" }
      : { kind: "pull-request", pullRequest: selected };
  }

  /** Converts API unavailability into a non-blocking branch fallback. */
  public async resolveSearchResult(
    result: GitHubPullRequestSearchResult
  ): Promise<GitHubPullRequestContextResolution> {
    return result.kind === "unavailable"
      ? { kind: "branch", reason: "unavailable" }
      : this.resolve(result.candidates);
  }
}

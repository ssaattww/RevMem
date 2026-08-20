/** Repository identity parsed from a Git remote URL. */
export interface GitHubRepositoryIdentity {
  /** Canonical GitHub or Enterprise HTTPS authority, including a non-default port. */
  readonly host: string;
  /** Repository owner login or organization. */
  readonly owner: string;
  /** Repository name without a trailing `.git`. */
  readonly repository: string;
}

/** Minimal pull request identity required to create a PR review context. */
export interface GitHubPullRequestCandidate {
  /** Pull request number. */
  readonly number: number;
  /** Human-readable pull request title. */
  readonly title: string;
  /** Browser URL for the pull request. */
  readonly url: string;
  /** Exact immutable head commit SHA matched by the search. */
  readonly headSha: string;
  /** Base branch ref name. */
  readonly baseRef: string;
  /** Immutable base commit SHA reported by GitHub. */
  readonly baseSha: string;
}

/** Stable API search outcomes. */
export type GitHubPullRequestSearchResult =
  | {
      readonly kind: "found";
      readonly candidates: readonly GitHubPullRequestCandidate[];
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "rate-limit" | "network" | "api" | "authentication";
    };

/** GitHub API boundary used by the resolver workflow. */
export interface GitHubPullRequestSearchPort {
  /** Searches open pull requests whose head SHA exactly matches `headSha`. */
  findOpenByHead(
    repository: GitHubRepositoryIdentity,
    headSha: string
  ): Promise<GitHubPullRequestSearchResult>;
}

/** Multiple-candidate selection boundary supplied by the VS Code UI adapter. */
export type GitHubPullRequestCandidateChooser = (
  candidates: readonly GitHubPullRequestCandidate[]
) => Promise<GitHubPullRequestCandidate | undefined>;

/** Final PR or branch fallback decision. */
export type GitHubPullRequestContextResolution =
  | {
      readonly kind: "pull-request";
      readonly pullRequest: GitHubPullRequestCandidate;
    }
  | {
      readonly kind: "branch";
      readonly reason: "not-found" | "cancelled" | "unavailable";
    };

/** Resolver dependencies. */
export interface GitHubPullRequestContextResolverOptions {
  /** Called only when more than one candidate matches the current HEAD. */
  readonly chooseCandidate: GitHubPullRequestCandidateChooser;
}

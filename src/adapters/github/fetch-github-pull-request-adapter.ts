import type {
  GitHubPullRequestCandidate,
  GitHubPullRequestSearchPort,
  GitHubPullRequestSearchResult,
  GitHubRepositoryIdentity
} from "../../application/github-pr-context/index";

interface GitHubPullRequestResponse {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly head?: { readonly sha?: unknown };
  readonly base?: { readonly ref?: unknown; readonly sha?: unknown };
}

/** Fetch adapter options. */
export interface FetchGitHubPullRequestAdapterOptions {
  /** REST API root without a trailing slash. */
  readonly apiBaseUrl: string;
  /** Optional VS Code GitHub authentication access token. */
  readonly token?: string;
  /** Optional fetch implementation for deterministic tests. */
  readonly fetch?: typeof globalThis.fetch;
}

const isString = (value: unknown): value is string => typeof value === "string";

const toCandidate = (
  value: GitHubPullRequestResponse,
  expectedHead: string
): GitHubPullRequestCandidate | undefined => {
  if (
    typeof value.number !== "number" ||
    !Number.isSafeInteger(value.number) ||
    !isString(value.title) ||
    !isString(value.html_url) ||
    !isString(value.head?.sha) ||
    !isString(value.base?.ref) ||
    !isString(value.base?.sha) ||
    value.head.sha !== expectedHead
  ) {
    return undefined;
  }
  return {
    number: value.number,
    title: value.title,
    url: value.html_url,
    headSha: value.head.sha,
    baseRef: value.base.ref,
    baseSha: value.base.sha
  };
};

/** Searches GitHub without requiring authentication for public repositories. */
export class FetchGitHubPullRequestAdapter implements GitHubPullRequestSearchPort {
  private readonly apiBaseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: FetchGitHubPullRequestAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async findOpenByHead(
    repository: GitHubRepositoryIdentity,
    headSha: string
  ): Promise<GitHubPullRequestSearchResult> {
    const url = new URL(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls`
    );
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "100");

    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    };
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, { headers });
    } catch {
      return { kind: "unavailable", reason: "network" };
    }

    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      return { kind: "unavailable", reason: "rate-limit" };
    }
    if (!response.ok) {
      return { kind: "unavailable", reason: "api" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "unavailable", reason: "api" };
    }
    if (!Array.isArray(payload)) {
      return { kind: "unavailable", reason: "api" };
    }

    const candidates = payload
      .map(value => toCandidate(value as GitHubPullRequestResponse, headSha))
      .filter((value): value is GitHubPullRequestCandidate => value !== undefined)
      .sort((left, right) => left.number - right.number);
    return { kind: "found", candidates };
  }
}

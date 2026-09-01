import type {
  GitHubPullRequestCandidate,
  GitHubPullRequestSearchPort,
  GitHubPullRequestSearchResult,
  GitHubRepositoryIdentity
} from "../../application/github-pr-context/index";
import { fetchGitHubPullRequestMergeBase } from "./fetch-github-pull-request-merge-base";

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

const isResponseObject = (value: unknown): value is GitHubPullRequestResponse =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toCandidate = (
  value: unknown,
  expectedHead: string
): GitHubPullRequestCandidate | undefined | "malformed" => {
  if (!isResponseObject(value)) {
    return "malformed";
  }
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
    if (
      typeof value.number !== "number" ||
      !Number.isSafeInteger(value.number) ||
      !isString(value.title) ||
      !isString(value.html_url) ||
      !isResponseObject(value.head) ||
      !isString(value.head.sha) ||
      !isResponseObject(value.base) ||
      !isString(value.base.ref) ||
      !isString(value.base.sha)
    ) {
      return "malformed";
    }
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

type NextPageResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly url: URL }
  | { readonly kind: "invalid" };

const nextPageUrl = (
  response: Response,
  currentUrl: URL,
  collectionUrl: URL
): NextPageResult => {
  const link = response.headers.get("link");
  if (link === null) {
    return { kind: "none" };
  }
  for (const entry of link.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*$/u.exec(entry);
    if (match?.[2]?.split(/\s+/u).includes("next") !== true) {
      continue;
    }

    let next: URL;
    try {
      next = new URL(match[1]!, currentUrl);
    } catch {
      return { kind: "invalid" };
    }

    if (
      next.origin !== collectionUrl.origin ||
      next.protocol !== collectionUrl.protocol ||
      (next.protocol !== "https:" && next.protocol !== "http:") ||
      next.username.length > 0 ||
      next.password.length > 0 ||
      next.pathname !== collectionUrl.pathname ||
      next.hash.length > 0
    ) {
      return { kind: "invalid" };
    }
    return { kind: "valid", url: next };
  }
  return { kind: "none" };
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
    const collectionUrl = new URL(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls`
    );
    collectionUrl.searchParams.set("state", "open");
    collectionUrl.searchParams.set("per_page", "100");
    let url = new URL(collectionUrl);

    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    };
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const candidates: GitHubPullRequestCandidate[] = [];
    const visited = new Set<string>();
    while (true) {
      if (visited.has(url.toString())) {
        return { kind: "unavailable", reason: "api" };
      }
      visited.add(url.toString());
      let response: Response;
      try {
        response = await this.fetchImplementation(url, { headers });
      } catch {
        return { kind: "unavailable", reason: "network" };
      }

      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        return { kind: "unavailable", reason: "rate-limit" };
      }
      if (response.status === 401 || response.status === 403) return { kind: "unavailable", reason: "authentication" };
      if (!response.ok) {
        return { kind: "unavailable", reason: "api", httpStatus: response.status };
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

      const pageCandidates: GitHubPullRequestCandidate[] = [];
      for (const value of payload) {
        const candidate = toCandidate(value, headSha);
        if (candidate === "malformed") {
          return { kind: "unavailable", reason: "api" };
        }
        if (candidate !== undefined) {
          pageCandidates.push(candidate);
        }
      }
      candidates.push(...pageCandidates);

      const next = nextPageUrl(response, url, collectionUrl);
      if (next.kind === "invalid") {
        return { kind: "unavailable", reason: "api" };
      }
      if (next.kind === "none") {
        break;
      }
      url = next.url;
    }

    const normalizedCandidates: GitHubPullRequestCandidate[] = [];
    for (const candidate of candidates) {
      const mergeBase = await fetchGitHubPullRequestMergeBase(
        {
          apiBaseUrl: this.apiBaseUrl,
          ...(this.token === undefined ? {} : { token: this.token }),
          fetch: this.fetchImplementation,
        },
        repository,
        candidate.baseSha,
        candidate.headSha,
      );
      if (mergeBase.kind === "unavailable") {
        return { kind: "unavailable", reason: mergeBase.reason };
      }
      normalizedCandidates.push({
        ...candidate,
        baseSha: mergeBase.mergeBaseSha,
      });
    }

    normalizedCandidates.sort((left, right) => left.number - right.number);
    return { kind: "found", candidates: normalizedCandidates };
  }
}

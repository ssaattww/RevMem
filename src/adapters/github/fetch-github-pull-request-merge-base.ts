import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import { requirePullRequestCommitObjectId } from "../../application/github-pr-diff/index";
import { GITHUB_REQUEST_TIMEOUT_MS, GitHubRequestTimeoutError, runGitHubRequestWithTimeout } from "./github-request-timeout";

export type GitHubPullRequestMergeBaseUnavailableReason =
  | "rate-limit"
  | "network"
  | "api"
  | "authentication"
  | "timeout";

export type GitHubPullRequestMergeBaseResult =
  | { readonly kind: "available"; readonly mergeBaseSha: string }
  | { readonly kind: "unavailable"; readonly reason: GitHubPullRequestMergeBaseUnavailableReason };

export interface FetchGitHubPullRequestMergeBaseOptions {
  readonly apiBaseUrl: string;
  readonly token?: string;
  readonly fetch: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
}

/** Stable key for one operation-local immutable branch-point comparison. */
export const githubPullRequestMergeBaseReadKey = (
  apiBaseUrl: string,
  repository: GitHubRepositoryIdentity,
  baseSha: string,
  headSha: string,
  requestTimeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
): string => JSON.stringify([
  "merge-base-v1",
  apiBaseUrl.replace(/\/+$/u, "").toLowerCase(),
  repository.host.toLowerCase(),
  repository.owner.toLowerCase(),
  repository.repository.toLowerCase(),
  baseSha,
  headSha,
  requestTimeoutMs,
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const classifyResponse = (response: Response): GitHubPullRequestMergeBaseUnavailableReason | undefined => {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) return "rate-limit";
  if (response.status === 401 || response.status === 403) return "authentication";
  return response.ok ? undefined : "api";
};

const objectId = (value: string): string | undefined => {
  try {
    return requirePullRequestCommitObjectId(value);
  } catch {
    return undefined;
  }
};

/** Resolves the three-dot comparison origin GitHub uses for an open pull request. */
export const fetchGitHubPullRequestMergeBase = async (
  options: FetchGitHubPullRequestMergeBaseOptions,
  repository: GitHubRepositoryIdentity,
  currentBaseSha: string,
  headSha: string,
  signal?: AbortSignal,
): Promise<GitHubPullRequestMergeBaseResult> => {
  if (signal?.aborted) throw new DOMException("GitHub merge-base fetch was superseded.", "AbortError");
  const base = objectId(currentBaseSha);
  const head = objectId(headSha);
  if (base === undefined || head === undefined) return { kind: "unavailable", reason: "api" };
  const apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
  const url = new URL(
    `${apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/compare/${base}...${head}`
  );
  let response: Response;
  let value: unknown;
  try {
    const result = await runGitHubRequestWithTimeout(
      signal,
      options.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS,
      async (requestSignal) => {
        const received = await options.fetch(url, {
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            ...(options.token === undefined || options.token.length === 0
              ? {}
              : { authorization: `Bearer ${options.token}` }),
          },
          signal: requestSignal,
        });
        if (!received.ok) return { response: received, body: undefined };
        try {
          return { response: received, body: await received.json() as unknown };
        } catch {
          return { response: received, body: undefined };
        }
      },
    );
    response = result.response;
    value = result.body;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("GitHub merge-base fetch was superseded.", "AbortError");
    if (error instanceof GitHubRequestTimeoutError) return { kind: "unavailable", reason: "timeout" };
    return { kind: "unavailable", reason: "network" };
  }
  if (signal?.aborted) throw new DOMException("GitHub merge-base fetch was superseded.", "AbortError");
  const failure = classifyResponse(response);
  if (failure !== undefined) return { kind: "unavailable", reason: failure };
  if (signal?.aborted) throw new DOMException("GitHub merge-base fetch was superseded.", "AbortError");
  if (!isObject(value) || !isObject(value.merge_base_commit)) {
    return { kind: "unavailable", reason: "api" };
  }
  const sha = value.merge_base_commit.sha;
  if (typeof sha !== "string") return { kind: "unavailable", reason: "api" };
  const mergeBaseSha = objectId(sha);
  return mergeBaseSha === undefined
    ? { kind: "unavailable", reason: "api" }
    : { kind: "available", mergeBaseSha };
};

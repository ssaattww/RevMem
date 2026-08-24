import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import type { PullRequestRemoteMetadata } from "../../application/github-pr-diff/index";
import {
  reportActiveOperationProgress,
  type OperationFeedbackContext,
} from "../../application/operation-feedback/index";

export type GitHubPullRequestLifecycleUnavailableReason = "rate-limit" | "network" | "api" | "authentication";

export type GitHubPullRequestLifecycleResult =
  | { readonly kind: "available"; readonly metadata: PullRequestRemoteMetadata }
  | { readonly kind: "unavailable"; readonly reason: GitHubPullRequestLifecycleUnavailableReason };

export type GitHubRevisionComparisonResult =
  | { readonly kind: "available"; readonly diff: string }
  | { readonly kind: "unavailable"; readonly reason: GitHubPullRequestLifecycleUnavailableReason };

export interface FetchGitHubPullRequestLifecycleAdapterOptions {
  readonly apiBaseUrl: string;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface PullRequestPayload {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly state?: unknown;
  readonly merged_at?: unknown;
  readonly base?: { readonly sha?: unknown };
  readonly head?: { readonly sha?: unknown };
}

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const synchronizedPullRequestsByOperation = new WeakMap<OperationFeedbackContext, Set<string>>();

const reportSynchronizedPullRequest = (
  repository: GitHubRepositoryIdentity,
  number: number,
  feedbackContext: OperationFeedbackContext | undefined,
): void => {
  if (feedbackContext === undefined) return;
  let synchronized = synchronizedPullRequestsByOperation.get(feedbackContext);
  if (synchronized === undefined) {
    synchronized = new Set<string>();
    synchronizedPullRequestsByOperation.set(feedbackContext, synchronized);
  }
  const identity = `${repository.host}\0${repository.owner}\0${repository.repository}\0${number}`;
  if (synchronized.has(identity)) return;
  synchronized.add(identity);
  reportActiveOperationProgress({
    stage: "pull-request-contexts",
    completed: synchronized.size,
  }, feedbackContext);
};

const classify = (response: Response): GitHubPullRequestLifecycleUnavailableReason | undefined => {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) return "rate-limit";
  if (response.status === 401 || response.status === 403) return "authentication";
  return response.ok ? undefined : "api";
};

const requirePositiveNumber = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("pull request number must be a positive safe integer");
  return value;
};

const requireObjectId = (value: string, name: string): string => {
  if (!OBJECT_ID.test(value)) throw new TypeError(`${name} must be a lowercase full Git object ID`);
  return value;
};

/** Reads stable PR lifecycle metadata and exact revision comparisons from GitHub REST. */
export class FetchGitHubPullRequestLifecycleAdapter {
  private readonly apiBaseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: FetchGitHubPullRequestLifecycleAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async fetchCurrent(
    repository: GitHubRepositoryIdentity,
    number: number,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestLifecycleResult> {
    if (signal?.aborted) throw new DOMException("GitHub lifecycle fetch was superseded.", "AbortError");
    requirePositiveNumber(number);
    const url = new URL(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls/${number}`
    );
    let response: Response;
    try {
      response = await this.fetchImplementation(url, { headers: this.headers(), signal });
    } catch {
      if (signal?.aborted) throw new DOMException("GitHub lifecycle fetch was superseded.", "AbortError");
      return { kind: "unavailable", reason: "network" };
    }
    if (signal?.aborted) throw new DOMException("GitHub lifecycle fetch was superseded.", "AbortError");
    const failure = classify(response);
    if (failure !== undefined) return { kind: "unavailable", reason: failure };
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return { kind: "unavailable", reason: "api" };
    }
    if (signal?.aborted) throw new DOMException("GitHub lifecycle fetch was superseded.", "AbortError");
    if (!isObject(value)) return { kind: "unavailable", reason: "api" };
    const payload = value as PullRequestPayload;
    if (
      payload.number !== number ||
      typeof payload.title !== "string" ||
      typeof payload.html_url !== "string" ||
      (payload.state !== "open" && payload.state !== "closed") ||
      (payload.merged_at !== null && payload.merged_at !== undefined && typeof payload.merged_at !== "string") ||
      !isObject(payload.base) || typeof payload.base.sha !== "string" || !OBJECT_ID.test(payload.base.sha) ||
      !isObject(payload.head) || typeof payload.head.sha !== "string" || !OBJECT_ID.test(payload.head.sha)
    ) return { kind: "unavailable", reason: "api" };
    reportSynchronizedPullRequest(repository, number, feedbackContext);
    return {
      kind: "available",
      metadata: {
        number,
        title: payload.title,
        url: payload.html_url,
        state: payload.merged_at === null || payload.merged_at === undefined ? payload.state : "merged",
        baseSha: payload.base.sha,
        headSha: payload.head.sha,
      },
    };
  }

  public async compareRevisions(
    repository: GitHubRepositoryIdentity,
    sourceRevision: string,
    targetRevision: string
  ): Promise<GitHubRevisionComparisonResult> {
    const source = requireObjectId(sourceRevision, "sourceRevision");
    const target = requireObjectId(targetRevision, "targetRevision");
    const url = new URL(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/compare/${source}...${target}`
    );
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: this.headers("application/vnd.github.diff"),
      });
    } catch {
      return { kind: "unavailable", reason: "network" };
    }
    const failure = classify(response);
    if (failure !== undefined) return { kind: "unavailable", reason: failure };
    try {
      return { kind: "available", diff: await response.text() };
    } catch {
      return { kind: "unavailable", reason: "api" };
    }
  }

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      accept,
      "x-github-api-version": "2022-11-28",
      ...(this.token === undefined || this.token.length === 0 ? {} : { authorization: `Bearer ${this.token}` }),
    };
  }
}
import type {
  GitHubPullRequestCandidate,
  GitHubPullRequestSearchPort,
  GitHubPullRequestSearchResult,
  GitHubRepositoryIdentity
} from "../../application/github-pr-context/index";
import {
  fetchGitHubPullRequestMergeBase,
  readGitHubPullRequestMergeBase,
  type GitHubPullRequestMergeBaseCacheGeneration,
  type GitHubPullRequestMergeBaseResultMap,
} from "./fetch-github-pull-request-merge-base";
import { GITHUB_REQUEST_TIMEOUT_MS, GitHubRequestTimeoutError, runGitHubRequestWithTimeout } from "./github-request-timeout";

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
  /** Per-page and per-merge-base deadline. */
  readonly requestTimeoutMs?: number;
  /** Operation-local memo shared with lifecycle reads for identical merge bases. */
  readonly mergeBaseReads?: Map<string, Promise<Awaited<ReturnType<typeof fetchGitHubPullRequestMergeBase>>>>;
  /** Completed immutable results shared across linked refresh signals. */
  readonly mergeBaseResults?: GitHubPullRequestMergeBaseResultMap;
  /** Invalidates old consumers when account/operation cache scope changes. */
  readonly mergeBaseGeneration?: GitHubPullRequestMergeBaseCacheGeneration;
  /** Emits allowlisted phase, ordinal, count, status, and duration only. */
  readonly onDiagnostic?: (event: GitHubPullRequestSearchPhaseDiagnostic) => void;
}

const isSignalAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

export interface GitHubPullRequestSearchPhaseDiagnostic {
  readonly stage: "pr-search-page" | "merge-base";
  readonly status: "started" | "succeeded" | "failed" | "cancelled";
  readonly ordinal: number;
  readonly durationMs?: number;
  readonly candidateCount?: number;
  readonly reasonCode?: "request-timeout" | "network-failure" | "api-failure" | "authentication-required" | "rate-limited" | "superseded-by-newer-generation";
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
  private readonly requestTimeoutMs: number;
  private readonly onDiagnostic: FetchGitHubPullRequestAdapterOptions["onDiagnostic"];
  private readonly mergeBaseReads: FetchGitHubPullRequestAdapterOptions["mergeBaseReads"];
  private readonly mergeBaseResults: FetchGitHubPullRequestAdapterOptions["mergeBaseResults"];
  private readonly mergeBaseGeneration: FetchGitHubPullRequestAdapterOptions["mergeBaseGeneration"];

  public constructor(options: FetchGitHubPullRequestAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS;
    this.onDiagnostic = options.onDiagnostic;
    this.mergeBaseReads = options.mergeBaseReads;
    this.mergeBaseResults = options.mergeBaseResults;
    this.mergeBaseGeneration = options.mergeBaseGeneration;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new RangeError("GitHub request timeout must be a positive safe integer");
    }
  }

  public async findOpenByHead(
    repository: GitHubRepositoryIdentity,
    headSha: string,
    signal?: AbortSignal,
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
    let pageOrdinal = 0;
    while (true) {
      if (signal?.aborted === true) throw new DOMException("GitHub PR search was superseded.", "AbortError");
      pageOrdinal += 1;
      if (visited.has(url.toString())) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, reasonCode: "api-failure" });
        return { kind: "unavailable", reason: "api" };
      }
      visited.add(url.toString());
      const pageStartedAt = Date.now();
      this.emit({ stage: "pr-search-page", status: "started", ordinal: pageOrdinal });
      let page: { readonly response: Response; readonly payload?: unknown; readonly bodyInvalid?: boolean };
      try {
        page = await runGitHubRequestWithTimeout(signal, this.requestTimeoutMs, async (requestSignal) => {
          const response = await this.fetchImplementation(url, { headers, signal: requestSignal });
          if (!response.ok) return { response };
          try {
            return { response, payload: await response.json() as unknown };
          } catch {
            return { response, bodyInvalid: true };
          }
        });
      } catch (error) {
        const durationMs = Math.max(0, Date.now() - pageStartedAt);
        if (isSignalAborted(signal)) {
          this.emit({ stage: "pr-search-page", status: "cancelled", ordinal: pageOrdinal, durationMs, reasonCode: "superseded-by-newer-generation" });
          throw new DOMException("GitHub PR search was superseded.", "AbortError");
        }
        if (error instanceof GitHubRequestTimeoutError) {
          this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs, reasonCode: "request-timeout" });
          return { kind: "unavailable", reason: "timeout" };
        }
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs, reasonCode: "network-failure" });
        return { kind: "unavailable", reason: "network" };
      }

      const { response } = page;
      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "rate-limited" });
        return { kind: "unavailable", reason: "rate-limit" };
      }
      if (response.status === 401 || response.status === 403) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "authentication-required" });
        return { kind: "unavailable", reason: "authentication" };
      }
      if (!response.ok) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "api-failure" });
        return { kind: "unavailable", reason: "api", httpStatus: response.status };
      }

      if (page.bodyInvalid === true) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "api-failure" });
        return { kind: "unavailable", reason: "api" };
      }
      const payload = page.payload;
      if (!Array.isArray(payload)) {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "api-failure" });
        return { kind: "unavailable", reason: "api" };
      }

      const pageCandidates: GitHubPullRequestCandidate[] = [];
      for (const value of payload) {
        const candidate = toCandidate(value, headSha);
        if (candidate === "malformed") {
          this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "api-failure" });
          return { kind: "unavailable", reason: "api" };
        }
        if (candidate !== undefined) {
          pageCandidates.push(candidate);
        }
      }
      candidates.push(...pageCandidates);

      const next = nextPageUrl(response, url, collectionUrl);
      if (next.kind === "invalid") {
        this.emit({ stage: "pr-search-page", status: "failed", ordinal: pageOrdinal, durationMs: Math.max(0, Date.now() - pageStartedAt), reasonCode: "api-failure" });
        return { kind: "unavailable", reason: "api" };
      }
      this.emit({
        stage: "pr-search-page",
        status: "succeeded",
        ordinal: pageOrdinal,
        durationMs: Math.max(0, Date.now() - pageStartedAt),
        candidateCount: pageCandidates.length,
      });
      if (next.kind === "none") {
        break;
      }
      url = next.url;
    }

    const normalizedCandidates: GitHubPullRequestCandidate[] = [];
    let candidateOrdinal = 0;
    for (const candidate of candidates) {
      if (isSignalAborted(signal)) throw new DOMException("GitHub PR search was superseded.", "AbortError");
      candidateOrdinal += 1;
      const mergeBaseStartedAt = Date.now();
      this.emit({ stage: "merge-base", status: "started", ordinal: candidateOrdinal });
      let mergeBase: Awaited<ReturnType<typeof fetchGitHubPullRequestMergeBase>>;
      try {
        mergeBase = await readGitHubPullRequestMergeBase(
          {
            apiBaseUrl: this.apiBaseUrl,
            ...(this.token === undefined ? {} : { token: this.token }),
            fetch: this.fetchImplementation,
            requestTimeoutMs: this.requestTimeoutMs,
          },
          repository,
          candidate.baseSha,
          candidate.headSha,
          signal,
          this.mergeBaseReads,
          this.mergeBaseResults,
          this.mergeBaseGeneration,
        );
      } catch (error) {
        if (isSignalAborted(signal) || (error instanceof DOMException && error.name === "AbortError")) {
          this.emit({ stage: "merge-base", status: "cancelled", ordinal: candidateOrdinal, durationMs: Math.max(0, Date.now() - mergeBaseStartedAt), reasonCode: "superseded-by-newer-generation" });
        } else {
          this.emit({ stage: "merge-base", status: "failed", ordinal: candidateOrdinal, durationMs: Math.max(0, Date.now() - mergeBaseStartedAt), reasonCode: "api-failure" });
        }
        throw error;
      }
      if (mergeBase.kind === "unavailable") {
        this.emit({
          stage: "merge-base",
          status: isSignalAborted(signal) ? "cancelled" : "failed",
          ordinal: candidateOrdinal,
          durationMs: Math.max(0, Date.now() - mergeBaseStartedAt),
          reasonCode: isSignalAborted(signal) ? "superseded-by-newer-generation" :
            mergeBase.reason === "timeout" ? "request-timeout" :
              mergeBase.reason === "network" ? "network-failure" :
                mergeBase.reason === "authentication" ? "authentication-required" :
                  mergeBase.reason === "rate-limit" ? "rate-limited" : "api-failure",
        });
        return { kind: "unavailable", reason: mergeBase.reason };
      }
      this.emit({ stage: "merge-base", status: "succeeded", ordinal: candidateOrdinal, durationMs: Math.max(0, Date.now() - mergeBaseStartedAt) });
      normalizedCandidates.push({
        ...candidate,
        baseSha: mergeBase.mergeBaseSha,
      });
    }

    normalizedCandidates.sort((left, right) => left.number - right.number);
    return { kind: "found", candidates: normalizedCandidates };
  }

  private emit(event: GitHubPullRequestSearchPhaseDiagnostic): void {
    this.onDiagnostic?.(event);
  }
}

// src/adapters/github/fetch-github-pull-request-viewed-identity-adapter.ts
import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import type { GitHubSilentSessionResult } from "./vscode-github-authentication-provider";
import { canonicalGitHubAuthority, gitHubApiBaseUrl } from "./git-remote";

type SilentSession = Extract<GitHubSilentSessionResult, { readonly kind: "available" }>;

export interface GitHubViewedIdentityRequest {
  readonly enabled: boolean;
  readonly session: SilentSession;
  readonly repository: GitHubRepositoryIdentity;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly generation: number;
  /** Captures current selection, setting, and auth-session generation. */
  readonly isCurrent: () => boolean;
  readonly signal?: AbortSignal;
}

export type GitHubViewedIdentityResult =
  | {
    readonly kind: "available";
    readonly viewer: { readonly id: string; readonly login: string; readonly host: string };
    readonly pullRequest: {
      readonly nodeId: string;
      readonly number: number;
      readonly state: "open";
      readonly repository: GitHubRepositoryIdentity;
      readonly headSha: string;
    };
    readonly generation: number;
    readonly session: SilentSession["binding"];
  }
  | { readonly kind: "unavailable"; readonly reason: "disabled" | "authentication" | "network" | "api" | "identity-mismatch" }
  | { readonly kind: "stale" };

export interface FetchGitHubPullRequestViewedIdentityAdapterOptions {
  readonly apiBaseUrl: string;
  readonly knownHosts: readonly string[];
  readonly fetch: typeof globalThis.fetch;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const QUERY = `query ViewedIdentity($owner: String!, $name: String!, $number: Int!) {
  viewer { id login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) { id number state headRefOid }
  }
}`;

export class FetchGitHubPullRequestViewedIdentityAdapter {
  private readonly apiBaseUrl: string;
  private readonly knownHosts: ReadonlySet<string>;
  private readonly fetch: typeof globalThis.fetch;

  public constructor(options: FetchGitHubPullRequestViewedIdentityAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.knownHosts = new Set(options.knownHosts
      .map(canonicalGitHubAuthority)
      .filter((host): host is string => host !== undefined));
    this.fetch = options.fetch;
  }

  public async fetchIdentity(request: GitHubViewedIdentityRequest): Promise<GitHubViewedIdentityResult> {
    if (!request.enabled) return { kind: "unavailable", reason: "disabled" };
    const host = canonicalGitHubAuthority(request.repository.host);
    const session = request.session;
    if (
      host === undefined ||
      !this.knownHosts.has(host) ||
      session.binding.host !== host ||
      session.accessToken.length === 0 ||
      this.apiBaseUrl !== gitHubApiBaseUrl(host)
    ) return { kind: "unavailable", reason: "authentication" };

    const stale = (): boolean => request.signal?.aborted === true || !request.isCurrent();
    if (stale()) return { kind: "stale" };

    const base = new URL(this.apiBaseUrl);
    const url = new URL(
      host === "github.com" ? "/graphql" : "/api/graphql",
      base.origin
    );
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28"
        },
        body: JSON.stringify({
          query: QUERY,
          variables: {
            owner: request.repository.owner,
            name: request.repository.repository,
            number: request.pullRequestNumber
          }
        }),
        signal: request.signal
      });
    } catch {
      return stale()
        ? { kind: "stale" }
        : { kind: "unavailable", reason: "network" };
    }
    if (stale()) return { kind: "stale" };
    if (response.status === 401 || response.status === 403) {
      return { kind: "unavailable", reason: "authentication" };
    }
    if (!response.ok) return { kind: "unavailable", reason: "api" };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "unavailable", reason: "api" };
    }
    if (stale()) return { kind: "stale" };
    if (
      !isObject(payload) ||
      (payload.errors !== undefined &&
        (!Array.isArray(payload.errors) || payload.errors.length > 0)) ||
      !isObject(payload.data) ||
      !isObject(payload.data.viewer) ||
      !isObject(payload.data.repository)
    ) return { kind: "unavailable", reason: "api" };

    const { id: viewerId, login } = payload.data.viewer;
    const repository = payload.data.repository;
    const pr = repository.pullRequest;
    if (
      typeof viewerId !== "string" || viewerId.length === 0 ||
      typeof login !== "string" || login.length === 0 ||
      typeof repository.nameWithOwner !== "string" ||
      repository.nameWithOwner.toLowerCase() !== `${request.repository.owner}/${request.repository.repository}`.toLowerCase() ||
      !isObject(pr) ||
      typeof pr.id !== "string" || pr.id.length === 0 ||
      pr.number !== request.pullRequestNumber ||
      pr.state !== "OPEN" ||
      pr.headRefOid !== request.headSha
    ) return { kind: "unavailable", reason: "identity-mismatch" };

    if (stale()) return { kind: "stale" };
    return {
      kind: "available",
      viewer: { id: viewerId, login, host },
      pullRequest: {
        nodeId: pr.id,
        number: request.pullRequestNumber,
        state: "open",
        repository: request.repository,
        headSha: request.headSha
      },
      generation: request.generation,
      session: session.binding
    };
  }
}

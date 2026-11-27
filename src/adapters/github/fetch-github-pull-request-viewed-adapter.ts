// src/adapters/github/fetch-github-pull-request-viewed-adapter.ts
import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import type {
  GitHubViewedReadSnapshot,
  GitHubViewedSelectedPullRequest,
} from "../../application/github-pr-context/github-viewed-contracts";
import { fetchGitHubPullRequestMergeBase } from "./fetch-github-pull-request-merge-base";
import { canonicalGitHubAuthority, gitHubApiBaseUrl } from "./git-remote";

export type GitHubPullRequestViewedUnavailableReason =
  | "authentication"
  | "rate-limit"
  | "network"
  | "api"
  | "identity-mismatch"
  | "incomplete"
  | "stale";

export type GitHubPullRequestViewedResult =
  | { readonly kind: "available"; readonly snapshot: GitHubViewedReadSnapshot }
  | { readonly kind: "unavailable"; readonly reason: GitHubPullRequestViewedUnavailableReason };

export interface GitHubPullRequestViewedRequest {
  readonly repository: GitHubRepositoryIdentity;
  readonly expectedViewerId: string;
  readonly selectedPullRequest: GitHubViewedSelectedPullRequest;
  /** Must return false when the selected PR or progress generation changes. */
  readonly isCurrent: () => boolean;
}

export interface FetchGitHubPullRequestViewedAdapterOptions {
  readonly apiBaseUrl: string;
  /** Token from the existing non-interactive, host-appropriate VS Code session. */
  readonly token: string;
  /** Allowlist from the existing authentication configuration. */
  readonly knownHosts: readonly string[];
  readonly fetch: typeof globalThis.fetch;
}

interface ViewedFilePayload {
  readonly path?: unknown;
  readonly additions?: unknown;
  readonly deletions?: unknown;
  readonly changeType?: unknown;
  readonly viewerViewedState?: unknown;
}

interface PullRequestPayload {
  readonly id?: unknown;
  readonly number?: unknown;
  readonly state?: unknown;
  readonly baseRefOid?: unknown;
  readonly headRefOid?: unknown;
  readonly files?: {
    readonly totalCount?: unknown;
    readonly pageInfo?: { readonly hasNextPage?: unknown; readonly endCursor?: unknown };
    readonly nodes?: unknown;
  };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const MAX_FILES = PAGE_SIZE * MAX_PAGES;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const QUERY = `
  query PullRequestViewedFiles(
    $owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String
  ) {
    viewer { id login }
    repository(owner: $owner, name: $name) {
      nameWithOwner
      pullRequest(number: $number) {
        id number state baseRefOid headRefOid
        files(first: $first, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { path additions deletions changeType viewerViewedState }
        }
      }
    }
  }
`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const sameRepository = (
  left: GitHubRepositoryIdentity,
  right: GitHubRepositoryIdentity,
): boolean =>
  left.host.toLowerCase() === right.host.toLowerCase() &&
  left.owner.toLowerCase() === right.owner.toLowerCase() &&
  left.repository.toLowerCase() === right.repository.toLowerCase();

const statusFor = (
  value: unknown,
): GitHubViewedReadSnapshot["files"][number]["status"] | undefined => {
  switch (value) {
    case "ADDED": return "added";
    case "DELETED": return "deleted";
    case "MODIFIED": return "modified";
    case "RENAMED": return "renamed";
    case "COPIED": return "copied";
    default: return undefined;
  }
};

const viewedStateFor = (
  value: unknown,
): GitHubViewedReadSnapshot["files"][number]["viewedState"] | undefined => {
  switch (value) {
    case "VIEWED": return "VIEWED";
    case "UNVIEWED": return "UNVIEWED";
    case "DISMISSED": return "DISMISSED";
    default: return undefined;
  }
};

const responseFailure = (
  response: Response,
): GitHubPullRequestViewedUnavailableReason | undefined => {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) return "rate-limit";
  if (response.status === 401 || response.status === 403) return "authentication";
  return response.ok ? undefined : "api";
};

/**
 * Read-only GraphQL reader for the authenticated viewer's PR file Viewed state.
 * The caller must obtain the token non-interactively from the existing,
 * host-specific VS Code authentication provider and supply that provider's
 * configured host allowlist. Requests reject redirects; this class has no
 * mutation operation.
 */
export class FetchGitHubPullRequestViewedAdapter {
  private readonly apiBaseUrl: string;
  private readonly token: string;
  private readonly knownHosts: ReadonlySet<string>;
  private readonly fetchNoRedirect: typeof globalThis.fetch;

  public constructor(options: FetchGitHubPullRequestViewedAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.knownHosts = new Set(
      options.knownHosts
        .map(canonicalGitHubAuthority)
        .filter((host): host is string => host !== undefined),
    );
    // Also applies to the existing merge-base REST helper.
    this.fetchNoRedirect = (input, init) =>
      options.fetch(input, { ...init, redirect: "error" });
  }

  public async fetch(
    request: GitHubPullRequestViewedRequest,
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestViewedResult> {
    const host = canonicalGitHubAuthority(request.repository.host);
    const selected = request.selectedPullRequest;
    if (
      this.token.length === 0 ||
      host === undefined ||
      !this.knownHosts.has(host) ||
      this.apiBaseUrl !== gitHubApiBaseUrl(host)
    ) return { kind: "unavailable", reason: "authentication" };

    if (
      !sameRepository(selected.repository, request.repository) ||
      selected.repository.host.toLowerCase() !== host ||
      selected.state !== "open" ||
      !Number.isSafeInteger(selected.number) ||
      selected.number <= 0 ||
      selected.nodeId.length === 0 ||
      !OBJECT_ID.test(selected.headSha) ||
      !OBJECT_ID.test(selected.comparisonBaseSha) ||
      selected.originalDiffId !== `${selected.comparisonBaseSha}..${selected.headSha}` ||
      request.expectedViewerId.length === 0 ||
      !Number.isSafeInteger(selected.generation) ||
      selected.generation < 0
    ) return { kind: "unavailable", reason: "identity-mismatch" };

    let graphQlUrl: URL;
    try {
      const apiBase = new URL(this.apiBaseUrl);
      if (apiBase.protocol !== "https:" || apiBase.username || apiBase.password ||
          apiBase.search || apiBase.hash) {
        return { kind: "unavailable", reason: "authentication" };
      }
      graphQlUrl = new URL(
        host === "github.com"
          ? "/graphql"
          : `${apiBase.pathname.replace(/\/api\/v3$/u, "")}/api/graphql`,
        apiBase.origin,
      );
    } catch {
      return { kind: "unavailable", reason: "authentication" };
    }

    const files: GitHubViewedReadSnapshot["files"][number][] = [];
    const seenCursors = new Set<string>();
    const seenPaths = new Set<string>();
    let cursor: string | null = null;
    let expectedTotal: number | undefined;
    let expectedBaseRefOid: string | undefined;
    let expectedHeadRefOid: string | undefined;
    let comparisonBaseSha: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw new DOMException("Viewed read was superseded.", "AbortError");
      if (!request.isCurrent()) return { kind: "unavailable", reason: "stale" };

      let response: Response;
      try {
        response = await this.fetchNoRedirect(graphQlUrl, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({
            query: QUERY,
            variables: {
              owner: request.repository.owner,
              name: request.repository.repository,
              number: selected.number,
              first: PAGE_SIZE,
              after: cursor,
            },
          }),
          signal,
        });
      } catch {
        if (signal?.aborted) throw new DOMException("Viewed read was superseded.", "AbortError");
        return { kind: "unavailable", reason: "network" };
      }
      if (signal?.aborted) throw new DOMException("Viewed read was superseded.", "AbortError");
      if (!request.isCurrent()) return { kind: "unavailable", reason: "stale" };

      const failure = responseFailure(response);
      if (failure !== undefined) return { kind: "unavailable", reason: failure };

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "unavailable", reason: "api" };
      }
      if (signal?.aborted) throw new DOMException("Viewed read was superseded.", "AbortError");
      if (!request.isCurrent()) return { kind: "unavailable", reason: "stale" };

      if (
        !isObject(payload) ||
        (payload.errors !== undefined &&
          (!Array.isArray(payload.errors) || payload.errors.length > 0)) ||
        !isObject(payload.data) ||
        !isObject(payload.data.viewer) ||
        !isObject(payload.data.repository)
      ) return { kind: "unavailable", reason: "api" };

      const viewer = payload.data.viewer;
      const repository = payload.data.repository;
      const prValue = repository.pullRequest;
      if (
        viewer.id !== request.expectedViewerId ||
        typeof viewer.login !== "string" ||
        viewer.login.length === 0 ||
        typeof repository.nameWithOwner !== "string" ||
        repository.nameWithOwner.toLowerCase() !==
          `${request.repository.owner}/${request.repository.repository}`.toLowerCase() ||
        !isObject(prValue)
      ) return { kind: "unavailable", reason: "identity-mismatch" };

      const pr = prValue as PullRequestPayload;
      const connection = pr.files;
      const pageInfo = connection?.pageInfo;
      if (
        pr.id !== selected.nodeId ||
        pr.number !== selected.number ||
        pr.state !== "OPEN" ||
        typeof pr.baseRefOid !== "string" ||
        !OBJECT_ID.test(pr.baseRefOid) ||
        typeof pr.headRefOid !== "string" ||
        !OBJECT_ID.test(pr.headRefOid) ||
        pr.headRefOid !== selected.headSha ||
        !isObject(connection) ||
        !isCount(connection.totalCount) ||
        connection.totalCount > MAX_FILES ||
        !isObject(pageInfo) ||
        typeof pageInfo.hasNextPage !== "boolean" ||
        !Array.isArray(connection.nodes) ||
        connection.nodes.length > PAGE_SIZE
      ) return { kind: "unavailable", reason: "identity-mismatch" };

      if (expectedTotal === undefined) {
        expectedTotal = connection.totalCount;
        expectedBaseRefOid = pr.baseRefOid;
        expectedHeadRefOid = pr.headRefOid;
        const mergeBase = await fetchGitHubPullRequestMergeBase(
          {
            apiBaseUrl: this.apiBaseUrl,
            token: this.token,
            fetch: this.fetchNoRedirect,
          },
          request.repository,
          expectedBaseRefOid,
          expectedHeadRefOid,
          signal,
        );
        if (signal?.aborted) throw new DOMException("Viewed read was superseded.", "AbortError");
        if (!request.isCurrent()) return { kind: "unavailable", reason: "stale" };
        if (mergeBase.kind === "unavailable") {
          return {
            kind: "unavailable",
            reason: mergeBase.reason === "authentication" || mergeBase.reason === "rate-limit"
              ? mergeBase.reason
              : mergeBase.reason === "network" || mergeBase.reason === "timeout"
                ? "network"
                : "api",
          };
        }
        if (mergeBase.mergeBaseSha !== selected.comparisonBaseSha) {
          return { kind: "unavailable", reason: "identity-mismatch" };
        }
        comparisonBaseSha = mergeBase.mergeBaseSha;
      } else if (
        connection.totalCount !== expectedTotal ||
        pr.baseRefOid !== expectedBaseRefOid ||
        pr.headRefOid !== expectedHeadRefOid
      ) {
        return { kind: "unavailable", reason: "identity-mismatch" };
      }

      for (const value of connection.nodes) {
        if (!isObject(value)) return { kind: "unavailable", reason: "api" };
        const node = value as ViewedFilePayload;
        const status = statusFor(node.changeType);
        const viewedState = viewedStateFor(node.viewerViewedState);
        if (
          typeof node.path !== "string" ||
          node.path.length === 0 ||
          seenPaths.has(node.path) ||
          !isCount(node.additions) ||
          !isCount(node.deletions) ||
          status === undefined ||
          viewedState === undefined
        ) return { kind: "unavailable", reason: "incomplete" };
        seenPaths.add(node.path);
        files.push({
          path: node.path,
          status,
          additions: node.additions,
          deletions: node.deletions,
          viewedState,
        });
      }

      if (pageInfo.hasNextPage === false) {
        if (files.length !== expectedTotal || comparisonBaseSha === undefined) {
          return { kind: "unavailable", reason: "incomplete" };
        }
        if (!request.isCurrent()) return { kind: "unavailable", reason: "stale" };
        return {
          kind: "available",
          snapshot: {
            viewerId: request.expectedViewerId,
            repository: request.repository,
            pullRequestNodeId: selected.nodeId,
            pullRequestNumber: selected.number,
            state: "open",
            headSha: selected.headSha,
            comparisonBaseSha,
            originalDiffId: selected.originalDiffId,
            generation: selected.generation,
            complete: true,
            files,
          },
        };
      }

      const nextCursor = pageInfo.endCursor;
      if (
        typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        seenCursors.has(nextCursor) ||
        connection.nodes.length === 0
      ) return { kind: "unavailable", reason: "incomplete" };
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return { kind: "unavailable", reason: "incomplete" };
  }
}

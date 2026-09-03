import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import {
  requirePullRequestCommitObjectId,
  requirePullRequestDiffAcquisitionRequest
} from "../../application/github-pr-diff/index";
import type {
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffUnavailableReason,
  PullRequestRemoteDataPort,
  PullRequestRemoteFile,
  PullRequestRemoteMetadata,
  PullRequestRemoteTextReadResult
} from "../../application/github-pr-diff/index";
import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import { fetchGitHubPullRequestMergeBase } from "./fetch-github-pull-request-merge-base";

interface GitHubPullRequestPayload {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly html_url?: unknown;
  readonly state?: unknown;
  readonly merged_at?: unknown;
  readonly changed_files?: unknown;
  readonly base?: { readonly sha?: unknown };
  readonly head?: { readonly sha?: unknown };
}

interface GitHubPullRequestFilePayload {
  readonly filename?: unknown;
  readonly previous_filename?: unknown;
  readonly status?: unknown;
  readonly additions?: unknown;
  readonly deletions?: unknown;
  readonly patch?: unknown;
}

/** Fetch options for GitHub PR metadata, files, and immutable raw content. */
export interface FetchGitHubPullRequestDiffAdapterOptions {
  readonly apiBaseUrl: string;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const PULL_REQUEST_FILES_PER_PAGE = 100;
const MAX_PULL_REQUEST_PAGES = 30;
const MAX_PULL_REQUEST_FILES = PULL_REQUEST_FILES_PER_PAGE * MAX_PULL_REQUEST_PAGES;

type PageLinkResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly url: URL; readonly page: number }
  | { readonly kind: "invalid" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isSafeCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const statusFrom = (value: unknown): PullRequestRemoteFile["status"] | undefined => {
  switch (value) {
    case "added": return "added";
    case "removed": return "deleted";
    case "modified": return "modified";
    case "renamed": return "renamed";
    case "copied": return "copied";
    default: return undefined;
  }
};

const classifyResponse = (response: Response): PullRequestDiffUnavailableReason | undefined => {
  if (response.status === 429 || (
    response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0"
  )) return "rate-limit";
  if (response.status === 401 || response.status === 403) return "authentication";
  return response.ok ? undefined : "api";
};

const exactPageQuery = (url: URL, expectedPage: number): boolean => {
  if (
    url.searchParams.getAll("per_page").length !== 1 ||
    url.searchParams.getAll("page").length !== 1 ||
    url.searchParams.get("per_page") !== String(PULL_REQUEST_FILES_PER_PAGE) ||
    url.searchParams.get("page") !== String(expectedPage)
  ) return false;
  return [...url.searchParams.keys()].every(key => key === "per_page" || key === "page") &&
    [...url.searchParams.keys()].length === 2;
};

const nextPage = (
  response: Response,
  current: URL,
  collection: URL,
  currentPage: number
): PageLinkResult => {
  const link = response.headers.get("link");
  if (link === null) return { kind: "none" };
  for (const entry of link.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*$/u.exec(entry);
    if (match?.[2]?.split(/\s+/u).includes("next") !== true) continue;
    let target: URL;
    try {
      target = new URL(match[1]!, current);
    } catch {
      return { kind: "invalid" };
    }
    const expectedPage = currentPage + 1;
    if (
      target.origin !== collection.origin ||
      target.protocol !== collection.protocol ||
      (target.protocol !== "https:" && target.protocol !== "http:") ||
      target.username.length > 0 ||
      target.password.length > 0 ||
      target.pathname !== collection.pathname ||
      target.hash.length > 0 ||
      !exactPageQuery(target, expectedPage)
    ) return { kind: "invalid" };
    return { kind: "valid", url: target, page: expectedPage };
  }
  return { kind: "none" };
};

interface ParsedPullRequestMetadata {
  readonly metadata: PullRequestRemoteMetadata;
  readonly changedFiles: number;
}

const parseMetadata = (value: unknown): ParsedPullRequestMetadata | undefined => {
  if (!isObject(value)) return undefined;
  const payload = value as GitHubPullRequestPayload;
  if (
    typeof payload.number !== "number" || !Number.isSafeInteger(payload.number) || payload.number <= 0 ||
    !isString(payload.title) || !isString(payload.html_url) ||
    (payload.state !== "open" && payload.state !== "closed") ||
    (payload.merged_at !== null && payload.merged_at !== undefined && !isString(payload.merged_at)) ||
    !isSafeCount(payload.changed_files) ||
    !isObject(payload.base) || !isString(payload.base.sha) ||
    !isObject(payload.head) || !isString(payload.head.sha)
  ) return undefined;
  return {
    metadata: {
      number: payload.number,
      title: payload.title,
      url: payload.html_url,
      state: payload.merged_at === null || payload.merged_at === undefined ? payload.state : "merged",
      baseSha: payload.base.sha,
      headSha: payload.head.sha
    },
    changedFiles: payload.changed_files
  };
};

const parseFile = (value: unknown): PullRequestRemoteFile | undefined => {
  if (!isObject(value)) return undefined;
  const payload = value as GitHubPullRequestFilePayload;
  const status = statusFrom(payload.status);
  if (
    status === undefined || !isString(payload.filename) ||
    !isSafeCount(payload.additions) || !isSafeCount(payload.deletions) ||
    (payload.patch !== undefined && !isString(payload.patch))
  ) return undefined;
  const newPath = payload.filename;
  if (status === "added") {
    return {
      newPath,
      status,
      additions: payload.additions,
      deletions: payload.deletions,
      ...(payload.patch === undefined ? {} : { patch: payload.patch })
    };
  }
  if (status === "deleted") {
    return {
      oldPath: newPath,
      status,
      additions: payload.additions,
      deletions: payload.deletions,
      ...(payload.patch === undefined ? {} : { patch: payload.patch })
    };
  }
  if (status === "renamed" || status === "copied") {
    if (!isString(payload.previous_filename)) return undefined;
    return {
      oldPath: payload.previous_filename,
      newPath,
      status,
      additions: payload.additions,
      deletions: payload.deletions,
      ...(payload.patch === undefined ? {} : { patch: payload.patch })
    };
  }
  return {
    oldPath: newPath,
    newPath,
    status,
    additions: payload.additions,
    deletions: payload.deletions,
    ...(payload.patch === undefined ? {} : { patch: payload.patch })
  };
};

/** GitHub REST implementation of all remote T402 acquisition boundaries. */
export class FetchGitHubPullRequestDiffAdapter implements PullRequestRemoteDataPort {
  private readonly apiBaseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImplementation: typeof globalThis.fetch;

  public constructor(options: FetchGitHubPullRequestDiffAdapterOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  public async fetch(
    request: PullRequestDiffAcquisitionRequest,
    _feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): ReturnType<PullRequestRemoteDataPort["fetch"]> {
    requirePullRequestDiffAcquisitionRequest(request);
    const root = `${this.apiBaseUrl}/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.repository)}/pulls/${request.number}`;
    const metadataResult = await this.fetchJson(new URL(root), signal);
    if (metadataResult.kind === "unavailable") return metadataResult;
    const parsedMetadata = parseMetadata(metadataResult.payload);
    if (parsedMetadata === undefined) return { kind: "unavailable", reason: "api" };
    const { metadata, changedFiles } = parsedMetadata;
    if (changedFiles >= MAX_PULL_REQUEST_FILES) {
      return { kind: "unavailable", reason: "diff-too-large" };
    }

    let exactMetadata = metadata;
    if (metadata.state === "open") {
      const mergeBase = await fetchGitHubPullRequestMergeBase(
        {
          apiBaseUrl: this.apiBaseUrl,
          ...(this.token === undefined ? {} : { token: this.token }),
          fetch: this.fetchImplementation,
        },
        request.repository,
        metadata.baseSha,
        metadata.headSha,
        signal,
      );
      if (mergeBase.kind === "unavailable") return mergeBase;
      exactMetadata = { ...metadata, baseSha: mergeBase.mergeBaseSha };
    }
    if (
      exactMetadata.number !== request.number ||
      exactMetadata.baseSha !== request.baseSha ||
      exactMetadata.headSha !== request.headSha
    ) return { kind: "unavailable", reason: "identity-mismatch" };

    const collection = new URL(`${root}/files`);
    collection.searchParams.set("per_page", String(PULL_REQUEST_FILES_PER_PAGE));
    collection.searchParams.set("page", "1");
    let currentPage = 1;
    let url = new URL(collection);
    const visited = new Set<string>();
    const files: PullRequestRemoteFile[] = [];
    while (true) {
      if (currentPage > MAX_PULL_REQUEST_PAGES) {
        return { kind: "unavailable", reason: "diff-too-large" };
      }
      if (visited.has(url.toString()) || !exactPageQuery(url, currentPage)) {
        return { kind: "unavailable", reason: "api" };
      }
      visited.add(url.toString());
      const page = await this.fetchJson(url, signal);
      if (page.kind === "unavailable") return page;
      if (!Array.isArray(page.payload)) {
        return { kind: "unavailable", reason: "api" };
      }
      if (page.payload.length > PULL_REQUEST_FILES_PER_PAGE) {
        return {
          kind: "unavailable",
          reason: files.length + page.payload.length >= MAX_PULL_REQUEST_FILES
            ? "diff-too-large"
            : "api"
        };
      }
      for (const value of page.payload) {
        const file = parseFile(value);
        if (file === undefined) return { kind: "unavailable", reason: "api" };
        files.push(file);
        if (files.length > changedFiles) {
          return { kind: "unavailable", reason: "api" };
        }
        if (files.length >= MAX_PULL_REQUEST_FILES) {
          return { kind: "unavailable", reason: "diff-too-large" };
        }
      }
      const next = nextPage(page.response, url, collection, currentPage);
      if (next.kind === "invalid") return { kind: "unavailable", reason: "api" };
      if (next.kind === "none") break;
      if (page.payload.length === 0) {
        return { kind: "unavailable", reason: "api" };
      }
      currentPage = next.page;
      url = next.url;
    }
    if (files.length !== changedFiles) {
      return { kind: "unavailable", reason: "api" };
    }
    return { kind: "available", metadata: exactMetadata, files };
  }

  public async readFile(
    repository: GitHubRepositoryIdentity,
    revision: string,
    path: string,
    _feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<PullRequestRemoteTextReadResult> {
    const immutableRevision = requirePullRequestCommitObjectId(revision);
    const canonical = requireCanonicalRepositoryRelativePath(path, "posix", "repositoryRelativePath");
    const encodedPath = canonical.split("/").map(encodeURIComponent).join("/");
    const url = new URL(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/contents/${encodedPath}`
    );
    url.searchParams.set("ref", immutableRevision);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: this.headers("application/vnd.github.raw+json"),
        signal,
      });
    } catch {
      return { kind: "unavailable", reason: "network" };
    }
    if (response.status === 404) return { kind: "unavailable", reason: "missing-file" };
    const failure = classifyResponse(response);
    if (failure !== undefined) return { kind: "unavailable", reason: failure };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.includes(0)) return { kind: "binary" };
    try {
      return {
        kind: "found",
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      };
    } catch {
      return { kind: "binary" };
    }
  }

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      accept,
      "x-github-api-version": "2022-11-28",
      ...(this.token === undefined || this.token.length === 0 ? {} : { authorization: `Bearer ${this.token}` })
    };
  }

  private async fetchJson(url: URL, signal?: AbortSignal): Promise<
    | { readonly kind: "available"; readonly payload: unknown; readonly response: Response }
    | { readonly kind: "unavailable"; readonly reason: PullRequestDiffUnavailableReason }
  > {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, { headers: this.headers(), signal });
    } catch {
      return { kind: "unavailable", reason: "network" };
    }
    const failure = classifyResponse(response);
    if (failure !== undefined) return { kind: "unavailable", reason: failure };
    try {
      return { kind: "available", payload: await response.json(), response };
    } catch {
      return { kind: "unavailable", reason: "api" };
    }
  }
}

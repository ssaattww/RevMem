import type { PullRequestDiffSnapshot } from "../../core/pr-progress/index";
import {
  requirePullRequestDiffAcquisitionRequest,
  type PullRequestDiffAcquisitionAttempt,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestDiffAcquisitionResult,
  type PullRequestDiffAcquisitionSource,
  type PullRequestRemoteMetadata
} from "../github-pr-diff/index";

/** T402-compatible immutable pull-request diff acquisition boundary. */
export interface PullRequestDiffAcquisitionPort {
  acquire(request: PullRequestDiffAcquisitionRequest): Promise<PullRequestDiffAcquisitionResult>;
}

/** Persisted metadata and source-redacted diff for one exact pull-request comparison. */
export interface GitHubPullRequestCacheEntry {
  readonly schemaVersion: 1;
  readonly request: PullRequestDiffAcquisitionRequest;
  readonly metadata: PullRequestRemoteMetadata;
  readonly snapshot: PullRequestDiffSnapshot;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

/** Durable cache boundary selected by exact repository, pull request, and revision identity. */
export interface GitHubPullRequestCacheStorage {
  read(request: PullRequestDiffAcquisitionRequest): Promise<GitHubPullRequestCacheEntry | undefined>;
  write(entry: GitHubPullRequestCacheEntry): Promise<void>;
}

/** Constructor dependencies for the T403 cache-aware acquisition service. */
export interface GitHubPullRequestCacheServiceOptions {
  readonly acquisition: PullRequestDiffAcquisitionPort;
  readonly storage: GitHubPullRequestCacheStorage;
  readonly freshnessMs: number;
  readonly now?: () => Date;
}

export type GitHubPullRequestLiveCacheStatus =
  | {
      readonly origin: "live";
      readonly freshness: "fresh";
      readonly updatedAt: string;
      readonly expiresAt: string;
    }
  | {
      readonly origin: "live";
      readonly freshness: "not-cached";
    };

export interface GitHubPullRequestOfflineCacheStatus {
  readonly origin: "offline";
  readonly freshness: "fresh" | "stale";
  readonly updatedAt: string;
  readonly expiresAt: string;
}

/** Cache-aware acquisition result. Offline results retain the failed live attempts for diagnostics. */
export type GitHubPullRequestCacheAcquisitionResult =
  | {
      readonly kind: "acquired";
      readonly source: PullRequestDiffAcquisitionSource;
      readonly snapshot: PullRequestDiffSnapshot;
      readonly metadata?: PullRequestRemoteMetadata;
      readonly cache: GitHubPullRequestLiveCacheStatus;
    }
  | {
      readonly kind: "acquired";
      readonly source: "offline-cache";
      readonly snapshot: PullRequestDiffSnapshot;
      readonly metadata: PullRequestRemoteMetadata;
      readonly attempts: readonly PullRequestDiffAcquisitionAttempt[];
      readonly cache: GitHubPullRequestOfflineCacheStatus;
    }
  | {
      readonly kind: "unavailable";
      readonly attempts: readonly PullRequestDiffAcquisitionAttempt[];
    };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const sameRequest = (
  left: PullRequestDiffAcquisitionRequest,
  right: PullRequestDiffAcquisitionRequest
): boolean =>
  left.contextId === right.contextId &&
  left.repository.host === right.repository.host &&
  left.repository.owner === right.repository.owner &&
  left.repository.repository === right.repository.repository &&
  left.number === right.number &&
  left.baseSha === right.baseSha &&
  left.headSha === right.headSha;

const requestFromUnknown = (value: unknown): PullRequestDiffAcquisitionRequest | undefined => {
  if (!isObject(value) || !isObject(value.repository)) return undefined;
  const candidate: PullRequestDiffAcquisitionRequest = {
    contextId: value.contextId as string,
    repository: {
      host: value.repository.host as string,
      owner: value.repository.owner as string,
      repository: value.repository.repository as string
    },
    number: value.number as number,
    baseSha: value.baseSha as string,
    headSha: value.headSha as string
  };
  try {
    requirePullRequestDiffAcquisitionRequest(candidate);
    return candidate;
  } catch {
    return undefined;
  }
};

const metadataFromUnknown = (
  value: unknown,
  request: PullRequestDiffAcquisitionRequest
): PullRequestRemoteMetadata | undefined => {
  if (!isObject(value)) return undefined;
  if (
    !isPositiveSafeInteger(value.number) ||
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    (value.state !== "open" && value.state !== "closed" && value.state !== "merged") ||
    typeof value.baseSha !== "string" ||
    typeof value.headSha !== "string"
  ) return undefined;
  if (
    value.number !== request.number ||
    value.baseSha !== request.baseSha ||
    value.headSha !== request.headSha
  ) return undefined;
  return {
    number: value.number,
    title: value.title,
    url: value.url,
    state: value.state,
    baseSha: value.baseSha,
    headSha: value.headSha
  };
};

const snapshotFromUnknown = (
  value: unknown,
  request: PullRequestDiffAcquisitionRequest,
  requireRedactedText: boolean
): PullRequestDiffSnapshot | undefined => {
  if (!isObject(value) || !Array.isArray(value.files)) return undefined;
  if (
    value.contextId !== request.contextId ||
    value.baseSha !== request.baseSha ||
    value.headSha !== request.headSha ||
    value.originalDiffId !== `${request.baseSha}..${request.headSha}`
  ) return undefined;

  const files: PullRequestDiffSnapshot["files"][number][] = [];
  for (const unknownFile of value.files) {
    if (!isObject(unknownFile) || !Array.isArray(unknownFile.hunks)) return undefined;
    if (
      !isNonEmptyString(unknownFile.fileId) ||
      (unknownFile.oldPath !== undefined && typeof unknownFile.oldPath !== "string") ||
      (unknownFile.newPath !== undefined && typeof unknownFile.newPath !== "string") ||
      (unknownFile.status !== "added" &&
        unknownFile.status !== "modified" &&
        unknownFile.status !== "deleted" &&
        unknownFile.status !== "renamed" &&
        unknownFile.status !== "copied" &&
        unknownFile.status !== "binary") ||
      !isNonNegativeSafeInteger(unknownFile.additions) ||
      !isNonNegativeSafeInteger(unknownFile.deletions)
    ) return undefined;

    const hunks: PullRequestDiffSnapshot["files"][number]["hunks"][number][] = [];
    for (const unknownHunk of unknownFile.hunks) {
      if (!isObject(unknownHunk) || !Array.isArray(unknownHunk.lines)) return undefined;
      if (
        !isNonNegativeSafeInteger(unknownHunk.oldStart) ||
        !isNonNegativeSafeInteger(unknownHunk.oldCount) ||
        !isNonNegativeSafeInteger(unknownHunk.newStart) ||
        !isNonNegativeSafeInteger(unknownHunk.newCount)
      ) return undefined;
      const lines: PullRequestDiffSnapshot["files"][number]["hunks"][number]["lines"][number][] = [];
      for (const unknownLine of unknownHunk.lines) {
        if (!isObject(unknownLine)) return undefined;
        if (
          (unknownLine.kind !== "context" && unknownLine.kind !== "addition" && unknownLine.kind !== "deletion") ||
          (unknownLine.oldLine !== undefined && !isPositiveSafeInteger(unknownLine.oldLine)) ||
          (unknownLine.newLine !== undefined && !isPositiveSafeInteger(unknownLine.newLine)) ||
          typeof unknownLine.text !== "string" ||
          (requireRedactedText && unknownLine.text !== "")
        ) return undefined;
        if (
          (unknownLine.kind === "context" && (unknownLine.oldLine === undefined || unknownLine.newLine === undefined)) ||
          (unknownLine.kind === "addition" && (unknownLine.oldLine !== undefined || unknownLine.newLine === undefined)) ||
          (unknownLine.kind === "deletion" && (unknownLine.oldLine === undefined || unknownLine.newLine !== undefined))
        ) return undefined;
        lines.push({
          kind: unknownLine.kind,
          ...(unknownLine.oldLine === undefined ? {} : { oldLine: unknownLine.oldLine }),
          ...(unknownLine.newLine === undefined ? {} : { newLine: unknownLine.newLine }),
          text: unknownLine.text
        });
      }
      hunks.push({
        oldStart: unknownHunk.oldStart,
        oldCount: unknownHunk.oldCount,
        newStart: unknownHunk.newStart,
        newCount: unknownHunk.newCount,
        lines
      });
    }
    files.push({
      fileId: unknownFile.fileId,
      ...(unknownFile.oldPath === undefined ? {} : { oldPath: unknownFile.oldPath }),
      ...(unknownFile.newPath === undefined ? {} : { newPath: unknownFile.newPath }),
      status: unknownFile.status,
      additions: unknownFile.additions,
      deletions: unknownFile.deletions,
      hunks
    });
  }
  return {
    contextId: request.contextId,
    baseSha: request.baseSha,
    headSha: request.headSha,
    originalDiffId: `${request.baseSha}..${request.headSha}`,
    files
  };
};

const canonicalTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString() === value ? value : undefined;
};

/** Parses a cache entry and rejects incomplete, identity-mismatched, or source-bearing data. */
export const parseGitHubPullRequestCacheEntry = (
  value: unknown,
  expectedRequest?: PullRequestDiffAcquisitionRequest
): GitHubPullRequestCacheEntry | undefined => {
  if (!isObject(value) || value.schemaVersion !== 1) return undefined;
  const request = requestFromUnknown(value.request);
  if (request === undefined || (expectedRequest !== undefined && !sameRequest(request, expectedRequest))) {
    return undefined;
  }
  const metadata = metadataFromUnknown(value.metadata, request);
  const snapshot = snapshotFromUnknown(value.snapshot, request, true);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  const expiresAt = canonicalTimestamp(value.expiresAt);
  if (
    metadata === undefined ||
    snapshot === undefined ||
    updatedAt === undefined ||
    expiresAt === undefined ||
    Date.parse(expiresAt) < Date.parse(updatedAt)
  ) return undefined;
  return {
    schemaVersion: 1,
    request: cloneRequest(request),
    metadata: cloneMetadata(metadata),
    snapshot: cloneSnapshot(snapshot, false),
    updatedAt,
    expiresAt
  };
};

/** Stable unambiguous identity serialization used by cache adapters. */
export const serializeGitHubPullRequestCacheIdentity = (
  request: PullRequestDiffAcquisitionRequest
): string => {
  requirePullRequestDiffAcquisitionRequest(request);
  return JSON.stringify([
    request.contextId,
    request.repository.host,
    request.repository.owner,
    request.repository.repository,
    request.number,
    request.baseSha,
    request.headSha
  ]);
};

const cloneRequest = (request: PullRequestDiffAcquisitionRequest): PullRequestDiffAcquisitionRequest => ({
  contextId: request.contextId,
  repository: {
    host: request.repository.host,
    owner: request.repository.owner,
    repository: request.repository.repository
  },
  number: request.number,
  baseSha: request.baseSha,
  headSha: request.headSha
});

const cloneMetadata = (metadata: PullRequestRemoteMetadata): PullRequestRemoteMetadata => ({
  number: metadata.number,
  title: metadata.title,
  url: metadata.url,
  state: metadata.state,
  baseSha: metadata.baseSha,
  headSha: metadata.headSha
});

const cloneSnapshot = (
  snapshot: PullRequestDiffSnapshot,
  redactText: boolean
): PullRequestDiffSnapshot => ({
  contextId: snapshot.contextId,
  baseSha: snapshot.baseSha,
  headSha: snapshot.headSha,
  originalDiffId: snapshot.originalDiffId,
  files: snapshot.files.map(file => ({
    fileId: file.fileId,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    ...(file.newPath === undefined ? {} : { newPath: file.newPath }),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks.map(hunk => ({
      oldStart: hunk.oldStart,
      oldCount: hunk.oldCount,
      newStart: hunk.newStart,
      newCount: hunk.newCount,
      lines: hunk.lines.map(line => ({
        kind: line.kind,
        ...(line.oldLine === undefined ? {} : { oldLine: line.oldLine }),
        ...(line.newLine === undefined ? {} : { newLine: line.newLine }),
        text: redactText ? "" : line.text
      }))
    }))
  }))
});

const cloneEntry = (entry: GitHubPullRequestCacheEntry): GitHubPullRequestCacheEntry => ({
  schemaVersion: 1,
  request: cloneRequest(entry.request),
  metadata: cloneMetadata(entry.metadata),
  snapshot: cloneSnapshot(entry.snapshot, false),
  updatedAt: entry.updatedAt,
  expiresAt: entry.expiresAt
});

/** Deterministic storage for application and adapter contract tests. */
export class InMemoryGitHubPullRequestCacheStorage implements GitHubPullRequestCacheStorage {
  private readonly entries = new Map<string, GitHubPullRequestCacheEntry>();

  public async read(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<GitHubPullRequestCacheEntry | undefined> {
    const value = this.entries.get(serializeGitHubPullRequestCacheIdentity(request));
    if (value === undefined) return undefined;
    const validated = parseGitHubPullRequestCacheEntry(value, request);
    return validated === undefined ? undefined : cloneEntry(validated);
  }

  public async write(entry: GitHubPullRequestCacheEntry): Promise<void> {
    const validated = parseGitHubPullRequestCacheEntry(entry, entry.request);
    if (validated === undefined) throw new TypeError("Invalid GitHub pull-request cache entry");
    this.entries.set(
      serializeGitHubPullRequestCacheIdentity(validated.request),
      cloneEntry(validated)
    );
  }
}

const exactMetadata = (
  metadata: PullRequestRemoteMetadata,
  request: PullRequestDiffAcquisitionRequest
): boolean => metadataFromUnknown(metadata, request) !== undefined;

const exactSnapshot = (
  snapshot: PullRequestDiffSnapshot,
  request: PullRequestDiffAcquisitionRequest
): boolean => snapshotFromUnknown(snapshot, request, false) !== undefined;

const allowsOfflineFallback = (attempts: readonly PullRequestDiffAcquisitionAttempt[]): boolean =>
  attempts.some(attempt =>
    (attempt.source === "github-patch" || attempt.source === "github-content") &&
    (attempt.reason === "rate-limit" || attempt.reason === "network")
  );

const requireClockMilliseconds = (now: () => Date): number => {
  const date = now();
  const milliseconds = date.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError("now must return a valid non-negative safe Date");
  }
  return milliseconds;
};

/**
 * Adds exact-identity metadata/diff caching around T402 acquisition.
 * Only rate-limit and network failures may read the offline cache. Cache write
 * failures never discard a complete live result.
 */
export class GitHubPullRequestCacheService {
  private readonly acquisition: PullRequestDiffAcquisitionPort;
  private readonly storage: GitHubPullRequestCacheStorage;
  private readonly freshnessMs: number;
  private readonly now: () => Date;

  public constructor(options: GitHubPullRequestCacheServiceOptions) {
    if (!Number.isSafeInteger(options.freshnessMs) || options.freshnessMs <= 0) {
      throw new RangeError("freshnessMs must be a positive safe integer");
    }
    this.acquisition = options.acquisition;
    this.storage = options.storage;
    this.freshnessMs = options.freshnessMs;
    this.now = options.now ?? (() => new Date());
  }

  public async acquire(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    requirePullRequestDiffAcquisitionRequest(request);
    const live = await this.acquisition.acquire(request);
    if (live.kind === "acquired") {
      return this.acceptLive(request, live);
    }
    if (!allowsOfflineFallback(live.attempts)) return live;

    let cached: GitHubPullRequestCacheEntry | undefined;
    try {
      cached = await this.storage.read(request);
    } catch {
      return live;
    }
    const validated = cached === undefined
      ? undefined
      : parseGitHubPullRequestCacheEntry(cached, request);
    if (validated === undefined) return live;

    const currentMilliseconds = requireClockMilliseconds(this.now);
    return {
      kind: "acquired",
      source: "offline-cache",
      snapshot: cloneSnapshot(validated.snapshot, false),
      metadata: cloneMetadata(validated.metadata),
      attempts: live.attempts.map(attempt => ({ ...attempt })),
      cache: {
        origin: "offline",
        freshness: currentMilliseconds <= Date.parse(validated.expiresAt) ? "fresh" : "stale",
        updatedAt: validated.updatedAt,
        expiresAt: validated.expiresAt
      }
    };
  }

  private async acceptLive(
    request: PullRequestDiffAcquisitionRequest,
    live: Extract<PullRequestDiffAcquisitionResult, { readonly kind: "acquired" }>
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    if (
      live.metadata === undefined ||
      !exactMetadata(live.metadata, request) ||
      !exactSnapshot(live.snapshot, request)
    ) {
      return {
        ...live,
        snapshot: cloneSnapshot(live.snapshot, false),
        cache: { origin: "live", freshness: "not-cached" }
      };
    }

    const updatedMilliseconds = requireClockMilliseconds(this.now);
    const expiresMilliseconds = updatedMilliseconds + this.freshnessMs;
    if (!Number.isSafeInteger(expiresMilliseconds)) {
      throw new RangeError("cache expiry must be a safe integer timestamp");
    }
    const updatedAt = new Date(updatedMilliseconds).toISOString();
    const expiresAt = new Date(expiresMilliseconds).toISOString();
    const entry: GitHubPullRequestCacheEntry = {
      schemaVersion: 1,
      request: cloneRequest(request),
      metadata: cloneMetadata(live.metadata),
      snapshot: cloneSnapshot(live.snapshot, true),
      updatedAt,
      expiresAt
    };
    try {
      await this.storage.write(entry);
    } catch {
      return {
        ...live,
        snapshot: cloneSnapshot(live.snapshot, false),
        metadata: cloneMetadata(live.metadata),
        cache: { origin: "live", freshness: "not-cached" }
      };
    }
    return {
      ...live,
      snapshot: cloneSnapshot(live.snapshot, false),
      metadata: cloneMetadata(live.metadata),
      cache: {
        origin: "live",
        freshness: "fresh",
        updatedAt,
        expiresAt
      }
    };
  }
}

import {
  requirePullRequestDiffAcquisitionRequest,
  type PullRequestDiffAcquisitionAttempt,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestDiffAcquisitionResult
} from "../github-pr-diff/index";
import {
  cloneGitHubPullRequestCacheRequest,
  cloneGitHubPullRequestDiffSnapshot,
  cloneGitHubPullRequestMetadata,
  gitHubPullRequestCacheMetadataMatches,
  gitHubPullRequestCacheSnapshotMatches,
  parseGitHubPullRequestCacheEntry
} from "./cache-entry";
import type {
  GitHubPullRequestCacheAcquisitionResult,
  GitHubPullRequestCacheEntry,
  GitHubPullRequestCacheServiceOptions,
  GitHubPullRequestCacheStorage,
  PullRequestDiffAcquisitionPort
} from "./contracts";

const isOfflineFailure = (attempt: PullRequestDiffAcquisitionAttempt): boolean =>
  attempt.reason === "rate-limit" || attempt.reason === "network";

const isPatchFallbackPrecursor = (attempt: PullRequestDiffAcquisitionAttempt): boolean =>
  attempt.source === "github-patch" &&
  (attempt.reason === "missing-patch" || attempt.reason === "incomplete-patch");

const allowsOfflineFallback = (attempts: readonly PullRequestDiffAcquisitionAttempt[]): boolean => {
  const remoteAttempts = attempts.filter(attempt => attempt.source !== "local-git");
  const terminal = remoteAttempts[remoteAttempts.length - 1];
  if (terminal === undefined || !isOfflineFailure(terminal)) return false;

  return remoteAttempts.every((attempt, index) =>
    isOfflineFailure(attempt) ||
    (index < remoteAttempts.length - 1 && isPatchFallbackPrecursor(attempt))
  );
};

const requireClockMilliseconds = (now: () => Date): number => {
  const date = now();
  const milliseconds = date.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError("now must return a valid non-negative safe Date");
  }
  return milliseconds;
};

const requireIsoTimestamp = (milliseconds: number, name: string): string => {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`${name} must be a valid Date timestamp`);
  }
  return date.toISOString();
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
    const read = await this.acquireRead(request);
    return this.publish(request, read);
  }

  /**
   * Performs only idempotent remote/cache reads. Callers that retry a UI
   * acquisition must defer {@link publish} until the read has succeeded once.
   */
  public async acquireRead(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    requirePullRequestDiffAcquisitionRequest(request);
    const live = await this.acquisition.acquire(request);
    if (live.kind === "acquired") {
      return this.projectLive(request, live);
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
      snapshot: cloneGitHubPullRequestDiffSnapshot(validated.snapshot, false),
      metadata: cloneGitHubPullRequestMetadata(validated.metadata),
      attempts: live.attempts.map(attempt => ({ ...attempt })),
      cache: {
        origin: "offline",
        freshness: currentMilliseconds <= Date.parse(validated.expiresAt) ? "fresh" : "stale",
        updatedAt: validated.updatedAt,
        expiresAt: validated.expiresAt
      }
    };
  }

  /** Publishes one previously acquired exact live cache entry without reacquiring it. */
  public async publish(
    request: PullRequestDiffAcquisitionRequest,
    result: GitHubPullRequestCacheAcquisitionResult,
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    if (result.kind !== "acquired" || result.source === "offline-cache" || result.cache.origin !== "live" || result.metadata === undefined) return result;
    return this.acceptLive(request, {
      kind: "acquired",
      source: result.source,
      snapshot: result.snapshot,
      metadata: result.metadata,
    });
  }

  private projectLive(
    request: PullRequestDiffAcquisitionRequest,
    live: Extract<PullRequestDiffAcquisitionResult, { readonly kind: "acquired" }>,
  ): GitHubPullRequestCacheAcquisitionResult {
    if (
      live.metadata === undefined ||
      !gitHubPullRequestCacheMetadataMatches(live.metadata, request) ||
      !gitHubPullRequestCacheSnapshotMatches(live.snapshot, request)
    ) {
      return {
        ...live,
        snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
        cache: { origin: "live", freshness: "not-cached" }
      };
    }
    return {
      ...live,
      snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
      metadata: cloneGitHubPullRequestMetadata(live.metadata),
      cache: { origin: "live", freshness: "not-cached" },
    };
  }

  private async acceptLive(
    request: PullRequestDiffAcquisitionRequest,
    live: Extract<PullRequestDiffAcquisitionResult, { readonly kind: "acquired" }>
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    if (
      live.metadata === undefined ||
      !gitHubPullRequestCacheMetadataMatches(live.metadata, request) ||
      !gitHubPullRequestCacheSnapshotMatches(live.snapshot, request)
    ) {
      return {
        ...live,
        snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
        cache: { origin: "live", freshness: "not-cached" }
      };
    }

    const updatedMilliseconds = requireClockMilliseconds(this.now);
    const expiresMilliseconds = updatedMilliseconds + this.freshnessMs;
    if (!Number.isSafeInteger(expiresMilliseconds)) {
      throw new RangeError("cache expiry must be a safe integer timestamp");
    }
    const updatedAt = requireIsoTimestamp(updatedMilliseconds, "cache update");
    const expiresAt = requireIsoTimestamp(expiresMilliseconds, "cache expiry");
    const entry: GitHubPullRequestCacheEntry = {
      schemaVersion: 1,
      request: cloneGitHubPullRequestCacheRequest(request),
      metadata: cloneGitHubPullRequestMetadata(live.metadata),
      snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, true),
      updatedAt,
      expiresAt
    };
    try {
      await this.storage.write(entry);
    } catch {
      return {
        ...live,
        snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
        metadata: cloneGitHubPullRequestMetadata(live.metadata),
        cache: { origin: "live", freshness: "not-cached" }
      };
    }
    return {
      ...live,
      snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
      metadata: cloneGitHubPullRequestMetadata(live.metadata),
      cache: {
        origin: "live",
        freshness: "fresh",
        updatedAt,
        expiresAt
      }
    };
  }
}

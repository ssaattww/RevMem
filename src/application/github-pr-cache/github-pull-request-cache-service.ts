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
import type { OperationFeedbackContext } from "../operation-feedback/index";
import { reportActiveOperationStageDiagnostic } from "../operation-feedback/index";

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
 * Only rate-limit and network failures may read the offline cache. Callers may
 * treat cache publication as best-effort to retain a complete live result, or
 * require persistence and propagate the write failure.
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
    request: PullRequestDiffAcquisitionRequest,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    const read = await this.acquireRead(request, feedbackContext, signal);
    return this.publish(request, read, feedbackContext, signal);
  }

  /**
   * Performs only idempotent remote/cache reads. Callers that retry a UI
   * acquisition must defer {@link publish} until the read has succeeded once.
   */
  public async acquireRead(
    request: PullRequestDiffAcquisitionRequest,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    requirePullRequestDiffAcquisitionRequest(request);
    if (signal?.aborted) throw new DOMException("PR cache acquisition was superseded.", "AbortError");
    const live = await this.acquisition.acquire(request, feedbackContext, signal);
    if (signal?.aborted) throw new DOMException("PR cache acquisition was superseded.", "AbortError");
    if (live.kind === "acquired") {
      return this.projectLive(request, live);
    }
    if (!allowsOfflineFallback(live.attempts)) return live;

    let cached: GitHubPullRequestCacheEntry | undefined;
    reportActiveOperationStageDiagnostic("cache-read", undefined, feedbackContext, "started");
    try {
      cached = await this.storage.read(request, feedbackContext, signal);
    } catch (error) {
      if (signal?.aborted) {
        const cancelled = new DOMException("PR cache acquisition was superseded.", "AbortError");
        reportActiveOperationStageDiagnostic("cache-read", cancelled, feedbackContext, "cancelled");
        throw cancelled;
      }
      reportActiveOperationStageDiagnostic("cache-read", error, feedbackContext, "failed");
      return live;
    }
    if (signal?.aborted === true) {
      const cancelled = new DOMException("PR cache acquisition was superseded.", "AbortError");
      reportActiveOperationStageDiagnostic("cache-read", cancelled, feedbackContext, "cancelled");
      throw cancelled;
    }
    if (cached === undefined) {
      reportActiveOperationStageDiagnostic("cache-read", undefined, feedbackContext, "no-result");
      return live;
    }
    let validated: GitHubPullRequestCacheEntry | undefined;
    try {
      validated = parseGitHubPullRequestCacheEntry(cached, request);
    } catch (error) {
      reportActiveOperationStageDiagnostic("cache-read", error, feedbackContext, "failed");
      return live;
    }
    if (validated === undefined) {
      reportActiveOperationStageDiagnostic("cache-read", new Error("Stored PR cache entry is invalid or does not match the requested PR identity."), feedbackContext, "failed");
      return live;
    }
    reportActiveOperationStageDiagnostic("cache-read", undefined, feedbackContext, "succeeded");

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
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
    /** Preserve an exact live result only for callers where cache persistence is optional. */
    writeFailurePolicy: "throw" | "preserve-live" = "throw",
  ): Promise<GitHubPullRequestCacheAcquisitionResult> {
    if (result.kind !== "acquired" || result.source === "offline-cache" || result.cache.origin !== "live" || result.metadata === undefined) return result;
    return this.acceptLive(request, {
      kind: "acquired",
      source: result.source,
      snapshot: result.snapshot,
      metadata: result.metadata,
    }, feedbackContext, signal, writeFailurePolicy);
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
    live: Extract<PullRequestDiffAcquisitionResult, { readonly kind: "acquired" }>,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
    writeFailurePolicy: "throw" | "preserve-live" = "throw",
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
    if (signal?.aborted) throw new DOMException("PR cache publication was superseded.", "AbortError");
    reportActiveOperationStageDiagnostic("cache-persistence", undefined, feedbackContext, "started");
    try {
      await this.storage.write(entry, feedbackContext, signal);
    } catch (error) {
      if (signal?.aborted === true) {
        const cancelled = new DOMException("PR cache publication was superseded.", "AbortError");
        reportActiveOperationStageDiagnostic("cache-persistence", cancelled, feedbackContext, "cancelled");
        throw cancelled;
      }
      if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
        reportActiveOperationStageDiagnostic("cache-persistence", error, feedbackContext, "cancelled");
        throw error;
      }
      if (writeFailurePolicy === "throw") {
        reportActiveOperationStageDiagnostic("cache-persistence", error, feedbackContext, "failed");
        throw error;
      }
      reportActiveOperationStageDiagnostic("cache-persistence", error, feedbackContext, "degraded");
      return {
        ...live,
        snapshot: cloneGitHubPullRequestDiffSnapshot(live.snapshot, false),
        metadata: cloneGitHubPullRequestMetadata(live.metadata),
        cache: { origin: "live", freshness: "not-cached" },
      };
    }
    if (signal?.aborted) {
      const cancelled = new DOMException("PR cache publication was superseded.", "AbortError");
      reportActiveOperationStageDiagnostic("cache-persistence", cancelled, feedbackContext, "cancelled");
      throw cancelled;
    }
    reportActiveOperationStageDiagnostic("cache-persistence", undefined, feedbackContext, "succeeded");
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

import type { PullRequestDiffSnapshot } from "../../core/pr-progress/index";
import type {
  PullRequestDiffAcquisitionAttempt,
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffAcquisitionResult,
  PullRequestDiffAcquisitionSource,
  PullRequestRemoteMetadata
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

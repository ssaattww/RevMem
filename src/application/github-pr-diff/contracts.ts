import type { PullRequestFileChangeStatus } from "../../core/contracts/index";
import type { PullRequestDiffSnapshot } from "../../core/pr-progress/index";
import type { GitHubRepositoryIdentity } from "../github-pr-context/index";

/** Immutable identity required to acquire one exact pull-request comparison. */
export interface PullRequestDiffAcquisitionRequest {
  /** Stable review-context identity for the pull request. */
  readonly contextId: string;
  /** Canonical GitHub repository identity. */
  readonly repository: GitHubRepositoryIdentity;
  /** Positive pull-request number within the repository. */
  readonly number: number;
  /** Immutable base commit object ID. */
  readonly baseSha: string;
  /** Immutable head commit object ID. */
  readonly headSha: string;
}

/** Metadata returned for the exact pull request being acquired. */
export interface PullRequestRemoteMetadata {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly baseSha: string;
  readonly headSha: string;
}

/** One changed-file record returned by the pull-request files API. */
export interface PullRequestRemoteFile {
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly status: PullRequestFileChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  /** Unified patch body when GitHub returned a complete text patch. */
  readonly patch?: string;
}

/** Stable reason that one local or remote acquisition boundary was unavailable. */
export type PullRequestDiffUnavailableReason =
  | "git-unavailable"
  | "missing-revision"
  | "git-failure"
  | "rate-limit"
  | "authentication"
  | "network"
  | "api"
  | "missing-file"
  | "invalid-encoding"
  | "missing-patch"
  | "incomplete-patch"
  | "identity-mismatch"
  | "invalid-data"
  | "diff-too-large";

/** Local immutable base/head Git diff boundary. */
export interface LocalPullRequestDiffPort {
  loadDiff(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<
    | { readonly kind: "available"; readonly diff: string }
    | { readonly kind: "unavailable"; readonly reason: PullRequestDiffUnavailableReason }
  >;
}

/** Exact immutable content lookup result used by the content fallback. */
export type PullRequestRemoteTextReadResult =
  | { readonly kind: "found"; readonly content: string }
  | { readonly kind: "binary" }
  | { readonly kind: "unavailable"; readonly reason: PullRequestDiffUnavailableReason };

/** GitHub metadata, changed-file, and immutable content boundary. */
export interface PullRequestRemoteDataPort {
  fetch(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<
    | {
        readonly kind: "available";
        readonly metadata: PullRequestRemoteMetadata;
        readonly files: readonly PullRequestRemoteFile[];
      }
    | { readonly kind: "unavailable"; readonly reason: PullRequestDiffUnavailableReason }
  >;

  readFile(
    repository: GitHubRepositoryIdentity,
    revision: string,
    path: string
  ): Promise<PullRequestRemoteTextReadResult>;
}

/** Source that produced a complete validated snapshot. */
export type PullRequestDiffAcquisitionSource =
  | "local-git"
  | "github-patch"
  | "github-content";

/** One failed route retained for diagnostics without exposing a partial snapshot. */
export interface PullRequestDiffAcquisitionAttempt {
  readonly source: PullRequestDiffAcquisitionSource;
  readonly reason: PullRequestDiffUnavailableReason;
}

/** Fail-closed result of the three acquisition routes. */
export type PullRequestDiffAcquisitionResult =
  | {
      readonly kind: "acquired";
      readonly source: PullRequestDiffAcquisitionSource;
      readonly snapshot: PullRequestDiffSnapshot;
      /** Exact remote metadata when GitHub was consulted. */
      readonly metadata?: PullRequestRemoteMetadata;
    }
  | {
      readonly kind: "unavailable";
      readonly attempts: readonly PullRequestDiffAcquisitionAttempt[];
    };

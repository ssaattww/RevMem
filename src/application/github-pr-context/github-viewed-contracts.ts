import type { GitHubRepositoryIdentity } from "./contracts";
import type { PullRequestDiffFileProgress } from "../../core/pr-progress/index";

/** GitHub's per-viewer state for one changed pull-request file. */
export type GitHubViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

/** The identity of the authenticated GitHub viewer authorized for this target. */
export interface GitHubViewedViewer {
  readonly id: string;
  readonly login: string;
  readonly host: string;
}

/** The currently selected pull request and exact comparison identity. */
export interface GitHubViewedSelectedPullRequest {
  readonly nodeId: string;
  readonly number: number;
  readonly state: "open" | "closed" | "merged";
  readonly repository: GitHubRepositoryIdentity;
  readonly headSha: string;
  /** The exact comparison base used by the local PR snapshot, such as merge-base. */
  readonly comparisonBaseSha: string;
  readonly originalDiffId: string;
  readonly generation: number;
}

/** One exact entry from the complete GitHub changed-files result. */
export interface GitHubViewedChangedFile {
  readonly path: string;
  readonly status: PullRequestDiffFileProgress["status"];
  readonly additions: number;
  readonly deletions: number;
  readonly viewedState: GitHubViewedState;
}

/** A complete read result tied to the viewer, PR, comparison, and refresh generation. */
export interface GitHubViewedReadSnapshot {
  readonly viewerId: string;
  readonly repository: GitHubRepositoryIdentity;
  readonly pullRequestNodeId: string;
  readonly pullRequestNumber: number;
  readonly state: "open" | "closed" | "merged";
  readonly headSha: string;
  readonly comparisonBaseSha: string;
  readonly originalDiffId: string;
  readonly generation: number;
  readonly complete: boolean;
  readonly files: readonly GitHubViewedChangedFile[];
}

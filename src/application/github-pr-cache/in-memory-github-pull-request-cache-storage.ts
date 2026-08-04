import type { PullRequestDiffAcquisitionRequest } from "../github-pr-diff/index";
import {
  cloneGitHubPullRequestCacheEntry,
  parseGitHubPullRequestCacheEntry,
  serializeGitHubPullRequestCacheIdentity
} from "./cache-entry";
import type {
  GitHubPullRequestCacheEntry,
  GitHubPullRequestCacheStorage
} from "./contracts";

/** Deterministic storage for application and adapter contract tests. */
export class InMemoryGitHubPullRequestCacheStorage implements GitHubPullRequestCacheStorage {
  private readonly entries = new Map<string, GitHubPullRequestCacheEntry>();

  public async read(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<GitHubPullRequestCacheEntry | undefined> {
    const value = this.entries.get(serializeGitHubPullRequestCacheIdentity(request));
    if (value === undefined) return undefined;
    const validated = parseGitHubPullRequestCacheEntry(value, request);
    return validated === undefined
      ? undefined
      : cloneGitHubPullRequestCacheEntry(validated);
  }

  public async write(entry: GitHubPullRequestCacheEntry): Promise<void> {
    const validated = parseGitHubPullRequestCacheEntry(entry, entry.request);
    if (validated === undefined) throw new TypeError("Invalid GitHub pull-request cache entry");
    this.entries.set(
      serializeGitHubPullRequestCacheIdentity(validated.request),
      cloneGitHubPullRequestCacheEntry(validated)
    );
  }
}

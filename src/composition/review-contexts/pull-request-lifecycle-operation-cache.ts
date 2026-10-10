import type { GitHubPullRequestLifecycleResult } from "../../adapters/github/fetch-github-pull-request-lifecycle-adapter";
import {
  fetchGitHubPullRequestMergeBase,
  type GitHubPullRequestMergeBaseCacheGeneration,
  type GitHubPullRequestMergeBaseResultMap,
} from "../../adapters/github/fetch-github-pull-request-merge-base";
import type { OperationFeedback, OperationFeedbackContext } from "../../application/operation-feedback/operation-feedback";

export interface PullRequestLifecycleOperationCache {
  readonly lifecycleReads: Map<string, Promise<GitHubPullRequestLifecycleResult>>;
  readonly mergeBaseReads: Map<string, Promise<Awaited<ReturnType<typeof fetchGitHubPullRequestMergeBase>>>>;
  readonly mergeBaseResults: GitHubPullRequestMergeBaseResultMap;
  readonly mergeBaseGeneration: GitHubPullRequestMergeBaseCacheGeneration;
}

/** Drops account-bound PR reads before retrying after authentication reselection. */
export const clearPullRequestLifecycleOperationCache = (
  cache: PullRequestLifecycleOperationCache,
): void => {
  cache.mergeBaseGeneration.value += 1;
  cache.lifecycleReads.clear();
  cache.mergeBaseReads.clear();
  cache.mergeBaseResults.clear();
};

/** Owns read memoization for exactly one OperationFeedback owner/id scope. */
export class PullRequestLifecycleOperationCacheRegistry {
  private readonly caches = new WeakMap<OperationFeedback, Map<number, PullRequestLifecycleOperationCache>>();

  public forOperation(context?: OperationFeedbackContext): PullRequestLifecycleOperationCache {
    if (context === undefined) return this.createCache();
    let ownerCaches = this.caches.get(context.owner);
    if (ownerCaches === undefined) {
      ownerCaches = new Map();
      this.caches.set(context.owner, ownerCaches);
    }
    const existing = ownerCaches.get(context.id);
    if (existing !== undefined) return existing;

    const cache = this.createCache();
    ownerCaches.set(context.id, cache);
    const owner = context.owner;
    const operationId = context.id;
    owner.onOperationFinished(context, () => {
      const current = this.caches.get(owner);
      if (current?.get(operationId) !== cache) return;
      cache.mergeBaseGeneration.value += 1;
      current.delete(operationId);
      if (current.size === 0) this.caches.delete(owner);
    });
    return cache;
  }

  private createCache(): PullRequestLifecycleOperationCache {
    return {
      lifecycleReads: new Map(),
      mergeBaseReads: new Map(),
      mergeBaseResults: new Map(),
      mergeBaseGeneration: { value: 0 },
    };
  }
}

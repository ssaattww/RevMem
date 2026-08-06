import {
  GitHubPullRequestCacheService,
  InMemoryGitHubPullRequestCacheStorage,
  type GitHubPullRequestCacheAcquisitionResult,
  type PullRequestDiffAcquisitionPort
} from "../../src/application/github-pr-cache/index";
import type { PullRequestDiffAcquisitionRequest } from "../../src/application/github-pr-diff/index";
import { NodeGitHubPullRequestCacheStorage } from "../../src/adapters/github/index";

const request: PullRequestDiffAcquisitionRequest = {
  contextId: "github:github.com/example/review-range#42",
  repository: { host: "github.com", owner: "example", repository: "review-range" },
  number: 42,
  baseSha: "1111111111111111111111111111111111111111",
  headSha: "2222222222222222222222222222222222222222"
};

const acquisition: PullRequestDiffAcquisitionPort = {
  acquire: async () => ({
    kind: "unavailable",
    attempts: [
      { source: "local-git", reason: "missing-revision" },
      { source: "github-patch", reason: "network" },
      { source: "github-content", reason: "network" }
    ]
  })
};
const storage = new InMemoryGitHubPullRequestCacheStorage();
const service = new GitHubPullRequestCacheService({
  acquisition,
  storage,
  freshnessMs: 60_000
});
const result: Promise<GitHubPullRequestCacheAcquisitionResult> = service.acquire(request);
void result;
void new NodeGitHubPullRequestCacheStorage({ cacheDirectory: "/extension/cache" });

// @ts-expect-error A cache service must receive an explicit freshness duration.
void new GitHubPullRequestCacheService({ acquisition, storage });
// @ts-expect-error Cache acquisition requires the immutable pull-request request.
void service.acquire();

import {
  PullRequestDiffAcquisitionService,
  type LocalPullRequestDiffPort,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestRemoteDataPort
} from "../../src/application/github-pr-diff/index";
import { FetchGitHubPullRequestDiffAdapter } from "../../src/adapters/github/index";
import {
  LocalGitPullRequestDiffAdapter,
  type GitCommandExecutor
} from "../../src/adapters/local-git/index";

const request: PullRequestDiffAcquisitionRequest = {
  contextId: "github:github.com/example/review-range#42",
  repository: { host: "github.com", owner: "example", repository: "review-range" },
  number: 42,
  baseSha: "1111111111111111111111111111111111111111",
  headSha: "2222222222222222222222222222222222222222"
};
const local: LocalPullRequestDiffPort = {
  loadDiff: async () => ({ kind: "unavailable", reason: "missing-revision" })
};
const remote: PullRequestRemoteDataPort = {
  fetch: async () => ({ kind: "unavailable", reason: "network" }),
  readFile: async () => ({ kind: "unavailable", reason: "network" })
};
const service = new PullRequestDiffAcquisitionService({ local, remote });
void service.acquire(request);

const executor: GitCommandExecutor = {
  execute: async () => ({ exitCode: 0, stdout: "", stderr: "" })
};
void new LocalGitPullRequestDiffAdapter(executor, "/repository");
void new FetchGitHubPullRequestDiffAdapter({ apiBaseUrl: "https://api.github.com" });

// @ts-expect-error The immutable comparison requires a pull-request number.
const missingNumber: PullRequestDiffAcquisitionRequest = {
  contextId: request.contextId,
  repository: request.repository,
  baseSha: request.baseSha,
  headSha: request.headSha
};
void missingNumber;
// @ts-expect-error Every remote file read must identify an immutable revision and path.
remote.readFile(request.repository, request.baseSha);

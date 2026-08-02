import {
  GitHubPullRequestContextResolver,
  type GitHubPullRequestCandidate,
  type GitHubRepositoryIdentity
} from "../../src/application/github-pr-context/index";
import {
  FetchGitHubPullRequestAdapter,
  VsCodeGitHubAuthenticationProvider,
  gitHubApiBaseUrl,
  parseGitHubRemote
} from "../../src/adapters/github/index";

const repository: GitHubRepositoryIdentity = {
  host: "git.example.test:8443",
  owner: "Team",
  repository: "Review-Range"
};
const candidate: GitHubPullRequestCandidate = {
  baseRef: "main",
  baseSha: "89abcdef0123456789abcdef0123456789abcdef",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  number: 1,
  title: "T401",
  url: "https://git.example.test:8443/Team/Review-Range/pull/1"
};

const resolver = new GitHubPullRequestContextResolver({
  chooseCandidate: async () => candidate
});
const adapter = new FetchGitHubPullRequestAdapter({
  apiBaseUrl: gitHubApiBaseUrl(repository.host)
});
const authentication = new VsCodeGitHubAuthenticationProvider({
  getSession: async () => undefined
}, ["repo"], "https://git.example.test:8443");

void resolver.resolve([candidate]);
void adapter.findOpenByHead(repository, candidate.headSha);
void authentication.getAccessToken(repository.host);
const parsed = parseGitHubRemote("ssh://git@git.example.test:8443/Team/Review-Range.git");
const parsedAuthority: string | undefined = parsed?.host;
void parsedAuthority;

// @ts-expect-error A consumer must provide an API authority.
new FetchGitHubPullRequestAdapter({});
// @ts-expect-error Repository identity keeps the canonical authority mandatory.
const missingAuthority: GitHubRepositoryIdentity = { owner: "Team", repository: "Review-Range" };
void missingAuthority;

import { GITHUB_REQUEST_TIMEOUT_MS, runGitHubRequestWithTimeout } from "../../adapters/github/github-request-timeout";
import { findGitHubViewedGrant, readGitHubViewedIfAllowed } from "../../adapters/github/github-viewed-allowlist";
import { FetchGitHubPullRequestViewedIdentityAdapter } from "../../adapters/github/fetch-github-pull-request-viewed-identity-adapter";
import { FetchGitHubPullRequestViewedAdapter } from "../../adapters/github/fetch-github-pull-request-viewed-adapter";
import type { GitHubViewedReadSnapshot, GitHubViewedViewer } from "../../application/github-pr-context/github-viewed-contracts";
import { gitHubApiBaseUrl } from "../../adapters/github/git-remote";
import type { VsCodeGitHubAuthenticationProvider } from "../../adapters/github/vscode-github-authentication-provider";
import type { ReviewStateCommit, ReviewStateRepositoryTarget } from "../../adapters/state-repository/index";

export type GitHubViewedSelectionRead =
  | { readonly kind: "available"; readonly viewer: GitHubViewedViewer; readonly expectedViewerId: string; readonly read: GitHubViewedReadSnapshot }
  | { readonly kind: "unavailable" };

export interface GitHubViewedSelectionInput {
  readonly repositoryId: string;
  readonly contextId: string;
  readonly number: number;
  readonly headSha: string;
  readonly baseSha: string;
  readonly originalDiffId: string;
  readonly generation: number;
  readonly configured: unknown;
  readonly isCurrent: () => boolean;
  readonly signal: AbortSignal;
}

export const createGitHubViewedSelectionReader = (options: {
  readonly load: (target: ReviewStateRepositoryTarget) => Promise<ReviewStateCommit | undefined>;
  readonly auth: Pick<VsCodeGitHubAuthenticationProvider, "getSilentSession" | "isCurrentSession">;
  readonly fetch: typeof globalThis.fetch;
}) => async (input: GitHubViewedSelectionInput): Promise<GitHubViewedSelectionRead | undefined> => {
  if (!input.isCurrent() || input.signal.aborted) return undefined;
  const saved = await options.load({
    kind: "pull-request", repositoryId: input.repositoryId, contextId: input.contextId,
  });
  const pr = saved?.contextState.pullRequest;
  if (!input.isCurrent() || input.signal.aborted || saved?.contextState.kind !== "pull-request" ||
      pr?.state !== "open" || pr.number !== input.number || pr.headSha !== input.headSha ||
      pr.baseSha !== input.baseSha || input.originalDiffId !== input.baseSha + ".." + input.headSha) return undefined;
  const target = { host: pr.host, owner: pr.owner, repository: pr.repository };
  const grant = findGitHubViewedGrant(input.configured, target);
  if (grant === undefined) return undefined;
  const common = { apiBaseUrl: gitHubApiBaseUrl(pr.host), knownHosts: [pr.host], fetch: options.fetch };
  const stillSelected = () => input.isCurrent() && !input.signal.aborted;
  const unavailable = { kind: "unavailable" } as const;
  try {
    const gated = await runGitHubRequestWithTimeout(input.signal, GITHUB_REQUEST_TIMEOUT_MS, (signal) => readGitHubViewedIfAllowed({
      configured: input.configured,
      target,
      isCurrent: () => stillSelected() && !signal.aborted,
      getSilentSession: async () => {
        const session = await options.auth.getSilentSession(pr.host, undefined, signal);
        return session.kind === "available" && options.auth.isCurrentSession(session.binding) ? session : undefined;
      },
      readViewer: async (session) => {
        const current = () => stillSelected() && !signal.aborted && options.auth.isCurrentSession(session.binding);
        const identity = await new FetchGitHubPullRequestViewedIdentityAdapter(common).fetchIdentity({
          enabled: true, session, repository: target, pullRequestNumber: pr.number, headSha: pr.headSha,
          generation: input.generation, isCurrent: current, signal,
        });
        return identity.kind === "available" && current()
          ? { ...identity.viewer, nodeId: identity.pullRequest.nodeId }
          : undefined;
      },
      readFiles: async (session, viewer) => {
        const current = () => stillSelected() && !signal.aborted && options.auth.isCurrentSession(session.binding);
        if (!current()) return undefined;
        const result = await new FetchGitHubPullRequestViewedAdapter({ ...common, token: session.accessToken }).fetch({
          repository: target, expectedViewerId: grant.viewerId,
          selectedPullRequest: {
            nodeId: viewer.nodeId, number: pr.number, state: "open",
            repository: target, headSha: pr.headSha, comparisonBaseSha: input.baseSha,
            originalDiffId: input.originalDiffId, generation: input.generation,
          },
          isCurrent: current,
        }, signal);
        return result.kind === "available" && current() ? { kind: "available" as const, viewer, expectedViewerId: grant.viewerId, read: result.snapshot } : undefined;
      },
    }));
    if (!stillSelected() || gated.kind === "stale" || gated.kind === "not-allowed") return undefined;
    return gated.kind === "available" ? gated.value ?? unavailable : unavailable;
  } catch {
    return stillSelected() ? unavailable : undefined;
  }
};

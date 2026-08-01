import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import { normalizeGitRemoteUrl } from "../local-git/git-remote-normalization";

const fromCanonicalRemote = (canonicalRemote: string): GitHubRepositoryIdentity | undefined => {
  const segments = canonicalRemote.split("/");
  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    return undefined;
  }
  const [host, owner, repository] = segments;
  if (host!.startsWith("file:")) {
    return undefined;
  }
  return {
    host: host!,
    owner: owner!,
    repository: repository!
  };
};

/**
 * Returns a canonical GitHub authority with an optional non-default port.
 *
 * GitHub.com is represented as `github.com`; Enterprise authorities retain a
 * non-default HTTPS port so the API and authentication boundaries cannot
 * silently target a different server.
 */
export function canonicalGitHubAuthority(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      (parsed.pathname !== "" && parsed.pathname !== "/")
    ) {
      return undefined;
    }
    return parsed.port.length === 0
      ? parsed.hostname.toLowerCase()
      : `${parsed.hostname.toLowerCase()}:${parsed.port}`;
  } catch {
    return undefined;
  }
}

/** Parses GitHub remotes through T202's canonical remote identity policy. */
export function parseGitHubRemote(
  remoteUrl: string
): GitHubRepositoryIdentity | undefined {
  try {
    const parsed = fromCanonicalRemote(normalizeGitRemoteUrl(remoteUrl));
    if (parsed === undefined || canonicalGitHubAuthority(parsed.host) !== parsed.host) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Returns the REST API base URL for GitHub.com or GitHub Enterprise Server. */
export function gitHubApiBaseUrl(authority: string): string {
  const canonicalAuthority = canonicalGitHubAuthority(authority);
  if (canonicalAuthority === undefined) {
    throw new TypeError("GitHub API authority must be a canonical HTTPS authority");
  }
  return canonicalAuthority === "github.com"
    ? "https://api.github.com"
    : `https://${canonicalAuthority}/api/v3`;
}

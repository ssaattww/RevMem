import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";

const fromHostAndPath = (
  host: string,
  rawPath: string
): GitHubRepositoryIdentity | undefined => {
  const parts = rawPath.replace(/^\/+|\/+$/gu, "").split("/");
  if (parts.length !== 2 || parts.some(part => part.length === 0)) {
    return undefined;
  }
  const repository = parts[1]!.replace(/\.git$/u, "");
  if (repository.length === 0) {
    return undefined;
  }
  return {
    host: host.toLowerCase(),
    owner: parts[0]!,
    repository
  };
};

/** Parses HTTPS, SSH URL, and SCP-like GitHub remotes. */
export function parseGitHubRemote(
  remoteUrl: string
): GitHubRepositoryIdentity | undefined {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      if (
        parsed.protocol !== "https:" &&
        parsed.protocol !== "http:" &&
        parsed.protocol !== "ssh:" &&
        parsed.protocol !== "git:"
      ) {
        return undefined;
      }
      return fromHostAndPath(parsed.hostname, parsed.pathname);
    } catch {
      return undefined;
    }
  }

  const scpLike = /^(?:[^@\s]+@)?([^:/\s]+):([^\s]+)$/u.exec(trimmed);
  if (scpLike !== null && !/^[A-Za-z]:[\\/]/u.test(trimmed)) {
    return fromHostAndPath(scpLike[1]!, scpLike[2]!);
  }
  return undefined;
}

/** Returns the REST API base URL for GitHub.com or GitHub Enterprise Server. */
export function gitHubApiBaseUrl(host: string): string {
  return host.toLowerCase() === "github.com"
    ? "https://api.github.com"
    : `https://${host}/api/v3`;
}

const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const REPOSITORY_PATH_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u;

/** Canonicalizes and validates a hosted Git authority with an optional protocol default port. */
export function canonicalizeHostedGitAuthority(authorityInput: string, defaultPort?: number): string {
  const authority = authorityInput.trim().toLowerCase();
  if (authority.length === 0 || authority.includes("@") || authority.includes("/") || authority.includes("[") || authority.includes("]")) {
    throw new TypeError("Invalid hosted Git authority");
  }
  const pieces = authority.split(":");
  if (pieces.length > 2) throw new TypeError("Invalid hosted Git authority");
  const hostname = pieces[0]!;
  if (!HOSTNAME_PATTERN.test(hostname) || hostname.includes("..")) throw new TypeError("Invalid hosted Git authority");
  if (pieces.length === 1) return hostname;

  const rawPort = pieces[1]!;
  if (!/^[0-9]{1,5}$/u.test(rawPort)) throw new TypeError("Invalid hosted Git port");
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("Invalid hosted Git port");
  if (defaultPort !== undefined && port === defaultPort) return hostname;
  return `${hostname}:${port}`;
}

/**
 * Canonicalizes a hosted Git repository authority and owner/repository path.
 */
export function canonicalizeHostedGitRepositoryIdentity(hostInput: string, repositoryPathInput: string): string {
  const host = canonicalizeHostedGitAuthority(hostInput);
  let repositoryPath = repositoryPathInput.trim().replace(/^\/+|\/+$/gu, "");
  if (!REPOSITORY_PATH_PATTERN.test(repositoryPath)) throw new TypeError("Invalid hosted Git repository path");
  repositoryPath = repositoryPath.replace(/\.git$/iu, "");
  if (host === "github.com") repositoryPath = repositoryPath.toLowerCase();
  return `${host}/${repositoryPath}`;
}

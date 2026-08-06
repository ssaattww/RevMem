const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/u;
const REPOSITORY_PATH_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u;

/**
 * Canonicalizes a hosted Git repository authority and owner/repository path.
 * Protocol-specific default-port removal happens before this pure shared boundary.
 */
export function canonicalizeHostedGitRepositoryIdentity(hostInput: string, repositoryPathInput: string): string {
  const host = hostInput.trim().toLowerCase();
  if (!HOST_PATTERN.test(host) || host.includes("..")) throw new TypeError("Invalid hosted Git authority");

  const portSeparator = host.lastIndexOf(":");
  if (portSeparator >= 0) {
    const port = Number(host.slice(portSeparator + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("Invalid hosted Git port");
  }

  let repositoryPath = repositoryPathInput.trim().replace(/^\/+|\/+$/gu, "");
  if (!REPOSITORY_PATH_PATTERN.test(repositoryPath)) throw new TypeError("Invalid hosted Git repository path");
  repositoryPath = repositoryPath.replace(/\.git$/iu, "");
  if (host === "github.com") repositoryPath = repositoryPath.toLowerCase();

  return `${host}/${repositoryPath}`;
}

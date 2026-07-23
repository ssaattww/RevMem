import path from "node:path";
import { pathToFileURL } from "node:url";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const SCP_LIKE_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/;
const DEFAULT_PORT_BY_PROTOCOL: Readonly<Record<string, string>> = {
  "git:": "9418",
  "http:": "80",
  "https:": "443",
  "ssh:": "22"
};

const requireRemote = (remoteUrl: string): string => {
  const value = remoteUrl.trim();
  if (value.length === 0 || value.includes("\0")) {
    throw new TypeError("remoteUrl must be a non-empty string without null characters");
  }

  return value;
};

const normalizeRepositoryPath = (value: string): string => {
  let normalized = value.replaceAll("\\", "/");
  normalized = normalized.replace(/[?#].*$/u, "");
  normalized = normalized.replace(/^\/+|\/+$/gu, "");
  normalized = normalized.replace(/\/{2,}/gu, "/");
  normalized = normalized.replace(/\.git$/iu, "");

  if (normalized.length === 0) {
    throw new TypeError("remoteUrl must include a repository path");
  }

  return normalized;
};

const canonicalHostPath = (host: string, repositoryPath: string): string => {
  const normalizedHost = host.toLowerCase();
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  const hostAwarePath = normalizedHost === "github.com"
    ? normalizedPath.toLowerCase()
    : normalizedPath;

  return `${normalizedHost}/${hostAwarePath}`;
};

const canonicalFileUrl = (url: URL): string => {
  const authority = url.hostname.toLowerCase();
  const repositoryPath = normalizeRepositoryPath(url.pathname);
  return authority.length === 0
    ? `file:///${repositoryPath}`
    : `file://${authority}/${repositoryPath}`;
};

const normalizeFileRemote = (source: string, repositoryRoot: string): string => {
  const resolvedPath = path.resolve(repositoryRoot, source);
  return canonicalFileUrl(pathToFileURL(resolvedPath));
};

const normalizedUrlHost = (url: URL): string => {
  const defaultPort = DEFAULT_PORT_BY_PROTOCOL[url.protocol];
  const port = url.port === defaultPort ? "" : url.port;
  return port.length === 0 ? url.hostname : `${url.hostname}:${port}`;
};

/**
 * Normalizes a Git remote into a credential-free repository identity.
 *
 * SCP-style SSH and URL-style remotes are reduced to `host/path`. GitHub paths
 * are lowercased because GitHub repository names are case-insensitive. Default
 * protocol ports are omitted. Local path remotes are resolved from the
 * repository root and rendered as file URLs. UNC file URLs retain their server
 * authority so separate network repositories cannot collide.
 *
 * @param remoteUrl Exact value returned by `git remote get-url`.
 * @param repositoryRoot Repository root used only for local-path remotes.
 * @returns Canonical remote identity without credentials, query, fragment, or `.git`.
 * @throws {TypeError} If the remote is empty or cannot identify a repository path.
 */
export function normalizeGitRemoteUrl(
  remoteUrl: string,
  repositoryRoot?: string
): string {
  const source = requireRemote(remoteUrl);

  if (!WINDOWS_ABSOLUTE_PATH.test(source)) {
    const scpMatch = SCP_LIKE_REMOTE.exec(source);
    if (scpMatch !== null && !source.includes("://")) {
      return canonicalHostPath(scpMatch[1]!, scpMatch[2]!);
    }
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol === "file:") {
      return canonicalFileUrl(parsed);
    }

    if (parsed.hostname.length === 0) {
      throw new TypeError("remoteUrl must include a host");
    }

    return canonicalHostPath(normalizedUrlHost(parsed), parsed.pathname);
  } catch (error) {
    if (
      error instanceof TypeError &&
      !WINDOWS_ABSOLUTE_PATH.test(source) &&
      /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source)
    ) {
      throw error;
    }
  }

  if (repositoryRoot === undefined || repositoryRoot.trim().length === 0) {
    throw new TypeError(
      "repositoryRoot is required to normalize a local-path remote"
    );
  }

  return normalizeFileRemote(source, repositoryRoot);
}

import { canonicalGitHubAuthority } from "./git-remote";

export interface GitHubViewedAllowlistEntry {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly login: string;
  readonly viewerId: string;
}

export interface GitHubViewedTarget {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isLiteral = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[/?*]/u.test(value);

const sameName = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/** Returns a grant only for one valid, exact host/owner/repository tuple. */
export function findGitHubViewedGrant(
  configured: unknown,
  target: GitHubViewedTarget
): GitHubViewedAllowlistEntry | undefined {
  const targetHost = canonicalGitHubAuthority(target.host);
  // Phase 1 has no trusted binding for Enterprise provider hosts.
  if (!Array.isArray(configured) || targetHost !== "github.com" ||
      !isLiteral(target.owner) || !isLiteral(target.repository)) return undefined;

  const matches: GitHubViewedAllowlistEntry[] = [];
  for (const value of configured) {
    if (!isRecord(value)) continue;
    const { host, owner, repository, login, viewerId } = value;
    if (!isLiteral(host) || !isLiteral(owner) ||
        !isLiteral(repository) || !isLiteral(login) ||
        typeof viewerId !== "string" || viewerId.length === 0 || /\s/u.test(viewerId)) continue;

    // Settings accept a host, not a URL, path, wildcard, or alternate origin.
    const canonicalHost = canonicalGitHubAuthority(host);
    if (canonicalHost !== host || canonicalHost !== targetHost) continue;
    if (!sameName(owner, target.owner) || !sameName(repository, target.repository)) continue;
    matches.push({ host: canonicalHost, owner, repository, login, viewerId });
  }

  return matches.length === 1 ? matches[0] : undefined;
}

/** GitHub login matching is case-insensitive; whitespace is rejected. */
export function matchesGitHubViewedLogin(
  grant: GitHubViewedAllowlistEntry,
  viewerLogin: unknown
): viewerLogin is string {
  return isLiteral(viewerLogin) && sameName(grant.login, viewerLogin);
}

export type GitHubViewedGateResult<T> =
  | { readonly kind: "stale" }
  | { readonly kind: "not-allowed" }
  | { readonly kind: "no-session" }
  | { readonly kind: "viewer-mismatch" }
  | { readonly kind: "available"; readonly grant: GitHubViewedAllowlistEntry; readonly value: T };

/**
 * Enforces ordering: allowlist → silent session → viewer login → file-list read.
 * The identical session value is passed to both callbacks.
 */
export async function readGitHubViewedIfAllowed<Session, Viewer extends {
  readonly id: string;
  readonly login: string;
}, Value>(input: {
  readonly configured: unknown;
  readonly target: GitHubViewedTarget;
  readonly isCurrent?: () => boolean;
  readonly getSilentSession: () => Promise<Session | undefined>;
  readonly readViewer: (session: Session) => Promise<Viewer | undefined>;
  readonly readFiles: (session: Session, expectedViewer: Viewer) => Promise<Value>;
}): Promise<GitHubViewedGateResult<Value>> {
  const current = (): boolean => input.isCurrent?.() !== false;
  if (!current()) return { kind: "stale" };
  const grant = findGitHubViewedGrant(input.configured, input.target);
  if (grant === undefined) return { kind: "not-allowed" };

  const session = await input.getSilentSession();
  if (!current()) return { kind: "stale" };
  if (session === undefined) return { kind: "no-session" };

  const viewer = await input.readViewer(session);
  if (!current()) return { kind: "stale" };
  if (viewer === undefined || viewer.id !== grant.viewerId || !matchesGitHubViewedLogin(grant, viewer.login)) {
    return { kind: "viewer-mismatch" };
  }

  const value = await input.readFiles(session, viewer);
  return current() ? { kind: "available", grant, value } : { kind: "stale" };
}

/**
 * Platform-neutral URI components equivalent to the stable parts of `vscode.Uri`.
 */
export interface ResourceUri {
  /** URI scheme such as `file` or `vscode-remote`. */
  readonly scheme: string;
  /** URI authority such as a remote Extension Host identifier. */
  readonly authority?: string;
  /** Absolute URI path using either slash style at the adapter boundary. */
  readonly path: string;
  /** Optional URI query retained in the canonical resource URI. */
  readonly query?: string;
  /** Optional URI fragment retained in the canonical resource URI. */
  readonly fragment?: string;
}

/**
 * Stable hashing contract supplied by the runtime adapter.
 */
export interface StableHash {
  /**
   * Hashes UTF-8 text to a lowercase 64-character SHA-256 hexadecimal digest.
   */
  digest(value: string): string;
}

/**
 * Inputs required to identify one non-Git workspace file.
 */
export interface WorkspaceIdentityInput {
  /** Workspace folder that owns the document. */
  readonly workspaceFolderUri: ResourceUri;
  /** URI of the document being identified. */
  readonly documentUri: ResourceUri;
  /** Workspace-folder-relative path reported by the workspace adapter. */
  readonly relativePath: string;
}

/**
 * Stable identities used by non-Git workspace review state.
 */
export interface WorkspaceIdentity {
  /** Canonical workspace folder URI used as the identity source. */
  readonly canonicalWorkspaceUri: string;
  /** Canonical document URI validated against the workspace folder. */
  readonly canonicalDocumentUri: string;
  /** Normalized slash-separated workspace-folder-relative file path. */
  readonly relativePath: string;
  /** Repository identity used by common state contracts for a non-Git root. */
  readonly repositoryId: string;
  /** Stable non-Git workspace identity stored in `WorkspaceReviewContext`. */
  readonly workspaceId: string;
  /** Stable review-context identity for the non-Git workspace. */
  readonly workspaceContextId: string;
  /** Stable file identity within the non-Git workspace root. */
  readonly fileId: string;
}

interface CanonicalResourceUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly caseInsensitivePath: boolean;
  readonly value: string;
}

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const WINDOWS_DRIVE_PATH_PATTERN = /^\/[A-Za-z]:(?:\/|$)/;
const WINDOWS_RELATIVE_DRIVE_PATTERN = /^[A-Za-z]:(?:\/|$)/;
const WINDOWS_DRIVE_SEGMENT_PATTERN = /^[A-Za-z]:$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }

  if (value.includes("\0")) {
    throw new TypeError(`${name} must not contain a null character.`);
  }

  return value;
}

function normalizeScheme(value: unknown): string {
  const scheme = requireString(value, "URI scheme").toLowerCase();

  if (!URI_SCHEME_PATTERN.test(scheme)) {
    throw new TypeError("URI scheme must be a valid non-empty scheme.");
  }

  return scheme;
}

function normalizeAuthority(value: unknown): string {
  const authority = requireString(value ?? "", "URI authority").toLowerCase();

  if (/[/\\?#]/.test(authority)) {
    throw new TypeError("URI authority must not contain path or suffix delimiters.");
  }

  return authority;
}

function normalizeAbsoluteUriPath(value: unknown): string {
  const source = requireString(value, "URI path").replaceAll("\\", "/");
  const withLeadingSlash = WINDOWS_RELATIVE_DRIVE_PATTERN.test(source)
    ? `/${source}`
    : source;

  if (!withLeadingSlash.startsWith("/")) {
    throw new TypeError("URI path must be absolute.");
  }

  const segments: string[] = [];

  for (const segment of withLeadingSlash.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        throw new TypeError("URI path must not escape its root.");
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function isWindowsFileUri(
  scheme: string,
  authority: string,
  normalizedPath: string
): boolean {
  return (
    scheme === "file" &&
    (authority.length > 0 || WINDOWS_DRIVE_PATH_PATTERN.test(normalizedPath))
  );
}

function encodeCanonicalPath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      WINDOWS_DRIVE_SEGMENT_PATTERN.test(segment)
        ? `${segment[0]}:`
        : encodeURIComponent(segment)
    )
    .join("/");
}

function renderCanonicalUri(
  scheme: string,
  authority: string,
  path: string,
  query: string,
  fragment: string
): string {
  let value = `${scheme}://${authority}${encodeCanonicalPath(path)}`;

  if (query.length > 0) {
    value += `?${encodeURIComponent(query)}`;
  }

  if (fragment.length > 0) {
    value += `#${encodeURIComponent(fragment)}`;
  }

  return value;
}

function canonicalizeResourceUri(uri: ResourceUri): CanonicalResourceUri {
  const scheme = normalizeScheme(uri.scheme);
  const authority = normalizeAuthority(uri.authority);
  const normalizedPath = normalizeAbsoluteUriPath(uri.path);
  const caseInsensitivePath = isWindowsFileUri(scheme, authority, normalizedPath);
  const path = caseInsensitivePath ? normalizedPath.toLowerCase() : normalizedPath;
  const query = requireString(uri.query ?? "", "URI query");
  const fragment = requireString(uri.fragment ?? "", "URI fragment");

  return {
    scheme,
    authority,
    path,
    query,
    fragment,
    caseInsensitivePath,
    value: renderCanonicalUri(scheme, authority, path, query, fragment)
  };
}

function normalizeRelativePath(value: unknown, caseInsensitive: boolean): string {
  const source = requireString(value, "relativePath").replaceAll("\\", "/");

  if (
    source.length === 0 ||
    source.startsWith("/") ||
    WINDOWS_RELATIVE_DRIVE_PATTERN.test(source)
  ) {
    throw new TypeError("relativePath must be a non-empty relative path.");
  }

  const segments: string[] = [];

  for (const segment of source.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        throw new TypeError("relativePath must not escape the workspace folder.");
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new TypeError("relativePath must identify a file below the workspace folder.");
  }

  const normalized = segments.join("/");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function relativeDocumentPath(
  workspaceFolder: CanonicalResourceUri,
  document: CanonicalResourceUri
): string {
  if (
    workspaceFolder.scheme !== document.scheme ||
    workspaceFolder.authority !== document.authority
  ) {
    throw new TypeError(
      "Document and workspace URI scheme and authority must match."
    );
  }

  const prefix = workspaceFolder.path === "/"
    ? "/"
    : `${workspaceFolder.path}/`;

  if (!document.path.startsWith(prefix)) {
    throw new TypeError("Document URI must be inside the workspace folder.");
  }

  return normalizeRelativePath(
    document.path.slice(prefix.length),
    workspaceFolder.caseInsensitivePath
  );
}

/**
 * Resolves stable, domain-separated identities for non-Git workspace state.
 */
export class WorkspaceIdentityService {
  public constructor(private readonly stableHash: StableHash) {}

  /**
   * Canonicalizes and validates one workspace file, then generates all stable IDs.
   *
   * @throws {TypeError} If URI components are invalid, the document is outside the
   * workspace folder, or the supplied relative path does not identify the document.
   * @throws {Error} If the hash adapter violates the SHA-256 hexadecimal contract.
   */
  public resolve(input: WorkspaceIdentityInput): WorkspaceIdentity {
    const workspaceFolder = canonicalizeResourceUri(input.workspaceFolderUri);
    const document = canonicalizeResourceUri(input.documentUri);
    const relativePath = normalizeRelativePath(
      input.relativePath,
      workspaceFolder.caseInsensitivePath
    );
    const derivedRelativePath = relativeDocumentPath(workspaceFolder, document);

    if (relativePath !== derivedRelativePath) {
      throw new TypeError(
        "relativePath does not match the document URI within the workspace folder."
      );
    }

    const repositoryId = this.createId(
      "non-git-repository",
      workspaceFolder.value
    );
    const workspaceId = this.createId("workspace", workspaceFolder.value);
    const workspaceContextId = this.createId(
      "workspace-context",
      repositoryId
    );
    const fileId = this.createId("workspace-file", repositoryId, relativePath);

    return {
      canonicalWorkspaceUri: workspaceFolder.value,
      canonicalDocumentUri: document.value,
      relativePath,
      repositoryId,
      workspaceId,
      workspaceContextId,
      fileId
    };
  }

  private createId(domain: string, ...parts: readonly string[]): string {
    const digest = this.stableHash.digest([domain, ...parts].join("\0"));

    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }

    return `${domain}:${digest}`;
  }
}

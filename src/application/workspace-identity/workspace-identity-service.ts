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
  /** Optional URI query. Workspace file identity rejects a non-empty value. */
  readonly query?: string;
  /** Optional URI fragment. Workspace file identity rejects a non-empty value. */
  readonly fragment?: string;
}

/**
 * Filesystem path semantics supplied by the workspace-side Extension Host.
 *
 * The adapter must identify the workspace filesystem, rather than the local
 * extension process platform. In particular, a remote Windows workspace must
 * supply `"windows"` even when this service runs outside Windows.
 */
export type FileSystemPathSemantics = "windows" | "posix";

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
  /**
   * Workspace folder that owns the document. Its query and fragment must be
   * empty because this service identifies filesystem workspace files.
   */
  readonly workspaceFolderUri: ResourceUri;
  /**
   * URI of the document being identified. Its query and fragment must be empty
   * because they are not part of a filesystem file identity.
   */
  readonly documentUri: ResourceUri;
  /**
   * Filesystem semantics selected by the workspace-side Extension Host.
   * Applied consistently to both URIs and `relativePath`.
   */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Workspace-folder-relative path reported using the selected semantics. */
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
  readonly pathSemantics: FileSystemPathSemantics;
  readonly value: string;
}

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/;
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

function normalizeFileSystemPathSemantics(
  value: unknown
): FileSystemPathSemantics {
  if (value === "windows" || value === "posix") {
    return value;
  }

  throw new TypeError(
    'fileSystemPathSemantics must be either "windows" or "posix".'
  );
}

function normalizeAbsoluteUriPath(
  value: unknown,
  pathSemantics: FileSystemPathSemantics
): string {
  const source = pathSemantics === "windows"
    ? requireString(value, "URI path").replaceAll("\\", "/")
    : requireString(value, "URI path");
  const withLeadingSlash =
    pathSemantics === "windows" && WINDOWS_RELATIVE_DRIVE_PATTERN.test(source)
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
  path: string
): string {
  return `${scheme}://${authority}${encodeCanonicalPath(path)}`;
}

function canonicalizeResourceUri(
  uri: ResourceUri,
  pathSemantics: FileSystemPathSemantics
): CanonicalResourceUri {
  const scheme = normalizeScheme(uri.scheme);
  const authority = normalizeAuthority(uri.authority);
  const normalizedPath = normalizeAbsoluteUriPath(uri.path, pathSemantics);
  const path = pathSemantics === "windows"
    ? normalizedPath.toLowerCase()
    : normalizedPath;
  const query = requireString(uri.query ?? "", "URI query");
  const fragment = requireString(uri.fragment ?? "", "URI fragment");

  if (query.length > 0 || fragment.length > 0) {
    throw new TypeError(
      "Workspace file URI query or fragment must be empty."
    );
  }

  return {
    scheme,
    authority,
    path,
    pathSemantics,
    value: renderCanonicalUri(scheme, authority, path)
  };
}

function normalizeRelativePath(
  value: unknown,
  pathSemantics: FileSystemPathSemantics
): string {
  const source = pathSemantics === "windows"
    ? requireString(value, "relativePath").replaceAll("\\", "/")
    : requireString(value, "relativePath");

  if (
    source.length === 0 ||
    source.startsWith("/") ||
    (pathSemantics === "windows" && WINDOWS_RELATIVE_DRIVE_PATTERN.test(source))
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
  return pathSemantics === "windows" ? normalized.toLowerCase() : normalized;
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
    workspaceFolder.pathSemantics
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
    const pathSemantics = normalizeFileSystemPathSemantics(
      input.fileSystemPathSemantics
    );
    const workspaceFolder = canonicalizeResourceUri(
      input.workspaceFolderUri,
      pathSemantics
    );
    const document = canonicalizeResourceUri(input.documentUri, pathSemantics);
    const relativePath = normalizeRelativePath(
      input.relativePath,
      pathSemantics
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

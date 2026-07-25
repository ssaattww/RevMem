import { TextDecoder } from "node:util";

import type { FileSystemPathSemantics } from "../workspace-identity/index";
import type {
  ReviewDiffDocumentDescriptor,
  ReviewDiffRevisionSource
} from "./contracts";

const REVIEW_DIFF_SCHEME = "review-range-diff";
const REVIEW_DIFF_AUTHORITY = "document";
const REVIEW_DIFF_VERSION = "v1";
const MAX_URI_LENGTH = 65_536;
const MAX_CONTEXT_ID_BYTES = 8_192;
const MAX_FILE_PATH_BYTES = 32_768;
const BASE64_URL_TOKEN = /^[A-Za-z0-9_-]+$/u;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Stable machine-readable reason for URI codec failures. */
export type ReviewDiffUriCodecErrorCode =
  | "invalid-review-diff-descriptor"
  | "invalid-review-diff-uri";

/** Error raised when a descriptor or virtual URI violates the canonical T302 contract. */
export class ReviewDiffUriCodecError extends Error {
  public constructor(
    public readonly code: ReviewDiffUriCodecErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ReviewDiffUriCodecError";
  }
}

const descriptorError = (message: string): ReviewDiffUriCodecError =>
  new ReviewDiffUriCodecError("invalid-review-diff-descriptor", message);

const uriError = (message: string, cause?: unknown): ReviewDiffUriCodecError =>
  new ReviewDiffUriCodecError("invalid-review-diff-uri", message, {
    ...(cause === undefined ? {} : { cause })
  });

const containsControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

const containsUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) {
        return true;
      }
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const requireWellFormedField = (
  value: string,
  name: string,
  maxBytes: number,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  if (value.length === 0) {
    throw failure(`${name} must not be empty`);
  }
  if (containsUnpairedSurrogate(value)) {
    throw failure(`${name} must be well-formed UTF-16`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw failure(`${name} exceeds the supported UTF-8 size`);
  }
  return value;
};

const validateContextId = (
  value: string,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  const contextId = requireWellFormedField(
    value,
    "contextId",
    MAX_CONTEXT_ID_BYTES,
    failure
  );
  if (containsControlCharacter(contextId)) {
    throw failure("contextId must not contain control characters");
  }
  return contextId;
};

const validatePathSemantics = (
  value: FileSystemPathSemantics,
  failure: (message: string) => ReviewDiffUriCodecError
): FileSystemPathSemantics => {
  if (value !== "posix" && value !== "windows") {
    throw failure("fileSystemPathSemantics must be posix or windows");
  }
  return value;
};

const hasWindowsInvalidCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const character = value[index]!;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      character === "<" ||
      character === ">" ||
      character === ":" ||
      character === '"' ||
      character === "\\" ||
      character === "|" ||
      character === "?" ||
      character === "*"
    ) {
      return true;
    }
  }
  return false;
};

const validateFilePath = (
  value: string,
  semantics: FileSystemPathSemantics,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  const filePath = requireWellFormedField(
    value,
    "filePath",
    MAX_FILE_PATH_BYTES,
    failure
  );
  if (filePath.includes("\0")) {
    throw failure("filePath must not contain a null character");
  }
  const segments = filePath.split("/");
  if (
    filePath.startsWith("/") ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw failure("filePath must be a canonical repository-relative path");
  }
  if (
    semantics === "windows" &&
    (hasWindowsInvalidCharacter(filePath) ||
      /^[A-Za-z]:/u.test(filePath) ||
      segments.some((segment) => /[. ]$/u.test(segment)))
  ) {
    throw failure("filePath is invalid under Windows path semantics");
  }
  return filePath;
};

const validateRevisionSource = (
  value: ReviewDiffRevisionSource,
  failure: (message: string) => ReviewDiffUriCodecError
): ReviewDiffRevisionSource => {
  if (value !== "git-commit") {
    throw failure("revisionSource must be git-commit");
  }
  return value;
};

const validateRevision = (
  value: string,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  if (!FULL_OBJECT_ID_PATTERN.test(value)) {
    throw failure(
      "revision must be a lowercase full SHA-1 or SHA-256 commit object ID"
    );
  }
  return value;
};

const encodeField = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const decodeField = (
  token: string,
  name: string,
  maxBytes: number
): string => {
  if (!BASE64_URL_TOKEN.test(token)) {
    throw uriError(`${name} is not canonical base64url`);
  }

  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length === 0 || bytes.length > maxBytes) {
      throw uriError(`${name} has an unsupported encoded size`);
    }
    if (bytes.toString("base64url") !== token) {
      throw uriError(`${name} is not canonical base64url`);
    }
    return utf8Decoder.decode(bytes);
  } catch (error) {
    if (error instanceof ReviewDiffUriCodecError) {
      throw error;
    }
    throw uriError(`${name} is not valid UTF-8`, error);
  }
};

const validateDescriptor = (
  descriptor: ReviewDiffDocumentDescriptor,
  failure: (message: string) => ReviewDiffUriCodecError
): ReviewDiffDocumentDescriptor => {
  const contextId = validateContextId(descriptor.contextId, failure);
  const fileSystemPathSemantics = validatePathSemantics(
    descriptor.fileSystemPathSemantics,
    failure
  );
  const filePath = validateFilePath(
    descriptor.filePath,
    fileSystemPathSemantics,
    failure
  );
  if (descriptor.side !== "original" && descriptor.side !== "modified") {
    throw failure("side must be original or modified");
  }
  const revisionSource = validateRevisionSource(
    descriptor.revisionSource,
    failure
  );
  const revision = validateRevision(descriptor.revision, failure);

  return {
    contextId,
    filePath,
    fileSystemPathSemantics,
    side: descriptor.side,
    revisionSource,
    revision
  };
};

/**
 * Encodes immutable review-diff document identity into one strict, versioned URI.
 *
 * Variable text fields use canonical base64url, while filesystem semantics and
 * revision source are explicit path segments. POSIX-only filename characters can
 * round-trip without weakening Windows path validation or context isolation.
 */
export class ReviewDiffUriCodec {
  /** Encodes one descriptor using the canonical `review-range-diff://document/v1` form. */
  public encode(descriptor: ReviewDiffDocumentDescriptor): string {
    const valid = validateDescriptor(descriptor, descriptorError);
    const uri = `${REVIEW_DIFF_SCHEME}://${REVIEW_DIFF_AUTHORITY}/${REVIEW_DIFF_VERSION}/${encodeField(valid.contextId)}/${valid.fileSystemPathSemantics}/${valid.side}/${valid.revisionSource}/${encodeField(valid.revision)}/${encodeField(valid.filePath)}`;
    if (uri.length > MAX_URI_LENGTH) {
      throw descriptorError("Encoded review diff URI exceeds the supported size");
    }
    return uri;
  }

  /** Decodes only canonical version-1 review-diff URIs. */
  public decode(uri: string): ReviewDiffDocumentDescriptor {
    if (
      uri.length === 0 ||
      uri.length > MAX_URI_LENGTH ||
      containsControlCharacter(uri)
    ) {
      throw uriError("Review diff URI has an unsupported size or control character");
    }

    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch (error) {
      throw uriError("Review diff URI is not syntactically valid", error);
    }

    if (
      parsed.protocol !== `${REVIEW_DIFF_SCHEME}:` ||
      parsed.hostname !== REVIEW_DIFF_AUTHORITY ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.port.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw uriError("Review diff URI scheme, authority, or suffix is invalid");
    }

    const segments = parsed.pathname.split("/");
    if (
      segments.length !== 8 ||
      segments[0] !== "" ||
      segments[1] !== REVIEW_DIFF_VERSION
    ) {
      throw uriError("Review diff URI path version or segment count is invalid");
    }

    const [
      ,
      ,
      contextToken,
      semanticsToken,
      sideToken,
      sourceToken,
      revisionToken,
      fileToken
    ] = segments;
    if (semanticsToken !== "posix" && semanticsToken !== "windows") {
      throw uriError("Review diff URI path semantics are invalid");
    }
    if (sideToken !== "original" && sideToken !== "modified") {
      throw uriError("Review diff URI side is invalid");
    }
    if (sourceToken !== "git-commit") {
      throw uriError("Review diff URI revision source is invalid");
    }

    const descriptor = validateDescriptor(
      {
        contextId: decodeField(contextToken!, "contextId", MAX_CONTEXT_ID_BYTES),
        filePath: decodeField(fileToken!, "filePath", MAX_FILE_PATH_BYTES),
        fileSystemPathSemantics: semanticsToken,
        side: sideToken,
        revisionSource: sourceToken,
        revision: decodeField(revisionToken!, "revision", 64)
      },
      (message) => uriError(message)
    );

    if (this.encode(descriptor) !== uri) {
      throw uriError("Review diff URI is not in canonical form");
    }
    return descriptor;
  }
}

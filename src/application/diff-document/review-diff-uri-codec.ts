import { TextDecoder } from "node:util";

import type { ReviewDiffDocumentDescriptor } from "./contracts";

const REVIEW_DIFF_SCHEME = "review-range-diff";
const REVIEW_DIFF_AUTHORITY = "document";
const REVIEW_DIFF_VERSION = "v1";
const MAX_URI_LENGTH = 65_536;
const MAX_CONTEXT_ID_BYTES = 8_192;
const MAX_FILE_PATH_BYTES = 32_768;
const MAX_REVISION_BYTES = 8_192;
const BASE64_URL_TOKEN = /^[A-Za-z0-9_-]+$/u;
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

const validateField = (
  value: string,
  name: string,
  maxBytes: number,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  if (value.length === 0) {
    throw failure(`${name} must not be empty`);
  }
  if (containsControlCharacter(value)) {
    throw failure(`${name} must not contain control characters`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw failure(`${name} exceeds the supported UTF-8 size`);
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

    const value = utf8Decoder.decode(bytes);
    return validateField(value, name, maxBytes, (message) => uriError(message));
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
  const contextId = validateField(
    descriptor.contextId,
    "contextId",
    MAX_CONTEXT_ID_BYTES,
    failure
  );
  const filePath = validateField(
    descriptor.filePath,
    "filePath",
    MAX_FILE_PATH_BYTES,
    failure
  );
  const revision = validateField(
    descriptor.revision,
    "revision",
    MAX_REVISION_BYTES,
    failure
  );
  if (descriptor.side !== "original" && descriptor.side !== "modified") {
    throw failure("side must be original or modified");
  }

  return {
    contextId,
    filePath,
    side: descriptor.side,
    revision
  };
};

/**
 * Encodes immutable review-diff document identity into one strict, versioned URI.
 *
 * The URI contains no repository path in its authority and never relies on query
 * ordering. Each variable field is canonical base64url, so reserved characters,
 * Unicode, and file separators round-trip without collisions between contexts.
 */
export class ReviewDiffUriCodec {
  /** Encodes one descriptor using the canonical `review-range-diff://document/v1` form. */
  public encode(descriptor: ReviewDiffDocumentDescriptor): string {
    const valid = validateDescriptor(descriptor, descriptorError);
    const uri = `${REVIEW_DIFF_SCHEME}://${REVIEW_DIFF_AUTHORITY}/${REVIEW_DIFF_VERSION}/${encodeField(valid.contextId)}/${valid.side}/${encodeField(valid.revision)}/${encodeField(valid.filePath)}`;
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
      segments.length !== 6 ||
      segments[0] !== "" ||
      segments[1] !== REVIEW_DIFF_VERSION
    ) {
      throw uriError("Review diff URI path version or segment count is invalid");
    }

    const [, , contextToken, sideToken, revisionToken, fileToken] = segments;
    if (sideToken !== "original" && sideToken !== "modified") {
      throw uriError("Review diff URI side is invalid");
    }

    const descriptor = validateDescriptor(
      {
        contextId: decodeField(contextToken!, "contextId", MAX_CONTEXT_ID_BYTES),
        filePath: decodeField(fileToken!, "filePath", MAX_FILE_PATH_BYTES),
        side: sideToken,
        revision: decodeField(revisionToken!, "revision", MAX_REVISION_BYTES)
      },
      (message) => uriError(message)
    );

    if (this.encode(descriptor) !== uri) {
      throw uriError("Review diff URI is not in canonical form");
    }

    return descriptor;
  }
}

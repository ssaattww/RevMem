import { TextDecoder } from "node:util";

import { requireCanonicalRepositoryRelativePath } from "../repository-path/index";
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
const LANGUAGE_HINT_FALLBACK_BASENAME = "review-file";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type ReviewDiffUriCodecErrorCode =
  | "invalid-review-diff-descriptor"
  | "invalid-review-diff-uri";

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
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const containsUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

const requireWellFormedField = (
  value: string,
  name: string,
  maxBytes: number,
  failure: (message: string) => ReviewDiffUriCodecError
): string => {
  if (value.length === 0) throw failure(`${name} must not be empty`);
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
  try {
    return requireCanonicalRepositoryRelativePath(
      filePath,
      semantics,
      "filePath"
    );
  } catch (error) {
    throw failure(error instanceof Error ? error.message : String(error));
  }
};

const validateRevisionSource = (
  value: ReviewDiffRevisionSource,
  failure: (message: string) => ReviewDiffUriCodecError
): ReviewDiffRevisionSource => {
  if (value !== "git-commit" && value !== "empty") {
    throw failure("revisionSource must be git-commit or empty");
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

const fileBasename = (filePath: string): string =>
  filePath.slice(filePath.lastIndexOf("/") + 1);

const fileExtension = (basename: string): string => {
  const index = basename.lastIndexOf(".");
  return index <= 0 ? "" : basename.slice(index);
};

const encodeLanguageHint = (filePath: string, remainingCharacters: number): string => {
  const basename = fileBasename(filePath);
  const encodedBasename = encodeURIComponent(basename);
  if (encodedBasename.length <= remainingCharacters) return encodedBasename;

  const encodedFallback = encodeURIComponent(
    `${LANGUAGE_HINT_FALLBACK_BASENAME}${fileExtension(basename)}`
  );
  if (encodedFallback.length <= remainingCharacters) return encodedFallback;
  throw descriptorError("Encoded review diff URI exceeds the supported size");
};

const decodeLanguageHint = (token: string): string => {
  if (token.length === 0) throw uriError("file language hint must not be empty");
  try {
    const decoded = decodeURIComponent(token);
    if (containsUnpairedSurrogate(decoded) || encodeURIComponent(decoded) !== token) {
      throw uriError("file language hint is not in canonical percent-encoded form");
    }
    return decoded;
  } catch (error) {
    if (error instanceof ReviewDiffUriCodecError) throw error;
    throw uriError("file language hint is not valid UTF-8", error);
  }
};

const decodeField = (token: string, name: string, maxBytes: number): string => {
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
    if (error instanceof ReviewDiffUriCodecError) throw error;
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
  const common = {
    contextId,
    filePath,
    fileSystemPathSemantics,
    side: descriptor.side,
    revision
  } as const;
  return revisionSource === "git-commit"
    ? { ...common, revisionSource: "git-commit" }
    : { ...common, revisionSource: "empty" };
};

export class ReviewDiffUriCodec {
  public encode(descriptor: ReviewDiffDocumentDescriptor): string {
    const valid = validateDescriptor(descriptor, descriptorError);
    const identity = this.encodeCurrentIdentity(valid);
    const languageHint = encodeLanguageHint(
      valid.filePath,
      MAX_URI_LENGTH - identity.length - 1
    );
    const uri = `${identity}/${languageHint}`;
    if (uri.length > MAX_URI_LENGTH) {
      throw descriptorError("Encoded review diff URI exceeds the supported size");
    }
    return uri;
  }

  public decode(uri: string): ReviewDiffDocumentDescriptor {
    if (
      uri.length === 0 ||
      uri.length > MAX_URI_LENGTH ||
      containsControlCharacter(uri)
    ) {
      throw uriError(
        "Review diff URI has an unsupported size or control character"
      );
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
    const isLegacy = segments.length === 8;
    if (
      (!isLegacy && segments.length !== 9) ||
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
      sourceToken
    ] = segments;
    const revisionToken = isLegacy ? segments[6] : segments[7];
    const fileToken = isLegacy ? segments[7] : segments[6];
    const languageHintToken = isLegacy ? undefined : segments[8];
    if (semanticsToken !== "posix" && semanticsToken !== "windows") {
      throw uriError("Review diff URI path semantics are invalid");
    }
    if (sideToken !== "original" && sideToken !== "modified") {
      throw uriError("Review diff URI side is invalid");
    }
    if (sourceToken !== "git-commit" && sourceToken !== "empty") {
      throw uriError("Review diff URI revision source is invalid");
    }

    const common = {
      contextId: decodeField(
        contextToken!,
        "contextId",
        MAX_CONTEXT_ID_BYTES
      ),
      filePath: decodeField(fileToken!, "filePath", MAX_FILE_PATH_BYTES),
      fileSystemPathSemantics: semanticsToken,
      side: sideToken,
      revision: decodeField(revisionToken!, "revision", 64)
    } as const;
    const input: ReviewDiffDocumentDescriptor = sourceToken === "git-commit"
      ? { ...common, revisionSource: "git-commit" }
      : { ...common, revisionSource: "empty" };
    const descriptor = validateDescriptor(
      input,
      (message) => uriError(message)
    );

    if (isLegacy) {
      if (this.encodeLegacyIdentity(descriptor) !== uri) {
        throw uriError("Review diff URI is not in canonical form");
      }
      return descriptor;
    }

    const languageHint = decodeLanguageHint(languageHintToken!);
    const expectedLanguageHint = decodeLanguageHint(
      this.encode(descriptor).split("/").at(-1)!
    );
    if (
      languageHint !== expectedLanguageHint ||
      this.encode(descriptor) !== parsed.toString()
    ) {
      throw uriError("Review diff URI is not in canonical form");
    }
    return descriptor;
  }

  private encodeCurrentIdentity(
    descriptor: ReviewDiffDocumentDescriptor
  ): string {
    return [
      `${REVIEW_DIFF_SCHEME}://${REVIEW_DIFF_AUTHORITY}`,
      REVIEW_DIFF_VERSION,
      encodeField(descriptor.contextId),
      descriptor.fileSystemPathSemantics,
      descriptor.side,
      descriptor.revisionSource,
      encodeField(descriptor.filePath),
      encodeField(descriptor.revision)
    ].join("/");
  }

  private encodeLegacyIdentity(
    descriptor: ReviewDiffDocumentDescriptor
  ): string {
    return [
      `${REVIEW_DIFF_SCHEME}://${REVIEW_DIFF_AUTHORITY}`,
      REVIEW_DIFF_VERSION,
      encodeField(descriptor.contextId),
      descriptor.fileSystemPathSemantics,
      descriptor.side,
      descriptor.revisionSource,
      encodeField(descriptor.revision),
      encodeField(descriptor.filePath)
    ].join("/");
  }
}

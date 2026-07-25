import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  ReviewDiffUriCodecError,
  type ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";

const descriptor: ReviewDiffDocumentDescriptor = {
  contextId: "context-1",
  filePath: "src/file.ts",
  fileSystemPathSemantics: "posix",
  side: "modified",
  revisionSource: "git-commit",
  revision: "0123456789abcdef0123456789abcdef01234567"
};

const expectInvalidUri = (codec: ReviewDiffUriCodec, uri: string): void => {
  assert.throws(
    () => codec.decode(uri),
    (error: unknown) =>
      error instanceof ReviewDiffUriCodecError &&
      error.code === "invalid-review-diff-uri"
  );
};

const replacePathSegment = (
  uri: string,
  segmentIndex: number,
  replacement: string
): string => {
  const parsed = new URL(uri);
  const segments = parsed.pathname.split("/");
  segments[segmentIndex] = replacement;
  return `${parsed.protocol}//${parsed.host}${segments.join("/")}`;
};

test("review diff URI rejects padded and non-canonical base64url tokens", () => {
  const codec = new ReviewDiffUriCodec();
  const uri = codec.encode(descriptor);
  const contextToken = new URL(uri).pathname.split("/")[2]!;

  expectInvalidUri(codec, replacePathSegment(uri, 2, `${contextToken}=`));
  expectInvalidUri(codec, replacePathSegment(uri, 2, "A"));
});

test("review diff URI rejects base64url that decodes to invalid UTF-8", () => {
  const codec = new ReviewDiffUriCodec();
  const uri = codec.encode(descriptor);
  const invalidUtf8Token = Buffer.from([0xff]).toString("base64url");

  expectInvalidUri(codec, replacePathSegment(uri, 2, invalidUtf8Token));
});

test("review diff URI rejects userinfo, password, and port", () => {
  const codec = new ReviewDiffUriCodec();
  const uri = codec.encode(descriptor);

  expectInvalidUri(codec, uri.replace("//document/", "//user@document/"));
  expectInvalidUri(codec, uri.replace("//document/", "//user:pass@document/"));
  expectInvalidUri(codec, uri.replace("//document/", "//document:8123/"));
});

test("review diff URI enforces context and file UTF-8 byte limits", () => {
  const codec = new ReviewDiffUriCodec();
  const maxContext = "c".repeat(8_192);
  const maxPath = "p".repeat(32_768);

  assert.equal(
    codec.decode(codec.encode({ ...descriptor, contextId: maxContext })).contextId,
    maxContext
  );
  assert.equal(
    codec.decode(codec.encode({ ...descriptor, filePath: maxPath })).filePath,
    maxPath
  );

  assert.throws(
    () => codec.encode({ ...descriptor, contextId: `${maxContext}x` }),
    (error: unknown) =>
      error instanceof ReviewDiffUriCodecError &&
      error.code === "invalid-review-diff-descriptor"
  );
  assert.throws(
    () => codec.encode({ ...descriptor, filePath: `${maxPath}x` }),
    (error: unknown) =>
      error instanceof ReviewDiffUriCodecError &&
      error.code === "invalid-review-diff-descriptor"
  );
});

test("review diff URI distinguishes the maximum raw length from an over-limit input", () => {
  const codec = new ReviewDiffUriCodec();
  const prefix = "review-range-diff://document/v1/";
  const atLimit = `${prefix}${"a".repeat(65_536 - prefix.length)}`;
  const overLimit = `${atLimit}a`;

  assert.equal(atLimit.length, 65_536);
  assert.throws(
    () => codec.decode(atLimit),
    (error: unknown) =>
      error instanceof ReviewDiffUriCodecError &&
      error.code === "invalid-review-diff-uri" &&
      !error.message.includes("unsupported size")
  );
  assert.throws(
    () => codec.decode(overLimit),
    (error: unknown) =>
      error instanceof ReviewDiffUriCodecError &&
      error.code === "invalid-review-diff-uri" &&
      error.message.includes("unsupported size")
  );
});

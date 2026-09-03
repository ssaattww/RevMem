import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  ReviewDiffUriCodecError,
  type ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";

const descriptor: ReviewDiffDocumentDescriptor = {
  contextId: "branch:refs/heads/feature-🚀",
  filePath: "src/emoji-🚀.ts",
  fileSystemPathSemantics: "posix",
  side: "modified",
  revisionSource: "git-commit",
  revision: "0123456789abcdef0123456789abcdef01234567"
};

test("review diff URI round-trips valid surrogate pairs", () => {
  const codec = new ReviewDiffUriCodec();
  assert.deepEqual(codec.decode(codec.encode(descriptor)), descriptor);
});

test("review diff URI encoding rejects unpaired UTF-16 surrogates", () => {
  const codec = new ReviewDiffUriCodec();

  for (const malformed of [
    { ...descriptor, contextId: `context-${String.fromCharCode(0xd800)}` },
    { ...descriptor, filePath: `src/${String.fromCharCode(0xdc00)}.ts` }
  ]) {
    assert.throws(
      () => codec.encode(malformed),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-descriptor"
    );
  }
});

test(
  "review diff URI keeps the source basename as the final path segment for VS Code language detection",
  () => {
    const uri = new URL(new ReviewDiffUriCodec().encode(descriptor));
    const encodedBasename = uri.pathname.split("/").at(-1);

    assert.ok(encodedBasename);
    assert.equal(decodeURIComponent(encodedBasename), "emoji-🚀.ts");
  }
);

test(
  "review diff URI rejects a language-hint basename that does not match the encoded file identity",
  () => {
    const codec = new ReviewDiffUriCodec();
    const uri = codec.encode(descriptor);
    const tampered = `${uri.slice(0, uri.lastIndexOf("/") + 1)}other.ts`;

    assert.throws(
      () => codec.decode(tampered),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-uri"
    );
  }
);

test("review diff URI continues to decode the legacy identity-only form", () => {
  const codec = new ReviewDiffUriCodec();
  const encodeField = (value: string): string =>
    Buffer.from(value, "utf8").toString("base64url");
  const legacyUri = [
    "review-range-diff://document",
    "v1",
    encodeField(descriptor.contextId),
    descriptor.fileSystemPathSemantics,
    descriptor.side,
    descriptor.revisionSource,
    encodeField(descriptor.revision),
    encodeField(descriptor.filePath)
  ].join("/");

  assert.deepEqual(codec.decode(legacyUri), descriptor);
});

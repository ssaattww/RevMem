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

import assert from "node:assert/strict";
import test from "node:test";

import { ReviewDiffUriCodec, ReviewDiffUriCodecError } from "../../src/application/diff-document/index";
import { requireCanonicalRepositoryRelativePath } from "../../src/application/repository-path/index";

const revision = "0123456789abcdef0123456789abcdef01234567";
const windowsReservedPaths = [
  "CON",
  "con.txt",
  "src/NUL",
  "src/prn.md",
  "src/AUX.json",
  "src/COM1",
  "src/com9.log",
  "src/LPT1",
  "src/lpt9.txt"
] as const;

test("Windows canonical repository paths reject reserved device names", () => {
  for (const filePath of windowsReservedPaths) {
    assert.throws(
      () => requireCanonicalRepositoryRelativePath(filePath, "windows"),
      TypeError,
      filePath
    );
  }
});

test("POSIX canonical repository paths retain Windows device-name spellings", () => {
  for (const filePath of windowsReservedPaths) {
    assert.equal(
      requireCanonicalRepositoryRelativePath(filePath, "posix"),
      filePath
    );
  }
});

test("review diff URI rejects Windows reserved device names during encoding", () => {
  const codec = new ReviewDiffUriCodec();

  for (const filePath of windowsReservedPaths) {
    assert.throws(
      () => codec.encode({
        contextId: "context-1",
        filePath,
        fileSystemPathSemantics: "windows",
        side: "modified",
        revisionSource: "git-commit",
        revision
      }),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-descriptor",
      filePath
    );
  }
});

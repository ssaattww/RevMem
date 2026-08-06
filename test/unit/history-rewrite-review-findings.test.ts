import assert from "node:assert/strict";
import test from "node:test";

import { GitRevisionMappingHistoryRewritePort } from "../../src/application/history-rewrite-recovery/adapters";
import type {
  GitRevisionMappingSource,
  GitRevisionMappingTextReadResult
} from "../../src/application/review-context/index";
import type { FileSystemPathSemantics } from "../../src/application/workspace-identity/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

class CopyRevisionSource implements GitRevisionMappingSource {
  public async objectExists(): Promise<boolean> {
    return true;
  }

  public async diffRevisions(): Promise<string> {
    return [
      "diff --git a/src/a.ts b/src/copied.ts",
      "similarity index 100%",
      "copy from src/a.ts",
      "copy to src/copied.ts",
      ""
    ].join("\n");
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    _revision: string,
    _repositoryRelativePath: string,
    _fileSystemPathSemantics: FileSystemPathSemantics
  ): Promise<GitRevisionMappingTextReadResult> {
    throw new Error("copy evidence must be rejected before immutable reads");
  }
}

test("legacy direct recovery adapter never transfers stable identity through a copy", async () => {
  const result = await new GitRevisionMappingHistoryRewritePort(
    new CopyRevisionSource(),
    "/repo",
    "posix"
  ).diff({
    oldRevisionId: OLD_SHA,
    newRevisionId: NEW_SHA,
    oldPath: "src/a.ts"
  });

  assert.equal(result.kind, "failure");
  assert.match(result.reason, /copy/u);
});

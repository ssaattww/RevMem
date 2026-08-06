import assert from "node:assert/strict";
import test from "node:test";

import { GitRevisionMappingHistoryRewritePort } from "../../src/application/history-rewrite-recovery/adapters";
import type {
  GitRevisionMappingSource,
  GitRevisionMappingTextReadResult
} from "../../src/application/review-context/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

class CopyRevisionSource implements GitRevisionMappingSource {
  public constructor(private readonly diff: string = [
    "diff --git a/src/a.ts b/src/copied.ts",
    "similarity index 100%",
    "copy from src/a.ts",
    "copy to src/copied.ts",
    ""
  ].join("\n")) {}

  public async objectExists(): Promise<boolean> {
    return true;
  }

  public async diffRevisions(): Promise<string> {
    return this.diff;
  }

  public async readTextFileAtRevision(): Promise<GitRevisionMappingTextReadResult> {
    throw new Error("copy evidence must be rejected before immutable reads");
  }
}

const copyResult = (source: GitRevisionMappingSource, oldPath: string) =>
  new GitRevisionMappingHistoryRewritePort(source, "/repo", "posix").diff({
    oldRevisionId: OLD_SHA,
    newRevisionId: NEW_SHA,
    oldPath
  });

test("legacy direct recovery adapter never transfers stable identity through a copy", async () => {
  const result = await copyResult(new CopyRevisionSource(), "src/a.ts");
  assert.equal(result.kind, "failure");
  assert.match(result.reason, /copy/u);
});

test("copy rejection uses decoded structural metadata for quoted and escaped paths", async () => {
  const cases = [
    {
      oldPath: "src/with space.ts",
      diff: [
        "diff --git \"a/src/with space.ts\" \"b/src/copied space.ts\"",
        "similarity index 100%",
        "copy from \"src/with space.ts\"",
        "copy to \"src/copied space.ts\"",
        ""
      ].join("\n")
    },
    {
      oldPath: "src/with\ttab.ts",
      diff: [
        "diff --git \"a/src/with\\ttab.ts\" \"b/src/copied\\ttab.ts\"",
        "similarity index 100%",
        "copy from \"src/with\\ttab.ts\"",
        "copy to \"src/copied\\ttab.ts\"",
        ""
      ].join("\n")
    },
    {
      oldPath: "src/café.ts",
      diff: [
        "diff --git \"a/src/caf\\303\\251.ts\" \"b/src/copied.ts\"",
        "similarity index 100%",
        "copy from \"src/caf\\303\\251.ts\"",
        "copy to src/copied.ts",
        ""
      ].join("\n")
    }
  ];

  for (const item of cases) {
    const result = await copyResult(new CopyRevisionSource(item.diff), item.oldPath);
    assert.equal(result.kind, "failure", item.oldPath);
    assert.match(result.reason, /copy/u);
  }
});

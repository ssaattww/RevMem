import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type RevisionTextContentSource
} from "../../src/application/diff-document/index";
import { ReviewDiffTextDocumentContentProvider } from "../../src/ui/diff-editor/index";

const descriptor = {
  contextId: "branch:refs/heads/feature",
  filePath: "src/space name.ts",
  fileSystemPathSemantics: "posix" as const,
  side: "modified" as const,
  revisionSource: "git-commit" as const,
  revision: "0123456789abcdef0123456789abcdef01234567"
};

test("VS Code content provider preserves the canonical encoded URI string", async () => {
  const codec = new ReviewDiffUriCodec();
  const canonicalUri = codec.encode(descriptor);
  const calls: boolean[] = [];
  const source: RevisionTextContentSource = {
    async readTextContent(request) {
      assert.deepEqual(request, descriptor);
      return { kind: "found", content: "current\n" };
    }
  };
  const provider = new ReviewDiffTextDocumentContentProvider(
    new RevisionTextContentProvider(codec, source)
  );
  const uri = {
    toString(skipEncoding?: boolean): string {
      calls.push(skipEncoding ?? false);
      return skipEncoding ? canonicalUri.replace("space%20name.ts", "space name.ts") : canonicalUri;
    }
  };

  assert.equal(
    await provider.provideTextDocumentContent(uri as never),
    "current\n"
  );
  assert.deepEqual(calls, [false]);
});

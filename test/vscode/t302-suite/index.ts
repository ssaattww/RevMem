import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentSource
} from "../../../src/application/diff-document/index";
import { ReviewDiffTextDocumentContentProvider } from "../../../src/ui/diff-editor/index";

/** Verifies T302 URI identity through the actual VS Code URI implementation. */
export async function run(): Promise<void> {
  const descriptor: ReviewDiffDocumentDescriptor = {
    contextId: "pull-request:github.com/owner/repository#42",
    filePath: "src/日本語/space name.ts",
    fileSystemPathSemantics: "posix",
    side: "original",
    revisionSource: "git-commit",
    revision: "0123456789abcdef0123456789abcdef01234567"
  };
  const codec = new ReviewDiffUriCodec();
  const encoded = codec.encode(descriptor);
  const uri = vscode.Uri.parse(encoded, true);

  assert.equal(uri.toString(true), encoded);
  assert.deepEqual(codec.decode(uri.toString(true)), descriptor);

  const source: RevisionTextContentSource = {
    async readTextContent(request) {
      assert.deepEqual(request, descriptor);
      return { kind: "found", content: "before\n" };
    }
  };
  const provider = new ReviewDiffTextDocumentContentProvider(
    new RevisionTextContentProvider(codec, source)
  );
  assert.equal(await provider.provideTextDocumentContent(uri), "before\n");
}

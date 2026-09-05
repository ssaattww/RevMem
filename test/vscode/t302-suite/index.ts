import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ReviewRangeRuntimePort } from "../../../src/extension";
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

  assert.equal(uri.toString(), encoded);
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

  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");
  const runtimePort = await extension.activate() as ReviewRangeRuntimePort;
  const registration = runtimePort.registerReviewDiffRuntime({
    ownsDocumentUri: (candidate) => candidate === uri.toString(),
    provideTextDocumentContent: (candidate) => provider.provideTextDocumentContent(candidate),
    invokeCommand: async () => undefined
  });
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.getText(), "before\n");
    assert.equal(document.languageId, "typescript");
  } finally {
    registration.dispose();
  }
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

test("T610-NR-010 documents exported folder-scope public contracts", async () => {
  const root = path.resolve(__dirname, "../../..");
  const contracts: Readonly<Record<string, readonly string[]>> = {
    "src/application/global-understanding/folder-understanding-scope-controller.ts": [
      "FolderUnderstandingScopeState", "FolderUnderstandingTotal", "reviewed", "complete",
      "FolderUnderstandingScopeSnapshot", "FolderUnderstandingStoppedStore", "loadStopped", "saveStopped"
    ],
    "src/ui/global-understanding/global-understanding-ui-model.ts": [
      "GlobalUnderstandingFolderSnapshot", "description", "action"
    ],
    "src/t305-global-understanding-startup.ts": ["T305StartupGlobalUnderstandingDocument", "isClosed", "uri", "observeStartupGlobalUnderstandingDocuments"],
    "src/ui/global-understanding/vscode-global-understanding-runtime.ts": [
      "GlobalUnderstandingRuntimeSource", "recalculate", "startFolder", "stopFolder", "resumeFolder",
      "GlobalUnderstandingRuntimeDependencies", "resolveFolderPathForResource",
      "GlobalUnderstandingPresentationForTest", "folderHierarchy", "summaryDescription", "statusText",
      "GlobalUnderstandingFolderPresentationForTest", "path", "state", "description", "children"
    ],
    "src/t305-global-understanding-lifecycle.ts": [
      "T305GlobalUnderstandingDocumentOpenDependencies", "observe", "requestRefresh", "refreshAfterFailure", "showGenericError",
      "observeGlobalUnderstandingDocumentOpen", "shouldRefreshGlobalUnderstandingFolderEntry"
    ]
  };
  for (const [relative, symbols] of Object.entries(contracts)) {
    const source = await readFile(path.join(root, relative), "utf8");
    const sourceFile = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const symbol of symbols) {
      const declarations: ts.Node[] = [];
      const visit = (node: ts.Node): void => {
        const named = node as ts.Node & { readonly name?: ts.Node & { readonly text?: string } };
        if (named.name?.text === symbol) declarations.push(node);
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      const documented = declarations.filter((declaration) => {
        const documentationOwner = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
        return ts.getJSDocCommentsAndTags(documentationOwner).length > 0;
      });
      assert.equal(documented.length, 1, `${relative}:${symbol} has exactly one declaration-adjacent contract JSDoc`);
    }
  }
});

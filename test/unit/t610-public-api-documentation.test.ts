import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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
      "GlobalUnderstandingPresentationForTest", "folderHierarchy", "summaryDescription", "statusText",
      "GlobalUnderstandingFolderPresentationForTest", "path", "state", "description", "children"
    ]
  };
  for (const [relative, symbols] of Object.entries(contracts)) {
    const source = await readFile(path.join(root, relative), "utf8");
    for (const symbol of symbols) {
      const documented = new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*(?:export\\s+)?(?:interface|type|class|const)?\\s*(?:readonly\\s+)?${symbol}\\b`, "gu");
      assert.equal((source.match(documented) ?? []).length, 1, `${relative}:${symbol} has exactly one contract JSDoc`);
    }
  }
});

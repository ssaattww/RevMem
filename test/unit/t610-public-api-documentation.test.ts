import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("T610-NR-010 documents exported folder-scope public contracts", async () => {
  const root = path.resolve(__dirname, "../../..");
  for (const relative of ["src/application/global-understanding/folder-understanding-scope-controller.ts", "src/ui/global-understanding/global-understanding-ui-model.ts", "src/ui/global-understanding/vscode-global-understanding-runtime.ts"]) {
    const source = await readFile(path.join(root, relative), "utf8");
    assert.match(source, /\/\*\*[\s\S]*?\*\/\s*export /u, relative);
  }
});

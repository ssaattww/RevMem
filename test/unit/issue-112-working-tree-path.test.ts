import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkingTreeFilePath } from "../../src/ui/pr-progress/working-tree-file-path";

test("working-tree path resolution stays under the registered repository root", () => {
  assert.equal(
    resolveWorkingTreeFilePath("/workspace/RevMem", "src/new-name.ts", "posix"),
    "/workspace/RevMem/src/new-name.ts"
  );
  assert.equal(
    resolveWorkingTreeFilePath("C:\\workspace\\RevMem", "src/new-name.ts", "windows"),
    "C:\\workspace\\RevMem\\src\\new-name.ts"
  );
});

test("working-tree path resolution rejects repository path escapes", () => {
  assert.throws(
    () => resolveWorkingTreeFilePath("/workspace/RevMem", "../outside.ts", "posix"),
    /canonical|relative|repository|path/i
  );
  assert.throws(
    () => resolveWorkingTreeFilePath("C:\\workspace\\RevMem", "C:/outside.ts", "windows"),
    /canonical|relative|repository|path/i
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("PR108-PRODUCT-002 new PR creation fails closed when owner synchronization is incomplete", async () => {
  const runtimeSource = await readFile(
    path.resolve(__dirname, "../../../src/t405-review-contexts-runtime.ts"),
    "utf8",
  );
  const detectStart = runtimeSource.indexOf("const detectPullRequest = async");
  const newContextStart = runtimeSource.indexOf("      } else {", detectStart);
  const createStart = runtimeSource.indexOf(
    "        const current = gitContextResolver.resolve",
    newContextStart,
  );
  assert.ok(detectStart >= 0 && newContextStart > detectStart && createStart > newContextStart);
  const newContextBranch = runtimeSource.slice(newContextStart, createStart);
  assert.match(newContextBranch, /if \(!synchronizationCompleted\)/u);
  assert.match(
    newContextBranch,
    /Repository-owner synchronization must complete before creating a new pull-request context\./u,
  );
});

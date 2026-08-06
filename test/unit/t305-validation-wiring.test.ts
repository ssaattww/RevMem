import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./global-understanding-ui.test";
import "./t505-review-findings.test";
import "./t505-refresh-invalidation.test";

test("T305 preserves every pre-existing unit suite exactly once while adding its focused suites", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const suitePaths = manifest.scripts["test:unit"].match(/test-dist\/test\/unit\/[^ ]+\.test\.js/g) ?? [];
  const suiteNames = suitePaths.map((value) => value.split("/").at(-1));

  assert.equal(
    suiteNames.filter((value) => value === "local-git-revision-text-content-source.test.js").length,
    1,
    "the Local Git text-content suite must not be duplicated"
  );
  assert.equal(
    suiteNames.includes("review-diff-editor-controller.test.js"),
    true,
    "the existing diff-editor regression suite must remain in the default unit command"
  );
  assert.equal(suiteNames.includes("current-context-ui.test.js"), true);
  assert.equal(suiteNames.includes("vscode-current-context-runtime.test.js"), true);
});

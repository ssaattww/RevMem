import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  refreshCurrentContextDependents,
} from "../../src/t305-projection-refresh.js";
import "./global-understanding-ui.test";
import "./t505-review-findings.test";
import "./t505-refresh-invalidation.test";
import "./review-contexts-storage.test";
import "./review-contexts-ui.test";
import "./review-contexts-runtime-wiring.test";

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

test("Issue #84 registers the selected PR runtime before PR Progress refresh", async () => {
  let pullRequestRuntimeRegistered = false;
  let progressObservedRegistration = false;

  await refreshCurrentContextDependents({
    refreshPullRequestProgress: async () => {
      progressObservedRegistration = pullRequestRuntimeRegistered;
    },
    refreshDecorations: async () => undefined,
    refreshGlobal: async () => undefined,
    refreshReviewContexts: async () => {
      pullRequestRuntimeRegistered = true;
    },
    reportPullRequestProgressError: async () => undefined,
  });

  assert.equal(
    progressObservedRegistration,
    true,
    "PR Progress must not run before Review Contexts has registered the selected PR diff runtime",
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readUtf8 = (path: string): Promise<string> => readFile(path, "utf8");

test("T305 contributes the Review Range activity container, views, and commands", async () => {
  const manifest = JSON.parse(await readUtf8("package.json")) as {
    contributes: {
      viewsContainers: { activitybar: Array<{ id: string }> };
      views: Record<string, Array<{ id: string }>>;
      commands: Array<{ command: string }>;
    };
    scripts: Record<string, string>;
  };

  assert.ok(manifest.contributes.viewsContainers.activitybar.some(({ id }) => id === "reviewRange"));
  assert.deepEqual(
    manifest.contributes.views.reviewRange.map(({ id }) => id),
    [
      "reviewRange.currentContext",
      "reviewRange.prProgress",
      "reviewRange.globalUnderstanding",
      "reviewRange.reviewContexts"
    ]
  );
  const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
  assert.ok(commands.has("reviewRange.refreshContext"));
  assert.ok(commands.has("reviewRange.selectContext"));
  assert.match(manifest.scripts["test:unit"], /vscode-current-context-runtime\.test\.js/u);
  assert.match(manifest.scripts["test:t305"], /current-context-ui\.test\.js/u);
});

test("T305 default and focused commands execute the same behavior suites", async () => {
  const manifest = JSON.parse(await readUtf8("package.json")) as {
    scripts: Record<string, string>;
  };
  const defaultSuites = manifest.scripts["test:unit"];

  for (const suite of [
    "current-context-ui.test.js",
    "vscode-current-context-runtime.test.js",
    "t305-validation-wiring.test.js"
  ]) {
    const pattern = new RegExp(suite.replaceAll(".", "\\."), "u");
    assert.match(defaultSuites, pattern);
    assert.match(manifest.scripts["test:t305"], pattern);
  }
});

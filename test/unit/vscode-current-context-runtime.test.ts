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

test("T305 composition root registers context runtime and synchronizes dependent decorations", async () => {
  const extension = await readUtf8("src/t305-extension.ts");
  const runtime = await readUtf8("src/ui/current-context/vscode-current-context-runtime.ts");

  assert.match(extension, /registerCurrentContextRuntime\(/u);
  assert.match(extension, /createNodeLocalGitAdapter\(\)/u);
  assert.match(extension, /enumerateContexts/u);
  assert.match(extension, /selectedKey/u);
  assert.match(extension, /refreshVisibleEditorDecorations/u);
  assert.match(runtime, /registerTreeDataProvider\(CURRENT_CONTEXT_VIEW_ID/u);
  assert.match(runtime, /registerCommand\(\s*REFRESH_CONTEXT_COMMAND_ID/u);
  assert.match(runtime, /registerCommand\(\s*SELECT_CONTEXT_COMMAND_ID/u);
  assert.match(runtime, /CurrentContextRuntimeCoordinator/u);
  assert.match(runtime, /createStatusBarItem/u);
});

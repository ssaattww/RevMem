import assert from "node:assert/strict";

import * as vscode from "vscode";

const expectedCommandIds = [
  "reviewRange.markSelectionReviewed",
  "reviewRange.unmarkSelectionReviewed",
  "reviewRange.markFileReviewed",
  "reviewRange.unmarkFileReviewed"
] as const;

const expectedDecorationDefaults = {
  "reviewRange.showGlobalReviewed": true,
  "reviewRange.showGutterIcon": true,
  "reviewRange.showOverviewRuler": false
} as const;

/** Runs the Extension Host smoke assertions invoked by VS Code's test runner. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");
  assert.deepEqual(extension.packageJSON.extensionKind, ["workspace"]);

  const configurationProperties = extension.packageJSON.contributes.configuration.properties;
  for (const [configurationKey, expectedDefault] of Object.entries(
    expectedDecorationDefaults
  )) {
    assert.equal(
      configurationProperties[configurationKey].default,
      expectedDefault,
      `${configurationKey} should expose the designed default.`
    );
  }
  await vscode.workspace.fs.stat(
    vscode.Uri.joinPath(extension.extensionUri, "media", "reviewed-gutter.svg")
  );

  await extension.activate();

  assert.equal(extension.isActive, true);
  const registeredCommands = new Set(await vscode.commands.getCommands(true));
  for (const commandId of expectedCommandIds) {
    assert.equal(
      registeredCommands.has(commandId),
      true,
      `${commandId} should be registered after activation.`
    );
  }

  const configuration = vscode.workspace.getConfiguration("reviewRange");
  for (const [configurationKey, expectedDefault] of Object.entries(
    expectedDecorationDefaults
  )) {
    const section = configurationKey.replace("reviewRange.", "");
    assert.equal(
      configuration.get(section),
      expectedDefault,
      `${configurationKey} should resolve to its designed default.`
    );
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "The Extension Host fixture should open a workspace folder.");
  const documentUri = vscode.Uri.joinPath(workspaceFolder.uri, "decoration-smoke.ts");
  await vscode.workspace.fs.writeFile(
    documentUri,
    Buffer.from("const first = 1;\nconst second = 2;\n")
  );
  const document = await vscode.workspace.openTextDocument(documentUri);
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 0, 0, 0);

  await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(vscode.window.visibleTextEditors.includes(editor), true);
}

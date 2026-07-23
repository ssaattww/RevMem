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

const expectedThemeColors = new Map([
  [
    "reviewRange.reviewedBackground",
    {
      dark: "#a0a0a01f",
      light: "#6060601f",
      highContrast: "#a0a0a033",
      highContrastLight: "#60606033"
    }
  ],
  [
    "reviewRange.reviewedOverviewRuler",
    {
      dark: "#a0a0a08c",
      light: "#6060608c",
      highContrast: "#a0a0a0cc",
      highContrastLight: "#606060cc"
    }
  ]
]);

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

  const contributedColors = new Map(
    extension.packageJSON.contributes.colors.map(
      (color: { readonly id: string; readonly defaults: unknown }) => [
        color.id,
        color.defaults
      ]
    )
  );
  for (const [colorId, expectedDefaults] of expectedThemeColors) {
    assert.deepEqual(
      contributedColors.get(colorId),
      expectedDefaults,
      `${colorId} should define all theme-kind defaults.`
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
  const splitEditor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false
  });
  splitEditor.selection = new vscode.Selection(0, 0, 0, 0);

  const visibleCopies = vscode.window.visibleTextEditors.filter(
    (visibleEditor) => visibleEditor.document.uri.toString() === documentUri.toString()
  );
  assert.ok(
    visibleCopies.length >= 2,
    "The Extension Host fixture should expose split editors for one document."
  );

  await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(vscode.window.visibleTextEditors.includes(editor), true);
  assert.equal(vscode.window.visibleTextEditors.includes(splitEditor), true);
}

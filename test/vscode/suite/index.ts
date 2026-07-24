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

const TEST_PHASE_ENVIRONMENT_VARIABLE = "REVIEW_RANGE_TEST_PHASE";
type TestPhase =
  | "confirm"
  | "restore-confirmed-and-unmark"
  | "restore-unmarked";

interface ReviewedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface ReviewRangeExtensionTestApi {
  refreshVisibleEditorDecorations(): Promise<void>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedInterval[];
}

const readTestPhase = (): TestPhase => {
  const phase = process.env[TEST_PHASE_ENVIRONMENT_VARIABLE];
  assert.ok(
    phase === "confirm" ||
      phase === "restore-confirmed-and-unmark" ||
      phase === "restore-unmarked",
    `Unexpected Extension Host test phase: ${String(phase)}`
  );
  return phase;
};

const assertManifestAndConfiguration = async (
  extension: vscode.Extension<unknown>
): Promise<void> => {
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
};

const openLifecycleFixture = async (
  phase: TestPhase,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<{
  readonly documentUri: vscode.Uri;
  readonly editor: vscode.TextEditor;
  readonly splitEditor: vscode.TextEditor;
}> => {
  const documentUri = vscode.Uri.joinPath(workspaceFolder.uri, "lifecycle-restart.ts");
  if (phase === "confirm") {
    await vscode.workspace.fs.writeFile(
      documentUri,
      Buffer.from("const first = 1;\nconst second = 2;\n")
    );
  } else {
    await vscode.workspace.fs.stat(documentUri);
  }

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

  return { documentUri, editor, splitEditor };
};

/** Runs the Extension Host lifecycle assertions invoked by VS Code's test runner. */
export async function run(): Promise<void> {
  const phase = readTestPhase();
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");

  const extensionApi = (await extension.activate()) as
    | ReviewRangeExtensionTestApi
    | undefined;
  assert.equal(extension.isActive, true);
  assert.ok(
    extensionApi,
    "Test-mode activation should expose lifecycle and decoration observation hooks."
  );
  await assertManifestAndConfiguration(extension);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "The Extension Host fixture should open a workspace folder.");
  const { documentUri, editor, splitEditor } = await openLifecycleFixture(
    phase,
    workspaceFolder
  );

  assert.equal(vscode.window.visibleTextEditors.includes(editor), true);
  assert.equal(vscode.window.visibleTextEditors.includes(splitEditor), true);

  if (phase === "confirm") {
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await extensionApi.refreshVisibleEditorDecorations();
    assert.deepEqual(
      extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
      [{ startLine: 0, endLineExclusive: 1 }],
      "A confirmed line should be persisted before its success decoration is observable."
    );
    return;
  }

  await extensionApi.refreshVisibleEditorDecorations();
  if (phase === "restore-confirmed-and-unmark") {
    assert.deepEqual(
      extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
      [{ startLine: 0, endLineExclusive: 1 }],
      "The confirmed line decoration should be restored after Extension Host restart."
    );

    splitEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await extensionApi.refreshVisibleEditorDecorations();
    assert.deepEqual(
      extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
      [],
      "An unmark operation should clear the decoration only after persistence succeeds."
    );
    return;
  }

  assert.deepEqual(
    extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
    [],
    "The unmarked state should remain undecorated after a second Extension Host restart."
  );
}

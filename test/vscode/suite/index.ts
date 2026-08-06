import assert from "node:assert/strict";

import * as vscode from "vscode";

const expectedCommandIds = [
  "reviewRange.markSelectionReviewed",
  "reviewRange.unmarkSelectionReviewed",
  "reviewRange.markFileReviewed",
  "reviewRange.unmarkFileReviewed",
  "reviewRange.refreshContext",
  "reviewRange.selectContext"
] as const;

const expectedDecorationDefaults = {
  "reviewRange.showGlobalReviewed": true,
  "reviewRange.showGutterIcon": true,
  "reviewRange.showOverviewRuler": false
} as const;

const expectedExcludeGlobs = [
  "**/.git/**",
  "**/node_modules/**",
  "**/bin/**",
  "**/obj/**",
  "**/dist/**",
  "**/build/**"
] as const;

const expectedDecisionBearingExcludeGlobs = expectedExcludeGlobs.slice(1);

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
const TEST_OPERATION_TIMEOUT_MS = 10_000;
type TestPhase =
  | "confirm"
  | "restore-confirmed-and-unmark"
  | "restore-unmarked";

interface ReviewedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface FileExclusionPolicySnapshot {
  readonly revision: number;
  readonly userGlobs: readonly string[];
}

interface FileExclusionDecision {
  readonly excluded: boolean;
  readonly normalizedPath: string;
  readonly reason?: { readonly kind: string; readonly pattern?: string };
}

interface ReviewRangeExtensionTestApi {
  refreshVisibleEditorDecorations(): Promise<void>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedInterval[];
  getFileExclusionPolicySnapshot(): FileExclusionPolicySnapshot;
  evaluateFileExclusion(path: string, isBinary?: boolean): FileExclusionDecision;
}

const within = async <Value>(label: string, operation: PromiseLike<Value>): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<Value>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`VS Code lifecycle operation timed out: ${label}`)), TEST_OPERATION_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

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
  assert.deepEqual(
    configurationProperties["reviewRange.exclude"].default,
    expectedExcludeGlobs,
    "reviewRange.exclude should expose the designed default glob list."
  );

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
  assert.deepEqual(
    configuration.get("exclude"),
    expectedExcludeGlobs,
    "reviewRange.exclude should resolve to its designed default."
  );
};

const waitForRevision = async (
  extensionApi: ReviewRangeExtensionTestApi,
  predicate: (revision: number) => boolean
): Promise<number> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const revision = extensionApi.getFileExclusionPolicySnapshot().revision;
    if (predicate(revision)) {
      return revision;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the exclusion-policy revision.");
};

const assertExclusionConfigurationLifecycle = async (
  extensionApi: ReviewRangeExtensionTestApi
): Promise<void> => {
  const configuration = vscode.workspace.getConfiguration("reviewRange");
  const initial = extensionApi.getFileExclusionPolicySnapshot();
  assert.deepEqual(initial.userGlobs, expectedDecisionBearingExcludeGlobs);
  assert.equal(extensionApi.evaluateFileExclusion("dist/index.js").excluded, true);

  const configuredGlobs = [...expectedExcludeGlobs, "**/*.generated.ts"];
  await configuration.update(
    "exclude",
    configuredGlobs,
    vscode.ConfigurationTarget.Workspace
  );
  const configuredRevision = await waitForRevision(
    extensionApi,
    (revision) => revision > initial.revision
  );
  assert.equal(
    extensionApi.evaluateFileExclusion("src/model.generated.ts").excluded,
    true,
    "A relevant effective setting change should update the shared policy."
  );

  await configuration.update(
    "showOverviewRuler",
    true,
    vscode.ConfigurationTarget.Workspace
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    extensionApi.getFileExclusionPolicySnapshot().revision,
    configuredRevision,
    "An unrelated setting change should not update the exclusion policy."
  );
  await configuration.update(
    "showOverviewRuler",
    undefined,
    vscode.ConfigurationTarget.Workspace
  );

  await configuration.update(
    "exclude",
    [...expectedExcludeGlobs, " **\\*.generated.ts "],
    vscode.ConfigurationTarget.Workspace
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    extensionApi.getFileExclusionPolicySnapshot().revision,
    configuredRevision,
    "A semantically equivalent setting should not request recomputation."
  );

  await configuration.update(
    "exclude",
    undefined,
    vscode.ConfigurationTarget.Workspace
  );
  await waitForRevision(
    extensionApi,
    (revision) => revision > configuredRevision
  );
  assert.deepEqual(
    extensionApi.getFileExclusionPolicySnapshot().userGlobs,
    expectedDecisionBearingExcludeGlobs
  );
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
    "Test-mode activation should expose lifecycle and runtime observation hooks."
  );
  await within("manifest and configuration", assertManifestAndConfiguration(extension));
  await within("refresh context command", vscode.commands.executeCommand("reviewRange.refreshContext"));
  if (phase === "confirm") {
    await within("exclusion configuration lifecycle", assertExclusionConfigurationLifecycle(extensionApi));
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "The Extension Host fixture should open a workspace folder.");
  const { documentUri, editor, splitEditor } = await within("open lifecycle fixture", openLifecycleFixture(
    phase,
    workspaceFolder
  ));

  assert.equal(vscode.window.visibleTextEditors.includes(editor), true);
  assert.equal(vscode.window.visibleTextEditors.includes(splitEditor), true);

  if (phase === "confirm") {
    await within("mark selection command", vscode.commands.executeCommand("reviewRange.markSelectionReviewed"));
    await within("refresh confirmed decorations", extensionApi.refreshVisibleEditorDecorations());
    assert.deepEqual(
      extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
      [{ startLine: 0, endLineExclusive: 1 }],
      "A confirmed line should be persisted before its success decoration is observable."
    );
    return;
  }

  await within("refresh restored decorations", extensionApi.refreshVisibleEditorDecorations());
  if (phase === "restore-confirmed-and-unmark") {
    assert.deepEqual(
      extensionApi.getVisibleReviewedIntervals(documentUri.toString()),
      [{ startLine: 0, endLineExclusive: 1 }],
      "The confirmed line decoration should be restored after Extension Host restart."
    );

    splitEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await within("unmark selection command", vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed"));
    await within("refresh unmarked decorations", extensionApi.refreshVisibleEditorDecorations());
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

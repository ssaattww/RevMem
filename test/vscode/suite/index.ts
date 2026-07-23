import assert from "node:assert/strict";

import * as vscode from "vscode";

const expectedCommandIds = [
  "reviewRange.markSelectionReviewed",
  "reviewRange.unmarkSelectionReviewed",
  "reviewRange.markFileReviewed",
  "reviewRange.unmarkFileReviewed"
] as const;

/** Runs the Extension Host smoke assertions invoked by VS Code's test runner. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");

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
}

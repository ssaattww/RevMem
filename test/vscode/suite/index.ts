import assert from "node:assert/strict";

import * as vscode from "vscode";

/** Runs the Extension Host smoke assertion invoked by VS Code's test runner. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");

  await extension.activate();

  assert.equal(extension.isActive, true);
}

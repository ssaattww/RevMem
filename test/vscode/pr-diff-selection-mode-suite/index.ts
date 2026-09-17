import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { PullRequestReviewRuntimeTestFixture } from "../../../src/composition/extension";
import type { PullRequestDiffSnapshot } from "../../../src/core/pr-progress/index";
import type { PullRequestProgressTreeFileNode } from "../../../src/ui/pr-progress/index";

interface ReviewedInterval {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface PullRequestHostTestApi {
  initializePullRequestReviewRuntimeForTest(input: PullRequestReviewRuntimeTestFixture): Promise<void>;
  refreshPullRequestProgressForTest(): Promise<void>;
  getPullRequestReviewStateForTest(): Promise<{
    readonly contextState: {
      readonly files: Record<string, {
        readonly modifiedReviewed: readonly ReviewedInterval[];
        readonly originalReviewedByDiff: Record<string, readonly ReviewedInterval[]>;
      }>;
    };
    readonly globalState: {
      readonly files: Record<string, { readonly reviewed: readonly ReviewedInterval[] }>;
    };
  } | undefined>;
  getActivePullRequestProgressTreeForTest(): readonly PullRequestProgressTreeFileNode[];
  getVisiblePrDiffReviewedIntervalsForTest(documentUri: string): readonly ReviewedInterval[];
}

const baseSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";
const contextId = "github-pr:fixture.invalid/extension-host/pds09#9";
const diffId = `${baseSha}..${headSha}`;
const reviewed = (startLine: number, endLineExclusive: number): ReviewedInterval => ({ startLine, endLineExclusive });

const snapshot: PullRequestDiffSnapshot = {
  contextId,
  baseSha,
  headSha,
  originalDiffId: diffId,
  files: [
    {
      fileId: "replacement",
      oldPath: "replacement.ts",
      newPath: "replacement.ts",
      status: "modified",
      additions: 2,
      deletions: 2,
      hunks: [{
        oldStart: 1, oldCount: 4, newStart: 1, newCount: 4,
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "anchor" },
          { kind: "deletion", oldLine: 2, text: "old-one" },
          { kind: "deletion", oldLine: 3, text: "old-two" },
          { kind: "addition", newLine: 2, text: "new-one" },
          { kind: "addition", newLine: 3, text: "new-two" },
          { kind: "context", oldLine: 4, newLine: 4, text: "tail" }
        ]
      }]
    },
    {
      fileId: "addition",
      oldPath: "addition.ts",
      newPath: "addition.ts",
      status: "modified",
      additions: 2,
      deletions: 0,
      hunks: [{
        oldStart: 1, oldCount: 2, newStart: 1, newCount: 4,
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "anchor" },
          { kind: "addition", newLine: 2, text: "added-one" },
          { kind: "addition", newLine: 3, text: "added-two" },
          { kind: "context", oldLine: 2, newLine: 4, text: "tail" }
        ]
      }]
    },
    {
      fileId: "deletion",
      oldPath: "deletion.ts",
      newPath: "deletion.ts",
      status: "modified",
      additions: 0,
      deletions: 2,
      hunks: [{
        oldStart: 1, oldCount: 4, newStart: 1, newCount: 2,
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "anchor" },
          { kind: "deletion", oldLine: 2, text: "deleted-one" },
          { kind: "deletion", oldLine: 3, text: "deleted-two" },
          { kind: "context", oldLine: 4, newLine: 2, text: "tail" }
        ]
      }]
    },
    {
      fileId: "eol",
      oldPath: "eol.ts",
      newPath: "eol.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      hunks: [{
        oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
        lines: [
          { kind: "deletion", oldLine: 1, text: "same" },
          { kind: "addition", newLine: 1, text: "same" }
        ]
      }]
    },
    {
      fileId: "boundary",
      oldPath: "boundary.ts",
      newPath: "boundary.ts",
      status: "modified",
      additions: 2,
      deletions: 2,
      hunks: [{
        oldStart: 1, oldCount: 5, newStart: 1, newCount: 5,
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "anchor" },
          { kind: "deletion", oldLine: 2, text: "old-one" },
          { kind: "addition", newLine: 2, text: "new-one" },
          { kind: "context", oldLine: 3, newLine: 3, text: "middle" },
          { kind: "deletion", oldLine: 4, text: "old-two" },
          { kind: "addition", newLine: 4, text: "new-two" },
          { kind: "context", oldLine: 5, newLine: 5, text: "tail" }
        ]
      }]
    }
  ]
};

const texts: PullRequestReviewRuntimeTestFixture["texts"] = [
  { revision: baseSha, filePath: "replacement.ts", content: "anchor\nold-one\nold-two\ntail\n" },
  { revision: headSha, filePath: "replacement.ts", content: "anchor\nnew-one\nnew-two\ntail\n" },
  { revision: baseSha, filePath: "addition.ts", content: "anchor\ntail\n" },
  { revision: headSha, filePath: "addition.ts", content: "anchor\nadded-one\nadded-two\ntail\n" },
  { revision: baseSha, filePath: "deletion.ts", content: "anchor\ndeleted-one\ndeleted-two\ntail\n" },
  { revision: headSha, filePath: "deletion.ts", content: "anchor\ntail\n" },
  { revision: baseSha, filePath: "eol.ts", content: "same" },
  { revision: headSha, filePath: "eol.ts", content: "same\n" },
  { revision: baseSha, filePath: "boundary.ts", content: "anchor\nold-one\nmiddle\nold-two\ntail\n" },
  { revision: headSha, filePath: "boundary.ts", content: "anchor\nnew-one\nmiddle\nnew-two\ntail\n" }
];

const fixture = (workspace: vscode.WorkspaceFolder, initialState?: PullRequestReviewRuntimeTestFixture["initialState"]): PullRequestReviewRuntimeTestFixture => ({
  repositoryId: "fixture.invalid/extension-host/pds09",
  repositoryRoot: workspace.uri.fsPath,
  pullRequestNumber: 9,
  snapshot,
  texts,
  ...(initialState === undefined ? {} : { initialState })
});

const activeDiff = (): { readonly original: string; readonly modified: string } => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputTextDiff, "PR Progress must open an actual VS Code diff tab.");
  return { original: input.original.toString(true), modified: input.modified.toString(true) };
};

const openProgressFile = async (api: PullRequestHostTestApi, fileId: string) => {
  const node = api.getActivePullRequestProgressTreeForTest().find((candidate) => candidate.source.fileId === fileId);
  assert.ok(node, `The rendered PR Progress Tree must contain ${fileId}.`);
  await vscode.commands.executeCommand("reviewRange.openPrProgressItem", node);
  return activeDiff();
};

const focus = async (side: "original" | "modified", diff: { readonly original: string; readonly modified: string }, line: number): Promise<void> => {
  await vscode.commands.executeCommand(
    side === "original"
      ? "workbench.action.compareEditor.focusSecondarySide"
      : "workbench.action.compareEditor.focusPrimarySide"
  );
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, `The ${side} diff pane must be active.`);
  assert.equal(editor.document.uri.toString(true), side === "original" ? diff.original : diff.modified);
  editor.selection = new vscode.Selection(line, 0, line, 0);
};

const stateFor = async (api: PullRequestHostTestApi, fileId: string) => {
  const state = await api.getPullRequestReviewStateForTest();
  assert.ok(state, "The composed PR runtime must persist a matching Review State context.");
  const file = state.contextState.files[fileId];
  assert.ok(file, `The persisted PR context must retain ${fileId}.`);
  return { file, global: state.globalState.files[fileId]?.reviewed ?? [] };
};

const refresh = (api: PullRequestHostTestApi) => api.refreshPullRequestProgressForTest();

const assertDoesNotReviewLine = (intervals: readonly ReviewedInterval[], line: number, message: string): void => {
  assert.equal(intervals.some((interval) => interval.startLine <= line && line < interval.endLineExclusive), false, message);
};

/** Exercises the composed PR runtime through public PR Progress and review commands. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host should load this extension.");
  const api = (await extension.activate()) as PullRequestHostTestApi;
  const workspace = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspace, "The Extension Host must have a workspace for the immutable PR fixture.");
  const configuration = vscode.workspace.getConfiguration("reviewRange");

  try {
    await api.initializePullRequestReviewRuntimeForTest(fixture(workspace));
    assert.equal(configuration.get("prDiffSelectionMode"), "side", "The Host resolves side as the default selection mode.");
    assert.equal(api.getActivePullRequestProgressTreeForTest().length, 5, "The real PR Progress Tree renders every immutable fixture file.");

    const replacement = await openProgressFile(api, "replacement");
    await focus("original", replacement, 1);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    let state = await stateFor(api, "replacement");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(1, 2)], "Default side mode persists only the original selection.");
    assert.deepEqual(state.file.modifiedReviewed, []);
    assert.deepEqual(state.global, []);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.original), [reviewed(1, 2)]);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.modified), []);

    await configuration.update("prDiffSelectionMode", "block", vscode.ConfigurationTarget.Workspace);
    await focus("original", replacement, 1);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "replacement");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(1, 3)], "Block mode expands a partial original replacement selection.");
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(1, 3)]);
    assert.deepEqual(state.global, [reviewed(1, 3)]);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.original), [reviewed(1, 3)]);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.modified), [reviewed(1, 3)]);
    const replacementNode = api.getActivePullRequestProgressTreeForTest().find((node) => node.source.fileId === "replacement");
    assert.equal(replacementNode?.reviewedLineCount, 4, "The real PR Progress row includes both reviewed replacement sides.");

    await focus("modified", replacement, 1);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "replacement");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], []);
    assert.deepEqual(state.file.modifiedReviewed, []);
    assert.deepEqual(state.global, []);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.original), []);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(replacement.modified), []);

    const addition = await openProgressFile(api, "addition");
    await focus("modified", addition, 1);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "addition");
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(1, 3)], "An addition-only block expands only the modified side.");
    assert.deepEqual(state.global, [reviewed(1, 3)]);
    assert.deepEqual(state.file.originalReviewedByDiff[diffId] ?? [], []);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(addition.modified), [reviewed(1, 3)]);
    await focus("modified", addition, 1);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "addition");
    assert.deepEqual(state.file.modifiedReviewed, [], "The modified-side public unmark clears an addition-only block.");
    assert.deepEqual(state.global, []);

    const deletion = await openProgressFile(api, "deletion");
    await focus("original", deletion, 1);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "deletion");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(1, 3)], "A deletion-only block expands only the original side.");
    assert.deepEqual(state.file.modifiedReviewed, []);
    assert.deepEqual(state.global, []);
    assert.deepEqual(api.getVisiblePrDiffReviewedIntervalsForTest(deletion.original), [reviewed(1, 3)]);
    await focus("original", deletion, 1);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "deletion");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [], "The original-side public unmark clears a deletion-only block.");

    const eol = await openProgressFile(api, "eol");
    await focus("modified", eol, 0);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "eol");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(0, 1)], "An EOL-only immutable diff reviews its original content line.");
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(0, 1)]);
    assert.deepEqual(state.global, [reviewed(0, 1)]);

    const boundary = await openProgressFile(api, "boundary");
    await focus("original", boundary, 1);
    const boundaryEditor = vscode.window.activeTextEditor;
    assert.ok(boundaryEditor);
    boundaryEditor.selection = new vscode.Selection(1, 0, 3, 0);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "boundary");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(1, 2)], "A nonempty selection ending at the next changed line column 0 excludes that next block while retaining its selected context.");
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(1, 3)], "The selected intervening context is preserved through normal mapping.");
    assertDoesNotReviewLine(api.getVisiblePrDiffReviewedIntervalsForTest(boundary.original), 3, "The original renderer must not decorate the next changed block at the column-0 boundary.");
    assertDoesNotReviewLine(api.getVisiblePrDiffReviewedIntervalsForTest(boundary.modified), 3, "The modified renderer must not decorate the next changed block at the column-0 boundary.");
    boundaryEditor.selection = new vscode.Selection(3, 0, 1, 0);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "boundary");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [], "The reverse selection has the same column-0 boundary and clears only its first block.");
    assert.deepEqual(state.file.modifiedReviewed, []);
    assert.deepEqual(state.global, []);

    await api.initializePullRequestReviewRuntimeForTest(fixture(workspace, {
      originalReviewedByFile: { replacement: [reviewed(1, 3)] },
      modifiedReviewedByFile: { replacement: [reviewed(1, 3)] },
      globalReviewedByFile: { replacement: [] }
    }));
    const mismatch = await openProgressFile(api, "replacement");
    await focus("modified", mismatch, 1);
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "replacement");
    assert.deepEqual(state.file.originalReviewedByDiff[diffId], [reviewed(1, 3)]);
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(1, 3)]);
    assert.deepEqual(state.global, [reviewed(1, 3)], "A public block mark repairs a persisted Global-only mismatch.");

    await focus("modified", mismatch, 0);
    await vscode.commands.executeCommand("reviewRange.unmarkSelectionReviewed");
    await refresh(api);
    state = await stateFor(api, "replacement");
    assert.deepEqual(state.file.modifiedReviewed, [reviewed(1, 3)], "A cursor on context never expands to a neighboring change block.");
  } finally {
    await configuration.update("prDiffSelectionMode", undefined, vscode.ConfigurationTarget.Workspace);
  }
}

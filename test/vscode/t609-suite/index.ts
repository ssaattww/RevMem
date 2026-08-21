import assert from "node:assert/strict";
import path from "node:path";

import * as vscode from "vscode";

const phase = process.env.REVIEW_RANGE_TEST_PHASE;
const isPrepare = phase === "prepare";
const isSingleRoot = phase === "single-root";
assert.ok(isSingleRoot || isPrepare || phase === "restart-reopen", `Unexpected T609 phase: ${String(phase)}`);

interface T609ExtensionApi {
  drainDocumentReviewEdits(): Promise<void>;
  seedT609InitialReviewedRanges(editors: readonly vscode.TextEditor[]): Promise<readonly {
    readonly documentUri: string;
    readonly contextIntervals: readonly ReviewedIntervalSnapshot[];
    readonly globalIntervals: readonly ReviewedIntervalSnapshot[];
  }[]>;
  refreshVisibleEditorDecorations(): Promise<void>;
  drainVisibleEditorDecorations(): Promise<void>;
  getObservedEncodingHintsForTest(): readonly {
    readonly documentFsPath: string;
    readonly encodingHint?: string;
  }[];
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  getNormalEditorCommandFailureForTest(): {
    readonly operation: string;
    readonly message: string;
  } | undefined;
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: { readonly files: readonly { readonly path: string }[] };
  } | undefined>;
  setReviewContextsRepositorySelection(selection: "cancel" | "stale"): void;
  setCurrentContextSelectionForTest(selection: "first" | "cancel" | "stale"): void;
  getCurrentContextCancellationSnapshotForTest(): {
    readonly selectedContext: string | undefined;
    readonly dependentRefreshCount: number;
  };
  getReviewContextsCancellationSnapshot(): Promise<{
    readonly providerProjection: readonly string[];
    readonly authoritativeContextCounts: readonly { readonly repositoryId: string; readonly count: number }[];
    readonly repositorySelectionRequestCount: number;
  }>;
}

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

const within = async <Value>(label: string, work: PromiseLike<Value>): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<Value>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`T609 Extension Host timed out: ${label}`)), 10_000);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const fixtureUri = (folder: vscode.WorkspaceFolder, name: string): vscode.Uri =>
  vscode.Uri.joinPath(folder.uri, name);

const closeAllEditors = async (): Promise<void> => {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  assert.equal(vscode.window.activeTextEditor, undefined, "the T609 repository path must start without an active editor");
};

const assertMultiRootCancellation = async (folder: vscode.WorkspaceFolder): Promise<void> => {
  const initialSecondRootPath = path.join(path.dirname(folder.uri.fsPath), "t609-second-root");
  assert.equal(
    (vscode.workspace.workspaceFolders ?? []).some((candidate) => candidate.uri.fsPath === initialSecondRootPath),
    true,
    "the T609 runner must start in the two-root workspace before adding another repository"
  );
  await closeAllEditors();
  const workspaceFolderPaths = (vscode.workspace.workspaceFolders ?? []).map((candidate) => candidate.uri.fsPath);
  assert.equal(
    workspaceFolderPaths.includes(initialSecondRootPath),
    true,
    "the cancellation trigger must observe both initially configured repository roots"
  );
};

const markAndSynchronizeFixtureReview = async (
  label: string,
  editor: vscode.TextEditor,
  api: T609ExtensionApi
): Promise<void> => {
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    editor.document.uri.toString(),
    `${label} fixture must be the active editor before its selected-root review starts`
  );
  try {
    await within(`mark ${label} public command`, vscode.commands.executeCommand("reviewRange.markSelectionReviewed"));
  } catch (error) {
    const diagnostic = api.getNormalEditorCommandFailureForTest();
    if (diagnostic !== undefined && error instanceof Error) {
      error.message += ` [T609 public command diagnostic: operation=${diagnostic.operation}; error=${diagnostic.message}]`;
    }
    throw error;
  }
  await within(`drain ${label} document state`, api.drainDocumentReviewEdits());
  await within(`refresh ${label} decorations`, api.refreshVisibleEditorDecorations());
  await within(`drain ${label} decorations`, api.drainVisibleEditorDecorations());
  assert.deepEqual(
    api.getVisibleReviewedIntervals(editor.document.uri.toString()),
    [{ startLine: 0, endLineExclusive: 1 }],
    `${label} review must persist before its visible decoration is observed`
  );
};

const assertMixedEncodingFixture = async (
  folder: vscode.WorkspaceFolder,
  api: T609ExtensionApi
): Promise<void> => {
  const shifted = await within("open Shift-JIS document", vscode.workspace.openTextDocument(fixtureUri(folder, "shift-jis.txt")));
  const utf8Bom = await within("open UTF-8 BOM document", vscode.workspace.openTextDocument(fixtureUri(folder, "utf8-bom.txt")));
  await within("open isolated invalid document", vscode.workspace.openTextDocument(fixtureUri(folder, "invalid.txt")));
  assert.match(shifted.getText(), /あ/u, "opened Shift-JIS text must use the VS Code decoding hint");
  assert.match(utf8Bom.getText(), /beta/u);
  const shiftedEditor = await vscode.window.showTextDocument(shifted, { preview: false });
  shiftedEditor.selection = new vscode.Selection(0, 0, 0, 0);
  await markAndSynchronizeFixtureReview("Shift-JIS", shiftedEditor, api);
  const utf8Editor = await vscode.window.showTextDocument(utf8Bom, { preview: false });
  utf8Editor.selection = new vscode.Selection(0, 0, 0, 0);
  await markAndSynchronizeFixtureReview("UTF-8 BOM", utf8Editor, api);
  await within("refresh Global mixed encoding", vscode.commands.executeCommand("reviewRange.refreshGlobalUnderstanding"));
  const global = await api.getGlobalUnderstandingSnapshot();
  assert.ok(global, "one invalid file must not prevent Global Understanding from continuing");
  const paths = global.progress.files.map((file) => file.path);
  assert.equal(paths.includes("shift-jis.txt"), true);
  assert.equal(paths.includes("utf8-bom.txt"), true);
};

const assertMappedGitTransitions = async (
  folder: vscode.WorkspaceFolder,
  api: T609ExtensionApi
): Promise<void> => {
  const reviewed = async (name: string): Promise<readonly ReviewedIntervalSnapshot[]> => {
    const document = await within(`open mapped ${name}`, vscode.workspace.openTextDocument(fixtureUri(folder, name)));
    await within(`show mapped ${name}`, vscode.window.showTextDocument(document, { preview: false }));
    await within(`refresh mapped ${name}`, api.refreshVisibleEditorDecorations());
    await within(`drain mapped ${name}`, api.drainVisibleEditorDecorations());
    return api.getVisibleReviewedIntervals(document.uri.toString());
  };
  assert.deepEqual(
    await reviewed("renamed.txt"),
    [{ startLine: 0, endLineExclusive: 1 }],
    "a committed Git rename must retain the reviewed stable identity through the public normal-editor composition"
  );
  assert.deepEqual(
    await reviewed("new-file.txt"),
    [],
    "a newly committed file must not inherit the renamed source's reviewed interval"
  );
  assert.deepEqual(
    await reviewed("whitespace.txt"),
    [{ startLine: 0, endLineExclusive: 1 }],
    "a whitespace-only Git transition must preserve review through the configured production mapping option"
  );
  assert.deepEqual(
    await reviewed("eol.txt"),
    [{ startLine: 0, endLineExclusive: 1 }],
    "an EOL-only Git transition must preserve review through the configured production mapping option"
  );
};

/** Exercises the T609 gate through one owned runner invocation and explicit lifecycle phases. */
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "T609 requires the dedicated workspace fixture");
  await within("close editors", closeAllEditors());

  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host must load the extension.");
  const api = (await within("activate extension", extension.activate())) as T609ExtensionApi;

  if (isSingleRoot) {
    await within("no-active-editor Current Context", vscode.commands.executeCommand("reviewRange.refreshContext"));
    await within("no-active-editor Review Contexts", vscode.commands.executeCommand("reviewRange.refreshReviewContexts"));
    await assertMixedEncodingFixture(folder, api);
    const mappingSeedEditors: vscode.TextEditor[] = [];
    for (const name of ["rename-source.txt", "whitespace.txt", "eol.txt"]) {
      const document = await within(`open mapping seed ${name}`, vscode.workspace.openTextDocument(fixtureUri(folder, name)));
      const editor = await within(`show mapping seed ${name}`, vscode.window.showTextDocument(document, { preview: false }));
      mappingSeedEditors.push(editor);
    }
    const seed = await within("seed initial mapping ranges", api.seedT609InitialReviewedRanges(mappingSeedEditors));
    assert.deepEqual(
      seed.map((entry) => ({ contextIntervals: entry.contextIntervals, globalIntervals: entry.globalIntervals })),
      Array.from({ length: 3 }, () => ({
        contextIntervals: [{ startLine: 0, endLineExclusive: 1 }],
        globalIntervals: [{ startLine: 0, endLineExclusive: 1 }]
      })),
      "the T609 seed must persist all initial intervals through the read-only production state query"
    );
    return;
  }

  if (!isPrepare) {
    const reopened = await within("reopen only UTF-8 BOM document", vscode.workspace.openTextDocument(fixtureUri(folder, "utf8-bom.txt")));
    assert.match(reopened.getText(), /beta/u);
    const reopenedEditor = await within(
      "activate reopened UTF-8 BOM document",
      vscode.window.showTextDocument(reopened, { preview: false })
    );
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      reopenedEditor.document.uri.toString(),
      "restart must restore Current Context from the reopened UTF-8 BOM editor"
    );
    assert.equal(
      vscode.workspace.textDocuments.some((document) => document.uri.path.endsWith("shift-jis.txt")),
      false,
      "a restarted host must not reuse an encoding hint by reopening an unopened file"
    );
    assert.equal(
      vscode.workspace.textDocuments.some((document) => document.uri.path.endsWith("invalid.txt")),
      false,
      "a restarted host must not reopen the invalid document"
    );
    await within("refresh reopened UTF-8 BOM decorations", api.refreshVisibleEditorDecorations());
    await within("drain reopened UTF-8 BOM decorations", api.drainVisibleEditorDecorations());
    const observedHints = api.getObservedEncodingHintsForTest();
    assert.deepEqual(
      observedHints.map((hint) => hint.documentFsPath),
      [reopened.uri.fsPath],
      "restart must observe only the reopened UTF-8 BOM document"
    );
    assert.deepEqual(
      observedHints.map((hint) => hint.encodingHint),
      [reopened.encoding],
      "restart must use the current Host's reopened document encoding hint"
    );
    return;
  }

  await within("multi-root fixture readiness", assertMultiRootCancellation(folder));
  await within("committed rename/new/whitespace/EOL mapping", assertMappedGitTransitions(folder, api));
  api.setCurrentContextSelectionForTest("first");
  await within("seed multi-root Current Context", vscode.commands.executeCommand("reviewRange.refreshContext"));
  const currentBefore = api.getCurrentContextCancellationSnapshotForTest();
  assert.ok(currentBefore.selectedContext, "a deterministic initial selection must be published through the public command");
  api.setCurrentContextSelectionForTest("cancel");
  await within("multi-root Current Context cancel", vscode.commands.executeCommand("reviewRange.refreshContext"));
  assert.deepEqual(api.getCurrentContextCancellationSnapshotForTest(), currentBefore, "Current Context cancel must retain selection and dependent state");
  api.setCurrentContextSelectionForTest("stale");
  await within("multi-root Current Context stale", vscode.commands.executeCommand("reviewRange.selectContext"));
  assert.deepEqual(api.getCurrentContextCancellationSnapshotForTest(), currentBefore, "post-pick stale selection must retain accepted state");
  await within("seed multi-root Review Contexts projection", vscode.commands.executeCommand("reviewRange.refreshReviewContexts"));
  const before = await within("read accepted multi-root Review Contexts snapshot", api.getReviewContextsCancellationSnapshot());
  assert.ok(before.providerProjection.length > 0, "multi-root cancellation must retain an accepted provider projection");
  api.setReviewContextsRepositorySelection("cancel");
  await within("multi-root cancellation boundary", vscode.commands.executeCommand("reviewRange.redetectPullRequest"));
  const afterCancel = await within("read cancel Review Contexts snapshot", api.getReviewContextsCancellationSnapshot());
  assert.equal(
    afterCancel.repositorySelectionRequestCount,
    before.repositorySelectionRequestCount + 1,
    "cancel must reach the multi-root repository-selection seam through the T405 command"
  );
  assert.deepEqual(afterCancel.providerProjection, before.providerProjection, "cancel must retain the accepted provider projection");
  assert.deepEqual(afterCancel.authoritativeContextCounts, before.authoritativeContextCounts, "cancel must not mutate authoritative Review State");
  api.setReviewContextsRepositorySelection("stale");
  await within("multi-root stale cancellation boundary", vscode.commands.executeCommand("reviewRange.redetectPullRequest"));
  const afterStale = await within("read stale Review Contexts snapshot", api.getReviewContextsCancellationSnapshot());
  assert.equal(
    afterStale.repositorySelectionRequestCount,
    afterCancel.repositorySelectionRequestCount + 1,
    "stale selection must reach the multi-root repository-selection seam through the T405 command"
  );
  assert.deepEqual(afterStale.providerProjection, before.providerProjection, "stale selection must retain the accepted provider projection");
  assert.deepEqual(afterStale.authoritativeContextCounts, before.authoritativeContextCounts, "stale selection must not mutate authoritative Review State");
}

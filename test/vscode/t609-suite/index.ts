import assert from "node:assert/strict";
import path from "node:path";

import * as vscode from "vscode";

const phase = process.env.REVIEW_RANGE_TEST_PHASE;
const isPrepare = phase === "prepare";
const isSingleRoot = phase === "single-root";
assert.ok(isSingleRoot || isPrepare || phase === "restart-reopen", `Unexpected T609 phase: ${String(phase)}`);
const timingStartedAt = Date.now();
const checkpoint = (name: string): void => {
  process.stderr.write(`[T609 timing] phase=${String(phase)} checkpoint=${name} elapsed_ms=${Date.now() - timingStartedAt}\n`);
};

interface T609ExtensionApi {
  drainCurrentContextStartupForTest(): Promise<void>;
  drainDocumentReviewEdits(): Promise<void>;
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
  getCurrentContextSelectionRequestCountForTest(): number;
  getReviewContextsCancellationSnapshot(): Promise<{
    readonly providerProjection: readonly string[];
    readonly authoritativeContextCounts: readonly { readonly repositoryId: string; readonly count: number }[];
    readonly repositorySelectionRequestCount: number;
  }>;
  /** Read-only T305 URI boundary observation using an actual VS Code Uri. */
  getT305WorkspaceUriPathForTest(uri: vscode.Uri): string | undefined;
  /** Read-only T405 URI boundary observation using an actual VS Code Uri. */
  getT405WorkspaceUriPathForTest(uri: vscode.Uri): string | undefined;
  /** Read-only persisted Git state summary for the supplied workspace document. */
  getGitReviewStateSnapshotForTest(document: vscode.TextDocument): Promise<GitReviewStateSnapshot>;
}

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface GitReviewStateSnapshot {
  readonly owner: "git";
  readonly repositoryId: string;
  readonly contextId: string;
  readonly contextRevisionId: string;
  readonly globalRevisionId: string;
  readonly contextFiles: readonly ReviewStateFileSnapshot[];
  readonly globalFiles: readonly ReviewStateFileSnapshot[];
}

interface ReviewStateFileSnapshot {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
  readonly reviewed: readonly ReviewedIntervalSnapshot[];
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

const closeDocument = async (document: vscode.TextDocument, discardChanges = false): Promise<void> => {
  if (document.isClosed) return;
  const targetTab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => {
    if (!(tab.input instanceof vscode.TabInputText)) return false;
    return tab.input.uri.toString(true) === document.uri.toString(true);
  });
  assert.ok(targetTab, `the T609 fixture must find an open text tab for ${document.uri.toString(true)}`);
  let disposable: vscode.Disposable | undefined;
  const closed = new Promise<void>((resolve) => {
    disposable = vscode.workspace.onDidCloseTextDocument((candidate) => {
      if (candidate.uri.toString(true) !== document.uri.toString(true)) return;
      disposable?.dispose();
      resolve();
    });
  });
  try {
    if (discardChanges) {
      assert.equal(document.isUntitled, true, "only the dirty virtual T609 document may use discard close");
      assert.equal(document.isDirty, true, "the virtual T609 document must still be dirty before discard close");
      assert.equal(
        vscode.window.activeTextEditor?.document.uri.toString(true),
        document.uri.toString(true),
        "the dirty virtual T609 document must be active before discard close"
      );
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    } else {
      await vscode.window.tabGroups.close(targetTab);
    }
    await closed;
  } catch (error) {
    disposable?.dispose();
    throw error;
  }
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
    await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");
  } catch (error) {
    const diagnostic = api.getNormalEditorCommandFailureForTest();
    if (diagnostic !== undefined && error instanceof Error) {
      error.message += ` [T609 public command diagnostic: operation=${diagnostic.operation}; error=${diagnostic.message}]`;
    }
    throw error;
  }
  await api.drainDocumentReviewEdits();
  await api.refreshVisibleEditorDecorations();
  await api.drainVisibleEditorDecorations();
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
  await assertPersistedMixedEncodingBoundary("Shift-JIS public mark", shifted, api);
  const utf8Editor = await vscode.window.showTextDocument(utf8Bom, { preview: false });
  utf8Editor.selection = new vscode.Selection(0, 0, 0, 0);
  await markAndSynchronizeFixtureReview("UTF-8 BOM", utf8Editor, api);
  await assertPersistedMixedEncodingBoundary("UTF-8 BOM public mark", shifted, api);
  await within("refresh Global mixed encoding", vscode.commands.executeCommand("reviewRange.refreshGlobalUnderstanding"));
  const global = await api.getGlobalUnderstandingSnapshot();
  assert.ok(global, "one invalid file must not prevent Global Understanding from continuing");
  const paths = global.progress.files.map((file) => file.path);
  assert.equal(paths.includes("shift-jis.txt"), true);
  assert.equal(paths.includes("utf8-bom.txt"), true);
  await assertPersistedMixedEncodingBoundary("Global refresh", shifted, api);
};

const findStateFile = (
  files: readonly ReviewStateFileSnapshot[],
  path: string
): ReviewStateFileSnapshot => {
  const found = files.find((file) => file.path === path);
  assert.ok(found, `persisted state must contain ${path}`);
  return found;
};

/** Adds read-only owner and file-state evidence when a public boundary loses Shift-JIS review state. */
const assertPersistedMixedEncodingBoundary = async (
  boundary: string,
  document: vscode.TextDocument,
  api: T609ExtensionApi
): Promise<GitReviewStateSnapshot> => {
  const snapshot = await api.getGitReviewStateSnapshotForTest(document);
  try {
    assert.deepEqual(
      findStateFile(snapshot.contextFiles, "shift-jis.txt").reviewed,
      [{ startLine: 0, endLineExclusive: 1 }],
      `${boundary} must retain Shift-JIS Context review state`
    );
    assert.deepEqual(
      findStateFile(snapshot.globalFiles, "shift-jis.txt").reviewed,
      [{ startLine: 0, endLineExclusive: 1 }],
      `${boundary} must retain Shift-JIS Global review state`
    );
  } catch (error) {
    if (error instanceof Error) {
      error.message += ` [T609 persisted-state diagnostic: boundary=${boundary}; owner=${snapshot.owner}; repositoryId=${snapshot.repositoryId}; contextId=${snapshot.contextId}; contextFiles=${JSON.stringify(snapshot.contextFiles)}; globalFiles=${JSON.stringify(snapshot.globalFiles)}]`;
    }
    throw error;
  }
  return snapshot;
};

const assertActualUriBoundaries = async (
  folder: vscode.WorkspaceFolder,
  api: T609ExtensionApi
): Promise<void> => {
  const file = vscode.Uri.file(path.join(folder.uri.fsPath, "utf8-bom.txt"));
  const query = file.with({ query: "revision=old" });
  const fragment = file.with({ fragment: "selection" });
  const untitled = vscode.Uri.parse("untitled:T609-virtual.txt");
  const remote = vscode.Uri.parse("vscode-remote://ssh-remote%2Bt609/tmp/file.txt");
  const probes = [api.getT305WorkspaceUriPathForTest, api.getT405WorkspaceUriPathForTest];
  for (const probe of probes) {
    assert.equal(probe.call(api, file), file.fsPath, "a plain workspace file Uri must be accepted");
    assert.equal(probe.call(api, query), undefined, "a query-bearing file Uri must be rejected");
    assert.equal(probe.call(api, fragment), undefined, "a fragment-bearing file Uri must be rejected");
    assert.equal(probe.call(api, untitled), undefined, "an untitled Uri must be rejected");
    assert.equal(probe.call(api, remote), undefined, "a non-workspace remote Uri must be rejected");
  }
  const virtual = await vscode.workspace.openTextDocument({ content: "virtual T609\n" });
  await vscode.window.showTextDocument(virtual, { preview: false });
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  await vscode.commands.executeCommand("reviewRange.refreshReviewContexts");
  await within("discard dirty virtual document", closeDocument(virtual, true));
};

const assertLiveEncodingTransition = async (
  folder: vscode.WorkspaceFolder,
  api: T609ExtensionApi
): Promise<void> => {
  const shiftedUri = fixtureUri(folder, "shift-jis.txt");
  const bomUri = fixtureUri(folder, "utf8-bom.txt");
  const shifted = await vscode.workspace.openTextDocument(shiftedUri);
  const bom = await vscode.workspace.openTextDocument(bomUri);
  const before = await assertPersistedMixedEncodingBoundary("before live encoding transition", shifted, api);
  assert.equal(before.owner, "git");
  assert.deepEqual(findStateFile(before.contextFiles, "shift-jis.txt").reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  assert.deepEqual(findStateFile(before.globalFiles, "shift-jis.txt").reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  const unaffectedContext = findStateFile(before.contextFiles, "utf8-bom.txt");
  const unaffectedGlobal = findStateFile(before.globalFiles, "utf8-bom.txt");
  await vscode.workspace.getConfiguration("files", shiftedUri).update("encoding", "utf8", vscode.ConfigurationTarget.WorkspaceFolder);
  await closeDocument(shifted);
  const reopened = await vscode.workspace.openTextDocument(shiftedUri);
  await vscode.window.showTextDocument(reopened, { preview: false });
  assert.equal(reopened.encoding, "utf8", "the opened document must be re-decoded through VS Code after its encoding changes");
  await api.refreshVisibleEditorDecorations();
  await api.drainVisibleEditorDecorations();
  const after = await api.getGitReviewStateSnapshotForTest(reopened);
  assert.equal(after.owner, "git");
  assert.equal(after.contextRevisionId, before.contextRevisionId);
  assert.equal(after.globalRevisionId, before.globalRevisionId);
  assert.deepEqual(findStateFile(after.contextFiles, "shift-jis.txt").reviewed, []);
  assert.deepEqual(findStateFile(after.globalFiles, "shift-jis.txt").reviewed, []);
  assert.deepEqual(findStateFile(after.contextFiles, "utf8-bom.txt"), unaffectedContext);
  assert.deepEqual(findStateFile(after.globalFiles, "utf8-bom.txt"), unaffectedGlobal);
  assert.equal(bom.isClosed, false, "the unrelated opened document must remain observed");
  await vscode.workspace.getConfiguration("files", shiftedUri).update("encoding", "shift_jis", vscode.ConfigurationTarget.WorkspaceFolder);
};

const assertMappedGitTransitions = async (
  folder: vscode.WorkspaceFolder,
  api: T609ExtensionApi
): Promise<void> => {
  const reviewed = async (name: string): Promise<readonly ReviewedIntervalSnapshot[]> => {
    const document = await within(`open mapped ${name}`, vscode.workspace.openTextDocument(fixtureUri(folder, name)));
    await within(`show mapped ${name}`, vscode.window.showTextDocument(document, { preview: false }));
    await api.refreshVisibleEditorDecorations();
    await api.drainVisibleEditorDecorations();
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
  checkpoint("run-start");
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "T609 requires the dedicated workspace fixture");
  await within("close editors", closeAllEditors());

  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "The Extension Development Host must load the extension.");
  const api = (await within("activate extension", extension.activate())) as T609ExtensionApi;
  await within("drain startup Current Context", api.drainCurrentContextStartupForTest());
  assert.equal(
    api.getCurrentContextSelectionRequestCountForTest(),
    0,
    "startup Current Context must not open a multi-root Quick Pick"
  );
  checkpoint("startup-drained");

  if (isSingleRoot) {
    await within("no-active-editor Current Context", vscode.commands.executeCommand("reviewRange.refreshContext"));
    await within("no-active-editor Review Contexts", vscode.commands.executeCommand("reviewRange.refreshReviewContexts"));
    checkpoint("no-active-commands");
    await assertActualUriBoundaries(folder, api);
    checkpoint("uri-boundaries");
    await assertMixedEncodingFixture(folder, api);
    checkpoint("mixed-encoding");
    await assertLiveEncodingTransition(folder, api);
    checkpoint("live-encoding");
    checkpoint("run-return");
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
    const persisted = await api.getGitReviewStateSnapshotForTest(reopened);
    assert.equal(persisted.owner, "git");
    assert.equal(persisted.contextRevisionId, persisted.globalRevisionId);
    assert.deepEqual(findStateFile(persisted.contextFiles, "shift-jis.txt").reviewed, []);
    assert.deepEqual(findStateFile(persisted.globalFiles, "shift-jis.txt").reviewed, []);
    assert.deepEqual(findStateFile(persisted.contextFiles, "utf8-bom.txt").reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
    assert.deepEqual(findStateFile(persisted.globalFiles, "utf8-bom.txt").reviewed, [{ startLine: 0, endLineExclusive: 1 }]);
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
    checkpoint("run-return");
    return;
  }

  await within("multi-root fixture readiness", assertMultiRootCancellation(folder));
  await assertMappedGitTransitions(folder, api);
  await within("clear mapped editor before Current Context selection", closeAllEditors());
  api.setCurrentContextSelectionForTest("first");
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  assert.equal(api.getCurrentContextSelectionRequestCountForTest(), 1, "the explicit refresh command must request selection");
  const currentBefore = api.getCurrentContextCancellationSnapshotForTest();
  assert.ok(currentBefore.selectedContext, "a deterministic initial selection must be published through the public command");
  api.setCurrentContextSelectionForTest("cancel");
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  assert.equal(api.getCurrentContextSelectionRequestCountForTest(), 2, "the public cancel command must reach selection once");
  assert.deepEqual(api.getCurrentContextCancellationSnapshotForTest(), currentBefore, "Current Context cancel must retain selection and dependent state");
  api.setCurrentContextSelectionForTest("stale");
  await vscode.commands.executeCommand("reviewRange.selectContext");
  assert.equal(api.getCurrentContextSelectionRequestCountForTest(), 3, "the public stale selection must reach selection once");
  assert.deepEqual(api.getCurrentContextCancellationSnapshotForTest(), currentBefore, "post-pick stale selection must retain accepted state");
  await vscode.commands.executeCommand("reviewRange.refreshReviewContexts");
  const before = await api.getReviewContextsCancellationSnapshot();
  assert.ok(before.providerProjection.length > 0, "multi-root cancellation must retain an accepted provider projection");
  api.setReviewContextsRepositorySelection("cancel");
  await vscode.commands.executeCommand("reviewRange.redetectPullRequest");
  const afterCancel = await api.getReviewContextsCancellationSnapshot();
  assert.equal(
    afterCancel.repositorySelectionRequestCount,
    before.repositorySelectionRequestCount + 1,
    "cancel must reach the multi-root repository-selection seam through the T405 command"
  );
  assert.deepEqual(afterCancel.providerProjection, before.providerProjection, "cancel must retain the accepted provider projection");
  assert.deepEqual(afterCancel.authoritativeContextCounts, before.authoritativeContextCounts, "cancel must not mutate authoritative Review State");
  api.setReviewContextsRepositorySelection("stale");
  await vscode.commands.executeCommand("reviewRange.redetectPullRequest");
  const afterStale = await api.getReviewContextsCancellationSnapshot();
  assert.equal(
    afterStale.repositorySelectionRequestCount,
    afterCancel.repositorySelectionRequestCount + 1,
    "stale selection must reach the multi-root repository-selection seam through the T405 command"
  );
  assert.deepEqual(afterStale.providerProjection, before.providerProjection, "stale selection must retain the accepted provider projection");
  assert.deepEqual(afterStale.authoritativeContextCounts, before.authoritativeContextCounts, "stale selection must not mutate authoritative Review State");
  checkpoint("run-return");
}

import assert from "node:assert/strict";

import * as vscode from "vscode";

interface T610ExtensionApi {
  drainCurrentContextStartupForTest(): Promise<void>;
  drainStartupGlobalUnderstandingForTest(): Promise<void>;
  drainGlobalUnderstandingFileOpenForTest(): Promise<void>;
  getGlobalUnderstandingDocumentObservationCountForTest(): number;
  drainNextGlobalUnderstandingDocumentObservationForTest(previousCount: number): Promise<void>;
  drainGlobalUnderstandingFolderEntryForTest(): Promise<void>;
  getGlobalUnderstandingFolderEntryCountForTest(): number;
  settleGlobalUnderstandingFolderEntryEventsForTest(): Promise<void>;
  disposeGlobalUnderstandingFolderEntryWatcherForTest(): void;
  recordT610HostSubphaseForTest(subphase: string): Promise<void>;
  getCurrentContextCancellationSnapshotForTest(): {
    readonly selectedContext: string | undefined;
  };
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: { readonly files: readonly { readonly path: string }[] };
    readonly folders?: readonly { readonly path: string; readonly state: string }[];
  } | undefined>;
  getGlobalUnderstandingPresentationForTest(): {
    readonly folderHierarchy: readonly { readonly path: string; readonly state: string; readonly description: string; readonly children: readonly unknown[] }[];
    readonly summaryDescription: string;
    readonly statusText: string;
  } | undefined;
  getGlobalUnderstandingFolderNodeForTest(folderPath: string): unknown;
  getGlobalUnderstandingUiErrorsForTest(): readonly string[];
  getGlobalUnderstandingLifecycleObservationForTest(): {
    readonly sourceContext: string | undefined;
    readonly acceptedDocumentOpenCount: number;
    readonly observedDocumentPath: string | undefined;
    readonly fileOpenOutcome: string;
    readonly sourceRefreshOutcome: string;
    readonly sourceRefreshError: string | undefined;
    readonly publishedSnapshot: boolean;
  };
  setCurrentContextSelectionForTest(selection: "first" | "cancel" | "stale"): void;
}

const phase = process.env.REVIEW_RANGE_TEST_PHASE;

/** Closes exactly the document opened by this suite and releases its private close listener. */
const closeDocument = async (document: vscode.TextDocument): Promise<void> => {
  const targetTab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => {
    if (!(tab.input instanceof vscode.TabInputText)) return false;
    return tab.input.uri.toString(true) === document.uri.toString(true);
  });
  assert.ok(targetTab, `the T610 fixture must find an open text tab for ${document.uri.toString(true)}`);
  let disposable: vscode.Disposable | undefined;
  const closed = new Promise<void>((resolve) => {
    disposable = vscode.workspace.onDidCloseTextDocument((candidate) => {
      if (candidate.uri.toString(true) !== document.uri.toString(true)) return;
      disposable?.dispose();
      resolve();
    });
  });
  try {
    await vscode.window.tabGroups.close(targetTab);
    await closed;
  } finally {
    disposable?.dispose();
  }
};

/** Exercises the exported production T305 lifecycle across a real Host restart. */
export async function run(): Promise<void> {
  assert.ok(phase === "t610-initial" || phase === "t610-restart", `Unexpected T610 phase: ${String(phase)}`);
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "T610 requires the contributed extension");
  const workspace = vscode.workspace.workspaceFolders![0]!;
  const foreignWorkspace = vscode.workspace.workspaceFolders![1]!;
  const preactivationDocument = phase === "t610-initial"
    ? await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace.uri, "src", "a.ts"))
    : undefined;
  const api = await extension.activate() as T610ExtensionApi;
  await api.recordT610HostSubphaseForTest("activation-returned");
  api.setCurrentContextSelectionForTest("first");
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  await api.drainCurrentContextStartupForTest();
  await api.drainStartupGlobalUnderstandingForTest();
  assert.notEqual(
    api.getCurrentContextCancellationSnapshotForTest().selectedContext,
    undefined,
    "the no-active-editor Current Context refresh establishes the Git repository before document open"
  );
  await api.recordT610HostSubphaseForTest("context-ready");
  if (phase === "t610-restart") {
    const restored = await api.getGlobalUnderstandingSnapshot();
    assert.ok(restored, "restart exposes the stopped-only Tree snapshot");
    assert.deepEqual(restored.progress.files, [], "restart never restores active file evidence");
    assert.equal(restored.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("restart-snapshot-observed");
    return;
  }
  const document = preactivationDocument!;
  const documentObservationBaseline = api.getGlobalUnderstandingDocumentObservationCountForTest();
  await vscode.window.showTextDocument(document);
  try {
    await api.recordT610HostSubphaseForTest("document-opened");
    await api.drainNextGlobalUnderstandingDocumentObservationForTest(documentObservationBaseline);
    const lifecycle = api.getGlobalUnderstandingLifecycleObservationForTest();
    assert.notEqual(lifecycle.sourceContext, undefined, "the selected Current Context remains bound to the Global source after open");
    assert.equal(lifecycle.sourceRefreshOutcome, "snapshot", `the source refresh publishes a snapshot: ${lifecycle.sourceRefreshError ?? "no source error"}`);
    assert.equal(lifecycle.publishedSnapshot, true, "the Global runtime publishes the source snapshot");
    const snapshot = await api.getGlobalUnderstandingSnapshot();
    assert.ok(snapshot, "actual activate/open wiring produces a Global snapshot");
    assert.ok(snapshot!.folders?.some((folder) => folder.path === "src"), "file open starts only its direct folder scope");
    assert.deepEqual(snapshot!.progress.files.map((file) => file.path), ["src/a.ts"]);
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition");
    const rootNode = api.getGlobalUnderstandingFolderNodeForTest("");
    assert.ok(rootNode, "the actual TreeDataProvider owns the current root start target");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition");
    await api.recordT610HostSubphaseForTest("before-public-start");
    await vscode.commands.executeCommand("reviewRange.startGlobalUnderstandingFolder", rootNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    await api.recordT610HostSubphaseForTest("after-public-start");
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition-active-src");
    const activeSrcNode = api.getGlobalUnderstandingFolderNodeForTest("src");
    assert.ok(activeSrcNode, "the actual TreeDataProvider owns the current src stop target");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition-active-src");
    await api.recordT610HostSubphaseForTest("before-mismatch-feedback-drain");
    await vscode.commands.executeCommand("reviewRange.startGlobalUnderstandingFolder", activeSrcNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.ok(
      api.getGlobalUnderstandingUiErrorsForTest().at(-1)?.includes("Review Range Output"),
      "a state-mismatched actual Tree target is rejected through the generic UI boundary"
    );
    await api.recordT610HostSubphaseForTest("after-mismatch-feedback-drain");
    await api.recordT610HostSubphaseForTest("before-public-stop");
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", document.uri);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-public-stop");
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition-stopped-src");
    const stoppedSrcNode = api.getGlobalUnderstandingFolderNodeForTest("src");
    assert.ok(stoppedSrcNode, "the actual TreeDataProvider refreshes the stopped resume target");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition-stopped-src");
    await api.recordT610HostSubphaseForTest("before-public-resume");
    await vscode.commands.executeCommand("reviewRange.resumeGlobalUnderstandingFolder", document.uri);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.notEqual((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-public-resume");
    await api.recordT610HostSubphaseForTest("before-second-root-open-owner-observation");
    const foreignDocument = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(foreignWorkspace.uri, "src", "a.ts"));
    await vscode.window.showTextDocument(foreignDocument, { preview: false });
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.deepEqual(
      (await api.getGlobalUnderstandingSnapshot())?.progress.files.map((file) => file.path),
      ["src/a.ts"],
      "an opened document from another workspace root never joins the selected owner"
    );
    const errorsBeforeForeignAction = api.getGlobalUnderstandingUiErrorsForTest().length;
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", foreignDocument.uri);
    assert.ok(api.getGlobalUnderstandingUiErrorsForTest().length > errorsBeforeForeignAction, "a foreign editor resource is rejected by the current-owner command boundary");
    await api.recordT610HostSubphaseForTest("after-second-root-open-owner-observation");
    await api.recordT610HostSubphaseForTest("before-foreign-document-close");
    await closeDocument(foreignDocument);
    await api.recordT610HostSubphaseForTest("after-foreign-document-close");
    await api.recordT610HostSubphaseForTest("before-hierarchy-status-probe");
    const nested = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace.uri, "src", "child", "b.ts"));
    await vscode.window.showTextDocument(nested, { preview: false });
    await api.drainGlobalUnderstandingFileOpenForTest();
    const presentation = api.getGlobalUnderstandingPresentationForTest();
    assert.ok(presentation, "the actual TreeDataProvider and Status Bar publish a presentation observation");
    assert.equal(presentation!.folderHierarchy[0]?.path, "", "the provider exposes the repository root row");
    const src = presentation!.folderHierarchy[0]?.children[0] as { readonly path?: string; readonly children?: readonly unknown[] } | undefined;
    assert.equal(src?.path, "src", "the provider nests the direct folder under its root row");
    assert.equal((src?.children?.[0] as { readonly path?: string } | undefined)?.path, "src/child", "the provider exposes the third-level folder hierarchy");
    await api.recordT610HostSubphaseForTest("after-hierarchy-status-probe");
    await api.recordT610HostSubphaseForTest("before-nested-document-close");
    await closeDocument(nested);
    await api.drainGlobalUnderstandingFileOpenForTest();
    await api.recordT610HostSubphaseForTest("after-nested-document-close");
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition-final-stop");
    const finalStopNode = api.getGlobalUnderstandingFolderNodeForTest("src/child");
    assert.ok(finalStopNode, "the leaf stop uses a current provider-owned target and leaves one resume candidate");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition-final-stop");
    await api.recordT610HostSubphaseForTest("before-final-public-stop");
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", finalStopNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src/child")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-final-public-stop");
    await api.recordT610HostSubphaseForTest("before-final-public-resume");
    await vscode.commands.executeCommand("reviewRange.resumeGlobalUnderstandingFolder");
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.notEqual((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src/child")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-final-public-resume");
    await api.recordT610HostSubphaseForTest("before-real-watcher-event");
    const inactiveWatcherFolder = vscode.Uri.joinPath(workspace.uri, "src", "inactive-watcher-child");
    await vscode.workspace.fs.createDirectory(inactiveWatcherFolder);
    await api.drainGlobalUnderstandingFolderEntryForTest();
    const watched = vscode.Uri.joinPath(inactiveWatcherFolder, "watcher-created.ts");
    const renamed = vscode.Uri.joinPath(inactiveWatcherFolder, "watcher-renamed.ts");
    await vscode.workspace.fs.writeFile(watched, new TextEncoder().encode("export const watcher = true;\n"));
    await api.drainGlobalUnderstandingFolderEntryForTest();
    await vscode.workspace.fs.writeFile(watched, new TextEncoder().encode("export const watcher = false;\n"));
    await api.drainGlobalUnderstandingFolderEntryForTest();
    await vscode.workspace.fs.rename(watched, renamed, { overwrite: true });
    await api.drainGlobalUnderstandingFolderEntryForTest();
    await vscode.workspace.fs.delete(renamed);
    await api.drainGlobalUnderstandingFolderEntryForTest();
    assert.equal(
      (await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state,
      "active",
      "the registered watcher callback refreshes the resumed folder scope"
    );
    assert.equal(
      (await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src/inactive-watcher-child")?.state,
      "inactive",
      "a newly discovered direct child is visible without starting or reading its contents"
    );
    const partialPresentation = api.getGlobalUnderstandingPresentationForTest();
    assert.ok(partialPresentation);
    assert.doesNotMatch(partialPresentation!.summaryDescription, /%/u, "a partial repository summary never exposes a percentage");
    assert.doesNotMatch(partialPresentation!.statusText, /%/u, "a partial repository Status Bar never exposes a percentage");
    const acceptedBeforeForeignMutation = api.getGlobalUnderstandingFolderEntryCountForTest();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(foreignWorkspace.uri, "src", "foreign-watcher.ts"), new TextEncoder().encode("export const foreign = true;\n"));
    await api.settleGlobalUnderstandingFolderEntryEventsForTest();
    assert.equal(api.getGlobalUnderstandingFolderEntryCountForTest(), acceptedBeforeForeignMutation, "a foreign-root watcher event is ignored");
    await api.recordT610HostSubphaseForTest("after-real-watcher-event");
    const finalSrcStopNode = api.getGlobalUnderstandingFolderNodeForTest("src");
    assert.ok(finalSrcStopNode, "restart persistence uses the current provider-owned src stop target");
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", finalSrcStopNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    api.disposeGlobalUnderstandingFolderEntryWatcherForTest();
    const acceptedBeforeDisposeMutation = api.getGlobalUnderstandingFolderEntryCountForTest();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(workspace.uri, "src", "after-dispose.ts"), new TextEncoder().encode("export const disposed = true;\n"));
    await api.settleGlobalUnderstandingFolderEntryEventsForTest();
    assert.equal(api.getGlobalUnderstandingFolderEntryCountForTest(), acceptedBeforeDisposeMutation, "disposed watcher registrations never fire");
    await api.recordT610HostSubphaseForTest("final-stop-completed");
  } finally {
    await api.recordT610HostSubphaseForTest("before-document-close");
    await closeDocument(document);
    await api.recordT610HostSubphaseForTest("after-document-close");
  }
}

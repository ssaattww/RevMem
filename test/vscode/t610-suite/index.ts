import assert from "node:assert/strict";

import * as vscode from "vscode";

interface T610ExtensionApi {
  drainCurrentContextStartupForTest(): Promise<void>;
  drainStartupGlobalUnderstandingForTest(): Promise<void>;
  drainGlobalUnderstandingFileOpenForTest(): Promise<void>;
  drainGlobalUnderstandingFolderEntryForTest(): Promise<void>;
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
  const api = await extension.activate() as T610ExtensionApi;
  await api.drainCurrentContextStartupForTest();
  await api.drainStartupGlobalUnderstandingForTest();
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  assert.notEqual(
    api.getCurrentContextCancellationSnapshotForTest().selectedContext,
    undefined,
    "the no-active-editor Current Context refresh establishes the Git repository before document open"
  );
  await api.recordT610HostSubphaseForTest("context-ready");
  const workspace = vscode.workspace.workspaceFolders![0]!;
  const foreignWorkspace = vscode.workspace.workspaceFolders![1]!;
  if (phase === "t610-restart") {
    const restored = await api.getGlobalUnderstandingSnapshot();
    assert.ok(restored, "restart exposes the stopped-only Tree snapshot");
    assert.deepEqual(restored.progress.files, [], "restart never restores active file evidence");
    assert.equal(restored.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("restart-snapshot-observed");
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, "src", "a.ts"));
  await vscode.window.showTextDocument(document);
  try {
    await api.recordT610HostSubphaseForTest("document-opened");
    await api.drainGlobalUnderstandingFileOpenForTest();
    const lifecycle = api.getGlobalUnderstandingLifecycleObservationForTest();
    assert.notEqual(lifecycle.sourceContext, undefined, "the selected Current Context remains bound to the Global source after open");
    assert.ok(lifecycle.acceptedDocumentOpenCount > 0, "the registered document-open event is accepted");
    assert.equal(lifecycle.observedDocumentPath, document.uri.fsPath, "the source observes the opened fixture path");
    assert.equal(lifecycle.fileOpenOutcome, "completed", "the source completes the accepted file-open observation");
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
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", activeSrcNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-public-stop");
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition-stopped-src");
    const stoppedSrcNode = api.getGlobalUnderstandingFolderNodeForTest("src");
    assert.ok(stoppedSrcNode, "the actual TreeDataProvider refreshes the stopped resume target");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition-stopped-src");
    await api.recordT610HostSubphaseForTest("before-public-resume");
    await vscode.commands.executeCommand("reviewRange.resumeGlobalUnderstandingFolder", stoppedSrcNode);
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
    assert.doesNotMatch(presentation!.summaryDescription, /%/u, "a partial repository summary never exposes a percentage");
    assert.doesNotMatch(presentation!.statusText, /%/u, "a partial repository Status Bar never exposes a percentage");
    await api.recordT610HostSubphaseForTest("after-hierarchy-status-probe");
    await api.recordT610HostSubphaseForTest("before-nested-document-close");
    await closeDocument(nested);
    await api.recordT610HostSubphaseForTest("after-nested-document-close");
    await api.recordT610HostSubphaseForTest("before-tree-node-acquisition-final-stop");
    const finalStopNode = api.getGlobalUnderstandingFolderNodeForTest("src");
    assert.ok(finalStopNode, "the final public stop uses a current provider-owned target");
    await api.recordT610HostSubphaseForTest("after-tree-node-acquisition-final-stop");
    await api.recordT610HostSubphaseForTest("before-final-public-stop");
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder", finalStopNode);
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-final-public-stop");
    await api.recordT610HostSubphaseForTest("before-final-public-resume");
    await vscode.commands.executeCommand("reviewRange.resumeGlobalUnderstandingFolder");
    await api.drainGlobalUnderstandingFileOpenForTest();
    assert.notEqual((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    await api.recordT610HostSubphaseForTest("after-final-public-resume");
    await api.recordT610HostSubphaseForTest("before-real-watcher-event");
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(workspace.uri, "src", "watcher-created.ts"), new TextEncoder().encode("export const watcher = true;\n"));
    await api.drainGlobalUnderstandingFolderEntryForTest();
    assert.equal(
      (await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state,
      "active",
      "the registered watcher callback refreshes the resumed folder scope"
    );
    await api.recordT610HostSubphaseForTest("after-real-watcher-event");
    await vscode.commands.executeCommand("reviewRange.stopGlobalUnderstandingFolder");
    await api.drainGlobalUnderstandingFileOpenForTest();
    await api.recordT610HostSubphaseForTest("final-stop-completed");
  } finally {
    await api.recordT610HostSubphaseForTest("before-document-close");
    await closeDocument(document);
    await api.recordT610HostSubphaseForTest("after-document-close");
  }
}

import assert from "node:assert/strict";

import * as vscode from "vscode";

interface T610ExtensionApi {
  drainCurrentContextStartupForTest(): Promise<void>;
  drainGlobalUnderstandingFileOpenForTest(): Promise<void>;
  getCurrentContextCancellationSnapshotForTest(): {
    readonly selectedContext: string | undefined;
  };
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: { readonly files: readonly { readonly path: string }[] };
    readonly folders?: readonly { readonly path: string; readonly state: string }[];
  } | undefined>;
  getGlobalUnderstandingLifecycleObservationForTest(): {
    readonly sourceContext: string | undefined;
    readonly acceptedDocumentOpenCount: number;
    readonly observedDocumentPath: string | undefined;
    readonly fileOpenOutcome: string;
    readonly sourceRefreshOutcome: string;
    readonly sourceRefreshError: string | undefined;
    readonly publishedSnapshot: boolean;
  };
  stopGlobalUnderstandingFolderForTest(folderPath: string): Promise<void>;
  resumeGlobalUnderstandingFolderForTest(folderPath: string): Promise<void>;
  notifyGlobalUnderstandingFolderEntryForTest(uri: vscode.Uri): Promise<void>;
}

const phase = process.env.REVIEW_RANGE_TEST_PHASE;

/** Exercises the exported production T305 lifecycle across a real Host restart. */
export async function run(): Promise<void> {
  assert.ok(phase === "t610-initial" || phase === "t610-restart", `Unexpected T610 phase: ${String(phase)}`);
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "T610 requires the contributed extension");
  const api = await extension.activate() as T610ExtensionApi;
  await api.drainCurrentContextStartupForTest();
  await vscode.commands.executeCommand("reviewRange.refreshContext");
  assert.notEqual(
    api.getCurrentContextCancellationSnapshotForTest().selectedContext,
    undefined,
    "the no-active-editor Current Context refresh establishes the Git repository before document open"
  );
  const workspace = vscode.workspace.workspaceFolders![0]!;
  if (phase === "t610-restart") {
    const restored = await api.getGlobalUnderstandingSnapshot();
    assert.ok(restored, "restart exposes the stopped-only Tree snapshot");
    assert.deepEqual(restored.progress.files, [], "restart never restores active file evidence");
    assert.equal(restored.folders?.find((folder) => folder.path === "src")?.state, "stopped");
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, "src", "a.ts"));
  await vscode.window.showTextDocument(document);
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
  await api.stopGlobalUnderstandingFolderForTest("src");
  assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
  await api.resumeGlobalUnderstandingFolderForTest("src");
  assert.notEqual((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
  await api.notifyGlobalUnderstandingFolderEntryForTest(vscode.Uri.joinPath(workspace.uri, "src", "watcher-created.ts"));
  assert.equal(
    (await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state,
    "active",
    "the registered watcher callback refreshes the resumed folder scope"
  );
  await api.stopGlobalUnderstandingFolderForTest("src");
}

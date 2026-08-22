import assert from "node:assert/strict";

import * as vscode from "vscode";

interface T610ExtensionApi {
  drainCurrentContextStartupForTest(): Promise<void>;
  getGlobalUnderstandingSnapshot(): Promise<{
    readonly progress: { readonly files: readonly { readonly path: string }[] };
    readonly folders?: readonly { readonly path: string; readonly state: string }[];
  } | undefined>;
  stopGlobalUnderstandingFolderForTest(folderPath: string): Promise<void>;
  resumeGlobalUnderstandingFolderForTest(folderPath: string): Promise<void>;
  notifyGlobalUnderstandingFolderEntryForTest(uri: vscode.Uri): Promise<void>;
}

const phase = process.env.REVIEW_RANGE_TEST_PHASE;

const waitFor = async <T>(
  label: string,
  operation: () => Promise<T>,
  predicate: (value: T) => boolean
): Promise<T> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await operation();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`T610 Extension Host timed out: ${label}`);
};

/** Exercises the exported production T305 lifecycle across a real Host restart. */
export async function run(): Promise<void> {
  assert.ok(phase === "t610-initial" || phase === "t610-restart", `Unexpected T610 phase: ${String(phase)}`);
  const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
  assert.ok(extension, "T610 requires the contributed extension");
  const api = await extension.activate() as T610ExtensionApi;
  await api.drainCurrentContextStartupForTest();
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
  const snapshot = await waitFor(
    "open produces Tree snapshot",
    () => api.getGlobalUnderstandingSnapshot(),
    (value) => value?.folders?.some((folder) => folder.path === "src" && folder.state !== "inactive") === true
  );
  assert.ok(snapshot, "actual activate/open wiring produces a Global snapshot");
  assert.ok(snapshot!.folders?.some((folder) => folder.path === "src"), "file open starts only its direct folder scope");
  assert.deepEqual(snapshot!.progress.files.map((file) => file.path), ["src/a.ts"]);
  await api.stopGlobalUnderstandingFolderForTest("src");
  assert.equal((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
  await api.resumeGlobalUnderstandingFolderForTest("src");
  assert.notEqual((await api.getGlobalUnderstandingSnapshot())?.folders?.find((folder) => folder.path === "src")?.state, "stopped");
  await api.notifyGlobalUnderstandingFolderEntryForTest(vscode.Uri.joinPath(workspace.uri, "src", "watcher-created.ts"));
  await waitFor(
    "registered watcher refresh",
    () => api.getGlobalUnderstandingSnapshot(),
    (value) => value?.folders?.find((folder) => folder.path === "src")?.state === "active"
  );
  await api.stopGlobalUnderstandingFolderForTest("src");
}

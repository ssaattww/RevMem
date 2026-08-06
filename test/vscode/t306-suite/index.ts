import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const within = async <Value>(label: string, operation: PromiseLike<Value>): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<Value>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`T306 timed out: ${label}`)), 10_000);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

interface PullRequestProgressTreeFile {
  readonly path: string;
  readonly category: string;
  readonly reason?: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly node: unknown;
}

interface PullRequestProgressSnapshot {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly files: readonly PullRequestProgressTreeFile[];
}

interface ReviewRangeT306TestApi {
  initializeLocalBaseHeadRuntime(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<void>;
  getLocalBaseHeadTree(): PullRequestProgressSnapshot;
  getLocalBaseHeadOpenedDiffs(): readonly {
    readonly original: string;
    readonly modified: string;
  }[];
  getLocalBaseHeadPersistence(): Promise<{
    readonly contextState: {
      readonly files: Readonly<Record<string, {
        readonly modifiedReviewed: readonly unknown[];
        readonly originalReviewedByDiff: Readonly<Record<string, readonly unknown[]>>;
      }>>;
    };
    readonly globalState: {
      readonly files: Readonly<Record<string, {
        readonly reviewed: readonly unknown[];
      }>>;
    };
  }>;
  setLocalBaseHeadConfirmationAnswer(answer: boolean): void;
}

const assertActiveLocalBaseHeadDiff = (
  diff: { readonly original: string; readonly modified: string }
): void => {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(tab, "Opening a reviewable Tree item must activate a tab.");
  assert.ok(
    tab.input instanceof vscode.TabInputTextDiff,
    "A reviewable Tree item must activate a real text-diff tab, not a normal editor."
  );
  assert.equal(tab.input.original.toString(true), diff.original);
  assert.equal(tab.input.modified.toString(true), diff.modified);
};

const runGit = async (
  workspacePath: string,
  argumentsList: readonly string[]
): Promise<string> => {
  const { stdout } = await execFileAsync("git", [...argumentsList], {
    cwd: workspacePath,
    windowsHide: true
  });
  return stdout.trim();
};

const createPullRequestFixture = async (
  workspacePath: string
): Promise<{ readonly baseSha: string; readonly headSha: string }> => {
  const write = (path: string, content: Uint8Array) => vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(vscode.Uri.file(workspacePath), path),
    content
  );
  await runGit(workspacePath, ["init", "--initial-branch=main"]);
  await runGit(workspacePath, ["config", "user.name", "Review Range Test"]);
  await runGit(workspacePath, ["config", "user.email", "review-range-test@example.invalid"]);
  await write("review.ts", Buffer.from("const removed = 1;\nconst retained = 2;\n"));
  await write("rename-source.ts", Buffer.from("export const renamed = true;\n"));
  await write("binary.bin", Buffer.from([0, 1, 2, 3]));
  await runGit(workspacePath, ["add", "."]);
  await runGit(workspacePath, ["commit", "-m", "base fixture"]);
  const baseSha = await runGit(workspacePath, ["rev-parse", "HEAD"]);

  await write("review.ts", Buffer.from("const retained = 2;\nconst added = 3;\n"));
  await write("excluded.generated.ts", Buffer.from("export const generated = true;\n"));
  await runGit(workspacePath, ["mv", "rename-source.ts", "rename-target.ts"]);
  await write("binary.bin", Buffer.from([4, 5, 6, 7]));
  await runGit(workspacePath, ["add", "."]);
  await runGit(workspacePath, ["commit", "-m", "head fixture"]);
  return { baseSha, headSha: await runGit(workspacePath, ["rev-parse", "HEAD"]) };
};

/** Exercises T306 through the real Extension Host and a local immutable Git comparison. */
export async function run(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "The T306 fixture requires a workspace folder.");
  const comparison = await createPullRequestFixture(workspaceFolder.uri.fsPath);
  const configuration = vscode.workspace.getConfiguration("reviewRange");
  await configuration.update(
    "exclude",
    ["**/*.generated.ts"],
    vscode.ConfigurationTarget.Workspace
  );
  try {
    const extension = vscode.extensions.getExtension("taiga.review-range-tracker");
    assert.ok(extension, "The Extension Development Host should load this extension.");
    const extensionApi = (await within("extension activation", extension.activate())) as ReviewRangeT306TestApi;
    await within("local base/head initialization", extensionApi.initializeLocalBaseHeadRuntime(comparison));
    const before = extensionApi.getLocalBaseHeadTree();

    assert.deepEqual(
      before,
      {
      reviewedLineCount: 0,
      totalLineCount: 2,
      files: [
        {
          path: "review.ts",
          category: "unreviewed",
          reviewedLineCount: 0,
          totalLineCount: 2,
          node: before.files[0]!.node
        },
        {
          path: "excluded.generated.ts",
          category: "excluded",
          reason: "ユーザー除外: **/*.generated.ts",
          reviewedLineCount: 0,
          totalLineCount: 0,
          node: before.files[1]!.node
        },
        {
          path: "rename-target.ts",
          category: "non-line-change",
          reviewedLineCount: 0,
          totalLineCount: 0,
          node: before.files[2]!.node
        },
        {
          path: "binary.bin",
          category: "line-review-unsupported",
          reason: "バイナリファイル",
          reviewedLineCount: 0,
          totalLineCount: 0,
          node: before.files[3]!.node
        }
      ]
    },
      "The local base/head comparison should project excluded, rename-only, and binary files separately."
    );
    const binary = before.files.find((file) => file.path === "binary.bin");
    assert.ok(binary);
    await within("binary Tree selection", vscode.commands.executeCommand("reviewRange.openPrProgressItem", binary.node));
    assert.equal(
      extensionApi.getLocalBaseHeadOpenedDiffs().length,
      0,
      "Selecting a binary PR Progress node must not delegate to the text-diff host."
    );

    const review = before.files.find((file) => file.path === "review.ts");
    assert.ok(review);
    await within("text Tree selection", vscode.commands.executeCommand("reviewRange.openPrProgressItem", review.node));
    const opened = extensionApi.getLocalBaseHeadOpenedDiffs();
    assert.equal(opened.length, 1, "Selecting a text Tree node should open the real diff host.");
    const [diff] = opened;
    assert.ok(diff);
    assertActiveLocalBaseHeadDiff(diff);
    await within(
      "original diff pane focus",
      vscode.commands.executeCommand("workbench.action.compareEditor.focusSecondarySide")
    );
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(true), diff.original);
    extensionApi.setLocalBaseHeadConfirmationAnswer(true);
    await within("whole-file mark", vscode.commands.executeCommand("reviewRange.markFileReviewed"));

    const marked = extensionApi.getLocalBaseHeadTree();
    assert.equal(
      marked.reviewedLineCount,
      2,
      "A whole-file operation while the original diff document is focused should review additions and deletions."
    );
    const markedState = await extensionApi.getLocalBaseHeadPersistence();
    const markedFile = Object.values(markedState.contextState.files).find((file) =>
      file.modifiedReviewed.length > 0 || Object.values(file.originalReviewedByDiff).some((ranges) => ranges.length > 0)
    );
    assert.ok(markedFile, "The diff command should persist context-local reviewed ranges.");
    assert.ok(Object.values(markedState.globalState.files).some((file) => file.reviewed.length > 0));

    assertActiveLocalBaseHeadDiff(diff);
    await within(
      "modified diff pane focus",
      vscode.commands.executeCommand("workbench.action.compareEditor.focusPrimarySide")
    );
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(true), diff.modified);
    await within("whole-file unmark", vscode.commands.executeCommand("reviewRange.unmarkFileReviewed"));
    const unmarked = extensionApi.getLocalBaseHeadTree();
    assert.equal(unmarked.reviewedLineCount, 0);
    const unmarkedState = await extensionApi.getLocalBaseHeadPersistence();
    assert.ok(Object.values(unmarkedState.contextState.files).every((file) =>
      file.modifiedReviewed.length === 0 &&
      Object.values(file.originalReviewedByDiff).every((ranges) => ranges.length === 0)
    ));
    assert.ok(Object.values(unmarkedState.globalState.files).every((file) => file.reviewed.length === 0));
  } finally {
    await configuration.update("exclude", undefined, vscode.ConfigurationTarget.Workspace);
  }
}

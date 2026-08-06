import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

interface PullRequestProgressTreeFile {
  readonly path: string;
  readonly category: string;
  readonly reason?: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
}

interface PullRequestProgressSnapshot {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly files: readonly PullRequestProgressTreeFile[];
}

interface ReviewRangeT306TestApi {
  runLocalPullRequestAcceptance(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<{
    readonly before: PullRequestProgressSnapshot;
    readonly markedFromOriginal: PullRequestProgressSnapshot;
    readonly unmarked: PullRequestProgressSnapshot;
    readonly binarySelectionKind: string;
    readonly textDiffOpenCount: number;
  }>;
}

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
    const extensionApi = (await extension.activate()) as ReviewRangeT306TestApi;
    const acceptance = await extensionApi.runLocalPullRequestAcceptance(comparison);

    assert.deepEqual(
      acceptance.before,
      {
      reviewedLineCount: 0,
      totalLineCount: 2,
      files: [
        {
          path: "review.ts",
          category: "unreviewed",
          reviewedLineCount: 0,
          totalLineCount: 2
        },
        {
          path: "excluded.generated.ts",
          category: "excluded",
          reason: "ユーザー除外: **/*.generated.ts",
          reviewedLineCount: 0,
          totalLineCount: 0
        },
        {
          path: "rename-target.ts",
          category: "non-line-change",
          reviewedLineCount: 0,
          totalLineCount: 0
        },
        {
          path: "binary.bin",
          category: "line-review-unsupported",
          reason: "バイナリファイル",
          reviewedLineCount: 0,
          totalLineCount: 0
        }
      ]
    },
      "The local base/head comparison should project excluded, rename-only, and binary files separately."
    );
    assert.equal(
      acceptance.markedFromOriginal.reviewedLineCount,
      2,
      "A whole-file operation invoked while the original side is focused should review both modified and deletion lines."
    );
    assert.equal(acceptance.markedFromOriginal.totalLineCount, 2);
    assert.equal(
      acceptance.unmarked.reviewedLineCount,
      0,
      "The whole-file unmark should clear modified, Global, and original deletion review state."
    );
    assert.equal(acceptance.binarySelectionKind, "line-review-unavailable");
    assert.equal(
      acceptance.textDiffOpenCount,
      0,
      "Selecting a binary PR Progress node must not delegate to the text-diff host."
    );
  } finally {
    await configuration.update("exclude", undefined, vscode.ConfigurationTarget.Workspace);
  }
}

import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { FileSystemReviewStateRepository } from "./adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "./adapters/workspace-review-state/index";
import { NormalEditorReviewCommandService } from "./application/review-commands/index";
import { WorkspaceIdentityService } from "./application/workspace-identity/index";
import {
  registerNormalEditorReviewCommands,
  type NormalEditorCommandHost
} from "./ui/normal-editor/index";

const MARK_FILE_CONFIRMATION = "確認済みにする";
const UNMARK_FILE_CONFIRMATION = "すべて解除";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isActiveDiffEditor = (): boolean =>
  vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
  vscode.TabInputTextDiff;

const toResourceUri = (uri: vscode.Uri) => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});

/** Activates the Review Range Tracker extension. */
export function activate(context: vscode.ExtensionContext): void {
  const stableHash = new NodeSha256StableHash();
  const repository = new FileSystemReviewStateRepository({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    }
  });
  const sessionProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository
  });
  const commandService = new NormalEditorReviewCommandService<vscode.TextEditor>({
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) =>
      editor.selections.map((selection) => ({
        anchor: {
          line: selection.anchor.line,
          character: selection.anchor.character
        },
        active: {
          line: selection.active.line,
          character: selection.active.character
        }
      })),
    openSession: async (editor) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (workspaceFolder === undefined) {
        throw new Error("ワークスペース内の通常ファイルを開いてください。");
      }
      if (context.storageUri === undefined) {
        throw new Error("ワークスペース用の保存先を取得できません。");
      }

      return sessionProvider.open({
        workspaceFolderUri: toResourceUri(workspaceFolder.uri),
        documentUri: toResourceUri(editor.document.uri),
        fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
        relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
        workspaceDisplayName: workspaceFolder.name,
        lineCount: editor.document.lineCount,
        contentHash: stableHash.digest(editor.document.getText())
      });
    },
    confirmWholeFileOperation: async (operation) => {
      if (operation === "mark-file-reviewed") {
        const result = await vscode.window.showWarningMessage(
          "このファイルの全行を確認済みにします。",
          { modal: true },
          MARK_FILE_CONFIRMATION
        );
        return result === MARK_FILE_CONFIRMATION;
      }

      const result = await vscode.window.showWarningMessage(
        "このファイルのすべての確認済み状態を解除します。",
        {
          modal: true,
          detail: "Global確認済み状態も解除されます。"
        },
        UNMARK_FILE_CONFIRMATION
      );
      return result === UNMARK_FILE_CONFIRMATION;
    },
    requestHistory: () => {
      // T206 connects the append-only history store. The request boundary is already
      // ordered after the atomic state commit by NormalEditorReviewCommandService.
    }
  });
  const host: NormalEditorCommandHost<vscode.TextEditor> = {
    getActiveEditor: () => vscode.window.activeTextEditor,
    isDiffEditor: () => isActiveDiffEditor(),
    registerCommand: (commandId, handler) =>
      vscode.commands.registerCommand(commandId, handler),
    showNormalEditorRequired: async () => {
      await vscode.window.showWarningMessage(
        "通常エディタでワークスペース内のファイルを開いてください。"
      );
    },
    showCommandError: async (error) => {
      await vscode.window.showErrorMessage(
        `レビュー状態を更新できませんでした: ${errorMessage(error)}`
      );
    }
  };

  const registrations = registerNormalEditorReviewCommands(host, {
    markSelectionReviewed: (editor) =>
      commandService.markSelectionReviewed(editor),
    unmarkSelectionReviewed: (editor) =>
      commandService.unmarkSelectionReviewed(editor),
    markFileReviewed: (editor) => commandService.markFileReviewed(editor),
    unmarkFileReviewed: (editor) => commandService.unmarkFileReviewed(editor)
  });
  context.subscriptions.push(...registrations);
}

/** Deactivates the Review Range Tracker extension. */
export function deactivate(): void {
  // Command registrations are disposed through ExtensionContext.subscriptions.
}

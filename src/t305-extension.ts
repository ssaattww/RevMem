import * as vscode from "vscode";

import {
  createNodeLocalGitAdapter,
  type LocalGitRepository
} from "./adapters/local-git/index";
import {
  activate as activateBaseExtension,
  deactivate as deactivateBaseExtension
} from "./extension";
import {
  registerCurrentContextRuntime,
  type CurrentContextDescriptor,
  type CurrentContextUiSnapshot
} from "./ui/current-context/index";

const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);

const branchDescriptor = (
  repository: LocalGitRepository
): CurrentContextDescriptor => ({
  kind: "branch",
  label: repository.branch.kind === "branch"
    ? repository.branch.fullRef.replace(/^refs\/heads\//u, "")
    : repository.head === undefined
      ? "detached"
      : repository.head.slice(0, 12),
  detail: repository.rootPath,
  headRevision: repository.head
});

const workspaceSnapshot = (): CurrentContextUiSnapshot | undefined => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder === undefined
    ? undefined
    : {
        context: { kind: "workspace", label: folder.name },
        progress: undefined
      };
};

/** T305 composition root that adds context UI while retaining the existing extension runtime. */
export function activate(context: vscode.ExtensionContext): unknown {
  const baseApi = activateBaseExtension(context);
  const git = createNodeLocalGitAdapter();

  const recompute = async (): Promise<CurrentContextUiSnapshot | undefined> => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || !FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
      return workspaceSnapshot();
    }

    const inspection = await git.inspectRepository(editor.document.uri.fsPath);
    if (inspection.kind !== "repository") {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      return {
        context: {
          kind: "workspace",
          label: folder?.name ?? editor.document.fileName
        },
        progress: undefined
      };
    }

    return {
      context: branchDescriptor(inspection.repository),
      progress: undefined
    };
  };

  registerCurrentContextRuntime(
    context,
    {
      recompute,
      selectContext: async () => {
        const snapshot = await recompute();
        if (snapshot === undefined) {
          await vscode.window.showInformationMessage(
            "表示できるレビューコンテキストがありません。"
          );
          return undefined;
        }
        const selected = await vscode.window.showQuickPick(
          [{ label: snapshot.context.label, description: snapshot.context.detail }],
          { placeHolder: "レビューコンテキストを選択" }
        );
        return selected === undefined ? undefined : snapshot.context;
      }
    },
    async () => {
      if (
        typeof baseApi === "object" &&
        baseApi !== null &&
        "refreshVisibleEditorDecorations" in baseApi &&
        typeof baseApi.refreshVisibleEditorDecorations === "function"
      ) {
        await baseApi.refreshVisibleEditorDecorations();
      }
    }
  );

  return baseApi;
}

export const deactivate = deactivateBaseExtension;

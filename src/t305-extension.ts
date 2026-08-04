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
  type CurrentContextDescriptor,
  type CurrentContextUiSnapshot
} from "./ui/current-context/index";
import {
  registerCurrentContextRuntime
} from "./ui/current-context/vscode-current-context-runtime";

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

const snapshotKey = (snapshot: CurrentContextUiSnapshot): string => [
  snapshot.context.kind,
  snapshot.context.label,
  snapshot.context.detail ?? "",
  snapshot.context.headRevision ?? ""
].join("\0");

/** T305 composition root that adds context UI while retaining the existing extension runtime. */
export function activate(context: vscode.ExtensionContext): unknown {
  const baseApi = activateBaseExtension(context);
  const git = createNodeLocalGitAdapter();
  let selectedKey: string | undefined;

  const enumerateContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
    const contexts = new Map<string, CurrentContextUiSnapshot>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const snapshot: CurrentContextUiSnapshot = {
        context: {
          kind: "workspace",
          label: folder.name,
          detail: folder.uri.fsPath
        },
        progress: undefined
      };
      contexts.set(snapshotKey(snapshot), snapshot);
    }

    for (const editor of vscode.window.visibleTextEditors) {
      if (!FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
        continue;
      }
      const inspection = await git.inspectRepository(editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        const snapshot: CurrentContextUiSnapshot = {
          context: branchDescriptor(inspection.repository),
          progress: undefined
        };
        contexts.set(snapshotKey(snapshot), snapshot);
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const snapshot: CurrentContextUiSnapshot = {
          context: {
            kind: "workspace",
            label: folder?.name ?? editor.document.fileName,
            detail: folder?.uri.fsPath ?? editor.document.uri.fsPath
          },
          progress: undefined
        };
        contexts.set(snapshotKey(snapshot), snapshot);
      }
    }

    return [...contexts.values()].sort((left, right) =>
      left.context.kind.localeCompare(right.context.kind) ||
      left.context.label.localeCompare(right.context.label)
    );
  };

  const recompute = async (): Promise<CurrentContextUiSnapshot | undefined> => {
    const candidates = await enumerateContexts();
    const selected = selectedKey === undefined
      ? undefined
      : candidates.find((candidate) => snapshotKey(candidate) === selectedKey);
    if (selected !== undefined) {
      return selected;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined && FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
      const inspection = await git.inspectRepository(editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        return candidates.find((candidate) =>
          candidate.context.kind === "branch" &&
          candidate.context.detail === inspection.repository.rootPath
        );
      }
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      return candidates.find((candidate) =>
        candidate.context.kind === "workspace" &&
        candidate.context.label === (folder?.name ?? editor.document.fileName)
      );
    }

    return candidates[0];
  };

  registerCurrentContextRuntime(
    context,
    {
      recompute,
      selectContext: async () => {
        const candidates = await enumerateContexts();
        if (candidates.length === 0) {
          await vscode.window.showInformationMessage(
            "表示できるレビューコンテキストがありません。"
          );
          return undefined;
        }
        const items = candidates.map((snapshot) => ({
          label: snapshot.context.kind === "branch"
            ? `Branch: ${snapshot.context.label}`
            : snapshot.context.kind === "workspace"
              ? `Workspace: ${snapshot.context.label}`
              : `PR ${snapshot.context.label}`,
          description: snapshot.context.detail,
          snapshot
        }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "レビューコンテキストを選択"
        });
        if (selected === undefined) {
          return undefined;
        }
        selectedKey = snapshotKey(selected.snapshot);
        return selected.snapshot;
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

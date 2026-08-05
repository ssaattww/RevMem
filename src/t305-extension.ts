import * as vscode from "vscode";

import {
  createNodeLocalGitAdapter,
  type LocalGitRepository
} from "./adapters/local-git/index";
import {
  activate as activateBaseExtension,
  deactivate as deactivateBaseExtension,
  type ReviewRangeRuntimePort
} from "./extension";
import {
  currentContextSelectionKey,
  CurrentContextCandidateSelection,
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
  headRevision: repository.head,
  selection: repository.branch.kind === "branch"
    ? {
        kind: "branch",
        repositoryId: repository.repositoryId,
        repositoryRoot: repository.rootPath,
        branchRef: repository.branch.fullRef
      }
    : repository.head === undefined
      ? undefined
      : {
          kind: "detached",
          repositoryId: repository.repositoryId,
          repositoryRoot: repository.rootPath,
          headRevision: repository.head
        }
});

/** T305 composition root that adds context UI while retaining the existing extension runtime. */
export function activate(context: vscode.ExtensionContext): unknown {
  const baseApi = activateBaseExtension(context);
  const git = createNodeLocalGitAdapter();
  const selection = new CurrentContextCandidateSelection();

  const enumerateContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
    const contexts = new Map<string, CurrentContextUiSnapshot>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const snapshot: CurrentContextUiSnapshot = {
        context: {
          kind: "workspace",
          label: folder.name,
          detail: folder.uri.fsPath,
          selection: {
            kind: "workspace",
            workspaceFolderUri: {
              scheme: folder.uri.scheme,
              authority: folder.uri.authority,
              path: folder.uri.path,
              query: folder.uri.query,
              fragment: folder.uri.fragment
            }
          }
        },
        progress: undefined
      };
      contexts.set(currentContextSelectionKey(snapshot), snapshot);
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
        contexts.set(currentContextSelectionKey(snapshot), snapshot);
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const snapshot: CurrentContextUiSnapshot = {
          context: {
            kind: "workspace",
            label: folder?.name ?? editor.document.fileName,
            detail: folder?.uri.fsPath ?? editor.document.uri.fsPath,
            ...(folder === undefined ? {} : {
              selection: {
                kind: "workspace" as const,
                workspaceFolderUri: {
                  scheme: folder.uri.scheme,
                  authority: folder.uri.authority,
                  path: folder.uri.path,
                  query: folder.uri.query,
                  fragment: folder.uri.fragment
                }
              }
            })
          },
          progress: undefined
        };
        contexts.set(currentContextSelectionKey(snapshot), snapshot);
      }
    }

    return [...contexts.values()].sort((left, right) =>
      left.context.kind.localeCompare(right.context.kind) ||
      left.context.label.localeCompare(right.context.label)
    );
  };

  const recompute = async (): Promise<CurrentContextUiSnapshot | undefined> => {
    const candidates = await enumerateContexts();
    const editor = vscode.window.activeTextEditor;
    let fallback: CurrentContextUiSnapshot | undefined;
    if (editor !== undefined && FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
      const inspection = await git.inspectRepository(editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        fallback = candidates.find((candidate) =>
          candidate.context.kind === "branch" &&
          candidate.context.detail === inspection.repository.rootPath
        );
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        fallback = candidates.find((candidate) =>
        candidate.context.kind === "workspace" &&
        candidate.context.label === (folder?.name ?? editor.document.fileName)
        );
      }
    }
    return selection.resolve(candidates, fallback);
  };

  const runtimePort: ReviewRangeRuntimePort = baseApi;
  registerCurrentContextRuntime(
    context,
    {
      recompute,
      acceptRecomputed: (snapshot) => selection.acceptRecomputed(snapshot),
      acceptExplicit: (snapshot) => selection.acceptExplicit(snapshot),
      selectContext: async () => {
        const candidates = await enumerateContexts();
        if (candidates.length === 0) {
          await vscode.window.showInformationMessage(
            "表示できるレビューコンテキストがありません。"
          );
          return undefined;
        }
        return selection.select(candidates, async (available) => {
        const items = available.map((snapshot) => ({
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
        return selected.snapshot;
        });
      }
    },
    {
      setSelectedContext: (selection) => runtimePort.setSelectedContext(selection),
      refreshDependents: () => runtimePort.refreshVisibleEditorDecorations()
    },
    async (error) => {
      await vscode.window.showErrorMessage(
        `現在のレビューコンテキストを更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  );

  return baseApi;
}

export const deactivate = deactivateBaseExtension;

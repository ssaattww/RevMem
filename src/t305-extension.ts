import path from "node:path";
import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { getActiveReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { createNodeLocalGitAdapter } from "./adapters/local-git/index";
import { runPersistenceStartupMigration } from "./adapters/persistence-startup-migration";
import {
  activate as activateBaseExtension,
  deactivate as deactivateBaseExtension,
  type ReviewRangeRuntimePort
} from "./extension";
import {
  currentContextSelectionKey,
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  type CurrentContextUiSnapshot
} from "./ui/current-context/index";
import {
  gitCurrentContextSnapshot,
  inspectCurrentContextDocument,
  isNonGitCurrentContextWorkspace
} from "./t305-current-context-git";
import { registerCurrentContextRuntime } from "./ui/current-context/vscode-current-context-runtime";
import {
  GlobalUnderstandingRefreshCoalescer,
  registerGlobalUnderstandingRuntime
} from "./ui/global-understanding/index";
import {
  T505GlobalUnderstandingSource,
  type T505GlobalUnderstandingOwner
} from "./t505-global-understanding-source";

const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);

export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
  await runPersistenceStartupMigration({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    }
  });
  const baseApi = activateBaseExtension(context);
  const runtimePort: ReviewRangeRuntimePort = baseApi;
  const git = createNodeLocalGitAdapter();
  const stableHash = new NodeSha256StableHash();
  const selection = new CurrentContextCandidateSelection();
  const exclusionPolicy = getActiveReviewFileExclusionPolicyService();
  const readOpenDocuments = (owner: Readonly<T505GlobalUnderstandingOwner>) =>
    vscode.workspace.textDocuments.flatMap((document) => {
      if (document.isClosed || !FILESYSTEM_SCHEMES.has(document.uri.scheme)) return [];
      const relativePath = path.relative(owner.repositoryRoot, document.uri.fsPath);
      if (
        relativePath.length === 0 ||
        path.isAbsolute(relativePath) ||
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`)
      ) return [];
      const repositoryPath = relativePath.split(path.sep).join("/");
      const content = document.getText();
      const contentHash = stableHash.digest(content);
      const version = document.version;
      const nonEmptyLines: number[] = [];
      for (let line = 0; line < document.lineCount; line += 1) {
        if (document.lineAt(line).text.trim().length > 0) nonEmptyLines.push(line);
      }
      return [{
        path: repositoryPath,
        revisionId: owner.currentRevisionId,
        lineCount: document.lineCount,
        nonEmptyLines,
        contentHash,
        cacheKey: `vscode:${document.uri.toString(true)}:${version}:${contentHash}`,
        validateCurrent: async () => {
          if (
            document.isClosed ||
            document.version !== version ||
            stableHash.digest(document.getText()) !== contentHash
          ) throw new Error(`Open document changed during Global recalculation: ${repositoryPath}`);
        }
      }];
    });
  const globalSource = new T505GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    },
    exclusionPolicy,
    readOpenDocuments
  });

  const enumerateContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
    const contexts = new Map<string, CurrentContextUiSnapshot>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (!(await isNonGitCurrentContextWorkspace(git, folder.uri.fsPath))) continue;
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
      if (!FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) continue;
      const inspection = await inspectCurrentContextDocument(git, editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        const snapshot = gitCurrentContextSnapshot(inspection.repository);
        contexts.set(currentContextSelectionKey(snapshot), snapshot);
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder !== undefined && !(await isNonGitCurrentContextWorkspace(git, folder.uri.fsPath))) continue;
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
      left.context.kind.localeCompare(right.context.kind) || left.context.label.localeCompare(right.context.label)
    );
  };

  const resolveFallback = async (candidates: readonly CurrentContextUiSnapshot[]): Promise<CurrentContextUiSnapshot | undefined> => {
    const editor = vscode.window.activeTextEditor;
    let fallback: CurrentContextUiSnapshot | undefined;
    if (editor !== undefined && FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
      const inspection = await inspectCurrentContextDocument(git, editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        fallback = candidates.find((candidate) =>
          candidate.context.kind === "branch" && candidate.context.detail === inspection.repository.rootPath
        );
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder !== undefined && !(await isNonGitCurrentContextWorkspace(git, folder.uri.fsPath))) return undefined;
        fallback = candidates.find((candidate) =>
          candidate.context.kind === "workspace" && candidate.context.label === (folder?.name ?? editor.document.fileName)
        );
      }
    }
    return fallback;
  };

  const currentContextComposition = new CurrentContextRuntimeComposition(selection, {
    enumerateCandidates: enumerateContexts,
    resolveFallback,
    requestSelection: async (available) => {
      if (available.length === 0) {
        await vscode.window.showInformationMessage("表示できるレビューコンテキストがありません。");
        return undefined;
      }
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
      return selected?.snapshot;
    }
  });

  const globalRuntime = registerGlobalUnderstandingRuntime(context, {
    source: globalSource,
    readGlobalLayerEnabled: () =>
      vscode.workspace.getConfiguration("reviewRange").get("showGlobalReviewed", true),
    writeGlobalLayerEnabled: (enabled) =>
      vscode.workspace.getConfiguration("reviewRange").update(
        "showGlobalReviewed",
        enabled,
        vscode.ConfigurationTarget.Workspace
      ),
    refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
    reportError: async (error) => {
      await vscode.window.showErrorMessage(
        `Global理解率を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
  const refreshGlobalUnderstanding = (): void => {
    void globalRuntime.refreshWithErrorBoundary();
  };
  const documentChangeRefresh = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => globalRuntime.invalidate(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    run: refreshGlobalUnderstanding
  });
  const requestRefreshForDocumentChange = (document: vscode.TextDocument): void => {
    if (FILESYSTEM_SCHEMES.has(document.uri.scheme)) documentChangeRefresh.request();
  };
  const refreshForSavedOrClosedDocument = (document: vscode.TextDocument): void => {
    if (!FILESYSTEM_SCHEMES.has(document.uri.scheme)) return;
    documentChangeRefresh.cancel();
    refreshGlobalUnderstanding();
  };
  context.subscriptions.push(
    runtimePort.onDidChangeReviewState(refreshGlobalUnderstanding),
    exclusionPolicy.onDidChange(refreshGlobalUnderstanding),
    vscode.workspace.onDidChangeTextDocument((event) => requestRefreshForDocumentChange(event.document)),
    vscode.workspace.onDidSaveTextDocument(refreshForSavedOrClosedDocument),
    vscode.workspace.onDidCloseTextDocument(refreshForSavedOrClosedDocument),
    documentChangeRefresh
  );

  registerCurrentContextRuntime(
    context,
    {
      recompute: () => currentContextComposition.recompute(),
      acceptRecomputed: (snapshot) => {
        currentContextComposition.acceptRecomputed(snapshot);
        globalSource.setContext(snapshot);
      },
      acceptExplicit: (snapshot) => {
        currentContextComposition.acceptExplicit(snapshot);
        globalSource.setContext(snapshot);
      },
      selectContext: () => currentContextComposition.selectContext()
    },
    {
      setSelectedContext: (selection) => runtimePort.setSelectedContext(selection),
      refreshDependents: async () => {
        await runtimePort.refreshVisibleEditorDecorations();
        await globalRuntime.refresh();
      }
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

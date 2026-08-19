import path from "node:path";
import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { getActiveReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { createNodeLocalGitAdapter } from "./adapters/local-git/index";
import { runPersistenceStartupMigration } from "./adapters/persistence-startup-migration";
import { ReviewFileExclusionPolicy } from "./core/file-exclusion/index";
import {
  activate as activateBaseExtension,
  deactivate as deactivateBaseExtension,
  type ReviewRangeRuntimePort
} from "./extension";
import {
  DocumentReviewEditRuntime,
  type DocumentReviewEditSnapshot
} from "./document-review-edit-runtime";
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
import {
  registerCurrentContextRuntime,
} from "./ui/current-context/vscode-current-context-runtime";
import {
  GlobalUnderstandingRefreshCoalescer,
  registerGlobalUnderstandingRuntime
} from "./ui/global-understanding/index";
import {
  refreshPullRequestProgressTree,
  setPullRequestProgressSource
} from "./ui/pr-progress/vscode-pull-request-progress-tree";
import {
  refreshAfterDocumentEdit,
  refreshCurrentContextDependents,
  refreshSelectedPullRequestProgress
} from "./t305-projection-refresh";
import {
  formatGlobalUnderstandingFileOpenError,
  type GlobalUnderstandingFileOpenTarget
} from "./ui/global-understanding/global-understanding-ui-model";
import {
  T505GlobalUnderstandingSource,
  type T505GlobalUnderstandingOwner
} from "./t505-global-understanding-source";
import {
  registerT405ReviewContextsRuntime,
  type RegisteredT405ReviewContextsRuntime,
} from "./t405-review-contexts-runtime";
import { PullRequestReviewRuntime } from "./t405-pull-request-review-runtime";
import type { SelectedReviewContext } from "./application/review-context/selected-review-context";
import { resolveReviewRangeMappingOptions } from "./application/configuration/review-range-mapping-options";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "./core/contracts/index";

const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);
let activeDocumentReviewEditRuntime: DocumentReviewEditRuntime | undefined;

const toResourceUri = (uri: vscode.Uri) => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});
const MARK_FILE_CONFIRMATION = "確認済みにする";
const UNMARK_FILE_CONFIRMATION = "すべて解除";

export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
  await runPersistenceStartupMigration({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    }
  });
  const baseApi = activateBaseExtension(context);
  const runtimePort: ReviewRangeRuntimePort = baseApi;
  let selectedContext: SelectedReviewContext | undefined;
  const acceptSelectedContext = (next: SelectedReviewContext | undefined): void => {
    selectedContext = next;
    runtimePort.setSelectedContext(next);
  };
  const git = createNodeLocalGitAdapter();
  const stableHash = new NodeSha256StableHash();
  const documentEditRuntime = new DocumentReviewEditRuntime({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    },
    gitInspector: git,
    stableHash
  });
  activeDocumentReviewEditRuntime = documentEditRuntime;
  const toEditSnapshot = (document: vscode.TextDocument): DocumentReviewEditSnapshot => {
    const text = document.getText();
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    return {
      documentKey: document.uri.toString(true),
      documentUri: toResourceUri(document.uri),
      documentFsPath: document.uri.fsPath,
      fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
      ...(workspaceFolder === undefined ? {} : {
        workspace: {
          workspaceFolderUri: toResourceUri(workspaceFolder.uri),
          relativePath: vscode.workspace.asRelativePath(document.uri, false)
        }
      }),
      text,
      lineCount: document.lineCount,
      contentHash: stableHash.digest(text)
    };
  };
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isClosed && FILESYSTEM_SCHEMES.has(document.uri.scheme)) {
      documentEditRuntime.observe(toEditSnapshot(document));
    }
  }

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

  const enumerateLocalContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
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

  const reviewContextsRuntimeRef: { current?: RegisteredT405ReviewContextsRuntime } = {};
  const enumerateContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
    const local = await enumerateLocalContexts();
    const reviewContextsRuntime = reviewContextsRuntimeRef.current;
    return reviewContextsRuntime === undefined
      ? local
      : [...await reviewContextsRuntime.augmentCurrentContextCandidates(local)];
  };

  const resolveFallback = async (candidates: readonly CurrentContextUiSnapshot[]): Promise<CurrentContextUiSnapshot | undefined> => {
    const editor = vscode.window.activeTextEditor;
    let fallback: CurrentContextUiSnapshot | undefined;
    if (editor !== undefined && FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
      const inspection = await inspectCurrentContextDocument(git, editor.document.uri.fsPath);
      if (inspection.kind === "repository") {
        fallback = candidates.find((candidate) =>
          candidate.context.selection?.kind === "pull-request" &&
          candidate.context.selection.repositoryRoot === inspection.repository.rootPath
        ) ?? candidates.find((candidate) =>
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

  const pullRequestReviewRuntimeRef: { current?: PullRequestReviewRuntime<vscode.Uri> } = {};
  const openGlobalFile = async (target: GlobalUnderstandingFileOpenTarget): Promise<void> => {
    let uri: vscode.Uri;
    if (target.kind === "working-tree") {
      const folder = (vscode.workspace.workspaceFolders ?? []).find((candidate) => {
        const relative = path.relative(candidate.uri.fsPath, target.filePath);
        return relative.length === 0 || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
      });
      uri = folder === undefined
        ? vscode.Uri.file(target.filePath)
        : vscode.Uri.joinPath(
          folder.uri,
          ...path.relative(folder.uri.fsPath, target.filePath).split(path.sep).filter((part) => part.length > 0)
        );
    } else {
      const pullRequestRuntime = pullRequestReviewRuntimeRef.current;
      if (pullRequestRuntime === undefined) {
        throw new Error("Pull-request review runtime is unavailable for Global file open");
      }
      uri = vscode.Uri.parse(
        pullRequestRuntime.createHeadFileDocumentUri(
          target.contextId,
          target.repositoryPath,
          target.revisionId
        ),
        true
      );
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  };

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
    openFile: openGlobalFile,
    reportError: async (error) => {
      await vscode.window.showErrorMessage(
        `Global理解率を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    },
    reportOpenError: async (error) => {
      await vscode.window.showErrorMessage(formatGlobalUnderstandingFileOpenError(error));
    }
  });

  const prRepository = runtimePort.reviewStateRepository;
  const prHistory = runtimePort.reviewHistoryRecorder;
  const pullRequestReviewRuntime = new PullRequestReviewRuntime<vscode.Uri>({
    repository: prRepository,
    requestHistory: (transaction) => prHistory.recordTransaction(
      transaction,
      transaction.operation === "mark-ranges-reviewed" || transaction.operation === "unmark-ranges-reviewed"
        ? "user-selection"
        : "user-file"
    ),
    diffHost: {
      parseUri: (value) => vscode.Uri.parse(value, true),
      openDiff: async (original, modified, title) => {
        await vscode.commands.executeCommand("vscode.diff", original, modified, title);
      },
    },
    openFile: async (uri) => {
      await vscode.commands.executeCommand("vscode.open", uri);
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({
      userGlobs: exclusionPolicy.getUserGlobs(),
    }),
  });
  const refreshPullRequestProgressForSelection = async (): Promise<void> => {
    const contextId = selectedContext?.kind === "pull-request" &&
      pullRequestReviewRuntime.hasContext(selectedContext.contextId)
      ? selectedContext.contextId
      : undefined;
    await refreshSelectedPullRequestProgress({
      contextId,
      source: pullRequestReviewRuntime.progress,
      activateProgress: (selectedContextId) =>
        pullRequestReviewRuntime.activateProgress(selectedContextId),
      clearProgress: () => pullRequestReviewRuntime.clearProgress(),
      setSource: (source) => setPullRequestProgressSource(source),
      refreshTree: () => refreshPullRequestProgressTree()
    });
  };
  const reportPullRequestProgressError = async (error: unknown): Promise<void> => {
    await vscode.window.showErrorMessage(
      `PR Progressを更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
    );
  };
  pullRequestReviewRuntimeRef.current = pullRequestReviewRuntime;
  const pullRequestCommandService = pullRequestReviewRuntime.createCommandService<vscode.TextEditor>({
    getDocumentUri: (editor) => editor.document.uri.toString(true),
    getSide: (editor) => pullRequestReviewRuntime.sideForDiffDocumentUri(
      editor.document.uri.toString(true)
    ),
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) => editor.selections.map((selected) => ({
      anchor: {
        line: selected.anchor.line,
        character: selected.anchor.character,
      },
      active: {
        line: selected.active.line,
        character: selected.active.character,
      },
    })),
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
        { modal: true, detail: "Global確認済み状態も解除されます。" },
        UNMARK_FILE_CONFIRMATION
      );
      return result === UNMARK_FILE_CONFIRMATION;
    },
  });
  context.subscriptions.push(runtimePort.registerReviewDiffRuntime({
    ownsDocumentUri: (uri) => pullRequestReviewRuntime.ownsDiffDocumentUri(uri),
    provideTextDocumentContent: (uri) =>
      pullRequestReviewRuntime.documentContentProvider.provideTextDocumentContent(uri),
    invokeCommand: (operation, editor) => pullRequestCommandService[operation](editor),
  }));

  const currentContextRuntime = registerCurrentContextRuntime(
    context,
    {
      recompute: () => currentContextComposition.recompute(),
      acceptRecomputed: (snapshot) => {
        globalRuntime.clear();
        currentContextComposition.acceptRecomputed(snapshot);
        globalSource.setContext(snapshot);
      },
      acceptExplicit: (snapshot) => {
        globalRuntime.clear();
        currentContextComposition.acceptExplicit(snapshot);
        globalSource.setContext(snapshot);
      },
      selectContext: () => currentContextComposition.selectContext()
    },
    {
      setSelectedContext: acceptSelectedContext,
      refreshDependents: () => refreshCurrentContextDependents({
        refreshPullRequestProgress: refreshPullRequestProgressForSelection,
        refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
        refreshGlobal: () => globalRuntime.refresh(),
        refreshReviewContexts: async () => {
          await reviewContextsRuntimeRef.current?.refresh();
        },
        reportPullRequestProgressError
      })
    },
    async (error) => {
      await vscode.window.showErrorMessage(
        `現在のレビューコンテキストを更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  );

  reviewContextsRuntimeRef.current = registerT405ReviewContextsRuntime({
    context,
    git,
    enumerateCurrentContexts: enumerateLocalContexts,
    refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
    refreshCurrentContext: () => currentContextRuntime.refresh(),
    registerPullRequestReviewDiff: (registration) => pullRequestReviewRuntime.register(registration),
    openPullRequestReviewDiff: (contextId, fileId, title) =>
      pullRequestReviewRuntime.openReviewDiff(contextId, fileId, title),
    getPullRequestReviewProgress: (contextId) =>
      pullRequestReviewRuntime.getProgress(contextId),
    reviewStateRepository: runtimePort.reviewStateRepository,
    reviewHistoryRecorder: runtimePort.reviewHistoryRecorder,
  });

  const refreshGlobalUnderstanding = (): void => {
    void globalRuntime.refreshWithErrorBoundary();
  };
  const refreshPullRequestProgress = (): void => {
    void refreshPullRequestProgressForSelection().catch(reportPullRequestProgressError);
  };
  const documentChangeRefresh = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => globalRuntime.invalidate(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    run: refreshGlobalUnderstanding
  });
  const requestRefreshForDocumentChange = (event: vscode.TextDocumentChangeEvent): void => {
    if (!FILESYSTEM_SCHEMES.has(event.document.uri.scheme)) return;
    documentChangeRefresh.request();
    void documentEditRuntime.apply({
      after: toEditSnapshot(event.document),
      changes: event.contentChanges.map((change) => ({
        range: {
          start: {
            line: change.range.start.line,
            character: change.range.start.character
          },
          end: {
            line: change.range.end.line,
            character: change.range.end.character
          }
        },
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text
      })),
      options: resolveReviewRangeMappingOptions({
        ignoreWhitespaceChanges: vscode.workspace.getConfiguration("reviewRange")
          .get<unknown>("ignoreWhitespaceChanges"),
        ignoreEolChanges: vscode.workspace.getConfiguration("reviewRange")
          .get<unknown>("ignoreEolChanges")
      }),
      selectedContext
    }).then(
      async (result) => {
        if (result !== "applied") return;
        try {
          await refreshAfterDocumentEdit({
            refreshPullRequestProgress: refreshPullRequestProgressForSelection,
            refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
            refreshGlobal: () => globalRuntime.refreshWithErrorBoundary(),
            reportPullRequestProgressError
          });
        } catch (error) {
          await vscode.window.showErrorMessage(
            `編集後のレビュー表示を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      async (error: unknown) => {
        await vscode.window.showErrorMessage(
          `編集後のレビュー状態を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    );
  };
  const refreshForSavedOrClosedDocument = (document: vscode.TextDocument): void => {
    if (!FILESYSTEM_SCHEMES.has(document.uri.scheme)) return;
    documentChangeRefresh.cancel();
    refreshGlobalUnderstanding();
  };
  context.subscriptions.push(
    runtimePort.onDidChangeReviewState(() => {
      refreshGlobalUnderstanding();
      refreshPullRequestProgress();
      void reviewContextsRuntimeRef.current?.refreshWithErrorBoundary();
    }),
    exclusionPolicy.onDidChange(() => {
      refreshGlobalUnderstanding();
      refreshPullRequestProgress();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (FILESYSTEM_SCHEMES.has(document.uri.scheme)) {
        documentEditRuntime.observe(toEditSnapshot(document));
      }
    }),
    vscode.workspace.onDidChangeTextDocument(requestRefreshForDocumentChange),
    vscode.workspace.onDidSaveTextDocument(refreshForSavedOrClosedDocument),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (FILESYSTEM_SCHEMES.has(document.uri.scheme)) {
        documentEditRuntime.forget(document.uri.toString(true));
      }
      refreshForSavedOrClosedDocument(document);
    }),
    documentChangeRefresh
  );

  void currentContextRuntime.refresh().catch(async (error) => {
    await vscode.window.showErrorMessage(
      `現在のPRコンテキストを復元できませんでした: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      ...baseApi,
      drainDocumentReviewEdits: () => documentEditRuntime.drain(),
      getGlobalUnderstandingSnapshot: () => globalSource.recalculate(),
      seedSavedPullRequestContext: async (document: vscode.TextDocument, pullRequestNumber: number) => {
        const inspection = await git.inspectRepository(document.uri.fsPath);
        if (inspection.kind !== "repository" || inspection.repository.head === undefined) {
          throw new Error("T506 saved PR fixture requires a Git document at a concrete HEAD.");
        }
        const relativePath = path.relative(inspection.repository.rootPath, document.uri.fsPath)
          .split(path.sep).join("/");
        const contextId = `github-pr:${inspection.repository.repositoryId}#${pullRequestNumber}`;
        const fileId = `repository-file:${stableHash.digest([
          "repository-file", inspection.repository.repositoryId, relativePath
        ].join("\0"))}`;
        const now = new Date().toISOString();
        const contentHash = stableHash.digest(document.getText());
        const contextState: ReviewContextState = {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId, kind: "pull-request",
          repositoryId: inspection.repository.repositoryId, displayName: `PR #${pullRequestNumber}`,
          pullRequest: { host: "github.com", owner: "fixture", repository: "t506", number: pullRequestNumber, state: "open", baseSha: inspection.repository.head, headSha: inspection.repository.head },
          files: { [fileId]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, fileId, currentPath: relativePath, previousPaths: [], revisionId: inspection.repository.head, modifiedReviewed: [], originalReviewedByDiff: {}, contentHash, lineCount: document.lineCount, updatedAt: now } },
          createdAt: now, updatedAt: now
        };
        const globalState: RepositoryGlobalState = {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: inspection.repository.repositoryId,
          currentRevisionId: inspection.repository.head, files: {}, updatedAt: now
        };
        await runtimePort.reviewStateRepository.save(
          { kind: "pull-request", repositoryId: inspection.repository.repositoryId, contextId },
          { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextState, globalState }
        );
        acceptSelectedContext({ kind: "pull-request", repositoryId: inspection.repository.repositoryId,
          repositoryRoot: inspection.repository.rootPath, contextId, pullRequestNumber,
          headRevision: inspection.repository.head });
      }
    };
  }
  return baseApi;
}

export async function deactivate(): Promise<void> {
  const editRuntime = activeDocumentReviewEditRuntime;
  activeDocumentReviewEditRuntime = undefined;
  await editRuntime?.drain();
  await deactivateBaseExtension();
}

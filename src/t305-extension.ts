import path from "node:path";
import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { getActiveReviewFileExclusionPolicyService } from "./application/file-exclusion/review-file-exclusion-policy-service";
import { createNodeLocalGitAdapter } from "./adapters/local-git/index";
import { runPersistenceStartupMigration } from "./adapters/persistence-startup-migration";
import {
  composeStartupFeedback,
  queueOperationStartDetails,
  reportActiveOperationFailure,
  reportActiveStorageLockDiagnostic,
  type OperationDiagnosticDetail,
} from "./application/operation-feedback/index";
import { VscodeOperationFeedbackHost } from "./ui/operation-feedback/index";
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
import { resolveCurrentContextRepositories, workspaceUriToFilesystemPath } from "./t609-repository-resolution";
import { resolveT305RepositoryRootUri } from "./t305-repository-root-uri";
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
import { type GlobalUnderstandingFileOpenTarget } from "./ui/global-understanding/global-understanding-ui-model";
import { OperationCancelledError, type OperationFeedbackContext, type OperationLogEntry } from "./application/operation-feedback/index";
import type { T505GlobalUnderstandingOwner } from "./t505-global-understanding-source";
import { createT305GlobalUnderstandingSource } from "./t305-global-understanding-composition";
import {
  registerT405ReviewContextsRuntime,
  type RegisteredT405ReviewContextsRuntime,
} from "./t405-review-contexts-runtime";
import { PullRequestReviewRuntime } from "./t405-pull-request-review-runtime";
import {
  GitReviewContextResolver,
  type SelectedReviewContext
} from "./application/review-context/index";
import {
  resolveWorkspaceFolderMembership,
  resolveWorkspaceResourceEligibility
} from "./application/workspace-identity/index";
import { readReviewRangeMappingOptions } from "./application/configuration/review-range-mapping-options";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState, type ReviewContextState } from "./core/contracts/index";
import { TestReviewStateDependentQueue } from "./test-only-review-state-dependent-queue";
import { observeStartupGlobalUnderstandingDocuments } from "./t305-global-understanding-startup";
import { observeGlobalUnderstandingDocumentOpen, shouldRefreshGlobalUnderstandingFolderEntry } from "./t305-global-understanding-lifecycle";

const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);
let activeDocumentReviewEditRuntime: DocumentReviewEditRuntime | undefined;
const workspaceSidePathSemantics = () =>
  process.platform === "win32" ? "windows" as const : "posix" as const;

const toResourceUri = (uri: vscode.Uri) => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});
const MARK_FILE_CONFIRMATION = "確認済みにする";
const UNMARK_FILE_CONFIRMATION = "すべて解除";

/** Ports owned by the T305 activation composition for the public Current Context command. */
export interface T305CurrentContextRuntimeCompositionPorts {
  readonly prepareExplicitSelection?: (signal?: AbortSignal, feedbackContext?: OperationFeedbackContext) => Promise<void>;
  readonly enumerateCandidates: (signal?: AbortSignal, feedbackContext?: OperationFeedbackContext) => Promise<readonly CurrentContextUiSnapshot[]>;
  readonly resolveFallback: (candidates: readonly CurrentContextUiSnapshot[], signal?: AbortSignal) => Promise<CurrentContextUiSnapshot | undefined>;
  readonly requestSelection: (candidates: readonly CurrentContextUiSnapshot[], signal?: AbortSignal) => Promise<CurrentContextUiSnapshot | undefined>;
}

/** Creates the production Current Context composition used by T305 command registration. */
export const createT305CurrentContextRuntimeComposition = (
  selection: CurrentContextCandidateSelection,
  ports: T305CurrentContextRuntimeCompositionPorts,
): CurrentContextRuntimeComposition => {
  const prepareExplicitSelection = ports.prepareExplicitSelection;
  return new CurrentContextRuntimeComposition(selection, {
  ...ports,
  prepareExplicitSelection: prepareExplicitSelection === undefined
    ? undefined
    : async (signal, feedbackContext) => {
      try {
        await prepareExplicitSelection(signal, feedbackContext);
      } catch (error) {
        if (signal?.aborted === true) throw new OperationCancelledError();
        throw error;
      }
      if (signal?.aborted === true) throw new OperationCancelledError();
    },
  });
};

export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
  // Startup migration can fail before the main runtime composition. Install the
  // shared Output boundary first so its queued terminal lock diagnostic flushes.
  const testOperationLogEntries: OperationLogEntry[] = [];
  const startupFeedbackHost = new VscodeOperationFeedbackHost(
    context.extensionMode === vscode.ExtensionMode.Test
      ? (entry) => { testOperationLogEntries.push({ ...entry }); }
      : undefined
  );
  context.subscriptions.push(startupFeedbackHost);
  const persistenceStartup = composeStartupFeedback(startupFeedbackHost, async (notifyStorageLockDiagnostic) => {
    await runPersistenceStartupMigration({
      storageUris: {
        globalStorageUri: context.globalStorageUri,
        storageUri: context.storageUri
      },
      notifyStorageLockDiagnostic
    });
  });
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    void persistenceStartup.catch((error: unknown) => {
      reportActiveOperationFailure("Review Range persistence startup", error);
    });
  } else {
    await persistenceStartup;
  }
  const baseApi = activateBaseExtension(context);
  const runtimePort: ReviewRangeRuntimePort = baseApi;
  let selectedContext: SelectedReviewContext | undefined;
  let testCurrentContextSelection: "first" | "cancel" | "stale" | undefined;
  let testCurrentContextSelectionRequestCount = 0;
  let testCurrentContextStaleAfterPick = false;
  let testCurrentContextDependentRefreshCount = 0;
  const pullRequestReviewRuntimeRef: { current?: PullRequestReviewRuntime<vscode.Uri> } = {};
  const acceptSelectedContext = (next: SelectedReviewContext | undefined): void => {
    selectedContext = next;
    runtimePort.setSelectedContext(next);
    runtimePort.setCurrentPullRequestDiff(
      next?.kind === "pull-request"
        ? pullRequestReviewRuntimeRef.current?.snapshotForContext(next.contextId)
        : undefined
    );
  };
  const git = createNodeLocalGitAdapter({
    decodeWithHint: async (bytes, encoding) => vscode.workspace.decode(bytes, { encoding })
  });
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
    const membership = resolveWorkspaceFolderMembership({
      documentUri: toResourceUri(document.uri),
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        uri: toResourceUri(folder.uri), name: folder.name
      })),
      fileSystemPathSemantics: workspaceSidePathSemantics()
    });
    return {
      documentKey: document.uri.toString(true),
      documentUri: toResourceUri(document.uri),
      documentFsPath: document.uri.fsPath,
      fileSystemPathSemantics: workspaceSidePathSemantics(),
      ...(membership === undefined ? {} : {
        workspace: {
          workspaceFolderUri: membership.workspaceFolder.uri,
          relativePath: membership.relativePath
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
  const globalSource = createT305GlobalUnderstandingSource({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    },
    exclusionPolicy,
    readOpenDocuments,
    notifyStorageLockDiagnostic: reportActiveStorageLockDiagnostic,
    globalStoragePath: context.globalStorageUri.fsPath,
    readAutoStartDescendants: () => vscode.workspace.getConfiguration("reviewRange.globalUnderstanding")
      .get("autoStartDescendants", false),
    resolveRepositoryRootUri: (repositoryRoot) => {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const workspaceUris = workspaceFolders.map((folder) => folder.uri);
      return resolveT305RepositoryRootUri({
        repositoryRoot,
        fileSystemPathSemantics: workspaceSidePathSemantics(),
        workspaceFolders: workspaceFolders.flatMap((folder) => {
          const filesystemPath = workspaceUriToFilesystemPath(folder.uri, workspaceUris);
          return filesystemPath === undefined ? [] : [{
            filesystemPath,
            uri: toResourceUri(folder.uri)
          }];
        })
      });
    }
  });
  let testGlobalUnderstandingSourceContext: string | undefined;
  let testGlobalUnderstandingAcceptedDocumentOpenCount = 0;
  let testGlobalUnderstandingObservedDocumentPath: string | undefined;
  let testGlobalUnderstandingFileOpenOutcome: "not-started" | "completed" | "error" = "not-started";
  let testGlobalUnderstandingDocumentOpenFailure: Error | undefined;
  let testGlobalUnderstandingSourceRefreshOutcome: "not-started" | "snapshot" | "undefined" | "error" = "not-started";
  let testGlobalUnderstandingSourceRefreshError: string | undefined;
  let testGlobalUnderstandingPublishedSnapshot = false;
  let testStartupGlobalUnderstanding = Promise.resolve();
  let testGlobalUnderstandingPresentation: import("./ui/global-understanding/vscode-global-understanding-runtime").GlobalUnderstandingPresentationForTest | undefined;
  const testGlobalUnderstandingUiErrors: string[] = [];
  let testGlobalUnderstandingFolderEntryAcceptedCount = 0;
  let testGlobalUnderstandingFolderEntryDrainedCount = 0;
  const testGlobalUnderstandingFolderEntryWaiters: Array<() => void> = [];
  const waitForTestGlobalUnderstandingFolderEntry = (): Promise<void> => {
    if (testGlobalUnderstandingFolderEntryAcceptedCount > testGlobalUnderstandingFolderEntryDrainedCount) return Promise.resolve();
    return new Promise<void>((resolve) => { testGlobalUnderstandingFolderEntryWaiters.push(resolve); });
  };
  const captureTestGlobalUnderstandingContext = (snapshot: CurrentContextUiSnapshot | undefined): void => {
    if (context.extensionMode !== vscode.ExtensionMode.Test) return;
    testGlobalUnderstandingSourceContext = snapshot?.context.selection === undefined
      ? undefined
        : JSON.stringify(snapshot.context.selection);
  };
  const observeCurrentGlobalUnderstandingDocument = async (document: vscode.TextDocument): Promise<void> => {
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      testGlobalUnderstandingAcceptedDocumentOpenCount += 1;
      testGlobalUnderstandingObservedDocumentPath = document.uri.fsPath;
      testGlobalUnderstandingFileOpenOutcome = "not-started";
      for (const resolve of testGlobalUnderstandingFileOpenWaiters.splice(0)) resolve();
    }
    try {
      if (testGlobalUnderstandingDocumentOpenFailure !== undefined) {
        const failure = testGlobalUnderstandingDocumentOpenFailure;
        testGlobalUnderstandingDocumentOpenFailure = undefined;
        throw failure;
      }
      await globalSource.observeFileOpen(document.uri.fsPath);
      if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingFileOpenOutcome = "completed";
    } catch (error) {
      if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingFileOpenOutcome = "error";
      throw error;
    }
  };
  const observedGlobalSource = {
    recalculate: async (
      signal?: AbortSignal,
      publishProgress?: (snapshot: import("./ui/global-understanding/global-understanding-ui-model").GlobalUnderstandingTreeSnapshot) => void | Promise<void>
    ) => {
      if (context.extensionMode === vscode.ExtensionMode.Test) {
        testGlobalUnderstandingSourceRefreshOutcome = "not-started";
        testGlobalUnderstandingSourceRefreshError = undefined;
      }
      try {
        const snapshot = await globalSource.recalculate(signal, publishProgress);
        if (context.extensionMode === vscode.ExtensionMode.Test) {
          testGlobalUnderstandingSourceRefreshOutcome = snapshot === undefined ? "undefined" : "snapshot";
        }
        return snapshot;
      } catch (error) {
        if (context.extensionMode === vscode.ExtensionMode.Test) {
          testGlobalUnderstandingSourceRefreshOutcome = "error";
          testGlobalUnderstandingSourceRefreshError = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    },
    startFolder: (folderPath: string) => globalSource.startFolder(folderPath),
    stopFolder: (folderPath: string) => globalSource.stopFolder(folderPath),
    resumeFolder: (folderPath: string) => globalSource.resumeFolder(folderPath)
  };

  const workspaceFilesystemPath = (uri: vscode.Uri): string | undefined => workspaceUriToFilesystemPath(
    uri,
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)
  );
  const enumerateLocalContexts = async (): Promise<CurrentContextUiSnapshot[]> => {
    const contexts = new Map<string, CurrentContextUiSnapshot>();
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      uri: toResourceUri(folder.uri), name: folder.name
    }));
    for (const candidate of await resolveCurrentContextRepositories({
      activeDocumentPath: vscode.window.activeTextEditor === undefined
        ? undefined
        : workspaceFilesystemPath(vscode.window.activeTextEditor.document.uri),
      openedDocumentPaths: vscode.workspace.textDocuments.map((document) =>
        !document.isClosed
          ? workspaceFilesystemPath(document.uri)
          : undefined),
      knownRootPaths: selectedContext?.kind === "branch" || selectedContext?.kind === "detached"
        ? [selectedContext.repositoryRoot]
        : [],
      workspaceFolderPaths: (vscode.workspace.workspaceFolders ?? []).map((folder) => workspaceFilesystemPath(folder.uri)),
      inspectRepository: (startPath) => git.inspectRepository(startPath)
    })) {
      const snapshot = gitCurrentContextSnapshot(candidate.repository as Parameters<typeof gitCurrentContextSnapshot>[0]);
      contexts.set(currentContextSelectionKey(snapshot), snapshot);
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (resolveWorkspaceResourceEligibility({
        documentUri: toResourceUri(folder.uri),
        workspaceFolders,
        fileSystemPathSemantics: workspaceSidePathSemantics()
      }) === undefined) continue;
      const folderPath = workspaceFilesystemPath(folder.uri);
      if (folderPath === undefined || !(await isNonGitCurrentContextWorkspace(git, folderPath))) continue;
      const snapshot: CurrentContextUiSnapshot = {
        context: {
          kind: "workspace",
          label: folder.name,
          detail: folderPath,
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
      const editorPath = workspaceFilesystemPath(editor.document.uri);
      if (editorPath === undefined || resolveWorkspaceResourceEligibility({
        documentUri: toResourceUri(editor.document.uri),
        workspaceFolders,
        fileSystemPathSemantics: workspaceSidePathSemantics()
      })?.relativePath === undefined) continue;
      const inspection = await inspectCurrentContextDocument(git, editorPath);
      if (inspection.kind === "repository") {
        const snapshot = gitCurrentContextSnapshot(inspection.repository);
        contexts.set(currentContextSelectionKey(snapshot), snapshot);
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const folderPath = folder === undefined ? undefined : workspaceFilesystemPath(folder.uri);
        if (folder !== undefined && (folderPath === undefined || !(await isNonGitCurrentContextWorkspace(git, folderPath)))) continue;
        const snapshot: CurrentContextUiSnapshot = {
          context: {
            kind: "workspace",
            label: folder?.name ?? editor.document.fileName,
            detail: folderPath ?? editorPath,
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
  const enumerateContexts = async (signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextUiSnapshot[]> => {
    if (testCurrentContextStaleAfterPick) {
      testCurrentContextStaleAfterPick = false;
      return [];
    }
    const local = await enumerateLocalContexts();
    if (signal?.aborted === true) return [];
    const reviewContextsRuntime = reviewContextsRuntimeRef.current;
    if (reviewContextsRuntime === undefined) return local;
    const augmented = await reviewContextsRuntime.augmentCurrentContextCandidates(local, signal, feedbackContext);
    // The Current Context owner is authoritative: an aborted composition must
    // never publish candidates returned by an in-flight T405 acquisition.
    return signal?.aborted ? [] : [...augmented];
  };

  const resolveFallback = async (candidates: readonly CurrentContextUiSnapshot[], signal?: AbortSignal): Promise<CurrentContextUiSnapshot | undefined> => {
    const editor = vscode.window.activeTextEditor;
    let fallback: CurrentContextUiSnapshot | undefined;
    const editorPath = editor === undefined ? undefined : workspaceFilesystemPath(editor.document.uri);
    if (editor !== undefined && editorPath !== undefined) {
      const inspection = await inspectCurrentContextDocument(git, editorPath);
      if (signal?.aborted === true) return undefined;
      if (inspection.kind === "repository") {
        fallback = candidates.find((candidate) =>
          candidate.context.selection?.kind === "pull-request" &&
          candidate.context.selection.repositoryRoot === inspection.repository.rootPath
        ) ?? candidates.find((candidate) =>
          candidate.context.kind === "branch" && candidate.context.detail === inspection.repository.rootPath
        );
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const folderPath = folder === undefined ? undefined : workspaceFilesystemPath(folder.uri);
        if (folder !== undefined && (folderPath === undefined || !(await isNonGitCurrentContextWorkspace(git, folderPath)))) return undefined;
        fallback = candidates.find((candidate) =>
          candidate.context.kind === "workspace" &&
          candidate.context.selection?.kind === "workspace" &&
          folder !== undefined &&
          candidate.context.selection.workspaceFolderUri.scheme === folder.uri.scheme &&
          candidate.context.selection.workspaceFolderUri.authority === folder.uri.authority &&
          candidate.context.selection.workspaceFolderUri.path === folder.uri.path
        );
      }
    }
    return fallback;
  };

  const currentContextComposition = createT305CurrentContextRuntimeComposition(selection, {
    prepareExplicitSelection: async (signal, feedbackContext) => {
      await reviewContextsRuntimeRef.current?.preparePullRequestCandidateForExplicitContextSelection?.(
        signal,
        feedbackContext,
      );
    },
    enumerateCandidates: enumerateContexts,
    resolveFallback,
    requestSelection: async (available, signal) => {
      testCurrentContextSelectionRequestCount += 1;
      if (context.extensionMode === vscode.ExtensionMode.Test) {
        const testSelection = testCurrentContextSelection;
        testCurrentContextSelection = undefined;
        if (testSelection === "cancel") return undefined;
        if (testSelection === "stale") {
          testCurrentContextStaleAfterPick = true;
          return available[0];
        }
        if (testSelection === "first") return available[0];
      }
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
      if (signal?.aborted === true) return undefined;
      return selected?.snapshot;
    }
  });

  const openGlobalFile = async (target: GlobalUnderstandingFileOpenTarget): Promise<void> => {
    let uri: vscode.Uri;
    if (target.kind === "working-tree") {
      const folders = (vscode.workspace.workspaceFolders ?? []).filter((candidate) => {
        const relative = path.relative(candidate.uri.fsPath, target.filePath);
        return relative.length === 0 || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
      });
      const folder = folders.sort((left, right) => right.uri.fsPath.length - left.uri.fsPath.length)[0];
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
    source: observedGlobalSource,
    resolveFolderPathForResource: (resource) => resource instanceof vscode.Uri
      ? globalSource.folderPathForEntry(resource.fsPath)
      : undefined,
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
    reportError: (error) => {
      const message = `Global理解率を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`;
      if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingUiErrors.push(message);
      void vscode.window.showErrorMessage(message);
    },
    requestGlobalRefresh: (detail) => refreshGlobalUnderstanding(detail),
    ...(context.extensionMode === vscode.ExtensionMode.Test ? {
      onSnapshotPublishedForTest: () => { testGlobalUnderstandingPublishedSnapshot = true; },
      onPresentationPublishedForTest: (presentation) => { testGlobalUnderstandingPresentation = presentation; }
    } : {})
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
      recompute: (signal, feedbackContext, options) => currentContextComposition.recompute(signal, feedbackContext, options),
      acceptRecomputed: (snapshot) => {
        globalRuntime.clear();
        currentContextComposition.acceptRecomputed(snapshot);
        globalSource.setContext(snapshot);
        captureTestGlobalUnderstandingContext(snapshot);
      },
      acceptExplicit: (snapshot) => {
        globalRuntime.clear();
        currentContextComposition.acceptExplicit(snapshot);
        globalSource.setContext(snapshot);
        captureTestGlobalUnderstandingContext(snapshot);
      },
      selectContext: (signal, feedbackContext) => currentContextComposition.selectContext(signal, feedbackContext)
    },
    {
      setSelectedContext: acceptSelectedContext,
      refreshDependents: async () => {
        testCurrentContextDependentRefreshCount += 1;
        await refreshCurrentContextDependents({
          refreshPullRequestProgress: refreshPullRequestProgressForSelection,
          refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
          refreshGlobal: async () => {
            await Promise.all(vscode.workspace.textDocuments
              .filter((document) => !document.isClosed && FILESYSTEM_SCHEMES.has(document.uri.scheme))
              .map(observeCurrentGlobalUnderstandingDocument));
            await refreshGlobalUnderstandingForMutation({ reason: "current-context-changed", phase: "global-refresh-trigger" });
          },
          refreshReviewContexts: async () => {
            await reviewContextsRuntimeRef.current?.refresh();
          },
          reportPullRequestProgressError
        });
      }
    },
    async (error) => {
      await vscode.window.showErrorMessage(
        `現在のレビューコンテキストを更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  );

  let testReviewContextsRepositorySelection: "cancel" | "stale" | undefined;
  let testReviewContextsRepositorySelectionRequestCount = 0;
  reviewContextsRuntimeRef.current = registerT405ReviewContextsRuntime({
    context,
    git,
    enumerateCurrentContexts: enumerateLocalContexts,
    refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
    refreshCurrentContext: () => currentContextRuntime.refresh(),
    registerPullRequestReviewDiff: (registration) => {
      pullRequestReviewRuntime.register(registration);
      if (selectedContext?.kind === "pull-request" && selectedContext.contextId === registration.snapshot.contextId) {
        runtimePort.setCurrentPullRequestDiff(registration.snapshot);
      }
    },
    openPullRequestReviewDiff: (contextId, fileId, title) =>
      pullRequestReviewRuntime.openReviewDiff(contextId, fileId, title),
    getPullRequestReviewProgress: (contextId, feedbackContext, signal) =>
      pullRequestReviewRuntime.getProgress(contextId, feedbackContext, signal),
    reviewStateRepository: runtimePort.reviewStateRepository,
    reviewHistoryRecorder: runtimePort.reviewHistoryRecorder,
    ...(context.extensionMode === vscode.ExtensionMode.Test ? {
      requestRepositorySelection: async (candidates) => {
        testReviewContextsRepositorySelectionRequestCount += 1;
        return testReviewContextsRepositorySelection === "stale" ? { ...candidates[0]! } : undefined;
      },
    } : {}),
  });

  const runGlobalUnderstanding = (detail?: OperationDiagnosticDetail): Promise<void> => {
    if (detail !== undefined) queueOperationStartDetails("Global理解率を再計算", [detail]);
    return globalRuntime.refreshWithErrorBoundary();
  };
  const refreshPullRequestProgress = (): void => {
    void refreshPullRequestProgressForSelection().catch(reportPullRequestProgressError);
  };
  const documentChangeRefresh = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => globalRuntime.invalidate(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    run: runGlobalUnderstanding
  });
  let globalRefreshMutationGeneration = 0;
  const nextGlobalRefreshMutationIdentity = (): string => `global-mutation:${++globalRefreshMutationGeneration}`;
  const refreshGlobalUnderstanding = (detail?: OperationDiagnosticDetail): Promise<void> =>
    documentChangeRefresh.flush(detail);
  const refreshGlobalUnderstandingForMutation = (detail: OperationDiagnosticDetail): Promise<void> =>
    documentChangeRefresh.flush(detail, nextGlobalRefreshMutationIdentity());
  const requestGlobalUnderstandingForMutation = (detail: OperationDiagnosticDetail): void =>
    documentChangeRefresh.request(detail, nextGlobalRefreshMutationIdentity());
  const requestRefreshForDocumentChange = (event: vscode.TextDocumentChangeEvent): void => {
    if (!FILESYSTEM_SCHEMES.has(event.document.uri.scheme)) return;
    requestGlobalUnderstandingForMutation({ reason: "document-changed", target: event.document.uri.fsPath, phase: "global-refresh-trigger" });
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
      options: readReviewRangeMappingOptions(vscode.workspace.getConfiguration("reviewRange")),
      selectedContext
    }).then(
      async (result) => {
        if (result !== "applied") return;
        try {
          await refreshAfterDocumentEdit({
            refreshPullRequestProgress: refreshPullRequestProgressForSelection,
            refreshDecorations: () => runtimePort.refreshVisibleEditorDecorations(),
            refreshGlobal: () => refreshGlobalUnderstandingForMutation({ reason: "document-review-state-applied", target: event.document.uri.fsPath, phase: "global-refresh-trigger" }),
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
  const refreshForSavedOrClosedDocument = (document: vscode.TextDocument, reason: "document-saved" | "document-closed"): void => {
    if (!FILESYSTEM_SCHEMES.has(document.uri.scheme)) return;
    documentChangeRefresh.cancel();
    refreshGlobalUnderstandingForMutation({ reason, target: document.uri.fsPath, phase: "global-refresh-trigger" });
  };
  const testReviewStateDependentQueue = context.extensionMode === vscode.ExtensionMode.Test
    ? new TestReviewStateDependentQueue({
        global: async () => undefined,
        "pull-request-progress": async () => undefined,
        "review-contexts": async () => undefined
      })
    : undefined;
  let testGlobalUnderstandingFileOpen = Promise.resolve();
  const testGlobalUnderstandingFileOpenWaiters: Array<() => void> = [];
  const observeRegisteredGlobalUnderstandingDocument = (
    document: vscode.TextDocument,
    observeEditSnapshot: boolean
  ): Promise<void> => {
    if (!FILESYSTEM_SCHEMES.has(document.uri.scheme)) return Promise.resolve();
    if (observeEditSnapshot) documentEditRuntime.observe(toEditSnapshot(document));
    const observedFileOpen = observeGlobalUnderstandingDocumentOpen({
      observe: () => observeCurrentGlobalUnderstandingDocument(document),
      requestRefresh: () => requestGlobalUnderstandingForMutation({ reason: "document-opened", target: document.uri.fsPath, phase: "global-refresh-trigger" }),
      refreshAfterFailure: () => refreshGlobalUnderstandingForMutation({ reason: "document-open-failed", target: document.uri.fsPath, phase: "global-refresh-trigger" }),
      showGenericError: (message) => {
        if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingUiErrors.push(message);
        void vscode.window.showErrorMessage(message);
      }
    }).then((outcome) => {
      if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingFileOpenOutcome = outcome;
    });
    if (context.extensionMode === vscode.ExtensionMode.Test) testGlobalUnderstandingFileOpen = observedFileOpen;
    return observedFileOpen;
  };
  context.subscriptions.push(
    runtimePort.onDidChangeReviewState(() => {
      if (context.extensionMode === vscode.ExtensionMode.Test) {
        testReviewStateDependentQueue?.enqueueAll();
        return;
      }
      refreshGlobalUnderstandingForMutation({ reason: "review-state-changed", phase: "global-refresh-trigger" });
      refreshPullRequestProgress();
      void reviewContextsRuntimeRef.current?.refreshWithErrorBoundary();
    }),
    exclusionPolicy.onDidChange(() => {
      refreshGlobalUnderstandingForMutation({ reason: "exclude-configuration-changed", phase: "global-refresh-trigger" });
      refreshPullRequestProgress();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void observeRegisteredGlobalUnderstandingDocument(document, true);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const document = editor?.document;
      if (document !== undefined) void observeRegisteredGlobalUnderstandingDocument(document, false);
    }),
    vscode.workspace.onDidChangeTextDocument(requestRefreshForDocumentChange),
    vscode.workspace.onDidSaveTextDocument((document) => refreshForSavedOrClosedDocument(document, "document-saved")),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (FILESYSTEM_SCHEMES.has(document.uri.scheme)) {
        documentEditRuntime.forget(document.uri.toString(true));
      }
      refreshForSavedOrClosedDocument(document, "document-closed");
    }),
    documentChangeRefresh,
    { dispose: () => testReviewStateDependentQueue?.dispose() }
  );

  // Register the real open listener before snapshotting startup documents so an
  // editor opened during activation is observed by one side of the boundary.
  const startupGlobalUnderstanding = currentContextRuntime.startupRefresh.then(() =>
    observeStartupGlobalUnderstandingDocuments(
      vscode.workspace.textDocuments,
      observeCurrentGlobalUnderstandingDocument,
      () => refreshGlobalUnderstandingForMutation({ reason: "startup-documents-observed", phase: "global-refresh-trigger" })
    )
  ).catch((error: unknown) => {
    reportActiveOperationFailure("Global Understanding startup", error);
  });
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    testStartupGlobalUnderstanding = startupGlobalUnderstanding;
  }

  // Recalculation remains scope-gated by the source: filesystem events never start
  // inactive/stopped folders, but active direct scopes and their ancestors refresh.
  const folderEntryWatcher = vscode.workspace.createFileSystemWatcher("**/*");
  let folderEntryWatcherDisposed = false;
  const requestRefreshForFolderEntry = (uri: vscode.Uri): void => {
    if (folderEntryWatcherDisposed) return;
    if (!shouldRefreshGlobalUnderstandingFolderEntry(uri.scheme, uri.fsPath, (filesystemPath) => globalSource.isActiveFolderEntry(filesystemPath))) return;
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      testGlobalUnderstandingFolderEntryAcceptedCount += 1;
      for (const resolve of testGlobalUnderstandingFolderEntryWaiters.splice(0)) resolve();
    }
    requestGlobalUnderstandingForMutation({ reason: "folder-entry-changed", target: uri.fsPath, phase: "global-refresh-trigger" });
  };
  const folderEntryWatcherRegistrations = [
    folderEntryWatcher,
    folderEntryWatcher.onDidCreate(requestRefreshForFolderEntry),
    folderEntryWatcher.onDidDelete(requestRefreshForFolderEntry),
    folderEntryWatcher.onDidChange(requestRefreshForFolderEntry)
  ];
  context.subscriptions.push(...folderEntryWatcherRegistrations);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    const gitReviewStateSnapshotForTest = async (document: vscode.TextDocument) => {
      const documentPath = workspaceFilesystemPath(document.uri);
      if (documentPath === undefined) {
        throw new Error("T609 Git state observation requires a validated workspace URI.");
      }
      const inspection = await git.inspectRepository(documentPath);
      if (inspection.kind !== "repository") {
        throw new Error("T609 Git state observation requires an opened Git document.");
      }
      if (selectedContext?.kind === "workspace") {
        throw new Error("T609 Git state observation cannot read a Git document through a workspace selection.");
      }
      if (
        selectedContext !== undefined &&
        (selectedContext.repositoryId !== inspection.repository.repositoryId ||
          selectedContext.repositoryRoot !== inspection.repository.rootPath)
      ) {
        throw new Error("T609 Git state observation requires the selected context to own the opened document.");
      }
      if (
        selectedContext?.kind === "branch" &&
        (inspection.repository.branch.kind !== "branch" ||
          inspection.repository.branch.fullRef !== selectedContext.branchRef)
      ) {
        throw new Error("T609 Git state observation requires the selected branch to match the opened document.");
      }
      if (
        selectedContext?.kind === "detached" &&
        (inspection.repository.branch.kind !== "detached" ||
          inspection.repository.head !== selectedContext.headRevision)
      ) {
        throw new Error("T609 Git state observation requires the selected detached revision to match the opened document.");
      }
      if (
        selectedContext?.kind === "pull-request" &&
        inspection.repository.head !== selectedContext.headRevision
      ) {
        throw new Error("T609 Git state observation requires the selected pull request revision to match the opened document.");
      }
      const current = new GitReviewContextResolver({ stableHash }).resolve({
        repositoryId: inspection.repository.repositoryId,
        rootPath: inspection.repository.rootPath,
        branch: inspection.repository.branch,
        ...(inspection.repository.head === undefined ? {} : { head: inspection.repository.head })
      });
      const target = selectedContext?.kind === "pull-request"
        ? {
            kind: "pull-request" as const,
            repositoryId: selectedContext.repositoryId,
            contextId: selectedContext.contextId
          }
        : {
            kind: "git" as const,
            repositoryId: current.repositoryId,
            contextId: current.contextId
          };
      const commit = await runtimePort.reviewStateRepository.load(target);
      if (commit === undefined) {
        throw new Error("T609 Git state observation requires persisted Review State.");
      }
      return {
        owner: target.kind,
        repositoryId: target.repositoryId,
        contextId: target.contextId,
        contextRevisionId: commit.contextState.branch?.headRevision ?? commit.contextState.pullRequest?.headSha ?? "",
        globalRevisionId: commit.globalState.currentRevisionId,
        contextFiles: Object.values(commit.contextState.files).map((file) => ({
          fileId: file.fileId,
          path: file.currentPath,
          revisionId: file.revisionId,
          reviewed: file.modifiedReviewed.map((interval) => ({ ...interval }))
        })).sort((left, right) => left.path.localeCompare(right.path)),
        globalFiles: Object.values(commit.globalState.files).map((file) => ({
          fileId: file.fileId,
          path: file.currentPath,
          revisionId: file.revisionId,
          reviewed: file.reviewed.map((interval) => ({ ...interval }))
        })).sort((left, right) => left.path.localeCompare(right.path))
      };
    };
    return {
      ...baseApi,
      drainCurrentContextStartupForTest: () => currentContextRuntime.startupRefresh,
      /** Test-mode T610 drain for non-blocking activation startup Global work. */
      drainStartupGlobalUnderstandingForTest: () => testStartupGlobalUnderstanding,
      /** Test-mode T610 drain for the registered document-open lifecycle. */
      drainGlobalUnderstandingFileOpenForTest: async () => {
        await testGlobalUnderstandingFileOpen;
        documentChangeRefresh.cancel();
        await globalRuntime.refreshWithErrorBoundary();
      },
      /** Returns the accepted production open/active-editor observation count. */
      getGlobalUnderstandingDocumentObservationCountForTest: () => testGlobalUnderstandingAcceptedDocumentOpenCount,
      /** Awaits the next actual open/active-editor observation without a fixed delay. */
      drainNextGlobalUnderstandingDocumentObservationForTest: async (previousCount: number) => {
        if (testGlobalUnderstandingAcceptedDocumentOpenCount <= previousCount) {
          await new Promise<void>((resolve) => { testGlobalUnderstandingFileOpenWaiters.push(resolve); });
        }
        await testGlobalUnderstandingFileOpen;
        documentChangeRefresh.cancel();
        await globalRuntime.refreshWithErrorBoundary();
      },
      /** Test-mode T610 drain for the registered real filesystem watcher callback. */
      drainGlobalUnderstandingFolderEntryForTest: async () => {
        await waitForTestGlobalUnderstandingFolderEntry();
        testGlobalUnderstandingFolderEntryDrainedCount = testGlobalUnderstandingFolderEntryAcceptedCount;
        documentChangeRefresh.cancel();
        await globalRuntime.refreshWithErrorBoundary();
      },
      /** Read-only count of accepted production watcher callbacks. */
      getGlobalUnderstandingFolderEntryCountForTest: () => testGlobalUnderstandingFolderEntryAcceptedCount,
      /** Gives already-delivered watcher callbacks an event-loop checkpoint without a time delay. */
      settleGlobalUnderstandingFolderEntryEventsForTest: () => new Promise<void>((resolve) => setImmediate(resolve)),
      /** Disposes the actual production watcher registrations for lifecycle assertions. */
      disposeGlobalUnderstandingFolderEntryWatcherForTest: () => {
        folderEntryWatcherDisposed = true;
        for (const registration of folderEntryWatcherRegistrations) registration.dispose();
      },
      /** Persists only the last T610 Host subphase outside the workspace watcher scope. */
      recordT610HostSubphaseForTest: async (subphase: string) => {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(context.globalStorageUri, "t610-host-subphase.json"),
          new TextEncoder().encode(`${JSON.stringify({ subphase })}\n`)
        );
      },
      drainDocumentReviewEdits: () => documentEditRuntime.drain(),
      getT305WorkspaceUriPathForTest: (uri: vscode.Uri) => workspaceFilesystemPath(uri),
      getT405WorkspaceUriPathForTest: (uri: vscode.Uri) =>
        reviewContextsRuntimeRef.current?.workspaceUriToFilesystemPathForTest?.(uri),
      getGitReviewStateSnapshotForTest: gitReviewStateSnapshotForTest,
      getGlobalUnderstandingSnapshot: () => globalSource.recalculate(),
      /** Actual TreeDataProvider hierarchy and Status Bar text captured after production rendering. */
      getGlobalUnderstandingPresentationForTest: () => testGlobalUnderstandingPresentation,
      /** Returns a current TreeDataProvider-owned folder node without constructing a fixture target. */
      getGlobalUnderstandingFolderNodeForTest: (folderPath: string) => globalRuntime.getFolderNodeForTest?.(folderPath),
      /** Selects the actual current TreeView row before a no-argument Palette command. */
      selectGlobalUnderstandingFolderNodeForTest: (folderPath: string) => globalRuntime.selectFolderNodeForTest?.(folderPath) ?? Promise.reject(new Error("Global Understanding Tree selection is unavailable.")),
      /** Injects one Test-mode document-open failure through the activated listener and shared Output host. */
      failNextGlobalUnderstandingDocumentOpenForTest: () => {
        const failure = new Error("C:\\private\\owner\\secret.ts permission denied") as NodeJS.ErrnoException;
        failure.code = "EACCES";
        testGlobalUnderstandingDocumentOpenFailure = failure;
      },
      /** Runs the same activated handler registered for document-open events, without waiting for another VS Code event. */
      runInjectedGlobalUnderstandingDocumentOpenForTest: async (uri: vscode.Uri) => {
        const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString(true) === uri.toString(true));
        if (document === undefined) throw new Error("Injected Global Understanding document is not open.");
        await observeRegisteredGlobalUnderstandingDocument(document, false);
      },
      /** Returns immutable shared Output lifecycle entries observed by the activated feedback host. */
      getOperationLogEntriesForTest: () => testOperationLogEntries.map((entry) => ({ ...entry })),
      /** Test-only observation of UI text emitted by the actual runtime error boundary. */
      getGlobalUnderstandingUiErrorsForTest: () => [...testGlobalUnderstandingUiErrors],
      /** Read-only T610 split observation for actual T305 document-open lifecycle diagnostics. */
      getGlobalUnderstandingLifecycleObservationForTest: () => ({
        sourceContext: testGlobalUnderstandingSourceContext,
        acceptedDocumentOpenCount: testGlobalUnderstandingAcceptedDocumentOpenCount,
        observedDocumentPath: testGlobalUnderstandingObservedDocumentPath,
        fileOpenOutcome: testGlobalUnderstandingFileOpenOutcome,
        sourceRefreshOutcome: testGlobalUnderstandingSourceRefreshOutcome,
        sourceRefreshError: testGlobalUnderstandingSourceRefreshError,
        publishedSnapshot: testGlobalUnderstandingPublishedSnapshot
      }),
      /** Test-mode T610 lifecycle seam; production commands remain the runtime owner. */
      startGlobalUnderstandingFolderForTest: async (folderPath: string) => {
        await globalSource.startFolder(folderPath);
        await globalRuntime.refreshWithErrorBoundary();
      },
      stopGlobalUnderstandingFolderForTest: async (folderPath: string) => {
        await globalSource.stopFolder(folderPath);
        await globalRuntime.refreshWithErrorBoundary();
      },
      resumeGlobalUnderstandingFolderForTest: async (folderPath: string) => {
        await globalSource.resumeFolder(folderPath);
        await globalRuntime.refreshWithErrorBoundary();
      },
      /** Reuses the registered watcher path without Extension Host fixture I/O. */
      notifyGlobalUnderstandingFolderEntryForTest: async (uri: vscode.Uri) => {
        requestRefreshForFolderEntry(uri);
        documentChangeRefresh.cancel();
        await globalRuntime.refreshWithErrorBoundary();
      },
      setReviewContextsRepositorySelection: (selection: "cancel" | "stale") => {
        testReviewContextsRepositorySelection = selection;
      },
      getReviewContextsCancellationSnapshot: async () => {
        const snapshot = await reviewContextsRuntimeRef.current?.getCancellationSnapshotForTest?.();
        if (snapshot === undefined) throw new Error("T609 Review Contexts runtime is unavailable.");
        return {
          ...snapshot,
          repositorySelectionRequestCount: testReviewContextsRepositorySelectionRequestCount,
        };
      },
      setCurrentContextSelectionForTest: (selection: "first" | "cancel" | "stale") => {
        testCurrentContextSelection = selection;
      },
      getCurrentContextCancellationSnapshotForTest: () => ({
        selectedContext: selectedContext === undefined ? undefined : JSON.stringify(selectedContext),
        dependentRefreshCount: testCurrentContextDependentRefreshCount,
      }),
      getCurrentContextSelectionRequestCountForTest: () => testCurrentContextSelectionRequestCount,
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

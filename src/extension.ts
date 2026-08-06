import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import {
  DocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor
} from "./adapters/document-review-state/index";
import { ReviewFileExclusionConfigurationController } from "./adapters/file-exclusion/index";
import {
  createNodeLocalGitAdapter
} from "./adapters/local-git/index";
import {
  LocalGitPullRequestDiffAdapter,
  NodeGitCommandExecutor
} from "./adapters/local-git/index";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute
} from "./adapters/state-repository/index";
import { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } from "./adapters/non-git-snapshots/index";
import { SnapshotTrackingWorkspaceReviewStateSessionProvider } from "./adapters/workspace-review-state/index";
import { NonGitSnapshotTracker } from "./application/non-git-snapshots/index";
import {
  createNormalEditorDecorationModel,
  type NormalEditorReviewedDecoration
} from "./application/editor-decoration/index";
import { ReviewFileExclusionPolicyService } from "./application/file-exclusion/index";
import {
  DiffEditorReviewCommandService,
  NormalEditorReviewCommandService
} from "./application/review-commands/index";
import { PullRequestDiffAcquisitionService } from "./application/github-pr-diff/index";
import { ReviewHistoryRecorder } from "./application/review-history/index";
import { WorkspaceIdentityService } from "./application/workspace-identity/index";
import type { SelectedReviewContext } from "./application/review-context/index";
import {
  DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS,
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionDecision
} from "./core/file-exclusion/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "./core/contracts/index";
import { calculatePullRequestDiffProgress } from "./core/pr-progress/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeFileNode
} from "./ui/pr-progress/index";
import {
  NormalEditorDecorationController,
  createRefreshingNormalEditorReviewCommandHandlers,
  registerNormalEditorReviewCommands,
  type NormalEditorCommandHost,
  type NormalEditorDecorationHost,
  type NormalEditorDecorationSettings
} from "./ui/normal-editor/index";

const MARK_FILE_CONFIRMATION = "確認済みにする";
const UNMARK_FILE_CONFIRMATION = "すべて解除";
const REVIEWED_BACKGROUND_COLOR = "reviewRange.reviewedBackground";
const REVIEWED_OVERVIEW_RULER_COLOR = "reviewRange.reviewedOverviewRuler";
const DECORATION_CONFIGURATION_KEYS = [
  "reviewRange.showGlobalReviewed",
  "reviewRange.showGutterIcon",
  "reviewRange.showOverviewRuler"
] as const;
const FILESYSTEM_SCHEMES = new Set(["file", "vscode-remote"]);

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface FileExclusionPolicySnapshot {
  readonly revision: number;
  readonly userGlobs: readonly string[];
}

/** Production runtime boundary shared with Current Context composition. */
export interface ReviewRangeRuntimePort {
  /** Applies an explicit Current Context identity to commands and decorations. */
  setSelectedContext(selection: SelectedReviewContext | undefined): void;
  /** Re-renders visible editors after a selected-context change. */
  refreshVisibleEditorDecorations(): Promise<void>;
}

interface ReviewRangeExtensionTestApi extends ReviewRangeRuntimePort {
  refreshVisibleEditorDecorations(): Promise<void>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  getFileExclusionPolicySnapshot(): FileExclusionPolicySnapshot;
  evaluateFileExclusion(path: string, isBinary?: boolean): ReviewFileExclusionDecision;
  runLocalPullRequestAcceptance(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<LocalPullRequestAcceptanceResult>;
}

interface LocalPullRequestAcceptanceFile {
  readonly path: string;
  readonly category: string;
  readonly reason?: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
}

interface LocalPullRequestAcceptanceSnapshot {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly files: readonly LocalPullRequestAcceptanceFile[];
}

interface LocalPullRequestAcceptanceResult {
  readonly before: LocalPullRequestAcceptanceSnapshot;
  readonly markedFromOriginal: LocalPullRequestAcceptanceSnapshot;
  readonly unmarked: LocalPullRequestAcceptanceSnapshot;
  readonly binarySelectionKind: string;
  readonly textDiffOpenCount: number;
}

interface ActiveExtensionRuntime {
  readonly persistence: DebouncedReviewStateRepository;
  readonly documentSessionProvider: DocumentReviewStateSessionProvider;
  readonly decorationController: NormalEditorDecorationController<
    vscode.TextEditor,
    vscode.TextEditorDecorationType
  >;
  readonly fileExclusionConfigurationController: ReviewFileExclusionConfigurationController;
}

let activeRuntime: ActiveExtensionRuntime | undefined;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isActiveDiffEditor = (): boolean =>
  vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof
  vscode.TabInputTextDiff;

const isVisibleDiffEditor = (editor: vscode.TextEditor): boolean => {
  const documentUri = editor.document.uri.toString();
  return !vscode.window.tabGroups.all.some((group) => {
    const input = group.activeTab?.input;
    return input instanceof vscode.TabInputText && input.uri.toString() === documentUri;
  });
};

const toResourceUri = (uri: vscode.Uri) => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});

const readDecorationSettings = (): NormalEditorDecorationSettings => {
  const configuration = vscode.workspace.getConfiguration("reviewRange");
  return {
    showGlobalReviewed: configuration.get("showGlobalReviewed", true),
    showGutterIcon: configuration.get("showGutterIcon", true),
    showOverviewRuler: configuration.get("showOverviewRuler", false)
  };
};

const createHoverMessage = (
  decoration: NormalEditorReviewedDecoration
): vscode.MarkdownString => {
  const hover = new vscode.MarkdownString(undefined, true);
  hover.isTrusted = false;
  hover.supportHtml = false;
  hover.appendMarkdown("**確認済み**  \n");
  hover.appendText(`Context: ${decoration.contextLabel}`);
  hover.appendMarkdown("  \n");
  hover.appendText(`Reviewed at: ${decoration.reviewedAt}`);
  hover.appendMarkdown("  \n");
  hover.appendText(`Global: ${decoration.globalActive ? "active" : "inactive"}`);
  return hover;
};

const toDecorationOptions = (
  editor: vscode.TextEditor,
  decorations: readonly NormalEditorReviewedDecoration[]
): vscode.DecorationOptions[] => decorations.map((decoration) => {
  const lastLine = decoration.interval.endLineExclusive - 1;
  return {
    range: new vscode.Range(
      new vscode.Position(decoration.interval.startLine, 0),
      editor.document.lineAt(lastLine).range.end
    ),
    hoverMessage: createHoverMessage(decoration)
  };
});

const uniqueVisibleIntervals = (
  documentUri: string,
  appliedDecorations: ReadonlyMap<
    vscode.TextEditor,
    readonly NormalEditorReviewedDecoration[]
  >
): readonly ReviewedIntervalSnapshot[] => {
  const intervals = new Map<string, ReviewedIntervalSnapshot>();

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() !== documentUri) {
      continue;
    }
    for (const decoration of appliedDecorations.get(editor) ?? []) {
      const interval = {
        startLine: decoration.interval.startLine,
        endLineExclusive: decoration.interval.endLineExclusive
      };
      intervals.set(
        `${interval.startLine}:${interval.endLineExclusive}`,
        interval
      );
    }
  }

  return [...intervals.values()].sort(
    (left, right) =>
      left.startLine - right.startLine ||
      left.endLineExclusive - right.endLineExclusive
  );
};

/** Activates the Review Range Tracker extension. */
export function activate(
  context: vscode.ExtensionContext
): ReviewRangeRuntimePort | ReviewRangeExtensionTestApi {
  const stableHash = new NodeSha256StableHash();
  const fileExclusionPolicyService = new ReviewFileExclusionPolicyService();
  const fileExclusionConfigurationController =
    new ReviewFileExclusionConfigurationController({
      service: fileExclusionPolicyService,
      host: {
        readExcludeGlobs: () => [
          ...vscode.workspace.getConfiguration("reviewRange").get<readonly string[]>(
            "exclude",
            DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS
          )
        ],
        onDidChangeConfiguration: (listener) =>
          vscode.workspace.onDidChangeConfiguration((event) => {
            listener({
              affectsExcludeConfiguration: event.affectsConfiguration(
                "reviewRange.exclude"
              )
            });
          }),
        showConfigurationError: (error) => {
          void vscode.window.showErrorMessage(
            `除外設定を適用できませんでした: ${errorMessage(error)}`
          );
        }
      }
    });
  fileExclusionConfigurationController.start();

  const atomicRepository = new FileSystemReviewStateRepository({
    storageUris: {
      globalStorageUri: context.globalStorageUri,
      storageUri: context.storageUri
    }
  });
  const repository = new DebouncedReviewStateRepository({
    delegate: atomicRepository
  });
  const historyRecorder = new ReviewHistoryRecorder({
    sessionId: randomUUID(),
    createEventId: randomUUID,
    appender: new JsonlReviewHistoryStore({
      storageUris: {
        globalStorageUri: context.globalStorageUri,
        storageUri: context.storageUri
      }
    })
  });
  const workspaceStorageUris = {
    globalStorageUri: context.globalStorageUri,
    storageUri: context.storageUri
  };
  const snapshotStorage = new NodeNonGitSnapshotStorage({
    snapshotDirectory: resolveReviewStateStorageRoute(workspaceStorageUris, {
      kind: "workspace", repositoryId: "extension-runtime", contextId: "extension-runtime"
    }).snapshotDirectory
  });
  const workspaceSessionProvider = new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
    historyRecorder,
    snapshotTracker: new NonGitSnapshotTracker(snapshotStorage, new NodeNonGitSnapshotCodec(), {
      maxSnapshots: 128,
      maxCompressedBytes: 5 * 1024 * 1024,
      retentionMs: 30 * 24 * 60 * 60 * 1_000
    }),
    resolveContent: (descriptor) => {
      const resource = descriptor.documentUri;
      return vscode.workspace.textDocuments.find((document) =>
        document.uri.scheme === resource.scheme && document.uri.authority === resource.authority && document.uri.path === resource.path
      )?.getText() ?? "";
    }
  });
  const documentSessionProvider = new DocumentReviewStateSessionProvider({
    gitInspector: createNodeLocalGitAdapter(),
    repository,
    workspaceProvider: workspaceSessionProvider,
    stableHash,
    historyRecorder
  });
  let selectedContext: SelectedReviewContext | undefined;
  const appliedDecorations = new Map<
    vscode.TextEditor,
    readonly NormalEditorReviewedDecoration[]
  >();
  const toDocumentDescriptor = (
    editor: vscode.TextEditor
  ): DocumentEditorReviewDescriptor => {
    const documentUri = editor.document.uri;
    if (!FILESYSTEM_SCHEMES.has(documentUri.scheme)) {
      throw new Error("ローカルまたはRemoteの通常ファイルを開いてください。");
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    const workspace = workspaceFolder === undefined
      ? undefined
      : {
          workspaceFolderUri: toResourceUri(workspaceFolder.uri),
          relativePath: vscode.workspace.asRelativePath(documentUri, false),
          displayName: workspaceFolder.name
        };

    return {
      documentUri: toResourceUri(documentUri),
      documentFsPath: documentUri.fsPath,
      fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
      ...(workspace === undefined ? {} : { workspace }),
      lineCount: editor.document.lineCount,
      contentHash: stableHash.digest(editor.document.getText())
    };
  };
  const openDocumentSession = (editor: vscode.TextEditor) =>
    documentSessionProvider.open(toDocumentDescriptor(editor), selectedContext);
  const reportDecorationError = async (error: unknown): Promise<void> => {
    await vscode.window.showErrorMessage(
      `確認済み装飾を更新できませんでした: ${errorMessage(error)}`
    );
  };
  const invokeDecorationListener = (
    listener: () => void | Promise<void>
  ): void => {
    void Promise.resolve(listener()).catch(reportDecorationError);
  };
  const decorationHost: NormalEditorDecorationHost<
    vscode.TextEditor,
    vscode.TextEditorDecorationType
  > = {
    getVisibleEditors: () => vscode.window.visibleTextEditors,
    isDiffEditor: (editor) => isVisibleDiffEditor(editor),
    getSettings: () => readDecorationSettings(),
    loadDecorations: async (editor, showGlobalReviewed) => {
      if (!FILESYSTEM_SCHEMES.has(editor.document.uri.scheme)) {
        return [];
      }
      const session = await documentSessionProvider.loadForDecoration(
        toDocumentDescriptor(editor),
        selectedContext
      );
      if (session === undefined) {
        return [];
      }
      return createNormalEditorDecorationModel({
        contextState: session.contextState,
        globalState: session.globalState,
        target: session.target,
        showGlobalReviewed
      });
    },
    createDecorationType: (settings) => {
      const options: vscode.DecorationRenderOptions = {
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor(REVIEWED_BACKGROUND_COLOR),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
      };
      if (settings.showGutterIcon) {
        options.gutterIconPath = vscode.Uri.joinPath(
          context.extensionUri,
          "media",
          "reviewed-gutter.svg"
        );
        options.gutterIconSize = "contain";
      }
      if (settings.showOverviewRuler) {
        options.overviewRulerColor = new vscode.ThemeColor(
          REVIEWED_OVERVIEW_RULER_COLOR
        );
        options.overviewRulerLane = vscode.OverviewRulerLane.Right;
      }
      return vscode.window.createTextEditorDecorationType(options);
    },
    setDecorations: (editor, decorationType, decorations) => {
      appliedDecorations.set(editor, decorations.map((decoration) => ({
        ...decoration,
        interval: { ...decoration.interval }
      })));
      editor.setDecorations(
        decorationType,
        toDecorationOptions(editor, decorations)
      );
    },
    onDidChangeVisibleEditors: (listener) =>
      vscode.window.onDidChangeVisibleTextEditors(() => {
        for (const editor of appliedDecorations.keys()) {
          if (!vscode.window.visibleTextEditors.includes(editor)) {
            appliedDecorations.delete(editor);
          }
        }
        invokeDecorationListener(listener);
      }),
    onDidChangeActiveEditor: (listener) =>
      vscode.window.onDidChangeActiveTextEditor(() => {
        invokeDecorationListener(listener);
      }),
    onDidChangeSettings: (listener) =>
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          DECORATION_CONFIGURATION_KEYS.some((key) =>
            event.affectsConfiguration(key)
          )
        ) {
          invokeDecorationListener(listener);
        }
      }),
    showDecorationError: (error) => reportDecorationError(error)
  };
  const decorationController = new NormalEditorDecorationController(decorationHost);
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
    openSession: (editor) => openDocumentSession(editor),
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
    requestHistory: (transaction) => historyRecorder.recordTransaction(
      transaction,
      transaction.operation === "mark-ranges-reviewed" ||
        transaction.operation === "unmark-ranges-reviewed"
        ? "user-selection"
        : "user-file"
    )
  });
  const host: NormalEditorCommandHost<vscode.TextEditor> = {
    getActiveEditor: () => vscode.window.activeTextEditor,
    isDiffEditor: () => isActiveDiffEditor(),
    registerCommand: (commandId, handler) =>
      vscode.commands.registerCommand(commandId, handler),
    showNormalEditorRequired: async () => {
      await vscode.window.showWarningMessage(
        "通常エディタでローカルまたはRemoteのファイルを開いてください。"
      );
    },
    showCommandError: async (error) => {
      await vscode.window.showErrorMessage(
        `レビュー状態を更新できませんでした: ${errorMessage(error)}`
      );
    }
  };
  const registrations = registerNormalEditorReviewCommands(
    host,
    createRefreshingNormalEditorReviewCommandHandlers(
      {
        markSelectionReviewed: (editor) => commandService.markSelectionReviewed(editor),
        unmarkSelectionReviewed: (editor) => commandService.unmarkSelectionReviewed(editor),
        markFileReviewed: (editor) => commandService.markFileReviewed(editor),
        unmarkFileReviewed: (editor) => commandService.unmarkFileReviewed(editor)
      },
      decorationController
    )
  );
  context.subscriptions.push(
    fileExclusionConfigurationController,
    documentSessionProvider,
    decorationController,
    ...registrations
  );
  activeRuntime = {
    persistence: repository,
    documentSessionProvider,
    decorationController,
    fileExclusionConfigurationController
  };
  void decorationController.start().catch(reportDecorationError);

  const runtimePort: ReviewRangeRuntimePort = {
    setSelectedContext: (selection) => {
      selectedContext = selection;
    },
    refreshVisibleEditorDecorations: () =>
      decorationController.refreshVisibleEditors()
  };

  const runLocalPullRequestAcceptance = async (
    input: { readonly baseSha: string; readonly headSha: string }
  ): Promise<LocalPullRequestAcceptanceResult> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder === undefined) {
      throw new Error("T306 acceptance requires one local workspace folder.");
    }
    const request = {
      contextId: "pull-request:local/t306#1",
      repository: { host: "local.test", owner: "t306", repository: "fixture" },
      number: 1,
      baseSha: input.baseSha,
      headSha: input.headSha
    };
    const acquisition = await new PullRequestDiffAcquisitionService({
      local: new LocalGitPullRequestDiffAdapter(
        new NodeGitCommandExecutor(),
        workspaceFolder.uri.fsPath
      ),
      remote: {
        fetch: async () => ({ kind: "unavailable", reason: "api" }),
        readFile: async () => ({ kind: "unavailable", reason: "api" })
      }
    }).acquire(request);
    if (acquisition.kind !== "acquired") {
      throw new Error("T306 local base/head comparison was unavailable.");
    }
    const diff = acquisition.snapshot;
    const reviewFile = diff.files.find((file) => file.newPath === "review.ts");
    if (reviewFile === undefined) throw new Error("T306 review fixture file is missing.");
    const originalLineCount = Math.max(
      0,
      ...reviewFile.hunks.flatMap((hunk) => hunk.lines.flatMap((line) =>
        line.kind === "deletion" && line.oldLine !== undefined ? [line.oldLine] : []
      ))
    );
    const modifiedLineCount = Math.max(
      0,
      ...reviewFile.hunks.flatMap((hunk) => hunk.lines.flatMap((line) =>
        line.kind === "addition" && line.newLine !== undefined ? [line.newLine] : []
      ))
    );
    const occurredAt = "2026-08-06T00:00:00.000Z";
    const copyContextState = (state: Readonly<ReviewContextState>): ReviewContextState => ({
      ...state,
      files: Object.fromEntries(Object.entries(state.files).map(([fileId, file]) => [fileId, {
        ...file,
        previousPaths: [...file.previousPaths],
        modifiedReviewed: file.modifiedReviewed.map((range) => ({ ...range })),
        originalReviewedByDiff: Object.fromEntries(Object.entries(file.originalReviewedByDiff)
          .map(([diffId, ranges]) => [diffId, ranges.map((range) => ({ ...range }))]))
      }]))
    });
    const copyGlobalState = (state: Readonly<RepositoryGlobalState>): RepositoryGlobalState => ({
      ...state,
      files: Object.fromEntries(Object.entries(state.files).map(([fileId, file]) => [fileId, {
        ...file,
        reviewed: file.reviewed.map((range) => ({ ...range }))
      }]))
    });
    let contextState: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: diff.contextId,
      kind: "pull-request",
      repositoryId: "local-t306-fixture",
      displayName: "T306 local fixture",
      pullRequest: {
        host: request.repository.host,
        owner: request.repository.owner,
        repository: request.repository.repository,
        number: request.number,
        state: "open",
        baseSha: diff.baseSha,
        headSha: diff.headSha
      },
      files: {
        [reviewFile.fileId]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          fileId: reviewFile.fileId,
          currentPath: reviewFile.newPath ?? reviewFile.oldPath ?? reviewFile.fileId,
          previousPaths: [],
          revisionId: diff.headSha,
          modifiedReviewed: [],
          originalReviewedByDiff: {},
          lineCount: modifiedLineCount,
          updatedAt: occurredAt
        }
      },
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    let globalState: RepositoryGlobalState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId: contextState.repositoryId,
      currentRevisionId: diff.headSha,
      files: {},
      updatedAt: occurredAt
    };
    let textDiffOpenCount = 0;
    const provider = new PullRequestProgressTreeDataProvider({
      openDiff: async () => { textDiffOpenCount += 1; }
    });
    const replaceProgress = (): LocalPullRequestAcceptanceSnapshot => {
      const progress = calculatePullRequestDiffProgress({
        diff,
        reviewContext: contextState,
        exclusionPolicy: new ReviewFileExclusionPolicy({
          userGlobs: fileExclusionPolicyService.getUserGlobs()
        })
      });
      provider.replaceSnapshot({
        snapshotId: `t306:${diff.baseSha}..${diff.headSha}`,
        contextId: diff.contextId,
        baseSha: diff.baseSha,
        headSha: diff.headSha,
        originalDiffId: diff.originalDiffId,
        fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
        progress,
        lineReviewabilityByFileId: Object.fromEntries(diff.files.map((file) => [
          file.fileId,
          file.status === "binary"
            ? { kind: "unsupported", reason: { kind: "binary" } }
            : { kind: "reviewable" }
        ]))
      });
      const files = provider.getChildren()
        .flatMap((category) => provider.getChildren(category))
        .filter((node): node is PullRequestProgressTreeFileNode => node.kind === "file")
        .map((node) => ({
          path: node.path,
          category: node.category,
          ...(node.reason === undefined ? {} : { reason: node.reason }),
          reviewedLineCount: node.reviewedLineCount,
          totalLineCount: node.totalLineCount
        }));
      return {
        reviewedLineCount: provider.getEffectiveProgress().reviewedLineCount,
        totalLineCount: provider.getEffectiveProgress().totalLineCount,
        files
      };
    };
    const before = replaceProgress();
    const binary = provider.getChildren().flatMap((category) => provider.getChildren(category))
      .find((node): node is PullRequestProgressTreeFileNode =>
        node.kind === "file" && node.path === "binary.bin"
      );
    if (binary === undefined) throw new Error("T306 binary fixture node is missing.");
    const binarySelection = await provider.select(binary);
    const service = new DiffEditorReviewCommandService<{
      readonly side: "original" | "modified";
      readonly lineCount: number;
    }>({
      getSide: (editor) => editor.side,
      getLineCount: (editor) => editor.lineCount,
      getSelections: () => [],
      openSession: async () => ({
        contextState,
        globalState,
        target: {
          fileId: reviewFile.fileId,
          currentPath: reviewFile.newPath ?? reviewFile.oldPath ?? reviewFile.fileId,
          revisionId: diff.headSha,
          lineCount: modifiedLineCount
        },
        diffId: diff.originalDiffId,
        originalLineCount,
        originalDeletionIntervals: reviewFile.hunks.flatMap((hunk) => hunk.lines.flatMap((line) =>
          line.kind === "deletion" && line.oldLine !== undefined
            ? [{ startLine: line.oldLine - 1, endLineExclusive: line.oldLine }]
            : []
        )),
        committer: {
          commit: async (transaction) => {
            contextState = copyContextState(transaction.next.contextState as unknown as ReviewContextState);
            globalState = copyGlobalState(transaction.next.globalState as unknown as RepositoryGlobalState);
          }
        }
      }),
      confirmWholeFileOperation: async () => true,
      requestHistory: async () => undefined,
      now: () => new Date(occurredAt)
    });
    await service.markFileReviewed({ side: "original", lineCount: originalLineCount });
    const markedFromOriginal = replaceProgress();
    await service.unmarkFileReviewed({ side: "modified", lineCount: modifiedLineCount });
    const unmarked = replaceProgress();
    return {
      before,
      markedFromOriginal,
      unmarked,
      binarySelectionKind: binarySelection.kind,
      textDiffOpenCount
    };
  };

  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return runtimePort;
  }

  return {
    ...runtimePort,
    getVisibleReviewedIntervals: (documentUri) =>
      uniqueVisibleIntervals(documentUri, appliedDecorations),
    getFileExclusionPolicySnapshot: () => ({
      revision: fileExclusionPolicyService.getRevision(),
      userGlobs: fileExclusionPolicyService.getUserGlobs()
    }),
    evaluateFileExclusion: (path, isBinary = false) =>
      fileExclusionPolicyService.evaluate({ path, isBinary }),
    runLocalPullRequestAcceptance
  };
}

/** Flushes pending state and releases runtime resources during Extension Host teardown. */
export async function deactivate(): Promise<void> {
  const runtime = activeRuntime;
  activeRuntime = undefined;
  if (runtime === undefined) {
    return;
  }

  runtime.fileExclusionConfigurationController.dispose();
  runtime.decorationController.dispose();
  runtime.documentSessionProvider.dispose();
  await runtime.persistence.dispose();
}

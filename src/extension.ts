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
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  JsonlReviewHistoryStore,
  resolveReviewStateStorageRoute
} from "./adapters/state-repository/index";
import { NodeNonGitSnapshotCodec, NodeNonGitSnapshotStorage } from "./adapters/non-git-snapshots/index";
import { SnapshotTrackingWorkspaceReviewStateSessionProvider } from "./adapters/workspace-review-state/index";
import { NonGitSnapshotTracker } from "./application/non-git-snapshots/index";
import {
  DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES,
  resolveConfiguredNonGitSnapshotLimits
} from "./application/non-git-snapshots/non-git-snapshot-settings";
import {
  createNormalEditorDecorationModel,
  type NormalEditorReviewedDecoration
} from "./application/editor-decoration/index";
import { ReviewFileExclusionPolicyService } from "./application/file-exclusion/index";
import {
  NormalEditorReviewCommandService
} from "./application/review-commands/index";
import { ReviewHistoryRecorder } from "./application/review-history/index";
import { WorkspaceIdentityService } from "./application/workspace-identity/index";
import type { SelectedReviewContext } from "./application/review-context/index";
import {
  DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS,
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionDecision
} from "./core/file-exclusion/index";
import {
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode
} from "./ui/pr-progress/index";
import {
  registerVscodePullRequestProgressTree,
  type VscodePullRequestProgressTreeDataProvider
} from "./ui/pr-progress/vscode-pull-request-progress-tree";
import {
  NormalEditorDecorationController,
  createRefreshingNormalEditorReviewCommandHandlers,
  registerNormalEditorReviewCommands,
  type NormalEditorCommandHost,
  type NormalEditorDecorationHost,
  type NormalEditorDecorationSettings
} from "./ui/normal-editor/index";
import { LocalBaseHeadRuntime } from "./t306-local-base-head-runtime";

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

type ReviewDiffEditorCommandOperation =
  | "markSelectionReviewed"
  | "unmarkSelectionReviewed"
  | "markFileReviewed"
  | "unmarkFileReviewed";

/** Additional owner of canonical `review-range-diff` documents and commands. */
export interface ReviewDiffRuntimePort {
  ownsDocumentUri(uri: string): boolean;
  provideTextDocumentContent(uri: vscode.Uri): string | Promise<string>;
  invokeCommand(
    operation: ReviewDiffEditorCommandOperation,
    editor: vscode.TextEditor
  ): Promise<unknown>;
}

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
  /** 同一Extension Hostで共有するReview Stateのserialization owner。 */
  readonly reviewStateRepository: DebouncedReviewStateRepository;
  /** 同一Extension Hostで共有するReview Historyのserialization owner。 */
  readonly reviewHistoryRecorder: ReviewHistoryRecorder;
  /** Applies an explicit Current Context identity to commands and decorations. */
  setSelectedContext(selection: SelectedReviewContext | undefined): void;
  /** Re-renders visible editors after a selected-context change. */
  refreshVisibleEditorDecorations(): Promise<void>;
  /** Subscribes UI projections that must be recalculated after review-state commands. */
  onDidChangeReviewState(listener: () => void): vscode.Disposable;
  /** Registers another canonical review-diff owner without registering a second URI scheme provider. */
  registerReviewDiffRuntime(runtime: ReviewDiffRuntimePort): vscode.Disposable;
}

interface ReviewRangeExtensionTestApi extends ReviewRangeRuntimePort {
  refreshVisibleEditorDecorations(): Promise<void>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  getFileExclusionPolicySnapshot(): FileExclusionPolicySnapshot;
  evaluateFileExclusion(path: string, isBinary?: boolean): ReviewFileExclusionDecision;
  initializeLocalBaseHeadRuntime(input: {
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<void>;
  getLocalBaseHeadTree(): {
    readonly reviewedLineCount: number;
    readonly totalLineCount: number;
    readonly files: readonly ({
      readonly path: string;
      readonly category: string;
      readonly reason?: string;
      readonly reviewedLineCount: number;
      readonly totalLineCount: number;
      readonly node: PullRequestProgressTreeFileNode;
    })[];
  };
  getLocalBaseHeadOpenedDiffs(): readonly {
    readonly original: string;
    readonly modified: string;
  }[];
  getLocalBaseHeadOpenedFiles(): readonly string[];
  getLocalBaseHeadPersistence(): ReturnType<LocalBaseHeadRuntime<vscode.Uri>["getPersistence"]>;
  setLocalBaseHeadConfirmationAnswer(answer: boolean): void;
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
  const reviewStateChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(reviewStateChanged);
  const additionalReviewDiffRuntimes = new Set<ReviewDiffRuntimePort>();
  const matchingAdditionalReviewDiffRuntime = (
    uri: string
  ): ReviewDiffRuntimePort | undefined =>
    [...additionalReviewDiffRuntimes].find((runtime) => runtime.ownsDocumentUri(uri));
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
    snapshotTracker: new NonGitSnapshotTracker(
      snapshotStorage,
      new NodeNonGitSnapshotCodec(),
      resolveConfiguredNonGitSnapshotLimits({
        maxSnapshotFileSizeBytes: vscode.workspace
          .getConfiguration("reviewRange")
          .get<number>(
            "maxSnapshotFileSizeBytes",
            DEFAULT_MAX_SNAPSHOT_FILE_SIZE_BYTES
          )
      })
    ),
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
  const localBaseHeadCommandServiceReference: {
    current: {
      markSelectionReviewed(editor: vscode.TextEditor): Promise<unknown>;
      unmarkSelectionReviewed(editor: vscode.TextEditor): Promise<unknown>;
      markFileReviewed(editor: vscode.TextEditor): Promise<unknown>;
      unmarkFileReviewed(editor: vscode.TextEditor): Promise<unknown>;
    } | undefined;
  } = { current: undefined };
  const localBaseHeadTreeReference: {
    current: VscodePullRequestProgressTreeDataProvider | undefined;
  } = { current: undefined };
  let localBaseHeadConfirmationAnswer: boolean | undefined;
  const host: NormalEditorCommandHost<vscode.TextEditor> = {
    getActiveEditor: () => vscode.window.activeTextEditor,
    isDiffEditor: (editor) =>
      isActiveDiffEditor() || editor.document.uri.scheme === "review-range-diff",
    invokeDiffEditorCommand: async (operation, editor) => {
      const documentUri = editor.document.uri.toString(true);
      const additional = matchingAdditionalReviewDiffRuntime(documentUri);
      if (additional !== undefined) {
        const result = await additional.invokeCommand(operation, editor);
        if (result === "applied") reviewStateChanged.fire();
        return result;
      }
      const service = localBaseHeadCommandServiceReference.current;
      if (service === undefined || editor.document.uri.scheme !== "review-range-diff") {
        throw new Error("Review Range diff editor is not available.");
      }
      const result = await service[operation](editor);
      if (result === "applied") {
        localBaseHeadTreeReference.current?.refresh();
        reviewStateChanged.fire();
      }
      return result;
    },
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
        markSelectionReviewed: async (editor) => {
          const result = await commandService.markSelectionReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        unmarkSelectionReviewed: async (editor) => {
          const result = await commandService.unmarkSelectionReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        markFileReviewed: async (editor) => {
          const result = await commandService.markFileReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        },
        unmarkFileReviewed: async (editor) => {
          const result = await commandService.unmarkFileReviewed(editor);
          if (result === "applied") reviewStateChanged.fire();
          return result;
        }
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
    reviewStateRepository: repository,
    reviewHistoryRecorder: historyRecorder,
    setSelectedContext: (selection) => {
      selectedContext = selection;
    },
    refreshVisibleEditorDecorations: () =>
      decorationController.refreshVisibleEditors(),
    onDidChangeReviewState: (listener) =>
      reviewStateChanged.event(listener),
    registerReviewDiffRuntime: (runtime) => {
      additionalReviewDiffRuntimes.add(runtime);
      return new vscode.Disposable(() => additionalReviewDiffRuntimes.delete(runtime));
    }
  };

  const localBaseHeadRuntimeReference: {
    current: LocalBaseHeadRuntime<vscode.Uri> | undefined;
  } = { current: undefined };
  const openedLocalBaseHeadDiffs: {
    original: string;
    modified: string;
  }[] = [];
  const openedLocalBaseHeadFiles: string[] = [];
  const openLocalBaseHeadDiff = async (
    target: PullRequestProgressTreeDiffTarget
  ): Promise<void> => {
    const runtime = localBaseHeadRuntimeReference.current;
    if (runtime === undefined) {
      throw new Error("Local base/head runtime is not available.");
    }
    await runtime.diffController.openReviewDiff({
      contextId: target.contextId,
      fileSystemPathSemantics: target.fileSystemPathSemantics,
      original: target.original,
      modified: target.modified,
      title: target.file.path
    });
  };
  const openLocalBaseHeadFile = async (
    target: PullRequestProgressTreeDiffTarget
  ): Promise<void> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder === undefined) {
      throw new Error("PR Progress file open requires a workspace folder.");
    }
    const repositoryPath = target.modified.kind === "present"
      ? target.modified.filePath
      : target.original.filePath;
    const uri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ...repositoryPath.split("/")
    );
    await vscode.commands.executeCommand("vscode.open", uri);
    openedLocalBaseHeadFiles.push(uri.toString(true));
  };
  const localBaseHeadRuntime = new LocalBaseHeadRuntime<vscode.Uri>({
    repository,
    historyRecorder,
    diffHost: {
      parseUri: (value) => vscode.Uri.parse(value, true),
      openDiff: async (original, modified, title) => {
        await vscode.commands.executeCommand(
          "vscode.diff",
          original,
          modified,
          title
        );
        openedLocalBaseHeadDiffs.push({
          original: original.toString(true),
          modified: modified.toString(true)
        });
      }
    },
    progressHost: {
      openDiff: openLocalBaseHeadDiff,
      openFile: openLocalBaseHeadFile
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({
      userGlobs: fileExclusionPolicyService.getUserGlobs()
    })
  });
  localBaseHeadRuntimeReference.current = localBaseHeadRuntime;
  const localBaseHeadCommandService = localBaseHeadRuntime.createCommandService<vscode.TextEditor>({
    getSide: (editor) => localBaseHeadRuntime.sideForDiffDocumentUri(
      editor.document.uri.toString(true)
    ),
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) => editor.selections.map((selection) => ({
      anchor: {
        line: selection.anchor.line,
        character: selection.anchor.character
      },
      active: {
        line: selection.active.line,
        character: selection.active.character
      }
    })),
    fileIdFor: (editor) => localBaseHeadRuntime.fileIdForDiffDocumentUri(
      editor.document.uri.toString(true)
    ),
    confirmWholeFileOperation: async (operation) => {
      if (context.extensionMode === vscode.ExtensionMode.Test &&
        localBaseHeadConfirmationAnswer !== undefined) {
        return localBaseHeadConfirmationAnswer;
      }
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
    }
  });
  localBaseHeadCommandServiceReference.current = localBaseHeadCommandService;
  localBaseHeadTreeReference.current = registerVscodePullRequestProgressTree(
    context,
    localBaseHeadRuntime.progress,
    async (error) => {
      await vscode.window.showErrorMessage(
        `PR Progressを開けませんでした: ${errorMessage(error)}`
      );
    }
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "review-range-diff",
      {
        provideTextDocumentContent: (uri) => {
          const additional = matchingAdditionalReviewDiffRuntime(uri.toString(true));
          return additional === undefined
            ? localBaseHeadRuntime.documentContentProvider.provideTextDocumentContent(uri)
            : additional.provideTextDocumentContent(uri);
        }
      }
    )
  );

  const initializeLocalBaseHeadRuntime = async (
    input: { readonly baseSha: string; readonly headSha: string }
  ): Promise<void> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder === undefined) {
      throw new Error("T306 acceptance requires one local workspace folder.");
    }
    await localBaseHeadRuntime.initialize({
      workspaceRoot: workspaceFolder.uri.fsPath,
      baseSha: input.baseSha,
      headSha: input.headSha
    });
    localBaseHeadTreeReference.current?.refresh();
  };

  const localBaseHeadTree = (): {
    readonly reviewedLineCount: number;
    readonly totalLineCount: number;
    readonly files: readonly ({
      readonly path: string;
      readonly category: string;
      readonly reason?: string;
      readonly reviewedLineCount: number;
      readonly totalLineCount: number;
      readonly node: PullRequestProgressTreeFileNode;
    })[];
  } => {
    const tree = localBaseHeadTreeReference.current;
    if (tree === undefined) throw new Error("PR Progress Tree is not available.");
    const files = tree.getChildren()
      .flatMap((category) => tree.getChildren(category))
      .filter((node): node is PullRequestProgressTreeFileNode => node.kind === "file")
      .map((node) => ({
        path: node.path,
        category: node.category,
        ...(node.reason === undefined ? {} : { reason: node.reason }),
        reviewedLineCount: node.reviewedLineCount,
        totalLineCount: node.totalLineCount,
        node
      }));
    const progress = localBaseHeadRuntime.progress.getEffectiveProgress();
    return {
      reviewedLineCount: progress.reviewedLineCount,
      totalLineCount: progress.totalLineCount,
      files
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
    initializeLocalBaseHeadRuntime,
    getLocalBaseHeadTree: localBaseHeadTree,
    getLocalBaseHeadOpenedDiffs: () => openedLocalBaseHeadDiffs.map((diff) => ({ ...diff })),
    getLocalBaseHeadOpenedFiles: () => [...openedLocalBaseHeadFiles],
    getLocalBaseHeadPersistence: () => localBaseHeadRuntime.getPersistence(),
    setLocalBaseHeadConfirmationAnswer: (answer) => {
      localBaseHeadConfirmationAnswer = answer;
    }
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

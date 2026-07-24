import * as vscode from "vscode";

import { NodeSha256StableHash } from "./adapters/crypto/index";
import { ReviewFileExclusionConfigurationController } from "./adapters/file-exclusion/index";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository
} from "./adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "./adapters/workspace-review-state/index";
import {
  createNormalEditorDecorationModel,
  type NormalEditorReviewedDecoration
} from "./application/editor-decoration/index";
import { ReviewFileExclusionPolicyService } from "./application/file-exclusion/index";
import { NormalEditorReviewCommandService } from "./application/review-commands/index";
import { WorkspaceIdentityService } from "./application/workspace-identity/index";
import {
  DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS,
  type ReviewFileExclusionDecision
} from "./core/file-exclusion/index";
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

interface ReviewedIntervalSnapshot {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

interface FileExclusionPolicySnapshot {
  readonly revision: number;
  readonly userGlobs: readonly string[];
}

interface ReviewRangeExtensionTestApi {
  refreshVisibleEditorDecorations(): Promise<void>;
  getVisibleReviewedIntervals(documentUri: string): readonly ReviewedIntervalSnapshot[];
  getFileExclusionPolicySnapshot(): FileExclusionPolicySnapshot;
  evaluateFileExclusion(path: string, isBinary?: boolean): ReviewFileExclusionDecision;
}

interface ActiveExtensionRuntime {
  readonly persistence: DebouncedReviewStateRepository;
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
    if (editor.document.uri.toString() !== documentUri) continue;
    for (const decoration of appliedDecorations.get(editor) ?? []) {
      const interval = {
        startLine: decoration.interval.startLine,
        endLineExclusive: decoration.interval.endLineExclusive
      };
      intervals.set(`${interval.startLine}:${interval.endLineExclusive}`, interval);
    }
  }
  return [...intervals.values()].sort(
    (left, right) => left.startLine - right.startLine ||
      left.endLineExclusive - right.endLineExclusive
  );
};

/** Activates the Review Range Tracker extension. */
export function activate(
  context: vscode.ExtensionContext
): ReviewRangeExtensionTestApi | undefined {
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
              affectsExcludeConfiguration: event.affectsConfiguration("reviewRange.exclude")
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
  const repository = new DebouncedReviewStateRepository({ delegate: atomicRepository });
  const sessionProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository
  });
  const appliedDecorations = new Map<
    vscode.TextEditor,
    readonly NormalEditorReviewedDecoration[]
  >();
  const openWorkspaceSession = async (editor: vscode.TextEditor) => {
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
  };
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
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (workspaceFolder === undefined || context.storageUri === undefined) return [];
      const session = await sessionProvider.loadForDecoration({
        workspaceFolderUri: toResourceUri(workspaceFolder.uri),
        documentUri: toResourceUri(editor.document.uri),
        fileSystemPathSemantics: process.platform === "win32" ? "windows" : "posix",
        relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
        workspaceDisplayName: workspaceFolder.name,
        lineCount: editor.document.lineCount,
        contentHash: stableHash.digest(editor.document.getText())
      });
      if (session === undefined) return [];
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
        options.overviewRulerColor = new vscode.ThemeColor(REVIEWED_OVERVIEW_RULER_COLOR);
        options.overviewRulerLane = vscode.OverviewRulerLane.Right;
      }
      return vscode.window.createTextEditorDecorationType(options);
    },
    setDecorations: (editor, decorationType, decorations) => {
      appliedDecorations.set(editor, decorations.map((decoration) => ({
        ...decoration,
        interval: { ...decoration.interval }
      })));
      editor.setDecorations(decorationType, toDecorationOptions(editor, decorations));
    },
    onDidChangeVisibleEditors: (listener) =>
      vscode.window.onDidChangeVisibleTextEditors(() => {
        for (const editor of appliedDecorations.keys()) {
          if (!vscode.window.visibleTextEditors.includes(editor)) appliedDecorations.delete(editor);
        }
        invokeDecorationListener(listener);
      }),
    onDidChangeActiveEditor: (listener) =>
      vscode.window.onDidChangeActiveTextEditor(() => invokeDecorationListener(listener)),
    onDidChangeSettings: (listener) =>
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (DECORATION_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(key))) {
          invokeDecorationListener(listener);
        }
      }),
    showDecorationError: (error) => reportDecorationError(error)
  };
  const decorationController = new NormalEditorDecorationController(decorationHost);
  const commandService = new NormalEditorReviewCommandService<vscode.TextEditor>({
    getLineCount: (editor) => editor.document.lineCount,
    getSelections: (editor) => editor.selections.map((selection) => ({
      anchor: { line: selection.anchor.line, character: selection.anchor.character },
      active: { line: selection.active.line, character: selection.active.character }
    })),
    openSession: (editor) => openWorkspaceSession(editor),
    confirmWholeFileOperation: async (operation) => {
      if (operation === "mark-file-reviewed") {
        const result = await vscode.window.showWarningMessage(
          "このファイルの全行を確認済みにします.",
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
    requestHistory: () => {
      // T206 connects the append-only history store after the atomic state commit.
    }
  });
  const host: NormalEditorCommandHost<vscode.TextEditor> = {
    getActiveEditor: () => vscode.window.activeTextEditor,
    isDiffEditor: () => isActiveDiffEditor(),
    registerCommand: (commandId, handler) => vscode.commands.registerCommand(commandId, handler),
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
    decorationController,
    ...registrations
  );
  activeRuntime = {
    persistence: repository,
    decorationController,
    fileExclusionConfigurationController
  };
  void decorationController.start().catch(reportDecorationError);

  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
    refreshVisibleEditorDecorations: () => decorationController.refreshVisibleEditors(),
    getVisibleReviewedIntervals: (documentUri) =>
      uniqueVisibleIntervals(documentUri, appliedDecorations),
    getFileExclusionPolicySnapshot: () => ({
      revision: fileExclusionPolicyService.getRevision(),
      userGlobs: fileExclusionPolicyService.getUserGlobs()
    }),
    evaluateFileExclusion: (path, isBinary = false) =>
      fileExclusionPolicyService.evaluate({ path, isBinary })
  };
}

/** Flushes pending state and releases runtime resources during Extension Host teardown. */
export async function deactivate(): Promise<void> {
  const runtime = activeRuntime;
  activeRuntime = undefined;
  if (runtime === undefined) return;
  runtime.fileExclusionConfigurationController.dispose();
  runtime.decorationController.dispose();
  await runtime.persistence.dispose();
}

import * as vscode from "vscode";

import {
  OperationFeedback,
  formatOperationFailureForUser,
  hasActiveOperationFeedback,
  runWithActiveOperationFeedback,
  setActiveOperationFeedback
} from "../../application/operation-feedback/index";
import { VscodeOperationFeedbackHost } from "../operation-feedback/index";

import {
  createGlobalUnderstandingTreeModelIncrementally,
  formatGlobalUnderstandingStatusBar,
  GlobalLayerToggleController,
  GlobalUnderstandingFileOpenController,
  GlobalUnderstandingRefreshController,
  type GlobalUnderstandingDiagnosticsNode,
  type GlobalUnderstandingFolderNode,
  type GlobalUnderstandingFileOpenTarget,
  type GlobalUnderstandingFileNode,
  type GlobalUnderstandingSummaryNode,
  type GlobalUnderstandingTreeModel,
  type GlobalUnderstandingTreeSnapshot
} from "./global-understanding-ui-model";

export const GLOBAL_UNDERSTANDING_VIEW_ID = "reviewRange.globalUnderstanding";
export const REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID =
  "reviewRange.refreshGlobalUnderstanding";
export const TOGGLE_GLOBAL_LAYER_COMMAND_ID = "reviewRange.toggleGlobalLayer";
export const OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID = "reviewRange.openGlobalUnderstandingFile";
export const START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.startGlobalUnderstandingFolder";
export const STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.stopGlobalUnderstandingFolder";
export const RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.resumeGlobalUnderstandingFolder";

export interface GlobalUnderstandingRuntimeSource {
  recalculate(signal?: AbortSignal): Promise<GlobalUnderstandingTreeSnapshot | undefined>;
  startFolder?(folderPath: string): Promise<void>;
  stopFolder?(folderPath: string): Promise<void>;
  resumeFolder?(folderPath: string): Promise<void>;
}

export interface GlobalUnderstandingRuntimeDependencies {
  readonly source: GlobalUnderstandingRuntimeSource;
  readonly readGlobalLayerEnabled: () => boolean;
  readonly writeGlobalLayerEnabled: (enabled: boolean) => void | PromiseLike<void>;
  readonly refreshDecorations: () => void | Promise<void>;
  readonly openFile: (target: GlobalUnderstandingFileOpenTarget) => void | Promise<void>;
  readonly reportError: (error: unknown) => void | Promise<void>;
  /** Test-mode-only observer supplied by the T305 composition after a snapshot is published. */
  readonly onSnapshotPublishedForTest?: (snapshot: GlobalUnderstandingTreeSnapshot) => void;
  /** Test-only observation of the production Tree provider's rendered hierarchy and Status Bar text. */
  readonly onPresentationPublishedForTest?: (presentation: GlobalUnderstandingPresentationForTest) => void;
}

/** Immutable rendering observation captured only from the actual Tree provider in Extension tests. */
export interface GlobalUnderstandingPresentationForTest {
  /** Recursive folder rows as returned by the active TreeDataProvider. */
  readonly folderHierarchy: readonly GlobalUnderstandingFolderPresentationForTest[];
  /** Description rendered on the provider's repository summary row. */
  readonly summaryDescription: string;
  /** Text rendered by the production Status Bar item. */
  readonly statusText: string;
}

/** One actual Tree folder row and its actual provider children. */
export interface GlobalUnderstandingFolderPresentationForTest {
  /** Canonical Tree row path. */
  readonly path: string;
  /** Lifecycle state rendered for the Tree row. */
  readonly state: GlobalUnderstandingFolderNode["state"];
  /** Description rendered for the Tree row. */
  readonly description: string;
  /** Actual nested folder rows returned by the provider. */
  readonly children: readonly GlobalUnderstandingFolderPresentationForTest[];
}

interface FilesGroupNode {
  readonly kind: "files-group";
  readonly label: "ファイル別";
  readonly count: number;
}

interface DiagnosticValueNode {
  readonly kind: "diagnostic-value";
  readonly label: string;
  readonly value: number;
}

type GlobalUnderstandingViewNode =
  | GlobalUnderstandingSummaryNode
  | FilesGroupNode
  | GlobalUnderstandingFileNode
  | GlobalUnderstandingFolderNode
  | GlobalUnderstandingDiagnosticsNode
  | DiagnosticValueNode;

const FILES_GROUP: FilesGroupNode = Object.freeze({
  kind: "files-group",
  label: "ファイル別",
  count: 0
});
const folderParent = (value: string): string | undefined => {
  if (value.length === 0) return undefined;
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
};

class GlobalUnderstandingTreeDataProvider
implements vscode.TreeDataProvider<GlobalUnderstandingViewNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<GlobalUnderstandingViewNode | undefined>();
  private model: GlobalUnderstandingTreeModel | undefined;

  public readonly onDidChangeTreeData = this.changed.event;

  public setModel(model: GlobalUnderstandingTreeModel): void {
    this.model = model;
    this.changed.fire(undefined);
  }

  public clear(): void {
    this.model = undefined;
    this.changed.fire(undefined);
  }

  public getTreeItem(node: GlobalUnderstandingViewNode): vscode.TreeItem {
    switch (node.kind) {
      case "summary": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = node.description;
        item.tooltip = [
          `Global理解率: ${Math.round(node.progress * 100)}%`,
          `確認済み非空行: ${node.reviewedNonEmptyLineCount}`,
          `対象非空行: ${node.totalNonEmptyLineCount}`
        ].join("\n");
        item.iconPath = new vscode.ThemeIcon("book");
        item.contextValue = "reviewRange.globalUnderstandingSummary";
        return item;
      }
      case "files-group": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.description = String(node.count);
        item.iconPath = new vscode.ThemeIcon("files");
        item.contextValue = "reviewRange.globalUnderstandingFiles";
        return item;
      }
      case "file": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = node.description;
        item.tooltip = [
          node.path,
          `状態: ${node.state}`,
          `確認済み非空行: ${node.reviewedNonEmptyLineCount}`,
          `対象非空行: ${node.totalNonEmptyLineCount}`
        ].join("\n");
        item.iconPath = new vscode.ThemeIcon(
          node.state === "current" ? "pass" : node.state === "stale" ? "warning" : "circle-outline"
        );
        item.contextValue = "reviewRange.globalUnderstandingFile";
        item.command = {
          command: OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID,
          title: "Global理解率のファイルを開く",
          arguments: [node]
        };
        return item;
      }
      case "folder": {
        const hasChildren = this.model?.folders?.some((candidate) => folderParent(candidate.path) === node.path) === true;
        const item = new vscode.TreeItem(node.label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.description = node.description;
        item.tooltip = `状態: ${node.state}\n${node.partial ? "部分集計" : "完全集計"}`;
        item.iconPath = new vscode.ThemeIcon(node.state === "stopped" ? "debug-pause" : node.partial ? "warning" : "folder");
        item.contextValue = `reviewRange.globalUnderstandingFolder.${node.action}`;
        const command = node.action === "start" ? START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID : node.action === "stop" ? STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID : RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID;
        item.command = { command, title: "Global Understanding folder action", arguments: [node] };
        return item;
      }
      case "diagnostics": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.iconPath = new vscode.ThemeIcon("info");
        item.contextValue = "reviewRange.globalUnderstandingDiagnostics";
        return item;
      }
      case "diagnostic-value": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = String(node.value);
        item.contextValue = "reviewRange.globalUnderstandingDiagnostic";
        return item;
      }
    }
  }

  public getChildren(
    node?: GlobalUnderstandingViewNode
  ): GlobalUnderstandingViewNode[] {
    const model = this.model;
    if (model === undefined) return [];
    if (node === undefined) {
      return [
        model.summary,
        ...(model.folders ?? []).filter((folder) => {
          const parent = folderParent(folder.path);
          return parent === undefined || !(model.folders ?? []).some((candidate) => candidate.path === parent);
        }),
        { ...FILES_GROUP, count: model.files.length },
        model.diagnostics
      ];
    }
    if (node.kind === "files-group") return [...model.files];
    if (node.kind === "folder") return (model.folders ?? []).filter((folder) => folderParent(folder.path) === node.path);
    if (node.kind === "diagnostics") {
      return [
        {
          kind: "diagnostic-value",
          label: "開いたことがあるファイル",
          value: node.openedFileCount
        },
        {
          kind: "diagnostic-value",
          label: "未オープンファイル",
          value: node.unopenedFileCount
        },
        {
          kind: "diagnostic-value",
          label: "除外ファイル",
          value: node.excludedFileCount
        },
        {
          kind: "diagnostic-value",
          label: "pruneした除外ディレクトリ",
          value: node.prunedExcludedDirectoryCount
        }
      ];
    }
    return [];
  }

  public dispose(): void {
    this.changed.dispose();
  }
}

export interface RegisteredGlobalUnderstandingRuntime extends vscode.Disposable {
  refresh(): Promise<void>;
  refreshWithErrorBoundary(): Promise<void>;
  invalidate(): void;
  clear(): void;
}

type FolderAction = GlobalUnderstandingFolderNode["action"];

const requireCurrentFolderNode = (value: unknown, expectedAction: FolderAction, current: ReadonlySet<GlobalUnderstandingFolderNode>): GlobalUnderstandingFolderNode => {
  if (value === undefined) {
    const candidates = [...current].filter((node) => node.action === expectedAction);
    if (candidates.length === 1) return candidates[0]!;
    throw new RangeError("Select one current Global Understanding folder row before running this command.");
  }
  if (typeof value !== "object" || value === null || (value as { kind?: unknown }).kind !== "folder") {
    throw new RangeError("Select a current Global Understanding folder row before running this command.");
  }
  const node = value as GlobalUnderstandingFolderNode;
  if (!current.has(node)) throw new RangeError("Selected Global Understanding folder row is stale or belongs to another repository.");
  if (node.action !== expectedAction) throw new RangeError("Selected Global Understanding folder row does not support this command.");
  return node;
};

/** Registers the T505 Tree View, adjacent Status Bar item, refresh command, and Global layer toggle. */
export const registerGlobalUnderstandingRuntime = (
  context: vscode.ExtensionContext,
  dependencies: GlobalUnderstandingRuntimeDependencies
): RegisteredGlobalUnderstandingRuntime => {
  if (!hasActiveOperationFeedback()) {
    const operationFeedbackHost = new VscodeOperationFeedbackHost();
    context.subscriptions.push(operationFeedbackHost);
    setActiveOperationFeedback(new OperationFeedback(operationFeedbackHost));
  }
  const tree = new GlobalUnderstandingTreeDataProvider();
  const openController = new GlobalUnderstandingFileOpenController({
    openFile: dependencies.openFile
  });
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  let currentFolderNodes = new Set<GlobalUnderstandingFolderNode>();
  status.name = "Review Range Global Understanding";
  status.command = TOGGLE_GLOBAL_LAYER_COMMAND_ID;
  const clearPresentation = (): void => {
    openController.clear();
    currentFolderNodes.clear();
    tree.clear();
    status.text = "";
    status.tooltip = undefined;
    status.hide();
  };
  const refreshController = new GlobalUnderstandingRefreshController(
    dependencies.source,
    {
      show: async (snapshot, isCurrent) => {
        const model = await createGlobalUnderstandingTreeModelIncrementally(snapshot, {
          maxFilesPerStage: 128,
          yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
          isCurrent,
          onStage: (stage) => {
            if (!isCurrent()) return;
            openController.replaceModel(stage);
            currentFolderNodes = new Set(stage.folders ?? []);
            tree.setModel(stage);
            dependencies.onSnapshotPublishedForTest?.(snapshot);
            if (!isCurrent()) {
              clearPresentation();
              return;
            }
            const statusModel = formatGlobalUnderstandingStatusBar(snapshot);
            status.text = statusModel.text;
            status.tooltip = statusModel.tooltip;
            status.show();
            const presentFolder = (folder: GlobalUnderstandingFolderNode): GlobalUnderstandingFolderPresentationForTest => ({
              path: folder.path,
              state: folder.state,
              description: folder.description,
              children: tree.getChildren(folder).filter((node): node is GlobalUnderstandingFolderNode => node.kind === "folder").map(presentFolder)
            });
            dependencies.onPresentationPublishedForTest?.({
              folderHierarchy: tree.getChildren().filter((node): node is GlobalUnderstandingFolderNode => node.kind === "folder").map(presentFolder),
              summaryDescription: stage.summary.description,
              statusText: status.text
            });
          }
        });
        if (model === undefined || !isCurrent()) return;
      },
      clear: clearPresentation
    }
  );

  const invalidate = (): void => {
    retryCancellation?.abort();
    refreshController.invalidate();
  };
  const clear = (): void => {
    retryCancellation?.abort();
    refreshController.clear();
  };
  let retryCancellation: AbortController | undefined;
  const refresh = (): Promise<void> => {
    retryCancellation?.abort();
    const currentCancellation = new AbortController();
    retryCancellation = currentCancellation;
    return runWithActiveOperationFeedback(
      "Global理解率を再計算",
      () => refreshController.refresh(currentCancellation.signal).then(() => undefined),
    ).finally(() => {
      if (retryCancellation === currentCancellation) retryCancellation = undefined;
    });
  };

  const refreshWithErrorBoundary = async (): Promise<void> => {
    try {
      await refresh();
    } catch (error) {
      await dependencies.reportError(formatOperationFailureForUser(error));
    }
  };

  const toggle = new GlobalLayerToggleController({
    readEnabled: dependencies.readGlobalLayerEnabled,
    writeEnabled: async (enabled) => {
      await dependencies.writeGlobalLayerEnabled(enabled);
    },
    refreshDecorations: dependencies.refreshDecorations,
    refreshGlobalUnderstanding: refresh
  });

  const registrations: vscode.Disposable[] = [
    vscode.window.registerTreeDataProvider(
      GLOBAL_UNDERSTANDING_VIEW_ID,
      tree
    ),
    vscode.commands.registerCommand(
      REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID,
      refreshWithErrorBoundary
    ),
    vscode.commands.registerCommand(
      START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
      async (value: unknown) => {
        try {
          if (dependencies.source.startFolder === undefined) return;
          const folder = requireCurrentFolderNode(value, "start", currentFolderNodes);
          await runWithActiveOperationFeedback("Global Understanding folderを開始", async () => {
            await dependencies.source.startFolder!(folder.path);
            await refreshWithErrorBoundary();
          });
        } catch (error) {
          await dependencies.reportError(formatOperationFailureForUser(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
      async (value: unknown) => {
        try {
          if (dependencies.source.stopFolder === undefined) return;
          const folder = requireCurrentFolderNode(value, "stop", currentFolderNodes);
          await runWithActiveOperationFeedback("Global Understanding folderを停止", async () => {
            await dependencies.source.stopFolder!(folder.path);
            await refreshWithErrorBoundary();
          });
        } catch (error) {
          await dependencies.reportError(formatOperationFailureForUser(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
      async (value: unknown) => {
        try {
          if (dependencies.source.resumeFolder === undefined) return;
          const folder = requireCurrentFolderNode(value, "resume", currentFolderNodes);
          await runWithActiveOperationFeedback("Global Understanding folderを再開", async () => {
            await dependencies.source.resumeFolder!(folder.path);
            await refreshWithErrorBoundary();
          });
        } catch (error) {
          await dependencies.reportError(formatOperationFailureForUser(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID,
      async (node: GlobalUnderstandingFileNode | undefined) => {
        if (node === undefined || node.kind !== "file") return;
        try {
          await runWithActiveOperationFeedback(
            "Global理解率ファイルを開く",
            () => openController.open(node),
          );
        } catch (error) {
          await dependencies.reportError(formatOperationFailureForUser(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      TOGGLE_GLOBAL_LAYER_COMMAND_ID,
      async () => {
        try {
          await runWithActiveOperationFeedback(
            "Global理解率Layerを切り替える",
            () => toggle.toggle(),
          );
        } catch (error) {
          await dependencies.reportError(formatOperationFailureForUser(error));
        }
      }
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("reviewRange.exclude") ||
        event.affectsConfiguration("reviewRange.globalUnderstanding.autoStartDescendants") ||
        event.affectsConfiguration("reviewRange.showGlobalReviewed")
      ) {
        void refreshWithErrorBoundary();
      }
    }),
    status,
    tree
  ];
  context.subscriptions.push(...registrations);

  return {
    refresh,
    refreshWithErrorBoundary,
    invalidate,
    clear,
    dispose: () => {
      retryCancellation?.abort();
      retryCancellation = undefined;
      refreshController.clear();
      for (const registration of registrations) registration.dispose();
    }
  };
};

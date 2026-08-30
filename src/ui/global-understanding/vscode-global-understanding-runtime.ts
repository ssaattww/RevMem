import * as vscode from "vscode";

import {
  OperationCancelledError,
  OperationFeedback,
  formatOperationFailureForUser,
  hasActiveOperationFeedback,
  queueOperationStartDetails,
  runWithActiveOperationFeedback,
  setActiveOperationFeedback
} from "../../application/operation-feedback/index";
import type { OperationDiagnosticDetail } from "../../application/operation-feedback/index";
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

/** VS Code Tree View identifier for the current owner-scoped Global Understanding projection. */
export const GLOBAL_UNDERSTANDING_VIEW_ID = "reviewRange.globalUnderstanding";
/** Public command that recomputes the current Global Understanding projection. */
export const REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID =
  "reviewRange.refreshGlobalUnderstanding";
/** Public command that toggles Global reviewed-line decorations. */
export const TOGGLE_GLOBAL_LAYER_COMMAND_ID = "reviewRange.toggleGlobalLayer";
/** Public command that opens one current Global Understanding file target. */
export const OPEN_GLOBAL_UNDERSTANDING_FILE_COMMAND_ID = "reviewRange.openGlobalUnderstandingFile";
/** Public command that starts the selected current-generation folder scope. */
export const START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.startGlobalUnderstandingFolder";
/** Public command that stops the selected current-generation folder scope. */
export const STOP_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.stopGlobalUnderstandingFolder";
/** Public command that resumes the selected current-generation folder scope. */
export const RESUME_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID = "reviewRange.resumeGlobalUnderstandingFolder";

/** Owner-scoped application source consumed by the VS Code Global Understanding runtime. */
export interface GlobalUnderstandingRuntimeSource {
  /** Recalculates the current owner and may publish a cancellable running snapshot before I/O. */
  recalculate(
    signal?: AbortSignal,
    publishProgress?: (snapshot: GlobalUnderstandingTreeSnapshot) => void | Promise<void>
  ): Promise<GlobalUnderstandingTreeSnapshot | undefined>;
  /** Starts the canonical current-generation folder path. */
  startFolder?(folderPath: string): Promise<void>;
  /** Stops the canonical current-generation folder path. */
  stopFolder?(folderPath: string): Promise<void>;
  /** Resumes the canonical current-generation folder path. */
  resumeFolder?(folderPath: string): Promise<void>;
}

/** VS Code composition dependencies for the owner-scoped Global Understanding runtime. */
export interface GlobalUnderstandingRuntimeDependencies {
  /** Current owner-scoped source controlled by this runtime. */
  readonly source: GlobalUnderstandingRuntimeSource;
  /** Resolves an editor-context resource to a canonical current-owner folder. */
  readonly resolveFolderPathForResource?: (resource: unknown) => string | undefined;
  /** Reads whether the global reviewed-line decoration layer is enabled. */
  readonly readGlobalLayerEnabled: () => boolean;
  /** Persists the global reviewed-line decoration layer setting. */
  readonly writeGlobalLayerEnabled: (enabled: boolean) => void | PromiseLike<void>;
  /** Refreshes reviewed-line decorations after a layer change. */
  readonly refreshDecorations: () => void | Promise<void>;
  /** Opens an immutable current-owner file target. */
  readonly openFile: (target: GlobalUnderstandingFileOpenTarget) => void | Promise<void>;
  /** Reports only generic UI wording while shared Output owns details. */
  readonly reportError: (error: unknown) => void | Promise<void>;
  /** Routes a user-visible Global refresh through the owner composition when available. */
  readonly requestGlobalRefresh?: (detail: OperationDiagnosticDetail) => Promise<void>;
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

  /** Resolves only an actual current folder ancestor so TreeView reveal can select it safely. */
  public getParent(node: GlobalUnderstandingViewNode): GlobalUnderstandingViewNode | undefined {
    if (node.kind !== "folder") return undefined;
    const parent = folderParent(node.path);
    if (parent === undefined) return undefined;
    return this.model?.folders?.find((candidate) => candidate.path === parent);
  }

  public dispose(): void {
    this.changed.dispose();
  }
}

/** Registered Tree, command, Status Bar, and generation lifecycle owned by T305 activation. */
export interface RegisteredGlobalUnderstandingRuntime extends vscode.Disposable {
  /** Recalculates and publishes the current owner without swallowing failures. */
  refresh(): Promise<void>;
  /** Recalculates through the generic UI/Output error boundary. */
  refreshWithErrorBoundary(): Promise<void>;
  /** Invalidates the current generation and clears every published row. */
  invalidate(): void;
  /** Clears the current generation and presentation. */
  clear(): void;
  /** Returns the current provider-owned folder node for Extension Host assertions only. */
  getFolderNodeForTest?(path: string): GlobalUnderstandingFolderNode | undefined;
  /** Selects one actual provider-owned folder row for Palette command assertions only. */
  selectFolderNodeForTest?(path: string): Promise<void>;
}

type FolderAction = GlobalUnderstandingFolderNode["action"];

const requireCurrentFolderNode = (
  value: unknown,
  expectedAction: FolderAction,
  current: ReadonlySet<GlobalUnderstandingFolderNode>,
  selected: GlobalUnderstandingFolderNode | undefined,
  resolveFolderPathForResource?: (resource: unknown) => string | undefined
): GlobalUnderstandingFolderNode => {
  if (value === undefined) {
    if (selected !== undefined && current.has(selected) && selected.action === expectedAction) return selected;
    throw new RangeError("Select a current Global Understanding folder row that supports this command.");
  }
  const resourceFolder = resolveFolderPathForResource?.(value);
  if (resourceFolder !== undefined) {
    const candidates = [...current].filter((node) => node.path === resourceFolder && node.action === expectedAction);
    if (candidates.length === 1) return candidates[0]!;
    throw new RangeError("The selected editor resource does not have a current Global Understanding folder action.");
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
  let selectedFolderNode: GlobalUnderstandingFolderNode | undefined;
  let treeView: vscode.TreeView<GlobalUnderstandingViewNode> | undefined;
  status.name = "Review Range Global Understanding";
  status.command = TOGGLE_GLOBAL_LAYER_COMMAND_ID;
  const clearPresentation = (): void => {
    openController.clear();
    currentFolderNodes.clear();
    selectedFolderNode = undefined;
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
            if (selectedFolderNode !== undefined && !currentFolderNodes.has(selectedFolderNode)) selectedFolderNode = undefined;
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
      async () => {
        await refreshController.refresh(currentCancellation.signal);
        if (currentCancellation.signal.aborted) throw new OperationCancelledError();
      },
    ).finally(() => {
      if (retryCancellation === currentCancellation) retryCancellation = undefined;
    });
  };

  const refreshWithErrorBoundary = async (): Promise<void> => {
    try {
      await refresh();
    } catch (error) {
      if (error instanceof OperationCancelledError || (error instanceof Error && error.name === "AbortError")) return;
      await dependencies.reportError(formatOperationFailureForUser(error));
    }
  };
  const refreshWithDetail = (detail: OperationDiagnosticDetail): Promise<void> => {
    if (dependencies.requestGlobalRefresh !== undefined) return dependencies.requestGlobalRefresh(detail);
    queueOperationStartDetails("Global理解率を再計算", [detail]);
    return refreshWithErrorBoundary();
  };

  const toggle = new GlobalLayerToggleController({
    readEnabled: dependencies.readGlobalLayerEnabled,
    writeEnabled: async (enabled) => {
      await dependencies.writeGlobalLayerEnabled(enabled);
    },
    refreshDecorations: dependencies.refreshDecorations,
    refreshGlobalUnderstanding: () => refreshWithDetail({ reason: "global-layer-toggled", phase: "global-refresh-trigger" })
  });

  const registrations: vscode.Disposable[] = [];
  if (typeof (vscode.window as { readonly createTreeView?: unknown }).createTreeView === "function") {
    treeView = vscode.window.createTreeView(GLOBAL_UNDERSTANDING_VIEW_ID, { treeDataProvider: tree });
    registrations.push(
      treeView,
      treeView.onDidChangeSelection((event) => {
        const selected = event.selection[0];
        selectedFolderNode = selected?.kind === "folder" ? selected : undefined;
      })
    );
  } else {
    registrations.push(vscode.window.registerTreeDataProvider(GLOBAL_UNDERSTANDING_VIEW_ID, tree));
  }
  registrations.push(
    vscode.commands.registerCommand(
      REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID,
      () => refreshWithDetail({ reason: "manual-refresh", phase: "global-refresh-trigger" })
    ),
    vscode.commands.registerCommand(
      START_GLOBAL_UNDERSTANDING_FOLDER_COMMAND_ID,
      async (value: unknown) => {
        try {
          if (dependencies.source.startFolder === undefined) return;
          const folder = requireCurrentFolderNode(value, "start", currentFolderNodes, selectedFolderNode, dependencies.resolveFolderPathForResource);
          await runWithActiveOperationFeedback("Global Understanding folderを開始", async () => {
            await dependencies.source.startFolder!(folder.path);
            await refreshWithDetail({ reason: "folder-start", target: folder.path, phase: "global-refresh-trigger" });
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
          const folder = requireCurrentFolderNode(value, "stop", currentFolderNodes, selectedFolderNode, dependencies.resolveFolderPathForResource);
          await runWithActiveOperationFeedback("Global Understanding folderを停止", async () => {
            await dependencies.source.stopFolder!(folder.path);
            await refreshWithDetail({ reason: "folder-stop", target: folder.path, phase: "global-refresh-trigger" });
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
          const folder = requireCurrentFolderNode(value, "resume", currentFolderNodes, selectedFolderNode, dependencies.resolveFolderPathForResource);
          await runWithActiveOperationFeedback("Global Understanding folderを再開", async () => {
            await dependencies.source.resumeFolder!(folder.path);
            await refreshWithDetail({ reason: "folder-resume", target: folder.path, phase: "global-refresh-trigger" });
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
        void refreshWithDetail({ reason: "configuration-changed", phase: "global-refresh-trigger" });
      }
    }),
    status,
    tree
  );
  context.subscriptions.push(...registrations);

  return {
    refresh,
    refreshWithErrorBoundary,
    invalidate,
    clear,
    getFolderNodeForTest: (path) => [...currentFolderNodes].find((node) => node.path === path),
    selectFolderNodeForTest: async (path) => {
      const node = [...currentFolderNodes].find((candidate) => candidate.path === path);
      if (node === undefined || treeView === undefined) throw new RangeError("Current Global Understanding folder row is unavailable for selection.");
      await treeView.reveal(node, { select: true, focus: false });
    },
    dispose: () => {
      retryCancellation?.abort();
      retryCancellation = undefined;
      refreshController.clear();
      for (const registration of registrations) registration.dispose();
    }
  };
};

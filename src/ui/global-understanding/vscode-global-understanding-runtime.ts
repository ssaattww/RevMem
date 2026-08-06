import * as vscode from "vscode";

import {
  createGlobalUnderstandingTreeModel,
  formatGlobalUnderstandingStatusBar,
  GlobalLayerToggleController,
  type GlobalUnderstandingDiagnosticsNode,
  type GlobalUnderstandingFileNode,
  type GlobalUnderstandingSummaryNode,
  type GlobalUnderstandingTreeModel,
  type GlobalUnderstandingTreeSnapshot
} from "./global-understanding-ui-model";

export const GLOBAL_UNDERSTANDING_VIEW_ID = "reviewRange.globalUnderstanding";
export const REFRESH_GLOBAL_UNDERSTANDING_COMMAND_ID =
  "reviewRange.refreshGlobalUnderstanding";
export const TOGGLE_GLOBAL_LAYER_COMMAND_ID = "reviewRange.toggleGlobalLayer";

export interface GlobalUnderstandingRuntimeSource {
  recalculate(): Promise<GlobalUnderstandingTreeSnapshot | undefined>;
}

export interface GlobalUnderstandingRuntimeDependencies {
  readonly source: GlobalUnderstandingRuntimeSource;
  readonly readGlobalLayerEnabled: () => boolean;
  readonly writeGlobalLayerEnabled: (enabled: boolean) => void | PromiseLike<void>;
  readonly refreshDecorations: () => void | Promise<void>;
  readonly reportError: (error: unknown) => void | Promise<void>;
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
  | GlobalUnderstandingDiagnosticsNode
  | DiagnosticValueNode;

const FILES_GROUP: FilesGroupNode = Object.freeze({
  kind: "files-group",
  label: "ファイル別",
  count: 0
});

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
        { ...FILES_GROUP, count: model.files.length },
        model.diagnostics
      ];
    }
    if (node.kind === "files-group") return [...model.files];
    if (node.kind === "diagnostics") {
      return [
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
  clear(): void;
}

/** Registers the T505 Tree View, adjacent Status Bar item, refresh command, and Global layer toggle. */
export const registerGlobalUnderstandingRuntime = (
  context: vscode.ExtensionContext,
  dependencies: GlobalUnderstandingRuntimeDependencies
): RegisteredGlobalUnderstandingRuntime => {
  const tree = new GlobalUnderstandingTreeDataProvider();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  status.name = "Review Range Global Understanding";
  status.command = TOGGLE_GLOBAL_LAYER_COMMAND_ID;
  let generation = 0;

  const clear = (): void => {
    generation += 1;
    tree.clear();
    status.text = "";
    status.tooltip = undefined;
    status.hide();
  };

  const refresh = async (): Promise<void> => {
    const currentGeneration = ++generation;
    const snapshot = await dependencies.source.recalculate();
    if (currentGeneration !== generation) return;
    if (snapshot === undefined) {
      tree.clear();
      status.text = "";
      status.tooltip = undefined;
      status.hide();
      return;
    }
    tree.setModel(createGlobalUnderstandingTreeModel(snapshot));
    const statusModel = formatGlobalUnderstandingStatusBar(snapshot);
    status.text = statusModel.text;
    status.tooltip = statusModel.tooltip;
    status.show();
  };

  const refreshWithErrorBoundary = async (): Promise<void> => {
    try {
      await refresh();
    } catch (error) {
      await dependencies.reportError(error);
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
      TOGGLE_GLOBAL_LAYER_COMMAND_ID,
      async () => {
        try {
          await toggle.toggle();
        } catch (error) {
          await dependencies.reportError(error);
        }
      }
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("reviewRange.exclude") ||
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
    clear,
    dispose: () => {
      for (const registration of registrations) registration.dispose();
    }
  };
};

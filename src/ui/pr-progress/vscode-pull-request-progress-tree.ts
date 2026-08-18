import * as vscode from "vscode";

import {
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeFileNode,
  type PullRequestProgressTreeNode,
  type PullRequestProgressTreeSelectionResult
} from "./pull-request-progress-tree-data-provider";

/** Contributed VS Code view that renders the current immutable pull-request progress projection. */
export const PULL_REQUEST_PROGRESS_VIEW_ID = "reviewRange.prProgress";
/** Tree-item command that opens a selected reviewable file through the shared T304 provider. */
export const OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID = "reviewRange.openPrProgressItem";

/** Minimal T304 source contract so the contributed view can switch between runtime owners. */
export interface PullRequestProgressTreeSource {
  getChildren(node?: PullRequestProgressTreeNode): readonly PullRequestProgressTreeNode[];
  select(node: PullRequestProgressTreeFileNode): Promise<PullRequestProgressTreeSelectionResult>;
}

interface ActivePullRequestProgressTreeRuntime {
  readonly setSource: (source: PullRequestProgressTreeSource | undefined) => void;
  readonly refresh: () => void;
}

let activeRuntime: ActivePullRequestProgressTreeRuntime | undefined;

/** Switches the contributed tree from its default local base/head source to an active GitHub PR source. */
export const setPullRequestProgressSource = (
  source: PullRequestProgressTreeSource | undefined
): void => activeRuntime?.setSource(source);

/** Notifies VS Code after the active runtime has replaced its immutable progress snapshot. */
export const refreshPullRequestProgressTree = (): void => activeRuntime?.refresh();

/** Adapts the existing T304 tree model to the VS Code Tree View API without re-projecting progress. */
export class VscodePullRequestProgressTreeDataProvider
implements vscode.TreeDataProvider<PullRequestProgressTreeNode> {
  private readonly changed = new vscode.EventEmitter<PullRequestProgressTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly source: PullRequestProgressTreeSource) {}

  public getTreeItem(node: PullRequestProgressTreeNode): vscode.TreeItem {
    if (node.kind === "category") return this.categoryTreeItem(node);
    const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None);
    item.description = `${node.reviewedLineCount}/${node.totalLineCount}`;
    item.tooltip = node.reason === undefined
      ? `${node.path}: ${node.reviewedLineCount}/${node.totalLineCount}`
      : `${node.path}: ${node.reason}`;
    item.contextValue = "reviewRange.prProgressFile";
    item.command = {
      command: OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID,
      title: "PR Progress項目を開く",
      arguments: [node]
    };
    return item;
  }

  public getChildren(node?: PullRequestProgressTreeNode): PullRequestProgressTreeNode[] {
    return [...this.source.getChildren(node)];
  }

  /** Informs VS Code that the shared provider has replaced its identity-bound snapshot. */
  public refresh(): void {
    this.changed.fire(undefined);
  }

  public dispose(): void {
    this.changed.dispose();
  }

  private categoryTreeItem(node: PullRequestProgressTreeCategoryNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.description = `${node.fileCount}`;
    item.contextValue = "reviewRange.prProgressCategory";
    return item;
  }
}

/** Registers the contributed PR Progress Tree View and delegates selection to the active T304 source. */
export const registerVscodePullRequestProgressTree = (
  context: vscode.ExtensionContext,
  defaultSource: PullRequestProgressTreeSource,
  reportError: (error: unknown) => void | Promise<void>
): VscodePullRequestProgressTreeDataProvider => {
  let selectedSource: PullRequestProgressTreeSource | undefined;
  const source: PullRequestProgressTreeSource = {
    getChildren: (node) => (selectedSource ?? defaultSource).getChildren(node),
    select: (node) => (selectedSource ?? defaultSource).select(node)
  };
  const tree = new VscodePullRequestProgressTreeDataProvider(source);
  const runtime: ActivePullRequestProgressTreeRuntime = {
    setSource: (next) => {
      selectedSource = next;
      tree.refresh();
    },
    refresh: () => tree.refresh()
  };
  activeRuntime = runtime;
  const view = vscode.window.createTreeView(PULL_REQUEST_PROGRESS_VIEW_ID, {
    treeDataProvider: tree,
    showCollapseAll: true
  });
  const open = vscode.commands.registerCommand(
    OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID,
    async (node: PullRequestProgressTreeFileNode | undefined) => {
      if (node === undefined || node.kind !== "file") return;
      try {
        await source.select(node);
      } catch (error) {
        await reportError(error);
      }
    }
  );
  const runtimeRegistration = new vscode.Disposable(() => {
    if (activeRuntime === runtime) activeRuntime = undefined;
  });
  context.subscriptions.push(tree, view, open, runtimeRegistration);
  return tree;
};

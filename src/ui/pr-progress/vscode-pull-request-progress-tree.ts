import * as vscode from "vscode";

import {
  PullRequestProgressTreeDataProvider,
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeFileNode,
  type PullRequestProgressTreeNode
} from "./pull-request-progress-tree-data-provider";

/** Contributed VS Code view that renders the current immutable pull-request progress projection. */
export const PULL_REQUEST_PROGRESS_VIEW_ID = "reviewRange.prProgress";
/** Tree-item command that opens a selected reviewable file through the shared T304 provider. */
export const OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID = "reviewRange.openPrProgressItem";

/** Adapts the existing T304 tree model to the VS Code Tree View API without re-projecting progress. */
export class VscodePullRequestProgressTreeDataProvider
implements vscode.TreeDataProvider<PullRequestProgressTreeNode> {
  private readonly changed = new vscode.EventEmitter<PullRequestProgressTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly source: PullRequestProgressTreeDataProvider) {}

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

/** Registers the contributed PR Progress Tree View and delegates selection to the shared T304 provider. */
export const registerVscodePullRequestProgressTree = (
  context: vscode.ExtensionContext,
  source: PullRequestProgressTreeDataProvider,
  reportError: (error: unknown) => void | Promise<void>
): VscodePullRequestProgressTreeDataProvider => {
  const tree = new VscodePullRequestProgressTreeDataProvider(source);
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
  context.subscriptions.push(tree, view, open);
  return tree;
};

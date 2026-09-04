import * as vscode from "vscode";

import type { NormalEditorReviewedDecoration } from "../../application/editor-decoration/index";
import type { ResourceUri } from "../../application/workspace-identity/index";
import { resolveT305RepositoryWorkingTreeFileTarget } from "../../t305-repository-root-uri";
import {
  PrProgressDiffReviewContextController
} from "./pr-progress-diff-review-context";
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
/** Context-menu command that opens the current working-tree file for a PR Progress item. */
export const OPEN_PULL_REQUEST_PROGRESS_WORKING_TREE_FILE_COMMAND_ID =
  "reviewRange.openPrProgressWorkingTreeFile";

export interface PullRequestProgressTreeSourceSubscription {
  dispose(): void;
}

export interface PullRequestProgressWorkingTreeFileTarget {
  readonly repositoryRoot: string;
  readonly repositoryPath: string;
  readonly fileSystemPathSemantics: "posix" | "windows";
}

/** Minimal T304 source contract so the contributed view can switch between runtime owners. */
export interface PullRequestProgressTreeSource {
  getChildren(node?: PullRequestProgressTreeNode): readonly PullRequestProgressTreeNode[];
  select(node: PullRequestProgressTreeFileNode): Promise<PullRequestProgressTreeSelectionResult>;
  openWorkingTreeFile?(node: PullRequestProgressTreeFileNode): Promise<void>;
  workingTreeFileTarget?(node: PullRequestProgressTreeFileNode): PullRequestProgressWorkingTreeFileTarget;
  onDidChangeReviewProjection?(
    listener: () => void | Promise<void>
  ): PullRequestProgressTreeSourceSubscription;
  ownsReviewDiffDocumentUri?(uri: string): boolean;
  loadReviewedDecorations?(uri: string): Promise<readonly NormalEditorReviewedDecoration[]>;
}

const toResourceUri = (uri: vscode.Uri): ResourceUri => ({
  scheme: uri.scheme,
  authority: uri.authority,
  path: uri.path,
  query: uri.query,
  fragment: uri.fragment
});

const toVscodeUri = (uri: ResourceUri): vscode.Uri => vscode.Uri.from({
  scheme: uri.scheme,
  authority: uri.authority ?? "",
  path: uri.path,
  query: uri.query ?? "",
  fragment: uri.fragment ?? ""
});

/** Adapts the existing T304 tree model to the VS Code Tree View API without re-projecting progress. */
export class VscodePullRequestProgressTreeDataProvider
implements vscode.TreeDataProvider<PullRequestProgressTreeNode>, PullRequestProgressTreeSource {
  private readonly changed = new vscode.EventEmitter<PullRequestProgressTreeNode | undefined>();
  private readonly reviewedDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("reviewRange.reviewedBackground"),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });
  private selectedSource: PullRequestProgressTreeSource | undefined;
  private selectedSourceProjectionSubscription: PullRequestProgressTreeSourceSubscription | undefined;
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly defaultSource: PullRequestProgressTreeSource) {}

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
    return [...this.activeSource().getChildren(node)];
  }

  public select(
    node: PullRequestProgressTreeFileNode
  ): Promise<PullRequestProgressTreeSelectionResult> {
    return this.activeSource().select(node);
  }

  public async openWorkingTreeFile(node: PullRequestProgressTreeFileNode): Promise<void> {
    const activeSource = this.activeSource();
    if (activeSource.workingTreeFileTarget !== undefined) {
      const target = activeSource.workingTreeFileTarget(node);
      const resolved = resolveT305RepositoryWorkingTreeFileTarget({
        ...target,
        workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          filesystemPath: folder.uri.fsPath,
          uri: toResourceUri(folder.uri)
        }))
      });
      if (resolved === undefined) {
        throw new Error("PR Progress working-tree file does not have one unambiguous workspace owner.");
      }
      const uri = vscode.Uri.joinPath(
        toVscodeUri(resolved.workspaceFolderUri),
        ...resolved.relativePathSegments
      );
      await vscode.commands.executeCommand("vscode.open", uri);
      return;
    }
    if (activeSource.openWorkingTreeFile === undefined) {
      throw new Error("The active PR Progress source cannot open working-tree files.");
    }
    await activeSource.openWorkingTreeFile(node);
  }

  /** Switches this activated Extension Host to its active GitHub PR source. */
  public setPullRequestProgressSource(
    source: PullRequestProgressTreeSource | undefined
  ): void {
    this.selectedSourceProjectionSubscription?.dispose();
    this.selectedSourceProjectionSubscription = undefined;
    this.selectedSource = source;
    if (source?.onDidChangeReviewProjection !== undefined) {
      this.selectedSourceProjectionSubscription = source.onDidChangeReviewProjection(async () => {
        this.refreshPullRequestProgressTree();
        await this.refreshReviewDiffDecorations();
      });
    }
    this.refreshPullRequestProgressTree();
    void this.refreshReviewDiffDecorations();
  }

  /** Notifies VS Code after this activated runtime replaced its immutable snapshot. */
  public refreshPullRequestProgressTree(): void {
    this.changed.fire(undefined);
  }

  public async refreshReviewDiffDecorations(): Promise<void> {
    const source = this.activeSource();
    for (const editor of vscode.window.visibleTextEditors) {
      const uri = editor.document.uri.toString();
      if (
        source.ownsReviewDiffDocumentUri === undefined ||
        source.loadReviewedDecorations === undefined ||
        !source.ownsReviewDiffDocumentUri(uri)
      ) {
        editor.setDecorations(this.reviewedDecorationType, []);
        continue;
      }
      const decorations = await source.loadReviewedDecorations(uri);
      editor.setDecorations(
        this.reviewedDecorationType,
        decorations.map((decoration) => new vscode.Range(
          decoration.interval.startLine,
          0,
          decoration.interval.endLineExclusive - 1,
          Number.MAX_SAFE_INTEGER
        ))
      );
    }
  }

  /** Backward-compatible local refresh alias used by the base runtime tests. */
  public refresh(): void {
    this.refreshPullRequestProgressTree();
  }

  public dispose(): void {
    this.selectedSourceProjectionSubscription?.dispose();
    this.reviewedDecorationType.dispose();
    this.changed.dispose();
  }

  private activeSource(): PullRequestProgressTreeSource {
    return this.selectedSource ?? this.defaultSource;
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
  const tree = new VscodePullRequestProgressTreeDataProvider(defaultSource);
  const source: PullRequestProgressTreeSource & {
    openWorkingTreeFile(node: PullRequestProgressTreeFileNode): Promise<void>;
  } = tree;
  const reviewContext = new PrProgressDiffReviewContextController<vscode.Tab>({
    getActiveTab: () => vscode.window.tabGroups.activeTabGroup.activeTab,
    isDiffTab: (tab) => tab.input instanceof vscode.TabInputTextDiff,
    setContext: (key, value) => vscode.commands.executeCommand("setContext", key, value)
  });
  const refreshReviewContext = (): void => {
    void Promise.all([
      reviewContext.refresh(),
      tree.refreshReviewDiffDecorations()
    ]).catch(reportError);
  };
  const view = vscode.window.createTreeView(PULL_REQUEST_PROGRESS_VIEW_ID, {
    treeDataProvider: tree,
    showCollapseAll: true
  });
  const open = vscode.commands.registerCommand(
    OPEN_PULL_REQUEST_PROGRESS_ITEM_COMMAND_ID,
    async (node: PullRequestProgressTreeFileNode | undefined) => {
      if (node === undefined || node.kind !== "file") return;
      try {
        const result = await source.select(node);
        if (result.kind === "opened-diff") {
          await reviewContext.recordActiveDiff();
          await tree.refreshReviewDiffDecorations();
        }
      } catch (error) {
        await reportError(error);
      }
    }
  );
  const openWorkingTreeFile = vscode.commands.registerCommand(
    OPEN_PULL_REQUEST_PROGRESS_WORKING_TREE_FILE_COMMAND_ID,
    async (node: PullRequestProgressTreeFileNode | undefined) => {
      if (node === undefined || node.kind !== "file") return;
      try {
        await source.openWorkingTreeFile(node);
      } catch (error) {
        await reportError(error);
      }
    }
  );
  const activeEditorChanged = vscode.window.onDidChangeActiveTextEditor(refreshReviewContext);
  refreshReviewContext();
  const reviewContextRegistration = new vscode.Disposable(() => {
    void reviewContext.clear().catch(reportError);
  });
  context.subscriptions.push(
    tree,
    view,
    open,
    openWorkingTreeFile,
    activeEditorChanged,
    reviewContextRegistration
  );
  return tree;
};

import * as vscode from "vscode";

import { CurrentContextRuntimeCoordinator } from "./current-context-runtime-coordinator";
import {
  CurrentContextUiController,
  type CurrentContextTreeItem,
  type CurrentContextUiSnapshot
} from "./current-context-ui-controller";

export const CURRENT_CONTEXT_VIEW_ID = "reviewRange.currentContext";
export const REFRESH_CONTEXT_COMMAND_ID = "reviewRange.refreshContext";
export const SELECT_CONTEXT_COMMAND_ID = "reviewRange.selectContext";

export interface CurrentContextRuntimeSource {
  recompute(): Promise<CurrentContextUiSnapshot | undefined>;
  selectContext(): Promise<CurrentContextUiSnapshot | undefined>;
}

class CurrentContextTreeDataProvider
implements vscode.TreeDataProvider<CurrentContextTreeItem> {
  private readonly changed = new vscode.EventEmitter<CurrentContextTreeItem | undefined>();
  private current: CurrentContextTreeItem | undefined;

  public readonly onDidChangeTreeData = this.changed.event;

  public setCurrent(item: CurrentContextTreeItem): void {
    this.current = { ...item };
    this.changed.fire(undefined);
  }

  public getTreeItem(item: CurrentContextTreeItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    treeItem.description = item.description;
    treeItem.tooltip = item.tooltip;
    treeItem.contextValue = "reviewRange.currentContext";
    return treeItem;
  }

  public getChildren(): CurrentContextTreeItem[] {
    return this.current === undefined ? [] : [{ ...this.current }];
  }

  public dispose(): void {
    this.changed.dispose();
  }
}

export interface RegisteredCurrentContextRuntime extends vscode.Disposable {
  readonly controller: CurrentContextUiController;
  refresh(): Promise<void>;
}

export const registerCurrentContextRuntime = (
  context: vscode.ExtensionContext,
  source: CurrentContextRuntimeSource,
  refreshDependents: () => void | Promise<void>
): RegisteredCurrentContextRuntime => {
  const tree = new CurrentContextTreeDataProvider();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.name = "Review Range Current Context";
  status.command = SELECT_CONTEXT_COMMAND_ID;

  const controller = new CurrentContextUiController(
    {
      setCurrentContext: (item) => tree.setCurrent(item),
      setStatusBar: (item) => {
        status.text = item.text;
        status.tooltip = item.tooltip;
        status.show();
      }
    },
    source
  );
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    refreshDependents
  });

  const registrations: vscode.Disposable[] = [
    vscode.window.registerTreeDataProvider(CURRENT_CONTEXT_VIEW_ID, tree),
    vscode.commands.registerCommand(
      REFRESH_CONTEXT_COMMAND_ID,
      () => coordinator.refresh()
    ),
    vscode.commands.registerCommand(
      SELECT_CONTEXT_COMMAND_ID,
      () => coordinator.selectContext()
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void coordinator.refresh();
    }),
    status,
    { dispose: () => tree.dispose() }
  ];

  context.subscriptions.push(...registrations);
  void coordinator.refresh();

  return {
    controller,
    refresh: () => coordinator.refresh(),
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose();
      }
    }
  };
};

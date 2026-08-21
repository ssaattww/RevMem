import * as vscode from "vscode";

import {
  formatOperationFailureForUser,
  runWithActiveOperationFeedback,
  type OperationFeedbackContext
} from "../../application/operation-feedback/index";

import {
  CurrentContextRuntimeCoordinator,
  type CurrentContextDependentRefresher
} from "./current-context-runtime-coordinator";
import {
  CurrentContextUiController,
  type CurrentContextTreeItem,
  type CurrentContextUiSnapshot
} from "./current-context-ui-controller";
import type { CurrentContextResolution } from "./current-context-runtime-composition";

export const CURRENT_CONTEXT_VIEW_ID = "reviewRange.currentContext";
export const REFRESH_CONTEXT_COMMAND_ID = "reviewRange.refreshContext";
export const SELECT_CONTEXT_COMMAND_ID = "reviewRange.selectContext";

export interface CurrentContextRuntimeSource {
  recompute(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextResolution>;
  selectContext(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextResolution>;
  acceptRecomputed?(snapshot: CurrentContextUiSnapshot | undefined): void;
  acceptExplicit?(snapshot: CurrentContextUiSnapshot): void;
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

  public clear(): void {
    this.current = undefined;
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
  /** The single startup refresh, including its handled error presentation. */
  readonly startupRefresh: Promise<void>;
  refresh(): Promise<void>;
}

export const registerCurrentContextRuntime = (
  context: vscode.ExtensionContext,
  source: CurrentContextRuntimeSource,
  dependentRefresher: CurrentContextDependentRefresher,
  reportRefreshError: (error: unknown) => void | Promise<void>
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
      },
      clearCurrentContext: () => tree.clear(),
      clearStatusBar: () => {
        status.text = "";
        status.tooltip = undefined;
        status.hide();
      }
    },
    source
  );
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    ...dependentRefresher
  });
  let currentCancellation: AbortController | undefined;
  const runRefresh = async (): Promise<void> => {
    currentCancellation?.abort();
    const cancellation = new AbortController();
    currentCancellation = cancellation;
    try {
      await runWithActiveOperationFeedback("Current Contextを更新", (feedbackContext) => coordinator.refresh(cancellation.signal, feedbackContext));
    } catch (error) {
      if (currentCancellation === cancellation) {
        controller.failClosed();
        await reportRefreshError(formatOperationFailureForUser(error));
      }
    } finally {
      if (currentCancellation === cancellation) currentCancellation = undefined;
    }
  };
  const runSelection = async (): Promise<void> => {
    currentCancellation?.abort();
    const cancellation = new AbortController();
    currentCancellation = cancellation;
    try {
      await runWithActiveOperationFeedback("Current Contextを選択", (feedbackContext) => coordinator.selectContext(cancellation.signal, feedbackContext));
    } catch (error) {
      if (currentCancellation === cancellation) {
        controller.failClosed();
        await reportRefreshError(formatOperationFailureForUser(error));
      }
    } finally {
      if (currentCancellation === cancellation) currentCancellation = undefined;
    }
  };

  const registrations: vscode.Disposable[] = [
    vscode.window.registerTreeDataProvider(CURRENT_CONTEXT_VIEW_ID, tree),
    vscode.commands.registerCommand(
      REFRESH_CONTEXT_COMMAND_ID,
      runRefresh
    ),
    vscode.commands.registerCommand(
      SELECT_CONTEXT_COMMAND_ID,
      runSelection
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void runRefresh();
    }),
    status,
    { dispose: () => tree.dispose() }
  ];

  context.subscriptions.push(...registrations);
  const startupRefresh = runRefresh();

  return {
    controller,
    startupRefresh,
    refresh: runRefresh,
    dispose: () => {
      currentCancellation?.abort();
      for (const registration of registrations) {
        registration.dispose();
      }
    }
  };
};

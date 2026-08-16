import * as vscode from "vscode";

import {
  type ReviewContextListItem,
  type ReviewContextVisibilityStore,
  type ReviewContextsController,
} from "../../application/review-contexts/index";

const VIEW_ID = "reviewRange.reviewContexts";
const HIDDEN_CONTEXTS_KEY = "reviewRange.hiddenReviewContexts.v1";

export interface ReviewContextsRuntimeSource {
  load(): Promise<readonly ReviewContextListItem[]>;
}

export interface ReviewContextsRuntimeDependencies {
  readonly source: ReviewContextsRuntimeSource;
  readonly controller: ReviewContextsController;
  readonly refreshDecorations: () => Promise<void>;
  readonly reportError: (error: unknown) => Promise<void>;
}

/** Stores display-only removals in workspaceState, separate from authoritative Review State and history. */
export class VscodeReviewContextVisibilityStore implements ReviewContextVisibilityStore {
  public constructor(private readonly state: vscode.Memento) {}

  public async readHiddenContextIds(): Promise<readonly string[]> {
    const raw = this.state.get<unknown>(HIDDEN_CONTEXTS_KEY, []);
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    ))].sort();
  }

  public async hide(contextId: string): Promise<void> {
    if (contextId.trim().length === 0) throw new TypeError("contextId must not be empty");
    const hidden = new Set(await this.readHiddenContextIds());
    hidden.add(contextId);
    await this.state.update(HIDDEN_CONTEXTS_KEY, [...hidden].sort());
  }
}

class ReviewContextsTreeProvider implements vscode.TreeDataProvider<ReviewContextListItem> {
  private readonly changed = new vscode.EventEmitter<ReviewContextListItem | undefined | null | void>();
  private items: readonly ReviewContextListItem[] = [];

  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly source: ReviewContextsRuntimeSource) {}

  public getTreeItem(element: ReviewContextListItem): vscode.TreeItem {
    const descriptionParts = [
      element.current ? "現在" : undefined,
      element.description,
      element.layerEnabled === undefined ? undefined : `Layer: ${element.layerEnabled ? "ON" : "OFF"}`,
    ].filter((value): value is string => value !== undefined);
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = descriptionParts.join(" · ");
    item.tooltip = this.tooltip(element);
    item.contextValue = element.context.kind === "pull-request"
      ? "reviewRange.reviewContextPullRequest"
      : "reviewRange.reviewContext";
    item.iconPath = new vscode.ThemeIcon(
      element.context.kind === "pull-request"
        ? "git-pull-request"
        : element.context.kind === "branch"
          ? "git-branch"
          : "folder",
    );
    return item;
  }

  public getChildren(): readonly ReviewContextListItem[] {
    return this.items;
  }

  public async refresh(): Promise<void> {
    this.items = [...await this.source.load()];
    this.changed.fire();
  }

  public dispose(): void {
    this.changed.dispose();
  }

  private tooltip(item: ReviewContextListItem): string {
    const context = item.context;
    const lines = [item.label];
    if (item.description !== undefined) lines.push(item.description);
    if (context.pullRequest !== undefined) {
      lines.push(`Base: ${context.pullRequest.baseSha}`);
      lines.push(`Head: ${context.pullRequest.headSha}`);
      lines.push(`Layer: ${item.layerEnabled === true ? "ON" : "OFF"}`);
    } else if (context.branch !== undefined) {
      lines.push(`Head: ${context.branch.headRevision}`);
    }
    return lines.join("\n");
  }
}

export interface RegisteredReviewContextsRuntime {
  refresh(): Promise<void>;
  refreshWithErrorBoundary(): Promise<void>;
}

/** Registers the T405 Review Contexts tree and all commands that operate on it. */
export function registerReviewContextsRuntime(
  context: vscode.ExtensionContext,
  dependencies: ReviewContextsRuntimeDependencies,
): RegisteredReviewContextsRuntime {
  const provider = new ReviewContextsTreeProvider(dependencies.source);
  const tree = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider });

  const report = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      await dependencies.reportError(error);
    }
  };
  const refreshWithErrorBoundary = (): Promise<void> => report(() => provider.refresh());
  const mutate = (operation: () => Promise<void>, refreshDecorations = false): Promise<void> =>
    report(async () => {
      await operation();
      if (refreshDecorations) await dependencies.refreshDecorations();
      await provider.refresh();
    });
  const requireItem = (item: ReviewContextListItem | undefined): ReviewContextListItem => {
    if (item === undefined) throw new Error("Review Contextsの項目を選択してください。");
    return item;
  };

  context.subscriptions.push(
    tree,
    provider,
    vscode.commands.registerCommand("reviewRange.refreshReviewContexts", refreshWithErrorBoundary),
    vscode.commands.registerCommand("reviewRange.redetectPullRequest", () =>
      mutate(() => dependencies.controller.redetectPullRequest())),
    vscode.commands.registerCommand("reviewRange.reconnectGitHub", () =>
      mutate(() => dependencies.controller.reconnectGitHub())),
    vscode.commands.registerCommand("reviewRange.refreshReviewContextCache", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      return mutate(() => dependencies.controller.refreshCache(item.context));
    }),
    vscode.commands.registerCommand("reviewRange.toggleReviewContextLayer", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      if (item.layerEnabled === undefined) throw new Error("PRコンテキストだけがLayerを持ちます。");
      return mutate(
        () => dependencies.controller.setLayerEnabled(item.context, !item.layerEnabled),
        true,
      );
    }),
    vscode.commands.registerCommand("reviewRange.hideReviewContext", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      return mutate(() => dependencies.controller.hide(item.context.contextId));
    }),
    vscode.commands.registerCommand("reviewRange.openReviewContextDiff", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      return report(() => dependencies.controller.openDiff(item.context));
    }),
  );

  void refreshWithErrorBoundary();
  return {
    refresh: () => provider.refresh(),
    refreshWithErrorBoundary,
  };
}

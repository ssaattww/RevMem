import * as vscode from "vscode";

import { runWithActiveOperationFeedback } from "../../application/operation-feedback/index";

import {
  formatReviewContextCacheStatus,
  formatReviewContextProgress,
  type ReviewContextListItem,
  type ReviewContextVisibilityStore,
  type ReviewContextsController,
} from "../../application/review-contexts/index";

const VIEW_ID = "reviewRange.reviewContexts";
const HIDDEN_CONTEXTS_KEY = "reviewRange.hiddenReviewContexts.v1";
const CURRENT_PULL_REQUEST_SELECTIONS_KEY = "reviewRange.currentPullRequestSelections.v1";

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

/** Remembers an explicit PR or branch choice for one immutable local repository HEAD. */
export class VscodeCurrentPullRequestSelectionStore {
  public constructor(private readonly state: vscode.Memento) {}

  public read(repositoryId: string, headRevision: string): string | undefined {
    const raw = this.state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const value = (raw as Record<string, unknown>)[this.key(repositoryId, headRevision)];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }

  public async select(
    repositoryId: string,
    headRevision: string,
    contextId: string,
  ): Promise<void> {
    if (contextId.trim().length === 0) throw new TypeError("contextId must not be empty");
    const raw = this.state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
    const selections: Record<string, string> = {};
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim().length > 0) selections[key] = value;
      }
    }
    selections[this.key(repositoryId, headRevision)] = contextId;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  /** Records an explicit branch/no-PR choice that suppresses saved-PR auto-inference. */
  public async selectBranch(repositoryId: string, headRevision: string): Promise<void> {
    const raw = this.state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
    const selections: Record<string, string | false> = {};
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if ((typeof value === "string" && value.trim().length > 0) || value === false) selections[key] = value;
      }
    }
    selections[this.key(repositoryId, headRevision)] = false;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  /** Returns whether the immutable repository HEAD has an explicit branch/no-PR choice. */
  public prefersBranch(repositoryId: string, headRevision: string): boolean {
    const raw = this.state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
      (raw as Record<string, unknown>)[this.key(repositoryId, headRevision)] === false;
  }

  private key(repositoryId: string, headRevision: string): string {
    return `${repositoryId}\0${headRevision}`;
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
      formatReviewContextProgress(element.progress),
      formatReviewContextCacheStatus(element.cache),
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

  public getChildren(): ReviewContextListItem[] {
    return [...this.items];
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
      const progress = formatReviewContextProgress(item.progress);
      if (progress !== undefined) lines.push(progress);
      const cache = formatReviewContextCacheStatus(item.cache);
      if (cache !== undefined) lines.push(cache);
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

  const runOperation = async (
    label: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    try {
      await runWithActiveOperationFeedback(label, operation);
    } catch (error) {
      await dependencies.reportError(error);
    }
  };
  const refreshWithErrorBoundary = (): Promise<void> =>
    runOperation("Review Contextsを更新", () => provider.refresh());
  const mutate = async (
    operation: () => Promise<void>,
    refreshDecorations = false,
  ): Promise<void> => {
    await runOperation("Review Contextsを更新", async () => {
      await operation();
      if (refreshDecorations) await dependencies.refreshDecorations();
    });
    await runOperation("Review Contextsを更新", () => provider.refresh());
  };
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
      return runOperation(
        "PR差分を開く",
        () => dependencies.controller.openDiff(item.context)
      );
    }),
  );

  void refreshWithErrorBoundary();
  return {
    refresh: () => runOperation("Review Contextsを更新", () => provider.refresh()),
    refreshWithErrorBoundary,
  };
}

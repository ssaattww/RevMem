import * as vscode from "vscode";

import {
  formatOperationFailureForUser,
  hasOperationFeedbackFailure,
  runWithBoundedRetry,
  runWithActiveOperationFeedback,
  type OperationFeedbackContext,
} from "../../application/operation-feedback/index";

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
  /** Loads read-only tree data and must stop downstream acquisition when aborted. */
  load(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<readonly ReviewContextListItem[]>;
  /** Commits a successful pure acquisition once, immediately before tree publication. */
  publishLoaded?(): Promise<void>;
}

export interface ReviewContextsRuntimeDependencies {
  readonly source: ReviewContextsRuntimeSource;
  readonly controller: ReviewContextsController;
  readonly refreshDecorations: () => Promise<void>;
  readonly reportError: (error: unknown) => Promise<void>;
}

/**
 * Runs the read-only Review Contexts acquisition boundary with the shared
 * bounded retry policy. Stateful commands deliberately do not call this.
 */
export const runReviewContextsPureRead = async <T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => (await runWithBoundedRetry(read, { maxAttempts: 3, signal })).value;

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
    const selections: Record<string, string | false> = {};
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if ((typeof value === "string" && value.trim().length > 0) || value === false) {
          selections[key] = value;
        }
      }
    }
    selections[this.key(repositoryId, headRevision)] = contextId;
    await this.state.update(CURRENT_PULL_REQUEST_SELECTIONS_KEY, selections);
  }

  /**
   * Removes only this immutable repository/HEAD preference for compatibility with
   * existing public UI API consumers. New branch fallback uses selectBranch().
   * @deprecated Use selectBranch() when an explicit branch/no-PR choice is required.
   */
  public async clear(repositoryId: string, headRevision: string): Promise<void> {
    const raw = this.state.get<unknown>(CURRENT_PULL_REQUEST_SELECTIONS_KEY, {});
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const selections: Record<string, string | false> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== this.key(repositoryId, headRevision) &&
        ((typeof value === "string" && value.trim().length > 0) || value === false)) {
        selections[key] = value;
      }
    }
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

/** Runtime tree provider with generation-fenced publication. */
export class ReviewContextsTreeProvider implements vscode.TreeDataProvider<ReviewContextListItem> {
  private readonly changed = new vscode.EventEmitter<ReviewContextListItem | undefined | null | void>();
  private items: readonly ReviewContextListItem[] = [];
  private generation = 0;
  private refreshController: AbortController | undefined;

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

  public async refresh(feedbackContext?: OperationFeedbackContext): Promise<void> {
    this.refreshController?.abort();
    const controller = new AbortController();
    this.refreshController = controller;
    const generation = ++this.generation;
    // The source owns the retryable acquisition; this method performs one
    // publication only after that read has completed successfully.
    const loaded = await runReviewContextsPureRead(
      () => this.source.load(controller.signal, feedbackContext),
      controller.signal,
    );
    if (generation !== this.generation) return;
    await this.source.publishLoaded?.();
    if (generation !== this.generation) return;
    this.items = [...loaded];
    this.changed.fire();
  }
  /** Clears the list when its replacement cannot be proven current. */
  public clear(): void {
    this.refreshController?.abort();
    this.refreshController = undefined;
    this.generation += 1;
    this.items = [];
    this.changed.fire();
  }

  public dispose(): void {
    this.refreshController?.abort();
    this.refreshController = undefined;
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
    operation: (feedbackContext: OperationFeedbackContext | undefined) => Promise<void>,
    retry = false,
    clearProviderOnFailure = true,
  ): Promise<void> => {
    // `retry` documents the command classification for wiring tests; retrying
    // itself is deliberately confined to ReviewContextsTreeProvider.load().
    void retry;
    try {
      await runWithActiveOperationFeedback(
        label,
        (feedbackContext) => operation(feedbackContext),
      );
    } catch (error) {
      if (clearProviderOnFailure) provider.clear();
      await dependencies.reportError(formatOperationFailureForUser(error));
    }
  };
  const refreshWithErrorBoundary = (): Promise<void> =>
    runOperation("Review Contextsを更新", (feedbackContext) => provider.refresh(feedbackContext), true);
  const mutate = async (
    operation: (feedbackContext: OperationFeedbackContext | undefined) => Promise<void>,
    refreshDecorations = false,
  ): Promise<void> => {
    let terminalFailure = false;
    await runOperation("Review Contextsを更新", async (feedbackContext) => {
      try {
        await operation(feedbackContext);
      } catch (error) {
        terminalFailure = true;
        throw error;
      }
      if (refreshDecorations) await dependencies.refreshDecorations();
      terminalFailure = hasOperationFeedbackFailure(feedbackContext);
    }, false, false);
    if (terminalFailure) return;
    await runOperation("Review Contextsを更新", (feedbackContext) => provider.refresh(feedbackContext), true);
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
      mutate((feedbackContext) => dependencies.controller.redetectPullRequest(feedbackContext))),
    vscode.commands.registerCommand("reviewRange.reconnectGitHub", () =>
      mutate((feedbackContext) => dependencies.controller.reconnectGitHub(feedbackContext))),
    vscode.commands.registerCommand("reviewRange.refreshReviewContextCache", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      return mutate((feedbackContext) => dependencies.controller.refreshCache(item.context, feedbackContext));
    }),
    vscode.commands.registerCommand("reviewRange.toggleReviewContextLayer", (raw?: ReviewContextListItem) => {
      const item = requireItem(raw);
      if (item.layerEnabled === undefined) throw new Error("PRコンテキストだけがLayerを持ちます。");
      return mutate(
        (feedbackContext) => dependencies.controller.setLayerEnabled(item.context, !item.layerEnabled, feedbackContext),
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
        (feedbackContext) => dependencies.controller.openDiff(item.context, feedbackContext)
      );
    }),
  );

  void refreshWithErrorBoundary();
  return {
    refresh: () => runOperation("Review Contextsを更新", (feedbackContext) => provider.refresh(feedbackContext), true),
    refreshWithErrorBoundary,
  };
}

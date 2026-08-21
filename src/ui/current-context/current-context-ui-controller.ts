import { runWithBoundedRetry, type OperationFeedbackContext } from "../../application/operation-feedback/index";

export type CurrentContextKind = "pull-request" | "branch" | "workspace";

export interface CurrentContextDescriptor {
  readonly kind: CurrentContextKind;
  readonly label: string;
  readonly detail?: string;
  readonly baseRevision?: string;
  readonly headRevision?: string;
  /** Runtime identity shared with commands and editor decoration reads. */
  readonly selection?: SelectedReviewContext;
}

export interface CurrentContextProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
}

export interface CurrentContextUiSnapshot {
  readonly context: CurrentContextDescriptor;
  readonly progress: CurrentContextProgress | undefined;
}

export interface CurrentContextTreeItem {
  readonly label: string;
  readonly description?: string;
  readonly tooltip: string;
}

export interface CurrentContextStatusBarItem {
  readonly text: string;
  readonly tooltip: string;
}

export interface CurrentContextUiHost {
  setCurrentContext(item: CurrentContextTreeItem): void;
  setStatusBar(item: CurrentContextStatusBarItem): void;
  clearCurrentContext(): void;
  clearStatusBar(): void;
}

export interface CurrentContextUiActions {
  /** Read-only candidate acquisition; callers may cancel a superseded owner. */
  recompute(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextUiSnapshot | undefined>;
  selectContext(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextUiSnapshot | undefined>;
  acceptRecomputed?(snapshot: CurrentContextUiSnapshot | undefined): void;
  acceptExplicit?(snapshot: CurrentContextUiSnapshot): void;
}

/** Result of a recomputation, distinguishing an empty current state from a stale request. */
export interface CurrentContextRefreshResult {
  readonly snapshot: CurrentContextUiSnapshot | undefined;
  readonly stale: boolean;
}

export const currentContextSelectionKey = (
  snapshot: CurrentContextUiSnapshot
): string => {
  const { context } = snapshot;
  const selection = context.selection;
  if (selection?.kind === "pull-request") {
    return [
      "pull-request",
      selection.repositoryId,
      selection.repositoryRoot,
      selection.contextId,
      String(selection.pullRequestNumber),
    ].join("\0");
  }
  if (selection?.kind === "branch") {
    return ["branch", selection.repositoryId, selection.repositoryRoot, selection.branchRef].join("\0");
  }
  if (selection?.kind === "detached") {
    return ["detached", selection.repositoryId, selection.repositoryRoot, selection.headRevision].join("\0");
  }
  if (selection?.kind === "workspace") {
    const uri = selection.workspaceFolderUri;
    return ["workspace", uri.scheme, uri.authority, uri.path, uri.query ?? "", uri.fragment ?? ""].join("\0");
  }
  switch (context.kind) {
    case "branch":
      return [context.kind, context.detail ?? "", context.label].join("\0");
    case "workspace":
      return [context.kind, context.detail ?? "", context.label].join("\0");
    case "pull-request":
      return [context.kind, context.detail ?? "", context.label].join("\0");
  }
};

const validateProgress = (progress: CurrentContextProgress): void => {
  if (!Number.isInteger(progress.reviewedLineCount) || progress.reviewedLineCount < 0) {
    throw new Error("reviewedLineCount must be a non-negative integer");
  }
  if (!Number.isInteger(progress.totalLineCount) || progress.totalLineCount < 0) {
    throw new Error("totalLineCount must be a non-negative integer");
  }
  if (progress.reviewedLineCount > progress.totalLineCount) {
    throw new Error("reviewedLineCount must not exceed totalLineCount");
  }
  if (!Number.isFinite(progress.progress) || progress.progress < 0 || progress.progress > 1) {
    throw new Error("progress must be between zero and one");
  }
};

const formatPercent = (progress: CurrentContextProgress | undefined): string | undefined => {
  if (progress === undefined) return undefined;
  validateProgress(progress);
  return `${Math.round(progress.progress * 100)}%`;
};

const validateContext = (context: CurrentContextDescriptor): void => {
  if (context.label.length === 0) throw new Error("context label must not be empty");
  if (context.kind === "pull-request" && !context.label.startsWith("#")) {
    throw new Error("pull-request labels must start with #");
  }
};

const projectContextLabel = (context: CurrentContextDescriptor): string => {
  validateContext(context);
  switch (context.kind) {
    case "pull-request": return `PR ${context.label}`;
    case "branch": return `Branch: ${context.label}`;
    case "workspace": return `Workspace: ${context.label}`;
  }
};

const projectStatusPrefix = (context: CurrentContextDescriptor): string => {
  validateContext(context);
  switch (context.kind) {
    case "pull-request": return `$(git-pull-request) PR ${context.label}`;
    case "branch": return `$(git-branch) ${context.label}`;
    case "workspace": return `$(folder) ${context.label}`;
  }
};

const createTooltip = (snapshot: CurrentContextUiSnapshot): string => {
  const lines = [projectContextLabel(snapshot.context)];
  if (snapshot.context.detail !== undefined) lines.push(snapshot.context.detail);
  if (snapshot.context.baseRevision !== undefined) lines.push(`Base: ${snapshot.context.baseRevision}`);
  if (snapshot.context.headRevision !== undefined) lines.push(`Head: ${snapshot.context.headRevision}`);
  if (snapshot.progress !== undefined) {
    validateProgress(snapshot.progress);
    lines.push(`Progress: ${snapshot.progress.reviewedLineCount}/${snapshot.progress.totalLineCount} (${formatPercent(snapshot.progress)})`);
  }
  return lines.join("\n");
};

export class CurrentContextUiController {
  private generation = 0;
  public constructor(private readonly host: CurrentContextUiHost, private readonly actions?: CurrentContextUiActions) {}
  public update(snapshot: CurrentContextUiSnapshot): void {
    const percent = formatPercent(snapshot.progress);
    const tooltip = createTooltip(snapshot);
    this.host.setCurrentContext({ label: projectContextLabel(snapshot.context), ...(snapshot.context.detail === undefined ? {} : { description: snapshot.context.detail }), tooltip });
    this.host.setStatusBar({ text: `${projectStatusPrefix(snapshot.context)}${percent === undefined ? "" : `: ${percent}`}`, tooltip });
  }
  public async refresh(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextRefreshResult> {
    if (this.actions === undefined) return { snapshot: undefined, stale: false };
    const generation = ++this.generation;
    if (signal !== undefined && signal.aborted) return { snapshot: undefined, stale: true };
    const snapshot = (await runWithBoundedRetry(
      () => this.actions!.recompute(signal, feedbackContext),
      { maxAttempts: 3, signal },
    )).value;
    if (signal?.aborted === true) return { snapshot: undefined, stale: true };
    if (snapshot !== undefined && generation === this.generation) {
      this.update(snapshot);
      this.actions.acceptRecomputed?.(snapshot);
      return { snapshot, stale: false };
    }
    if (generation === this.generation) {
      this.host.clearCurrentContext();
      this.host.clearStatusBar();
      this.actions.acceptRecomputed?.(undefined);
    }
    return { snapshot: undefined, stale: generation !== this.generation };
  }
  public async selectContext(signal?: AbortSignal, feedbackContext?: OperationFeedbackContext): Promise<CurrentContextUiSnapshot | undefined> {
    if (this.actions === undefined) return undefined;
    const generation = ++this.generation;
    if (signal !== undefined && signal.aborted) return undefined;
    // A Quick Pick is an observable user interaction.  Unlike the preceding
    // candidate acquisition it must never be replayed after a partial result.
    const selection = await this.actions.selectContext(signal, feedbackContext);
    if (signal?.aborted === true) return undefined;
    if (selection !== undefined && generation === this.generation) {
      this.update(selection);
      this.actions.acceptExplicit?.(selection);
      return selection;
    }
    return undefined;
  }
  /** Clears an indeterminate context so an old snapshot is never presented as fresh. */
  public failClosed(): void {
    this.generation += 1;
    this.host.clearCurrentContext();
    this.host.clearStatusBar();
    this.actions?.acceptRecomputed?.(undefined);
  }
}
import type { SelectedReviewContext } from "../../application/review-context/index";

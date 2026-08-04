export type CurrentContextKind = "pull-request" | "branch" | "workspace";

export interface CurrentContextDescriptor {
  readonly kind: CurrentContextKind;
  readonly label: string;
  readonly detail?: string;
  readonly baseRevision?: string;
  readonly headRevision?: string;
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
}

export interface CurrentContextUiActions {
  recompute(): Promise<CurrentContextUiSnapshot | undefined>;
  selectContext(): Promise<CurrentContextUiSnapshot | undefined>;
}

export const currentContextSelectionKey = (
  snapshot: CurrentContextUiSnapshot
): string => {
  const { context } = snapshot;
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

const validateContext = (context: CurrentContextDescriptor): void => {
  if (context.label.length === 0) {
    throw new Error("context label must not be empty");
  }
  if (context.kind === "pull-request" && !context.label.startsWith("#")) {
    throw new Error("pull-request labels must start with #");
  }
};

const formatPercent = (progress: CurrentContextProgress | undefined): string | undefined => {
  if (progress === undefined) {
    return undefined;
  }
  validateProgress(progress);
  return `${Math.round(progress.progress * 100)}%`;
};

const projectContextLabel = (context: CurrentContextDescriptor): string => {
  validateContext(context);
  switch (context.kind) {
    case "pull-request":
      return `PR ${context.label}`;
    case "branch":
      return `Branch: ${context.label}`;
    case "workspace":
      return `Workspace: ${context.label}`;
  }
};

const projectStatusPrefix = (context: CurrentContextDescriptor): string => {
  validateContext(context);
  switch (context.kind) {
    case "pull-request":
      return `$(git-pull-request) PR ${context.label}`;
    case "branch":
      return `$(git-branch) ${context.label}`;
    case "workspace":
      return `$(folder) ${context.label}`;
  }
};

const createTooltip = (snapshot: CurrentContextUiSnapshot): string => {
  const lines = [projectContextLabel(snapshot.context)];
  if (snapshot.context.detail !== undefined) {
    lines.push(snapshot.context.detail);
  }
  if (snapshot.context.baseRevision !== undefined) {
    lines.push(`Base: ${snapshot.context.baseRevision}`);
  }
  if (snapshot.context.headRevision !== undefined) {
    lines.push(`Head: ${snapshot.context.headRevision}`);
  }
  if (snapshot.progress !== undefined) {
    validateProgress(snapshot.progress);
    lines.push(
      `Progress: ${snapshot.progress.reviewedLineCount}/${snapshot.progress.totalLineCount} (${formatPercent(snapshot.progress)})`
    );
  }
  return lines.join("\n");
};

export class CurrentContextUiController {
  private generation = 0;

  public constructor(
    private readonly host: CurrentContextUiHost,
    private readonly actions?: CurrentContextUiActions
  ) {}

  public update(snapshot: CurrentContextUiSnapshot): void {
    const percent = formatPercent(snapshot.progress);
    const tooltip = createTooltip(snapshot);
    this.host.setCurrentContext({
      label: projectContextLabel(snapshot.context),
      ...(snapshot.context.detail === undefined ? {} : { description: snapshot.context.detail }),
      tooltip
    });
    this.host.setStatusBar({
      text: `${projectStatusPrefix(snapshot.context)}${percent === undefined ? "" : `: ${percent}`}`,
      tooltip
    });
  }

  public async refresh(): Promise<void> {
    if (this.actions === undefined) {
      return;
    }
    const generation = ++this.generation;
    const snapshot = await this.actions.recompute();
    if (snapshot !== undefined && generation === this.generation) {
      this.update(snapshot);
    }
  }

  public async selectContext(): Promise<void> {
    if (this.actions === undefined) {
      return;
    }
    const generation = ++this.generation;
    const selection = await this.actions.selectContext();
    if (selection !== undefined && generation === this.generation) {
      this.update(selection);
    }
  }
}

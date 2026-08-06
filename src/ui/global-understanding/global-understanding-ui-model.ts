import type {
  GlobalUnderstandingFileProgress,
  RepositoryGlobalUnderstandingProgress
} from "../../core/global-understanding/index";

export interface GlobalUnderstandingTreeSnapshot {
  readonly progress: RepositoryGlobalUnderstandingProgress;
  /** Concrete excluded files only; pruned directory descendants are never inferred. */
  readonly excludedFileCount: number;
  /** One diagnostic record per directory pruned before traversal. */
  readonly prunedExcludedDirectoryCount: number;
}

export interface GlobalUnderstandingSummaryNode {
  readonly kind: "summary";
  readonly label: "リポジトリ全体";
  readonly description: string;
  readonly reviewedNonEmptyLineCount: number;
  readonly totalNonEmptyLineCount: number;
  readonly progress: number;
}

export interface GlobalUnderstandingFileNode {
  readonly kind: "file";
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly state: GlobalUnderstandingFileProgress["state"];
  readonly reviewedNonEmptyLineCount: number;
  readonly totalNonEmptyLineCount: number;
  readonly progress: number;
}

export interface GlobalUnderstandingDiagnosticsNode {
  readonly kind: "diagnostics";
  readonly label: "除外診断";
  readonly excludedFileCount: number;
  readonly prunedExcludedDirectoryCount: number;
}

export interface GlobalUnderstandingTreeModel {
  readonly summary: GlobalUnderstandingSummaryNode;
  readonly files: readonly GlobalUnderstandingFileNode[];
  readonly diagnostics: GlobalUnderstandingDiagnosticsNode;
}

export interface GlobalUnderstandingStatusBarModel {
  readonly text: string;
  readonly tooltip: string;
}

export interface GlobalUnderstandingRefreshSource {
  recalculate(): Promise<GlobalUnderstandingTreeSnapshot | undefined>;
}

export interface GlobalUnderstandingRefreshHost {
  show(snapshot: GlobalUnderstandingTreeSnapshot): void;
  clear(): void;
}

export interface GlobalLayerToggleHost {
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void | Promise<void>;
  refreshDecorations(): void | Promise<void>;
  refreshGlobalUnderstanding(): void | Promise<void>;
}

const compareCodeUnits = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const requireCount = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
};

const ratio = (reviewed: number, total: number): number =>
  total === 0 ? 1 : reviewed / total;

const ratiosEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <=
  Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));

const validateProgress = (
  reviewed: number,
  total: number,
  progress: number,
  label: string
): void => {
  requireCount(reviewed, `${label}.reviewed`);
  requireCount(total, `${label}.total`);
  if (reviewed > total) {
    throw new RangeError(`${label}.reviewed must not exceed total.`);
  }
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(`${label}.progress must be in 0..1.`);
  }
  if (!ratiosEqual(progress, ratio(reviewed, total))) {
    throw new RangeError(`${label}.progress does not match its counts.`);
  }
};

const formatPercent = (progress: number): string =>
  `${Math.round(progress * 100)}%`;

const fileNode = (
  file: GlobalUnderstandingFileProgress
): GlobalUnderstandingFileNode => {
  if (file.path.length === 0) {
    throw new RangeError("Global understanding file path must not be empty.");
  }
  validateProgress(
    file.reviewedNonEmptyLineCount,
    file.totalNonEmptyLineCount,
    file.progress,
    `Global understanding file ${file.path}`
  );
  return Object.freeze({
    kind: "file" as const,
    path: file.path,
    label: file.path,
    description: `${formatPercent(file.progress)} (${file.reviewedNonEmptyLineCount}/${file.totalNonEmptyLineCount})`,
    state: file.state,
    reviewedNonEmptyLineCount: file.reviewedNonEmptyLineCount,
    totalNonEmptyLineCount: file.totalNonEmptyLineCount,
    progress: file.progress
  });
};

/** Projects one immutable Global calculation and enumeration diagnostic snapshot for Tree View rendering. */
export const createGlobalUnderstandingTreeModel = (
  snapshot: GlobalUnderstandingTreeSnapshot
): GlobalUnderstandingTreeModel => {
  const { progress } = snapshot;
  validateProgress(
    progress.reviewedNonEmptyLineCount,
    progress.totalNonEmptyLineCount,
    progress.progress,
    "Global understanding repository"
  );
  requireCount(snapshot.excludedFileCount, "excludedFileCount");
  requireCount(
    snapshot.prunedExcludedDirectoryCount,
    "prunedExcludedDirectoryCount"
  );

  const files = progress.files.map(fileNode).sort((left, right) =>
    compareCodeUnits(left.path, right.path)
  );
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) {
      throw new RangeError(`duplicate Global understanding path: ${file.path}`);
    }
    paths.add(file.path);
  }

  return Object.freeze({
    summary: Object.freeze({
      kind: "summary" as const,
      label: "リポジトリ全体" as const,
      description: `${formatPercent(progress.progress)} (${progress.reviewedNonEmptyLineCount}/${progress.totalNonEmptyLineCount})`,
      reviewedNonEmptyLineCount: progress.reviewedNonEmptyLineCount,
      totalNonEmptyLineCount: progress.totalNonEmptyLineCount,
      progress: progress.progress
    }),
    files: Object.freeze(files),
    diagnostics: Object.freeze({
      kind: "diagnostics" as const,
      label: "除外診断" as const,
      excludedFileCount: snapshot.excludedFileCount,
      prunedExcludedDirectoryCount: snapshot.prunedExcludedDirectoryCount
    })
  });
};

/** Formats the Global half of the T305 Status Bar display. */
export const formatGlobalUnderstandingStatusBar = (
  snapshot: GlobalUnderstandingTreeSnapshot
): GlobalUnderstandingStatusBarModel => {
  const model = createGlobalUnderstandingTreeModel(snapshot);
  const percent = formatPercent(model.summary.progress);
  return {
    text: `$(book) Global: ${percent} (${model.summary.reviewedNonEmptyLineCount}/${model.summary.totalNonEmptyLineCount})`,
    tooltip: [
      `Global理解率: ${percent}`,
      `確認済み非空行: ${model.summary.reviewedNonEmptyLineCount}`,
      `対象非空行: ${model.summary.totalNonEmptyLineCount}`,
      `除外ファイル: ${model.diagnostics.excludedFileCount}`,
      `pruneした除外ディレクトリ: ${model.diagnostics.prunedExcludedDirectoryCount}`
    ].join("\n")
  };
};

/** Persists the Global decoration layer setting before refreshing dependent surfaces. */
export class GlobalLayerToggleController {
  public constructor(private readonly host: GlobalLayerToggleHost) {}

  public async toggle(): Promise<boolean> {
    const next = !this.host.readEnabled();
    await this.host.writeEnabled(next);
    await this.host.refreshDecorations();
    await this.host.refreshGlobalUnderstanding();
    return next;
  }
}

export interface GlobalUnderstandingRefreshCoalescerHost {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  run(): void | Promise<void>;
}

/** Debounces rapid refresh requests so only the latest document evidence starts recalculation. */
export class GlobalUnderstandingRefreshCoalescer {
  private scheduled: unknown | undefined;
  private disposed = false;

  public constructor(
    private readonly host: GlobalUnderstandingRefreshCoalescerHost,
    private readonly delayMs = 150
  ) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new RangeError("delayMs must be a non-negative safe integer.");
    }
  }

  public request(): void {
    if (this.disposed) return;
    this.cancel();
    let handle: unknown;
    handle = this.host.schedule(() => {
      if (this.disposed || this.scheduled !== handle) return;
      this.scheduled = undefined;
      void this.host.run();
    }, this.delayMs);
    this.scheduled = handle;
  }

  public cancel(): void {
    if (this.scheduled === undefined) return;
    this.host.cancel(this.scheduled);
    this.scheduled = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }
}

/** Prevents stale or failed recalculations from publishing Global data for the wrong context. */
export class GlobalUnderstandingRefreshController {
  private generation = 0;

  public constructor(
    private readonly source: GlobalUnderstandingRefreshSource,
    private readonly host: GlobalUnderstandingRefreshHost
  ) {}

  public clear(): void {
    this.generation += 1;
    this.host.clear();
  }

  public async refresh(): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const currentGeneration = ++this.generation;
    try {
      const snapshot = await this.source.recalculate();
      if (currentGeneration !== this.generation) return undefined;
      if (snapshot === undefined) {
        this.host.clear();
        return undefined;
      }
      this.host.show(snapshot);
      return snapshot;
    } catch (error) {
      if (currentGeneration !== this.generation) return undefined;
      this.host.clear();
      throw error;
    }
  }
}

import type {
  GlobalUnderstandingFileProgress,
  RepositoryGlobalUnderstandingProgress
} from "../../core/global-understanding/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";
import { runWithBoundedRetry } from "../../application/operation-feedback/index";

export interface GlobalUnderstandingWorkingTreeFileOpenTarget {
  readonly kind: "working-tree";
  readonly repositoryId: string;
  readonly contextId: string;
  readonly revisionId: string;
  readonly repositoryPath: string;
  readonly filePath: string;
}

export interface GlobalUnderstandingPullRequestHeadFileOpenTarget {
  readonly kind: "pull-request-head";
  readonly repositoryId: string;
  readonly contextId: string;
  readonly revisionId: string;
  readonly repositoryPath: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}

export type GlobalUnderstandingFileOpenTarget =
  | GlobalUnderstandingWorkingTreeFileOpenTarget
  | GlobalUnderstandingPullRequestHeadFileOpenTarget;

export interface GlobalUnderstandingTreeSnapshot {
  readonly progress: RepositoryGlobalUnderstandingProgress;
  readonly fileOpenTargets?: readonly GlobalUnderstandingFileOpenTarget[];
  readonly openedFileCount?: number;
  readonly unopenedFileCount?: number;
  readonly excludedFileCount: number;
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
  readonly openTarget?: GlobalUnderstandingFileOpenTarget;
}

export interface GlobalUnderstandingDiagnosticsNode {
  readonly kind: "diagnostics";
  readonly label: "ファイル状況";
  readonly openedFileCount: number;
  readonly unopenedFileCount: number;
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

export interface GlobalUnderstandingFileOpenHost {
  openFile(target: GlobalUnderstandingFileOpenTarget): void | Promise<void>;
}

export interface GlobalUnderstandingRefreshSource {
  recalculate(signal?: AbortSignal): Promise<GlobalUnderstandingTreeSnapshot | undefined>;
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
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
};
const ratio = (reviewed: number, total: number): number => total === 0 ? 1 : reviewed / total;
const ratiosEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
const validateProgress = (reviewed: number, total: number, progress: number, label: string): void => {
  requireCount(reviewed, `${label}.reviewed`);
  requireCount(total, `${label}.total`);
  if (reviewed > total) throw new RangeError(`${label}.reviewed must not exceed total.`);
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new RangeError(`${label}.progress must be in 0..1.`);
  if (!ratiosEqual(progress, ratio(reviewed, total))) throw new RangeError(`${label}.progress does not match its counts.`);
};
const formatPercent = (progress: number): string => `${Math.round(progress * 100)}%`;
const cloneOpenTarget = (target: GlobalUnderstandingFileOpenTarget): GlobalUnderstandingFileOpenTarget =>
  target.kind === "working-tree"
    ? { ...target }
    : { ...target };
const freezeOpenTarget = (target: GlobalUnderstandingFileOpenTarget): GlobalUnderstandingFileOpenTarget =>
  Object.freeze(cloneOpenTarget(target));
const fileNode = (
  file: GlobalUnderstandingFileProgress,
  openTarget: GlobalUnderstandingFileOpenTarget | undefined
): GlobalUnderstandingFileNode => {
  if (file.path.length === 0) throw new RangeError("Global understanding file path must not be empty.");
  validateProgress(file.reviewedNonEmptyLineCount, file.totalNonEmptyLineCount, file.progress, `Global understanding file ${file.path}`);
  return Object.freeze({
    kind: "file" as const,
    path: file.path,
    label: file.path,
    description: `${formatPercent(file.progress)} (${file.reviewedNonEmptyLineCount}/${file.totalNonEmptyLineCount})`,
    state: file.state,
    reviewedNonEmptyLineCount: file.reviewedNonEmptyLineCount,
    totalNonEmptyLineCount: file.totalNonEmptyLineCount,
    progress: file.progress,
    ...(openTarget === undefined ? {} : { openTarget: freezeOpenTarget(openTarget) })
  });
};

export const createGlobalUnderstandingTreeModel = (snapshot: GlobalUnderstandingTreeSnapshot): GlobalUnderstandingTreeModel => {
  const { progress } = snapshot;
  validateProgress(progress.reviewedNonEmptyLineCount, progress.totalNonEmptyLineCount, progress.progress, "Global understanding repository");
  const openedFileCount = snapshot.openedFileCount ?? progress.files.length;
  const unopenedFileCount = snapshot.unopenedFileCount ?? 0;
  requireCount(openedFileCount, "openedFileCount");
  requireCount(unopenedFileCount, "unopenedFileCount");
  requireCount(snapshot.excludedFileCount, "excludedFileCount");
  requireCount(snapshot.prunedExcludedDirectoryCount, "prunedExcludedDirectoryCount");
  if (openedFileCount !== progress.files.length) {
    throw new RangeError("openedFileCount must match Global progress file count.");
  }
  const openTargetsByPath = new Map<string, GlobalUnderstandingFileOpenTarget>();
  for (const target of snapshot.fileOpenTargets ?? []) {
    if (openTargetsByPath.has(target.repositoryPath)) {
      throw new RangeError(`duplicate Global understanding open target: ${target.repositoryPath}`);
    }
    openTargetsByPath.set(target.repositoryPath, target);
  }
  if (snapshot.fileOpenTargets !== undefined && snapshot.fileOpenTargets.length !== progress.files.length) {
    throw new RangeError("Global understanding open target count must match file progress count.");
  }
  const files = progress.files.map((file) => {
    const target = openTargetsByPath.get(file.path);
    if (snapshot.fileOpenTargets !== undefined && target === undefined) {
      throw new RangeError(`Global understanding open target is missing: ${file.path}`);
    }
    return fileNode(file, target);
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new RangeError(`duplicate Global understanding path: ${file.path}`);
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
      label: "ファイル状況" as const,
      openedFileCount,
      unopenedFileCount,
      excludedFileCount: snapshot.excludedFileCount,
      prunedExcludedDirectoryCount: snapshot.prunedExcludedDirectoryCount
    })
  });
};

export const formatGlobalUnderstandingStatusBar = (snapshot: GlobalUnderstandingTreeSnapshot): GlobalUnderstandingStatusBarModel => {
  const model = createGlobalUnderstandingTreeModel(snapshot);
  const percent = formatPercent(model.summary.progress);
  return {
    text: `$(book) Global: ${percent} (${model.summary.reviewedNonEmptyLineCount}/${model.summary.totalNonEmptyLineCount})`,
    tooltip: [
      `Global理解率: ${percent}`,
      `確認済み非空行: ${model.summary.reviewedNonEmptyLineCount}`,
      `対象非空行: ${model.summary.totalNonEmptyLineCount}`,
      `開いたことがあるファイル: ${model.diagnostics.openedFileCount}`,
      `未オープンファイル: ${model.diagnostics.unopenedFileCount}`,
      `除外ファイル: ${model.diagnostics.excludedFileCount}`,
      `pruneした除外ディレクトリ: ${model.diagnostics.prunedExcludedDirectoryCount}`
    ].join("\n")
  };
};

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
  invalidate(): void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  run(): void | Promise<void>;
}

export class GlobalUnderstandingRefreshCoalescer {
  private scheduled: unknown | undefined;
  private disposed = false;
  public constructor(private readonly host: GlobalUnderstandingRefreshCoalescerHost, private readonly delayMs = 150) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new RangeError("delayMs must be a non-negative safe integer.");
  }
  public request(): void {
    if (this.disposed) return;
    this.host.invalidate();
    this.cancel();
    const handle = this.host.schedule(() => {
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

export const formatGlobalUnderstandingFileOpenError = (error: unknown): string =>
  `Global のファイルを開けませんでした: ${error instanceof Error ? error.message : String(error)}`;

export class GlobalUnderstandingFileOpenController {
  private currentNodes = new Set<GlobalUnderstandingFileNode>();

  public constructor(private readonly host: GlobalUnderstandingFileOpenHost) {}

  public replaceModel(model: GlobalUnderstandingTreeModel): void {
    this.currentNodes = new Set(model.files);
  }

  public clear(): void {
    this.currentNodes.clear();
  }

  public async open(node: GlobalUnderstandingFileNode): Promise<void> {
    if (!this.currentNodes.has(node)) {
      throw new RangeError("Selected Global understanding file node is stale and does not belong to the current snapshot.");
    }
    if (node.openTarget === undefined) {
      throw new Error("Global understanding file open target is unavailable.");
    }
    await this.host.openFile(freezeOpenTarget(node.openTarget));
  }
}

export class GlobalUnderstandingRefreshController {
  private generation = 0;
  public constructor(private readonly source: GlobalUnderstandingRefreshSource, private readonly host: GlobalUnderstandingRefreshHost) {}
  public invalidate(): void { this.generation += 1; }
  public clear(): void { this.invalidate(); this.host.clear(); }
  public async refresh(signal?: AbortSignal): Promise<GlobalUnderstandingTreeSnapshot | undefined> {
    const currentGeneration = ++this.generation;
    try {
      const snapshot = (await runWithBoundedRetry(
        () => this.source.recalculate(signal),
        { maxAttempts: 3, signal },
      )).value;
      if (signal?.aborted === true) return undefined;
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

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
  /** True when the known folder scopes do not cover a complete repository denominator. */
  readonly repositoryPartial?: boolean;
  readonly folders?: readonly GlobalUnderstandingFolderSnapshot[];
}

/** T610 folder scope state used to render action and incomplete aggregation safely. */
export interface GlobalUnderstandingFolderSnapshot {
  readonly path: string;
  readonly state: "inactive" | "running" | "active" | "stopped" | "failed";
  readonly reviewedNonEmptyLineCount: number;
  readonly totalNonEmptyLineCount: number;
  readonly partial: boolean;
}

export interface GlobalUnderstandingSummaryNode {
  readonly kind: "summary";
  readonly label: "リポジトリ全体";
  readonly description: string;
  readonly reviewedNonEmptyLineCount: number;
  readonly totalNonEmptyLineCount: number;
  readonly progress: number;
  /** Prevents a known-scope ratio from being presented as repository-wide. */
  readonly partial?: true;
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
  readonly folders?: readonly GlobalUnderstandingFolderNode[];
}

export interface GlobalUnderstandingFolderNode extends GlobalUnderstandingFolderSnapshot {
  readonly kind: "folder";
  readonly label: string;
  readonly description: string;
  readonly action: "start" | "stop" | "resume";
}

/** Deterministic work budget and publication callbacks for a large Tree projection. */
export interface GlobalUnderstandingTreeStagingOptions {
  /** Maximum file-node operations between scheduler checkpoints and stage publication. */
  readonly maxFilesPerStage: number;
  /** Gives the Extension Host a chance to process input between bounded stages. */
  readonly yieldControl: () => void | Promise<void>;
  /** Returns false when this projection generation is stale, cancelled, or disposed. */
  readonly isCurrent?: () => boolean;
  /** Receives an immutable, sorted prefix of the current generation. */
  readonly onStage?: (model: GlobalUnderstandingTreeModel, complete: boolean) => void | Promise<void>;
  /** Optional deterministic accounting hook for large-workload contract fixtures. */
  readonly accountWork?: (entry: GlobalUnderstandingTreeWorkAccount) => void;
}

/** A bounded projection operation observed by a deterministic workload fixture. */
export interface GlobalUnderstandingTreeWorkAccount {
  readonly kind: "validated-open-target" | "built-file-node" | "published-stage";
  readonly count: number;
  readonly stageFileCount: number;
  readonly modelRetainsInputArray?: boolean;
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
  show(
    snapshot: GlobalUnderstandingTreeSnapshot,
    isCurrent: () => boolean
  ): unknown;
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

const folderNode = (folder: GlobalUnderstandingFolderSnapshot): GlobalUnderstandingFolderNode => {
  const action = folder.state === "stopped" ? "resume" : folder.state === "running" || folder.state === "active" ? "stop" : "start";
  return Object.freeze({ ...folder, kind: "folder" as const, label: folder.path.length === 0 ? "リポジトリroot" : folder.path,
    description: folder.partial ? `partial (${folder.reviewedNonEmptyLineCount}/${folder.totalNonEmptyLineCount})` : `${formatPercent(ratio(folder.reviewedNonEmptyLineCount, folder.totalNonEmptyLineCount))} (${folder.reviewedNonEmptyLineCount}/${folder.totalNonEmptyLineCount})`, action });
};

interface ValidatedTreeSnapshot {
  readonly progress: RepositoryGlobalUnderstandingProgress;
  readonly openedFileCount: number;
  readonly unopenedFileCount: number;
  readonly excludedFileCount: number;
  readonly prunedExcludedDirectoryCount: number;
  readonly openTargetsByPath: ReadonlyMap<string, GlobalUnderstandingFileOpenTarget>;
  readonly folders: readonly GlobalUnderstandingFolderSnapshot[];
  readonly repositoryPartial: boolean;
}

const validateTreeSnapshot = (
  snapshot: GlobalUnderstandingTreeSnapshot
): ValidatedTreeSnapshot => {
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
  return {
    progress,
    openedFileCount,
    unopenedFileCount,
    excludedFileCount: snapshot.excludedFileCount,
    prunedExcludedDirectoryCount: snapshot.prunedExcludedDirectoryCount,
    openTargetsByPath,
    folders: snapshot.folders ?? [], repositoryPartial: snapshot.repositoryPartial === true
  };
};

const validateTreeSnapshotIncrementally = async (
  snapshot: GlobalUnderstandingTreeSnapshot,
  maxItems: number,
  yieldControl: () => void | Promise<void>,
  isCurrent: () => boolean,
  accountWork?: (entry: GlobalUnderstandingTreeWorkAccount) => void
): Promise<ValidatedTreeSnapshot | undefined> => {
  const { progress } = snapshot;
  validateProgress(progress.reviewedNonEmptyLineCount, progress.totalNonEmptyLineCount, progress.progress, "Global understanding repository");
  const openedFileCount = snapshot.openedFileCount ?? progress.files.length;
  const unopenedFileCount = snapshot.unopenedFileCount ?? 0;
  requireCount(openedFileCount, "openedFileCount"); requireCount(unopenedFileCount, "unopenedFileCount");
  requireCount(snapshot.excludedFileCount, "excludedFileCount"); requireCount(snapshot.prunedExcludedDirectoryCount, "prunedExcludedDirectoryCount");
  if (openedFileCount !== progress.files.length) throw new RangeError("openedFileCount must match Global progress file count.");
  const openTargetsByPath = new Map<string, GlobalUnderstandingFileOpenTarget>();
  const targets = snapshot.fileOpenTargets ?? [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (openTargetsByPath.has(target.repositoryPath)) throw new RangeError(`duplicate Global understanding open target: ${target.repositoryPath}`);
    openTargetsByPath.set(target.repositoryPath, target);
    accountWork?.({ kind: "validated-open-target", count: 1, stageFileCount: 1 });
    if ((index + 1) % maxItems === 0) { await yieldControl(); if (!isCurrent()) return undefined; }
  }
  if (snapshot.fileOpenTargets !== undefined && targets.length !== progress.files.length) throw new RangeError("Global understanding open target count must match file progress count.");
  return { progress, openedFileCount, unopenedFileCount, excludedFileCount: snapshot.excludedFileCount, prunedExcludedDirectoryCount: snapshot.prunedExcludedDirectoryCount, openTargetsByPath, folders: snapshot.folders ?? [], repositoryPartial: snapshot.repositoryPartial === true };
};

const createTreeModel = (
  snapshot: ValidatedTreeSnapshot,
  files: readonly GlobalUnderstandingFileNode[]
): GlobalUnderstandingTreeModel => Object.freeze({
  summary: Object.freeze({
    kind: "summary" as const,
    label: "リポジトリ全体" as const,
    description: snapshot.repositoryPartial ? `partial (${snapshot.progress.reviewedNonEmptyLineCount}/${snapshot.progress.totalNonEmptyLineCount})` : `${formatPercent(snapshot.progress.progress)} (${snapshot.progress.reviewedNonEmptyLineCount}/${snapshot.progress.totalNonEmptyLineCount})`,
    reviewedNonEmptyLineCount: snapshot.progress.reviewedNonEmptyLineCount,
    totalNonEmptyLineCount: snapshot.progress.totalNonEmptyLineCount,
    progress: snapshot.progress.progress,
    ...(snapshot.repositoryPartial ? { partial: true as const } : {})
  }),
  files: Object.freeze(files),
  diagnostics: Object.freeze({
    kind: "diagnostics" as const,
    label: "ファイル状況" as const,
    openedFileCount: snapshot.openedFileCount,
    unopenedFileCount: snapshot.unopenedFileCount,
    excludedFileCount: snapshot.excludedFileCount,
    prunedExcludedDirectoryCount: snapshot.prunedExcludedDirectoryCount
  }),
  ...(snapshot.folders.length === 0 ? {} : { folders: Object.freeze(snapshot.folders.map(folderNode).sort((left, right) => compareCodeUnits(left.path, right.path))) })
});

const cooperativeSortFileNodes = async (
  values: readonly GlobalUnderstandingFileNode[],
  maxItems: number,
  yieldControl: () => void | Promise<void>,
  isCurrent: () => boolean
): Promise<GlobalUnderstandingFileNode[] | undefined> => {
  let source = [...values];
  let target = new Array<GlobalUnderstandingFileNode>(source.length);
  let pending = 0;
  const step = async (): Promise<boolean> => {
    pending += 1;
    if (pending < maxItems) return isCurrent();
    pending = 0;
    await yieldControl();
    return isCurrent();
  };
  for (let width = 1; width < source.length; width *= 2) {
    for (let left = 0; left < source.length; left += width * 2) {
      const middle = Math.min(left + width, source.length);
      const right = Math.min(left + width * 2, source.length);
      let first = left;
      let second = middle;
      for (let output = left; output < right; output += 1) {
        if (first < middle && (second >= right || compareCodeUnits(source[first]!.path, source[second]!.path) <= 0)) {
          target[output] = source[first++]!;
        } else target[output] = source[second++]!;
        if (!await step()) return undefined;
      }
    }
    const previous = source;
    source = target;
    target = previous;
  }
  return source;
};

export const createGlobalUnderstandingTreeModel = (snapshot: GlobalUnderstandingTreeSnapshot): GlobalUnderstandingTreeModel => {
  const validated = validateTreeSnapshot(snapshot);
  const files = validated.progress.files.map((file) => {
    const target = validated.openTargetsByPath.get(file.path);
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
  return createTreeModel(validated, files);
};

/**
 * Builds and publishes a sorted Global Tree in bounded deterministic file stages.
 * A stale generation returns undefined and never publishes after invalidation.
 */
export const createGlobalUnderstandingTreeModelIncrementally = async (
  snapshot: GlobalUnderstandingTreeSnapshot,
  options: GlobalUnderstandingTreeStagingOptions
): Promise<GlobalUnderstandingTreeModel | undefined> => {
  if (!Number.isSafeInteger(options.maxFilesPerStage) || options.maxFilesPerStage <= 0) {
    throw new RangeError("maxFilesPerStage must be a positive integer.");
  }
  const isCurrent = (): boolean => options.isCurrent?.() !== false;
  if (!isCurrent()) return undefined;
  const validated = await validateTreeSnapshotIncrementally(snapshot, options.maxFilesPerStage, options.yieldControl, isCurrent, options.accountWork);
  if (validated === undefined) return undefined;
  const built: GlobalUnderstandingFileNode[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < validated.progress.files.length; index += 1) {
    if (!isCurrent()) return undefined;
    const file = validated.progress.files[index]!;
    const target = validated.openTargetsByPath.get(file.path);
    if (snapshot.fileOpenTargets !== undefined && target === undefined) {
      throw new RangeError(`Global understanding open target is missing: ${file.path}`);
    }
    if (paths.has(file.path)) throw new RangeError(`duplicate Global understanding path: ${file.path}`);
    paths.add(file.path);
    built.push(fileNode(file, target));
    options.accountWork?.({ kind: "built-file-node", count: 1, stageFileCount: 1 });
    if ((index + 1) % options.maxFilesPerStage === 0 && index + 1 < validated.progress.files.length) {
      await options.yieldControl();
    }
  }
  if (!isCurrent()) return undefined;
  const sorted = await cooperativeSortFileNodes(
    built,
    options.maxFilesPerStage,
    options.yieldControl,
    isCurrent
  );
  if (sorted === undefined) return undefined;
  for (let end = options.maxFilesPerStage; end < built.length; end += options.maxFilesPerStage) {
    if (!isCurrent()) return undefined;
    const stageFiles = sorted.slice(0, end);
    const stage = createTreeModel(validated, stageFiles);
    options.accountWork?.({ kind: "published-stage", count: end % options.maxFilesPerStage || options.maxFilesPerStage, stageFileCount: stage.files.length, modelRetainsInputArray: stage.files === stageFiles });
    await options.onStage?.(stage, false);
    if (!isCurrent()) return undefined;
    await options.yieldControl();
  }
  if (!isCurrent()) return undefined;
  const complete = createTreeModel(validated, sorted);
  options.accountWork?.({ kind: "published-stage", count: sorted.length % options.maxFilesPerStage || Math.min(sorted.length, options.maxFilesPerStage), stageFileCount: complete.files.length, modelRetainsInputArray: complete.files === sorted });
  await options.onStage?.(complete, true);
  return isCurrent() ? complete : undefined;
};

export const formatGlobalUnderstandingStatusBar = (snapshot: GlobalUnderstandingTreeSnapshot): GlobalUnderstandingStatusBarModel => {
  const { progress } = snapshot;
  validateProgress(progress.reviewedNonEmptyLineCount, progress.totalNonEmptyLineCount, progress.progress, "Global understanding repository");
  const openedFileCount = snapshot.openedFileCount ?? progress.files.length;
  const unopenedFileCount = snapshot.unopenedFileCount ?? 0;
  requireCount(openedFileCount, "openedFileCount");
  requireCount(unopenedFileCount, "unopenedFileCount");
  requireCount(snapshot.excludedFileCount, "excludedFileCount");
  requireCount(snapshot.prunedExcludedDirectoryCount, "prunedExcludedDirectoryCount");
  const percent = snapshot.repositoryPartial === true ? "partial" : formatPercent(progress.progress);
  return {
    text: `$(book) Global: ${percent} (${progress.reviewedNonEmptyLineCount}/${progress.totalNonEmptyLineCount})`,
    tooltip: [
      `Global理解率: ${percent}`,
      `確認済み非空行: ${progress.reviewedNonEmptyLineCount}`,
      `対象非空行: ${progress.totalNonEmptyLineCount}`,
      `開いたことがあるファイル: ${openedFileCount}`,
      `未オープンファイル: ${unopenedFileCount}`,
      `除外ファイル: ${snapshot.excludedFileCount}`,
      `pruneした除外ディレクトリ: ${snapshot.prunedExcludedDirectoryCount}`
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
  public invalidate(): void { this.generation += 1; this.host.clear(); }
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
      await this.host.show(
        snapshot,
        () => currentGeneration === this.generation && signal?.aborted !== true
      );
      if (currentGeneration !== this.generation || signal?.aborted) {
        return undefined;
      }
      return snapshot;
    } catch (error) {
      if (currentGeneration !== this.generation) return undefined;
      this.host.clear();
      throw error;
    }
  }
}

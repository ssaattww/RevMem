import type {
  PullRequestDiffFileProgress,
  PullRequestDiffProgress
} from "../../core/pr-progress/index";
import type { ReviewFileExclusionReason } from "../../core/file-exclusion/index";

/** Stable PR Progress Tree root categories in their default display order. */
export type PullRequestProgressTreeCategory =
  | "unreviewed"
  | "completed"
  | "excluded"
  | "non-line-change"
  | "line-review-unsupported";

/** One root node in the PR Progress Tree. */
export interface PullRequestProgressTreeCategoryNode {
  /** Discriminant for root/category nodes. */
  readonly kind: "category";
  /** Stable category identity. */
  readonly category: PullRequestProgressTreeCategory;
  /** User-visible category label. */
  readonly label: string;
  /** Number of file children currently classified under this root. */
  readonly fileCount: number;
}

/** One changed-file node in the PR Progress Tree. */
export interface PullRequestProgressTreeFileNode {
  /** Discriminant for changed-file nodes. */
  readonly kind: "file";
  /** Stable root category containing this file. */
  readonly category: PullRequestProgressTreeCategory;
  /** Canonical repository-relative display path. */
  readonly path: string;
  /** Reviewed changed-line count. */
  readonly reviewedLineCount: number;
  /** Total reviewable changed-line count. */
  readonly totalLineCount: number;
  /** Remaining reviewable changed-line count. */
  readonly unreviewedLineCount: number;
  /** Progress ratio in the inclusive range `0..1`. */
  readonly progress: number;
  /** Addition statistic retained from the exact diff snapshot. */
  readonly additions: number;
  /** Deletion statistic retained from the exact diff snapshot. */
  readonly deletions: number;
  /** User-visible reason for exclusion or line-review unavailability. */
  readonly reason?: string;
  /** Exact source record used when opening this file's diff. */
  readonly source: PullRequestDiffFileProgress;
}

/** Node union returned by the PR Progress Tree provider. */
export type PullRequestProgressTreeNode =
  | PullRequestProgressTreeCategoryNode
  | PullRequestProgressTreeFileNode;

/** Host boundary used when the user selects one changed-file node. */
export interface PullRequestProgressTreeHost {
  /** Opens the diff associated with the exact selected progress record. */
  openDiff(file: PullRequestDiffFileProgress): Promise<void>;
}

interface CategoryDefinition {
  readonly category: PullRequestProgressTreeCategory;
  readonly label: string;
}

const CATEGORY_DEFINITIONS = Object.freeze([
  { category: "unreviewed", label: "未確認変更が残るファイル" },
  { category: "completed", label: "確認完了したファイル" },
  { category: "excluded", label: "除外されたファイル" },
  { category: "non-line-change", label: "行以外の変更" },
  { category: "line-review-unsupported", label: "行単位レビュー対象外" }
] satisfies readonly CategoryDefinition[]);

const compareCodeUnits = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const ratio = (reviewed: number, total: number): number =>
  total === 0 ? 1 : reviewed / total;

const ratiosEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
};

const formatReason = (reason: ReviewFileExclusionReason): string => {
  switch (reason.kind) {
    case "binary":
      return "バイナリファイル";
    case "default-glob":
      return `既定除外: ${reason.pattern}`;
    case "user-glob":
      return `ユーザー除外: ${reason.pattern}`;
  }
};

const validateFile = (file: PullRequestDiffFileProgress): void => {
  if (file.fileId.length === 0) throw new RangeError("PR progress fileId must not be empty.");
  if (file.path.length === 0) throw new RangeError("PR progress path must not be empty.");
  validateCount(file.additions, `PR progress additions for ${file.fileId}`);
  validateCount(file.deletions, `PR progress deletions for ${file.fileId}`);
  validateCount(file.reviewedLineCount, `PR progress reviewedLineCount for ${file.fileId}`);
  validateCount(file.totalLineCount, `PR progress totalLineCount for ${file.fileId}`);
  if (file.reviewedLineCount > file.totalLineCount) {
    throw new RangeError(`PR progress reviewedLineCount exceeds totalLineCount for ${file.fileId}.`);
  }
  if (!Number.isFinite(file.progress) || file.progress < 0 || file.progress > 1) {
    throw new RangeError(`PR progress ratio must be in 0..1 for ${file.fileId}.`);
  }
  const expectedProgress = ratio(file.reviewedLineCount, file.totalLineCount);
  if (!ratiosEqual(file.progress, expectedProgress)) {
    throw new RangeError(`PR progress ratio does not match counts for ${file.fileId}.`);
  }
  if (file.excluded !== (file.exclusionReason !== undefined)) {
    throw new RangeError(`PR progress exclusion reason mismatch for ${file.fileId}.`);
  }
};

const categoryFor = (file: PullRequestDiffFileProgress): PullRequestProgressTreeCategory => {
  if (file.status === "binary" || file.exclusionReason?.kind === "binary") {
    return "line-review-unsupported";
  }
  if (file.excluded) return "excluded";
  if (file.totalLineCount === 0) return "non-line-change";
  if (file.reviewedLineCount < file.totalLineCount) return "unreviewed";
  return "completed";
};

const reasonFor = (file: PullRequestDiffFileProgress): string | undefined =>
  file.exclusionReason === undefined ? undefined : formatReason(file.exclusionReason);

const toFileNode = (file: PullRequestDiffFileProgress): PullRequestProgressTreeFileNode => ({
  kind: "file",
  category: categoryFor(file),
  path: file.path,
  reviewedLineCount: file.reviewedLineCount,
  totalLineCount: file.totalLineCount,
  unreviewedLineCount: file.totalLineCount - file.reviewedLineCount,
  progress: file.progress,
  additions: file.additions,
  deletions: file.deletions,
  ...(reasonFor(file) === undefined ? {} : { reason: reasonFor(file) }),
  source: file
});

const compareFileNodes = (
  left: PullRequestProgressTreeFileNode,
  right: PullRequestProgressTreeFileNode
): number =>
  right.unreviewedLineCount - left.unreviewedLineCount ||
  compareCodeUnits(left.path, right.path);

/**
 * Stores one exact PR progress snapshot as five deterministic Tree View categories.
 * The provider is platform-neutral; T305 supplies the concrete VS Code Tree View host and refresh wiring.
 */
export class PullRequestProgressTreeDataProvider {
  private readonly filesByCategory = new Map<
    PullRequestProgressTreeCategory,
    readonly PullRequestProgressTreeFileNode[]
  >();

  /** Creates an empty provider connected to the diff-opening host boundary. */
  public constructor(private readonly host: PullRequestProgressTreeHost) {
    this.clear();
  }

  /**
   * Atomically replaces the rendered progress snapshot after validating file and aggregate invariants.
   * @throws {RangeError} When counts, ratios, identities, exclusions, duplicates, or aggregate values are inconsistent.
   */
  public replaceProgress(progress: PullRequestDiffProgress): void {
    validateCount(progress.reviewedLineCount, "PR aggregate reviewedLineCount");
    validateCount(progress.totalLineCount, "PR aggregate totalLineCount");
    if (progress.reviewedLineCount > progress.totalLineCount) {
      throw new RangeError("PR aggregate reviewedLineCount exceeds totalLineCount.");
    }
    if (!Number.isFinite(progress.progress) || progress.progress < 0 || progress.progress > 1) {
      throw new RangeError("PR aggregate progress must be in 0..1.");
    }

    const seenFileIds = new Set<string>();
    const seenPaths = new Set<string>();
    const next = new Map<PullRequestProgressTreeCategory, PullRequestProgressTreeFileNode[]>();
    for (const { category } of CATEGORY_DEFINITIONS) next.set(category, []);

    let aggregateReviewed = 0;
    let aggregateTotal = 0;
    for (const file of progress.files) {
      validateFile(file);
      if (seenFileIds.has(file.fileId)) {
        throw new RangeError(`Duplicate PR progress fileId: ${file.fileId}`);
      }
      if (seenPaths.has(file.path)) {
        throw new RangeError(`Duplicate PR progress path: ${file.path}`);
      }
      seenFileIds.add(file.fileId);
      seenPaths.add(file.path);
      aggregateReviewed += file.reviewedLineCount;
      aggregateTotal += file.totalLineCount;
      const node = toFileNode(file);
      next.get(node.category)!.push(node);
    }

    if (
      aggregateReviewed !== progress.reviewedLineCount ||
      aggregateTotal !== progress.totalLineCount
    ) {
      throw new RangeError("PR aggregate counts do not match file progress records.");
    }
    const expectedProgress = ratio(aggregateReviewed, aggregateTotal);
    if (!ratiosEqual(progress.progress, expectedProgress)) {
      throw new RangeError("PR aggregate progress does not match aggregate counts.");
    }

    for (const { category } of CATEGORY_DEFINITIONS) {
      const sorted = [...next.get(category)!].sort(compareFileNodes);
      this.filesByCategory.set(category, Object.freeze(sorted));
    }
  }

  /** Removes all file children while preserving the five stable category roots. */
  public clear(): void {
    for (const { category } of CATEGORY_DEFINITIONS) {
      this.filesByCategory.set(category, Object.freeze([]));
    }
  }

  /** Returns root categories or the selected category's sorted file children. */
  public getChildren(
    element?: PullRequestProgressTreeNode
  ): readonly PullRequestProgressTreeNode[] {
    if (element === undefined) {
      return CATEGORY_DEFINITIONS.map(({ category, label }) => ({
        kind: "category",
        category,
        label,
        fileCount: this.filesByCategory.get(category)?.length ?? 0
      }));
    }
    if (element.kind === "file") return [];
    return this.filesByCategory.get(element.category) ?? [];
  }

  /** Opens the exact diff represented by a selected changed-file node. */
  public async select(node: PullRequestProgressTreeFileNode): Promise<void> {
    await this.host.openDiff(node.source);
  }
}

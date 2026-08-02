import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";
import type { ReviewFileExclusionReason } from "../../core/file-exclusion/index";
import type {
  PullRequestDiffFileProgress,
  PullRequestDiffProgress
} from "../../core/pr-progress/index";

/** Stable PR Progress Tree root categories in their default display order. */
export type PullRequestProgressTreeCategory =
  | "unreviewed"
  | "completed"
  | "excluded"
  | "non-line-change"
  | "line-review-unsupported";

/** Reason that line-based review cannot be performed for one changed file. */
export type PullRequestLineReviewUnsupportedReason =
  | { readonly kind: "binary" }
  | { readonly kind: "invalid-encoding"; readonly encoding: string }
  | { readonly kind: "unsupported-encoding"; readonly encoding: string };

/** Explicit line-review availability supplied together with one exact PR progress snapshot. */
export type PullRequestLineReviewability =
  | { readonly kind: "reviewable" }
  | {
    readonly kind: "unsupported";
    readonly reason: PullRequestLineReviewUnsupportedReason;
  };

/** Immutable identity shared by rendered nodes and their exact diff-open targets. */
export interface PullRequestProgressTreeSnapshotIdentity {
  /** Opaque identity of this exact rendered snapshot generation. */
  readonly snapshotId: string;
  /** Stable pull-request review-context identity. */
  readonly contextId: string;
  /** Full immutable base commit object ID. */
  readonly baseSha: string;
  /** Full immutable head commit object ID. */
  readonly headSha: string;
  /** Canonical original-side state key, exactly `${baseSha}..${headSha}`. */
  readonly originalDiffId: string;
  /** Filesystem semantics needed to encode both virtual diff documents. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}

/** Complete identity-bound input rendered by the PR Progress Tree. */
export interface PullRequestProgressTreeSnapshot
  extends PullRequestProgressTreeSnapshotIdentity {
  /** Validated T301 progress result for the same PR comparison. */
  readonly progress: PullRequestDiffProgress;
  /** Exhaustive line-review availability keyed by every progress file ID. */
  readonly lineReviewabilityByFileId: Readonly<
    Record<string, PullRequestLineReviewability>
  >;
}

/** One immutable side of a selected PR diff. */
export interface PullRequestProgressTreeDiffSide {
  /** Repository-relative path for this side. */
  readonly filePath: string;
  /** Full immutable commit object ID for this side. */
  readonly revision: string;
}

/** Exact immutable diff target passed to the concrete UI host. */
export interface PullRequestProgressTreeDiffTarget
  extends PullRequestProgressTreeSnapshotIdentity {
  /** Exact progress record represented by the selected node. */
  readonly file: PullRequestDiffFileProgress;
  /** Base/original virtual-document target. */
  readonly original: PullRequestProgressTreeDiffSide;
  /** Head/modified virtual-document target. */
  readonly modified: PullRequestProgressTreeDiffSide;
}

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
  /** Exact source record used to render this node. */
  readonly source: PullRequestDiffFileProgress;
  /** Identity-bound target used when opening this file's diff. */
  readonly openTarget: PullRequestProgressTreeDiffTarget;
}

/** Node union returned by the PR Progress Tree provider. */
export type PullRequestProgressTreeNode =
  | PullRequestProgressTreeCategoryNode
  | PullRequestProgressTreeFileNode;

/** Host boundary used when the user selects one changed-file node. */
export interface PullRequestProgressTreeHost {
  /** Opens the exact immutable diff represented by the selected current node. */
  openDiff(target: PullRequestProgressTreeDiffTarget): Promise<void>;
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
const FULL_COMMIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

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

const validateNonEmpty = (value: string, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty.`);
  }
  return value;
};

const validateCommitObjectId = (value: string, label: string): void => {
  if (!FULL_COMMIT_OBJECT_ID.test(value)) {
    throw new RangeError(`${label} must be a full lowercase commit object ID.`);
  }
};

const validateSnapshotIdentity = (
  identity: PullRequestProgressTreeSnapshotIdentity
): void => {
  validateNonEmpty(identity.snapshotId, "PR progress snapshotId");
  validateNonEmpty(identity.contextId, "PR progress contextId");
  validateCommitObjectId(identity.baseSha, "PR progress baseSha");
  validateCommitObjectId(identity.headSha, "PR progress headSha");
  const expectedDiffId = `${identity.baseSha}..${identity.headSha}`;
  if (identity.originalDiffId !== expectedDiffId) {
    throw new RangeError(`PR progress originalDiffId must equal ${expectedDiffId}.`);
  }
  if (
    identity.fileSystemPathSemantics !== "posix" &&
    identity.fileSystemPathSemantics !== "windows"
  ) {
    throw new RangeError("PR progress filesystem semantics must be posix or windows.");
  }
};

const formatExclusionReason = (reason: ReviewFileExclusionReason): string => {
  switch (reason.kind) {
    case "binary":
      return "バイナリファイル";
    case "default-glob":
      return `既定除外: ${reason.pattern}`;
    case "user-glob":
      return `ユーザー除外: ${reason.pattern}`;
  }
};

const formatUnsupportedReason = (
  reason: PullRequestLineReviewUnsupportedReason
): string => {
  switch (reason.kind) {
    case "binary":
      return "バイナリファイル";
    case "invalid-encoding":
      return `不正な文字エンコーディング: ${reason.encoding}`;
    case "unsupported-encoding":
      return `未対応エンコーディング: ${reason.encoding}`;
  }
};

const validateFile = (file: PullRequestDiffFileProgress): void => {
  validateNonEmpty(file.fileId, "PR progress fileId");
  validateNonEmpty(file.path, "PR progress path");
  if (file.oldPath !== undefined) validateNonEmpty(file.oldPath, `PR progress oldPath for ${file.fileId}`);
  if (file.newPath !== undefined) validateNonEmpty(file.newPath, `PR progress newPath for ${file.fileId}`);
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

const validateReviewability = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability | undefined
): PullRequestLineReviewability => {
  if (reviewability === undefined) {
    throw new RangeError(`PR progress line reviewability is missing for ${file.fileId}.`);
  }
  const binaryFile =
    file.status === "binary" || file.exclusionReason?.kind === "binary";

  switch ((reviewability as { readonly kind: unknown }).kind) {
    case "reviewable":
      if (binaryFile) {
        throw new RangeError(`Binary file must be line-review unsupported: ${file.fileId}.`);
      }
      return reviewability;
    case "unsupported": {
      if (
        file.reviewedLineCount !== 0 ||
        file.totalLineCount !== 0 ||
        !ratiosEqual(file.progress, 1)
      ) {
        throw new RangeError(
          `Line-review unsupported file must have zero line counts and progress 1: ${file.fileId}.`
        );
      }
      const reason = (reviewability as {
        readonly reason?: PullRequestLineReviewUnsupportedReason;
      }).reason;
      if (reason === undefined) {
        throw new RangeError(`Line-review unsupported reason is missing for ${file.fileId}.`);
      }
      switch ((reason as { readonly kind: unknown }).kind) {
        case "binary":
          if (!binaryFile) {
            throw new RangeError(`Binary line-review reason does not match ${file.fileId}.`);
          }
          return reviewability;
        case "invalid-encoding":
        case "unsupported-encoding":
          if (binaryFile) {
            throw new RangeError(`Encoding line-review reason does not match binary file ${file.fileId}.`);
          }
          validateNonEmpty(
            (reason as { readonly encoding: string }).encoding,
            `Line-review unsupported encoding for ${file.fileId}`
          );
          return reviewability;
        default:
          throw new RangeError(`Unknown line-review unsupported reason for ${file.fileId}.`);
      }
    }
    default:
      throw new RangeError(`Unknown line reviewability for ${file.fileId}.`);
  }
};

const categoryFor = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): PullRequestProgressTreeCategory => {
  if (reviewability.kind === "unsupported") return "line-review-unsupported";
  if (file.excluded) return "excluded";
  if (file.totalLineCount === 0) return "non-line-change";
  if (file.reviewedLineCount < file.totalLineCount) return "unreviewed";
  return "completed";
};

const reasonFor = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): string | undefined => {
  if (reviewability.kind === "unsupported") {
    return formatUnsupportedReason(reviewability.reason);
  }
  return file.exclusionReason === undefined
    ? undefined
    : formatExclusionReason(file.exclusionReason);
};

const createOpenTarget = (
  identity: PullRequestProgressTreeSnapshotIdentity,
  file: PullRequestDiffFileProgress
): PullRequestProgressTreeDiffTarget => {
  const originalPath = file.oldPath ?? file.newPath ?? file.path;
  const modifiedPath = file.newPath ?? file.oldPath ?? file.path;
  return {
    ...identity,
    file,
    original: { filePath: originalPath, revision: identity.baseSha },
    modified: { filePath: modifiedPath, revision: identity.headSha }
  };
};

const toFileNode = (
  identity: PullRequestProgressTreeSnapshotIdentity,
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): PullRequestProgressTreeFileNode => {
  const reason = reasonFor(file, reviewability);
  return {
    kind: "file",
    category: categoryFor(file, reviewability),
    path: file.path,
    reviewedLineCount: file.reviewedLineCount,
    totalLineCount: file.totalLineCount,
    unreviewedLineCount: file.totalLineCount - file.reviewedLineCount,
    progress: file.progress,
    additions: file.additions,
    deletions: file.deletions,
    ...(reason === undefined ? {} : { reason }),
    source: file,
    openTarget: createOpenTarget(identity, file)
  };
};

const compareFileNodes = (
  left: PullRequestProgressTreeFileNode,
  right: PullRequestProgressTreeFileNode
): number =>
  right.unreviewedLineCount - left.unreviewedLineCount ||
  compareCodeUnits(left.path, right.path);

/**
 * Stores one exact identity-bound PR progress snapshot as five deterministic Tree View categories.
 * The provider is platform-neutral; T305 supplies the concrete VS Code Tree View host and refresh wiring.
 */
export class PullRequestProgressTreeDataProvider {
  private readonly filesByCategory = new Map<
    PullRequestProgressTreeCategory,
    readonly PullRequestProgressTreeFileNode[]
  >();
  private currentFileNodes = new Set<PullRequestProgressTreeFileNode>();

  /** Creates an empty provider connected to the immutable diff-opening host boundary. */
  public constructor(private readonly host: PullRequestProgressTreeHost) {
    this.clear();
  }

  /**
   * Atomically replaces the rendered snapshot after validating identity, availability, file, and aggregate invariants.
   * @throws {RangeError} When snapshot identity, line reviewability, counts, ratios, exclusions, or duplicates are inconsistent.
   */
  public replaceSnapshot(snapshot: PullRequestProgressTreeSnapshot): void {
    validateSnapshotIdentity(snapshot);
    const { progress } = snapshot;
    validateCount(progress.reviewedLineCount, "PR aggregate reviewedLineCount");
    validateCount(progress.totalLineCount, "PR aggregate totalLineCount");
    if (progress.reviewedLineCount > progress.totalLineCount) {
      throw new RangeError("PR aggregate reviewedLineCount exceeds totalLineCount.");
    }
    if (!Number.isFinite(progress.progress) || progress.progress < 0 || progress.progress > 1) {
      throw new RangeError("PR aggregate progress must be in 0..1.");
    }

    const rawReviewability = snapshot.lineReviewabilityByFileId as unknown;
    if (
      typeof rawReviewability !== "object" ||
      rawReviewability === null ||
      Array.isArray(rawReviewability)
    ) {
      throw new RangeError("PR progress line reviewability must be a file-ID record.");
    }
    const reviewabilityByFileId = rawReviewability as Readonly<
      Record<string, PullRequestLineReviewability | undefined>
    >;
    const seenFileIds = new Set<string>();
    const seenPaths = new Set<string>();
    const next = new Map<PullRequestProgressTreeCategory, PullRequestProgressTreeFileNode[]>();
    const nextCurrentFileNodes = new Set<PullRequestProgressTreeFileNode>();
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
      if (!Object.prototype.hasOwnProperty.call(reviewabilityByFileId, file.fileId)) {
        throw new RangeError(`PR progress line reviewability is missing for ${file.fileId}.`);
      }
      seenFileIds.add(file.fileId);
      seenPaths.add(file.path);
      aggregateReviewed += file.reviewedLineCount;
      aggregateTotal += file.totalLineCount;
      const reviewability = validateReviewability(
        file,
        reviewabilityByFileId[file.fileId]
      );
      const node = toFileNode(snapshot, file, reviewability);
      next.get(node.category)!.push(node);
      nextCurrentFileNodes.add(node);
    }

    for (const fileId of Object.keys(reviewabilityByFileId)) {
      if (!seenFileIds.has(fileId)) {
        throw new RangeError(`PR progress line reviewability references unknown file ${fileId}.`);
      }
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
    this.currentFileNodes = nextCurrentFileNodes;
  }

  /** Removes all file children and invalidates every previously returned file node. */
  public clear(): void {
    for (const { category } of CATEGORY_DEFINITIONS) {
      this.filesByCategory.set(category, Object.freeze([]));
    }
    this.currentFileNodes = new Set<PullRequestProgressTreeFileNode>();
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

  /**
   * Opens the exact immutable diff represented by a selected current node.
   * @throws {RangeError} When the node was returned by an older snapshot or another provider.
   */
  public async select(node: PullRequestProgressTreeFileNode): Promise<void> {
    if (!this.currentFileNodes.has(node)) {
      throw new RangeError("Selected PR progress node is stale and does not belong to the current snapshot.");
    }
    await this.host.openDiff(node.openTarget);
  }
}

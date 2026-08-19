import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
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
  readonly snapshotId: string;
  readonly contextId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly originalDiffId: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}

/** Complete identity-bound input rendered by the PR Progress Tree. */
export interface PullRequestProgressTreeSnapshot
  extends PullRequestProgressTreeSnapshotIdentity {
  /** Raw validated T301 progress result for the same PR comparison. */
  readonly progress: PullRequestDiffProgress;
  /** Exhaustive line-review availability keyed by every progress file ID. */
  readonly lineReviewabilityByFileId: Readonly<
    Record<string, PullRequestLineReviewability>
  >;
}

/** One immutable present side of a selected PR diff. */
export interface PullRequestProgressTreePresentDiffSide {
  readonly kind: "present";
  readonly filePath: string;
  readonly revision: string;
}

/** One immutable empty side for a file absent at the selected revision. */
export interface PullRequestProgressTreeAbsentDiffSide {
  readonly kind: "absent";
  readonly filePath: string;
  readonly revision: string;
}

/** One immutable present or absent side of a selected PR diff. */
export type PullRequestProgressTreeDiffSide =
  | PullRequestProgressTreePresentDiffSide
  | PullRequestProgressTreeAbsentDiffSide;

/** Exact immutable diff target passed to the concrete UI host. */
export interface PullRequestProgressTreeDiffTarget
  extends PullRequestProgressTreeSnapshotIdentity {
  readonly file: PullRequestDiffFileProgress;
  readonly original: PullRequestProgressTreeDiffSide;
  readonly modified: PullRequestProgressTreeDiffSide;
}

/**
 * One T304-owned effective file projection.
 * `raw` preserves the authoritative T301 record while the direct counts represent
 * the line-reviewability-adjusted denominator used by the PR Progress UI.
 */
export interface PullRequestEffectiveFileProgress {
  readonly raw: PullRequestDiffFileProgress;
  readonly reviewability: PullRequestLineReviewability;
  readonly category: PullRequestProgressTreeCategory;
  readonly effectiveReason?: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
}

/** Aggregate T304 projection that is intentionally distinct from raw T301 progress. */
export interface PullRequestEffectiveProgress {
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly progress: number;
  readonly files: readonly PullRequestEffectiveFileProgress[];
}

/** Result of selecting one current PR Progress Tree file node. */
export type PullRequestProgressTreeSelectionResult =
  | {
    readonly kind: "opened-diff";
    readonly target: PullRequestProgressTreeDiffTarget;
  }
  | {
    readonly kind: "opened-file";
    readonly target: PullRequestProgressTreeDiffTarget;
  }
  | {
    readonly kind: "line-review-unavailable";
    readonly file: PullRequestDiffFileProgress;
    readonly reason: PullRequestLineReviewUnsupportedReason;
  };

/** One root node in the PR Progress Tree. */
export interface PullRequestProgressTreeCategoryNode {
  readonly kind: "category";
  readonly category: PullRequestProgressTreeCategory;
  readonly label: string;
  readonly fileCount: number;
}

/** One changed-file node in the PR Progress Tree. */
export interface PullRequestProgressTreeFileNode {
  readonly kind: "file";
  readonly category: PullRequestProgressTreeCategory;
  readonly path: string;
  readonly reviewedLineCount: number;
  readonly totalLineCount: number;
  readonly unreviewedLineCount: number;
  readonly progress: number;
  readonly additions: number;
  readonly deletions: number;
  readonly reason?: string;
  readonly reviewability: PullRequestLineReviewability;
  /** Raw authoritative T301 record before line-reviewability projection. */
  readonly source: PullRequestDiffFileProgress;
  /** Immutable target retained for reviewable nodes and diagnostic identity. */
  readonly openTarget: PullRequestProgressTreeDiffTarget;
}

export type PullRequestProgressTreeNode =
  | PullRequestProgressTreeCategoryNode
  | PullRequestProgressTreeFileNode;

/** Host boundary used only when a reviewable changed-file node opens a text diff. */
export interface PullRequestProgressTreeHost {
  openDiff(target: PullRequestProgressTreeDiffTarget): Promise<void>;
  openFile?(target: PullRequestProgressTreeDiffTarget): Promise<void>;
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

const ratio = (reviewed: number, total: number): number =>
  total === 0 ? 1 : reviewed / total;
const ratiosEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <=
  Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
const compareCodeUnits = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
};

const validateNonBlank = (value: string, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty.`);
  }
  return value;
};

const validateRepositoryPath = (
  value: string,
  semantics: FileSystemPathSemantics,
  label: string
): string => {
  try {
    return requireCanonicalRepositoryRelativePath(value, semantics, label);
  } catch (error) {
    throw new RangeError(
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
};

const validateCommitObjectId = (value: string, label: string): void => {
  if (!FULL_COMMIT_OBJECT_ID.test(value)) {
    throw new RangeError(`${label} must be a full lowercase commit object ID.`);
  }
};

const cloneExclusionReason = (
  reason: ReviewFileExclusionReason
): ReviewFileExclusionReason => {
  switch (reason.kind) {
    case "binary": return { kind: "binary" };
    case "default-glob": return { kind: "default-glob", pattern: reason.pattern };
    case "user-glob": return { kind: "user-glob", pattern: reason.pattern };
  }
};

const cloneRawFile = (
  file: PullRequestDiffFileProgress
): PullRequestDiffFileProgress => ({
  ...file,
  ...(file.exclusionReason === undefined
    ? {}
    : { exclusionReason: cloneExclusionReason(file.exclusionReason) })
});

const freezeRawFile = (
  file: PullRequestDiffFileProgress
): PullRequestDiffFileProgress => {
  const clone = cloneRawFile(file);
  if (clone.exclusionReason !== undefined) Object.freeze(clone.exclusionReason);
  return Object.freeze(clone);
};

const cloneUnsupportedReason = (
  reason: PullRequestLineReviewUnsupportedReason
): PullRequestLineReviewUnsupportedReason => reason.kind === "binary"
  ? { kind: "binary" }
  : { kind: reason.kind, encoding: reason.encoding };

const cloneReviewability = (
  reviewability: PullRequestLineReviewability
): PullRequestLineReviewability => reviewability.kind === "reviewable"
  ? { kind: "reviewable" }
  : {
    kind: "unsupported",
    reason: cloneUnsupportedReason(reviewability.reason)
  };

const freezeReviewability = (
  reviewability: PullRequestLineReviewability
): PullRequestLineReviewability => {
  const clone = cloneReviewability(reviewability);
  if (clone.kind === "unsupported") Object.freeze(clone.reason);
  return Object.freeze(clone);
};

const validateSnapshotIdentity = (
  identity: PullRequestProgressTreeSnapshotIdentity
): void => {
  validateNonBlank(identity.snapshotId, "PR progress snapshotId");
  validateNonBlank(identity.contextId, "PR progress contextId");
  validateCommitObjectId(identity.baseSha, "PR progress baseSha");
  validateCommitObjectId(identity.headSha, "PR progress headSha");
  const expectedDiffId = `${identity.baseSha}..${identity.headSha}`;
  if (identity.originalDiffId !== expectedDiffId) {
    throw new RangeError(
      `PR progress originalDiffId must equal ${expectedDiffId}.`
    );
  }
  if (
    identity.fileSystemPathSemantics !== "posix" &&
    identity.fileSystemPathSemantics !== "windows"
  ) {
    throw new RangeError(
      "PR progress filesystem semantics must be posix or windows."
    );
  }
};

const formatExclusionReason = (reason: ReviewFileExclusionReason): string => {
  switch (reason.kind) {
    case "binary": return "バイナリファイル";
    case "default-glob": return `既定除外: ${reason.pattern}`;
    case "user-glob": return `ユーザー除外: ${reason.pattern}`;
  }
};

const formatUnsupportedReason = (
  reason: PullRequestLineReviewUnsupportedReason
): string => {
  switch (reason.kind) {
    case "binary": return "バイナリファイル";
    case "invalid-encoding":
      return `不正な文字エンコーディング: ${reason.encoding}`;
    case "unsupported-encoding":
      return `未対応エンコーディング: ${reason.encoding}`;
  }
};

const validateFile = (
  file: PullRequestDiffFileProgress,
  semantics: FileSystemPathSemantics
): void => {
  validateNonBlank(file.fileId, "PR progress fileId");
  validateRepositoryPath(file.path, semantics, "PR progress path");
  if (file.oldPath !== undefined) {
    validateRepositoryPath(
      file.oldPath,
      semantics,
      `PR progress oldPath for ${file.fileId}`
    );
  }
  if (file.newPath !== undefined) {
    validateRepositoryPath(
      file.newPath,
      semantics,
      `PR progress newPath for ${file.fileId}`
    );
  }
  validateCount(file.additions, `PR progress additions for ${file.fileId}`);
  validateCount(file.deletions, `PR progress deletions for ${file.fileId}`);
  validateCount(
    file.reviewedLineCount,
    `PR progress reviewedLineCount for ${file.fileId}`
  );
  validateCount(
    file.totalLineCount,
    `PR progress totalLineCount for ${file.fileId}`
  );
  if (file.reviewedLineCount > file.totalLineCount) {
    throw new RangeError(
      `PR progress reviewedLineCount exceeds totalLineCount for ${file.fileId}.`
    );
  }
  if (!Number.isFinite(file.progress) || file.progress < 0 || file.progress > 1) {
    throw new RangeError(
      `PR progress ratio must be in 0..1 for ${file.fileId}.`
    );
  }
  if (!ratiosEqual(file.progress, ratio(
    file.reviewedLineCount,
    file.totalLineCount
  ))) {
    throw new RangeError(
      `PR progress ratio does not match counts for ${file.fileId}.`
    );
  }
  if (file.excluded !== (file.exclusionReason !== undefined)) {
    throw new RangeError(
      `PR progress exclusion reason mismatch for ${file.fileId}.`
    );
  }
};

const validateReviewability = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability | undefined
): PullRequestLineReviewability => {
  if (reviewability === undefined) {
    throw new RangeError(
      `PR progress line reviewability is missing for ${file.fileId}.`
    );
  }
  const binaryFile =
    file.status === "binary" || file.exclusionReason?.kind === "binary";
  switch ((reviewability as { readonly kind: unknown }).kind) {
    case "reviewable":
      if (binaryFile) {
        throw new RangeError(
          `Binary file must be line-review unsupported: ${file.fileId}.`
        );
      }
      return { kind: "reviewable" };
    case "unsupported": {
      const reason = (reviewability as {
        readonly reason?: PullRequestLineReviewUnsupportedReason;
      }).reason;
      if (reason === undefined) {
        throw new RangeError(
          `Line-review unsupported reason is missing for ${file.fileId}.`
        );
      }
      switch ((reason as { readonly kind: unknown }).kind) {
        case "binary":
          if (!binaryFile) {
            throw new RangeError(
              `Binary line-review reason does not match ${file.fileId}.`
            );
          }
          break;
        case "invalid-encoding":
        case "unsupported-encoding":
          if (binaryFile) {
            throw new RangeError(
              `Encoding line-review reason does not match binary file ${file.fileId}.`
            );
          }
          validateNonBlank(
            (reason as { readonly encoding: string }).encoding,
            `Line-review unsupported encoding for ${file.fileId}`
          );
          break;
        default:
          throw new RangeError(
            `Unknown line-review unsupported reason for ${file.fileId}.`
          );
      }
      return {
        kind: "unsupported",
        reason: cloneUnsupportedReason(reason)
      };
    }
    default:
      throw new RangeError(`Unknown line reviewability for ${file.fileId}.`);
  }
};

const categoryFor = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): PullRequestProgressTreeCategory => {
  if (reviewability.kind === "unsupported") {
    return "line-review-unsupported";
  }
  if (file.excluded) return "excluded";
  if (file.totalLineCount === 0) return "non-line-change";
  if (file.reviewedLineCount < file.totalLineCount) return "unreviewed";
  return "completed";
};

const reasonFor = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): string | undefined => reviewability.kind === "unsupported"
  ? formatUnsupportedReason(reviewability.reason)
  : file.exclusionReason === undefined
    ? undefined
    : formatExclusionReason(file.exclusionReason);

const defineEffectiveFile = (
  rawFile: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability
): PullRequestEffectiveFileProgress => {
  const raw = Object.freeze(cloneRawFile(rawFile));
  if (raw.exclusionReason !== undefined) Object.freeze(raw.exclusionReason);
  const detachedReviewability = freezeReviewability(reviewability);
  const category = categoryFor(raw, detachedReviewability);
  const effectiveReason = reasonFor(raw, detachedReviewability);
  const unsupported = detachedReviewability.kind === "unsupported";
  return Object.freeze({
    raw,
    reviewability: detachedReviewability,
    category,
    ...(effectiveReason === undefined ? {} : { effectiveReason }),
    reviewedLineCount: unsupported ? 0 : raw.reviewedLineCount,
    totalLineCount: unsupported ? 0 : raw.totalLineCount,
    progress: unsupported ? 1 : raw.progress
  });
};

const cloneEffectiveFile = (
  file: PullRequestEffectiveFileProgress
): PullRequestEffectiveFileProgress => defineEffectiveFile(
  file.raw,
  file.reviewability
);

const side = (
  kind: "present" | "absent",
  filePath: string,
  revision: string
): PullRequestProgressTreeDiffSide => ({ kind, filePath, revision });

const cloneDiffSide = (
  value: PullRequestProgressTreeDiffSide
): PullRequestProgressTreeDiffSide => ({ ...value });

const freezeDiffSide = (
  value: PullRequestProgressTreeDiffSide
): PullRequestProgressTreeDiffSide => Object.freeze(cloneDiffSide(value));

const cloneOpenTarget = (
  target: PullRequestProgressTreeDiffTarget
): PullRequestProgressTreeDiffTarget => ({
  ...target,
  file: cloneRawFile(target.file),
  original: cloneDiffSide(target.original),
  modified: cloneDiffSide(target.modified)
});

const freezeOpenTarget = (
  target: PullRequestProgressTreeDiffTarget
): PullRequestProgressTreeDiffTarget => {
  const clone = cloneOpenTarget(target);
  return Object.freeze({
    ...clone,
    file: freezeRawFile(clone.file),
    original: freezeDiffSide(clone.original),
    modified: freezeDiffSide(clone.modified)
  });
};

const createOpenTarget = (
  identity: PullRequestProgressTreeSnapshotIdentity,
  file: PullRequestDiffFileProgress
): PullRequestProgressTreeDiffTarget => {
  const originalPath = file.oldPath ?? file.newPath ?? file.path;
  const modifiedPath = file.newPath ?? file.oldPath ?? file.path;
  return freezeOpenTarget({
    snapshotId: identity.snapshotId,
    contextId: identity.contextId,
    baseSha: identity.baseSha,
    headSha: identity.headSha,
    originalDiffId: identity.originalDiffId,
    fileSystemPathSemantics: identity.fileSystemPathSemantics,
    file: cloneRawFile(file),
    original: side(
      file.oldPath === undefined ? "absent" : "present",
      originalPath,
      identity.baseSha
    ),
    modified: side(
      file.newPath === undefined ? "absent" : "present",
      modifiedPath,
      identity.headSha
    )
  });
};

const toFileNode = (
  identity: PullRequestProgressTreeSnapshotIdentity,
  effectiveFile: PullRequestEffectiveFileProgress
): PullRequestProgressTreeFileNode => {
  const rawFile = effectiveFile.raw;
  const reason = effectiveFile.effectiveReason;
  return Object.freeze({
    kind: "file",
    category: effectiveFile.category,
    path: rawFile.path,
    reviewedLineCount: effectiveFile.reviewedLineCount,
    totalLineCount: effectiveFile.totalLineCount,
    unreviewedLineCount:
      effectiveFile.totalLineCount - effectiveFile.reviewedLineCount,
    progress: effectiveFile.progress,
    additions: rawFile.additions,
    deletions: rawFile.deletions,
    ...(reason === undefined ? {} : { reason }),
    reviewability: freezeReviewability(effectiveFile.reviewability),
    source: freezeRawFile(rawFile),
    openTarget: createOpenTarget(identity, rawFile)
  });
};

const compareFileNodes = (
  left: PullRequestProgressTreeFileNode,
  right: PullRequestProgressTreeFileNode
): number =>
  right.unreviewedLineCount - left.unreviewedLineCount ||
  compareCodeUnits(left.path, right.path);

const EMPTY_EFFECTIVE_PROGRESS: PullRequestEffectiveProgress = Object.freeze({
  reviewedLineCount: 0,
  totalLineCount: 0,
  progress: 1,
  files: Object.freeze([])
});

/** Stores one exact identity-bound PR progress snapshot as five deterministic categories. */
export class PullRequestProgressTreeDataProvider {
  private readonly filesByCategory = new Map<
    PullRequestProgressTreeCategory,
    readonly PullRequestProgressTreeFileNode[]
  >();
  private currentFileNodes = new Set<PullRequestProgressTreeFileNode>();
  private effectiveProgress: PullRequestEffectiveProgress =
    EMPTY_EFFECTIVE_PROGRESS;

  public constructor(private readonly host: PullRequestProgressTreeHost) {
    this.clear();
  }

  /**
   * Validates one raw T301 result and projects line-review unsupported files out
   * of the T304 effective denominator without mutating or retyping the raw result.
   */
  public replaceSnapshot(snapshot: PullRequestProgressTreeSnapshot): void {
    validateSnapshotIdentity(snapshot);
    const { progress } = snapshot;
    validateCount(progress.reviewedLineCount, "PR aggregate reviewedLineCount");
    validateCount(progress.totalLineCount, "PR aggregate totalLineCount");
    if (progress.reviewedLineCount > progress.totalLineCount) {
      throw new RangeError(
        "PR aggregate reviewedLineCount exceeds totalLineCount."
      );
    }
    if (
      !Number.isFinite(progress.progress) ||
      progress.progress < 0 ||
      progress.progress > 1
    ) {
      throw new RangeError("PR aggregate progress must be in 0..1.");
    }

    const rawReviewability = snapshot.lineReviewabilityByFileId as unknown;
    if (
      typeof rawReviewability !== "object" ||
      rawReviewability === null ||
      Array.isArray(rawReviewability)
    ) {
      throw new RangeError(
        "PR progress line reviewability must be a file-ID record."
      );
    }
    const reviewabilityByFileId = rawReviewability as Readonly<
      Record<string, PullRequestLineReviewability | undefined>
    >;
    const seenFileIds = new Set<string>();
    const seenPaths = new Set<string>();
    const next = new Map<
      PullRequestProgressTreeCategory,
      PullRequestProgressTreeFileNode[]
    >();
    const nextCurrentFileNodes = new Set<PullRequestProgressTreeFileNode>();
    const effectiveFiles: PullRequestEffectiveFileProgress[] = [];
    for (const { category } of CATEGORY_DEFINITIONS) next.set(category, []);

    let rawReviewed = 0;
    let rawTotal = 0;
    let effectiveReviewed = 0;
    let effectiveTotal = 0;
    for (const rawFile of progress.files) {
      validateFile(rawFile, snapshot.fileSystemPathSemantics);
      if (seenFileIds.has(rawFile.fileId)) {
        throw new RangeError(
          `Duplicate PR progress fileId: ${rawFile.fileId}`
        );
      }
      if (seenPaths.has(rawFile.path)) {
        throw new RangeError(`Duplicate PR progress path: ${rawFile.path}`);
      }
      if (!Object.prototype.hasOwnProperty.call(
        reviewabilityByFileId,
        rawFile.fileId
      )) {
        throw new RangeError(
          `PR progress line reviewability is missing for ${rawFile.fileId}.`
        );
      }
      seenFileIds.add(rawFile.fileId);
      seenPaths.add(rawFile.path);
      rawReviewed += rawFile.reviewedLineCount;
      rawTotal += rawFile.totalLineCount;

      const reviewability = validateReviewability(
        rawFile,
        reviewabilityByFileId[rawFile.fileId]
      );
      const effectiveFile = defineEffectiveFile(rawFile, reviewability);
      effectiveFiles.push(effectiveFile);
      effectiveReviewed += effectiveFile.reviewedLineCount;
      effectiveTotal += effectiveFile.totalLineCount;
      const node = toFileNode(snapshot, effectiveFile);
      next.get(node.category)!.push(node);
      nextCurrentFileNodes.add(node);
    }

    for (const fileId of Object.keys(reviewabilityByFileId)) {
      if (!seenFileIds.has(fileId)) {
        throw new RangeError(
          `PR progress line reviewability references unknown file ${fileId}.`
        );
      }
    }
    if (
      rawReviewed !== progress.reviewedLineCount ||
      rawTotal !== progress.totalLineCount
    ) {
      throw new RangeError(
        "PR aggregate counts do not match file progress records."
      );
    }
    if (!ratiosEqual(progress.progress, ratio(rawReviewed, rawTotal))) {
      throw new RangeError(
        "PR aggregate progress does not match aggregate counts."
      );
    }

    for (const { category } of CATEGORY_DEFINITIONS) {
      this.filesByCategory.set(
        category,
        Object.freeze([...next.get(category)!].sort(compareFileNodes))
      );
    }
    this.currentFileNodes = nextCurrentFileNodes;
    this.effectiveProgress = Object.freeze({
      reviewedLineCount: effectiveReviewed,
      totalLineCount: effectiveTotal,
      progress: ratio(effectiveReviewed, effectiveTotal),
      files: Object.freeze(effectiveFiles)
    });
  }

  /** Returns a detached T304 effective projection, never a raw T301 result. */
  public getEffectiveProgress(): PullRequestEffectiveProgress {
    return {
      reviewedLineCount: this.effectiveProgress.reviewedLineCount,
      totalLineCount: this.effectiveProgress.totalLineCount,
      progress: this.effectiveProgress.progress,
      files: this.effectiveProgress.files.map(cloneEffectiveFile)
    };
  }

  /** Removes all file children and invalidates every previously returned file node. */
  public clear(): void {
    for (const { category } of CATEGORY_DEFINITIONS) {
      this.filesByCategory.set(category, Object.freeze([]));
    }
    this.currentFileNodes = new Set<PullRequestProgressTreeFileNode>();
    this.effectiveProgress = EMPTY_EFFECTIVE_PROGRESS;
  }

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
   * Opens every current file node. Reviewable nodes use the canonical text diff;
   * line-review-unsupported nodes use the non-review file host.
   */
  public async select(
    node: PullRequestProgressTreeFileNode
  ): Promise<PullRequestProgressTreeSelectionResult> {
    if (!this.currentFileNodes.has(node)) {
      throw new RangeError(
        "Selected PR progress node is stale and does not belong to the current snapshot."
      );
    }
    if (node.reviewability.kind === "unsupported") {
      if (this.host.openFile === undefined) {
        throw new Error("PR progress file-open host is unavailable for a line-review-unsupported file.");
      }
      await this.host.openFile(freezeOpenTarget(node.openTarget));
      return Object.freeze({
        kind: "opened-file",
        target: freezeOpenTarget(node.openTarget)
      });
    }
    await this.host.openDiff(freezeOpenTarget(node.openTarget));
    return Object.freeze({
      kind: "opened-diff",
      target: freezeOpenTarget(node.openTarget)
    });
  }
}
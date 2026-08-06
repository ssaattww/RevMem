import type { FileReviewState, LineInterval } from "../../core/contracts/index";
import {
  mapReviewedIntervalsAcrossDiff,
  type GitDiffMappingOptions
} from "../../core/git-diff/index";
import { normalizeLineIntervals } from "../../core/intervals/index";

/** Current repository evidence available after a rebase or force-push. */
export interface HistoryRewriteCurrentFile {
  /** Candidate identity in the current repository enumeration. */
  readonly fileId: string;
  /** Canonical repository-relative path. */
  readonly path: string;
  /** VS Code line count for the current file. */
  readonly lineCount: number;
  /** Exact current content hash, when available. */
  readonly contentHash?: string;
  /** Complete current text, when available for diff evidence validation. */
  readonly content?: string;
}

/** Request for old-object evidence between the persisted and current revisions. */
export interface HistoryRewriteGitObjectRequest {
  readonly oldRevisionId: string;
  readonly newRevisionId: string;
  readonly oldPath: string;
}

/** Ordered first-stage result returned by the Local Git boundary. */
export type HistoryRewriteGitObjectResult =
  | {
      readonly kind: "unchanged";
      readonly newPath: string;
    }
  | {
      readonly kind: "diff";
      readonly oldPath: string;
      readonly newPath: string;
      readonly diff: string;
      readonly oldText?: string;
      readonly newText?: string;
    }
  | {
      readonly kind: "missing-old-revision";
    }
  | {
      readonly kind: "failure";
      readonly reason: string;
    };

/** Local Git port. Only `missing-old-revision` permits snapshot fallback. */
export interface HistoryRewriteGitObjectPort {
  diff(request: HistoryRewriteGitObjectRequest): Promise<HistoryRewriteGitObjectResult>;
}

/** Conservative mapping result from one saved snapshot to one current candidate. */
export type HistoryRewriteSnapshotResult =
  | {
      readonly kind: "mapped";
      readonly reviewedRanges: readonly LineInterval[];
    }
  | {
      readonly kind: "missing" | "corrupt" | "expired" | "ambiguous";
    };

/** Snapshot port implemented by the T601 snapshot tracker boundary. */
export interface HistoryRewriteSnapshotPort {
  map(
    snapshotId: string,
    currentFile: HistoryRewriteCurrentFile,
    now: number
  ): Promise<HistoryRewriteSnapshotResult>;
}

/** Complete input for recovering one persisted file after history rewriting. */
export interface HistoryRewriteRecoveryInput {
  readonly file: Readonly<FileReviewState>;
  readonly newRevisionId: string;
  readonly updatedAt: string;
  readonly currentFiles: readonly HistoryRewriteCurrentFile[];
  readonly snapshotId?: string;
  readonly now: number;
  readonly options: Readonly<GitDiffMappingOptions>;
}

export type HistoryRewriteRecoverySource =
  | "git-object-diff"
  | "snapshot-diff"
  | "unique-content";

export type HistoryRewriteUnresolvedReason =
  | "git-failure"
  | "invalid-git-diff"
  | "ambiguous-file-mapping"
  | "missing-evidence"
  | "snapshot-failure";

/** Recovery preserves review state only when one ordered evidence source proves it. */
export type HistoryRewriteRecoveryResult =
  | {
      readonly status: "recovered";
      readonly source: HistoryRewriteRecoverySource;
      readonly file: FileReviewState;
    }
  | {
      readonly status: "unresolved";
      readonly source: "unreviewed";
      readonly reason: HistoryRewriteUnresolvedReason;
      readonly reviewedRanges: readonly [];
    };

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Applies the T602 evidence order for one file:
 * old Git object diff, saved snapshot diff, unique exact-content mapping, then unreviewed.
 */
export class HistoryRewriteRecoveryService {
  public constructor(
    private readonly gitObjects: HistoryRewriteGitObjectPort,
    private readonly snapshots: HistoryRewriteSnapshotPort
  ) {}

  public async recover(
    input: Readonly<HistoryRewriteRecoveryInput>
  ): Promise<HistoryRewriteRecoveryResult> {
    validateInput(input);

    let gitResult: HistoryRewriteGitObjectResult;
    try {
      gitResult = await this.gitObjects.diff({
        oldRevisionId: input.file.revisionId,
        newRevisionId: input.newRevisionId,
        oldPath: input.file.currentPath
      });
    } catch {
      return unresolved("git-failure");
    }

    if (gitResult.kind === "failure") {
      return unresolved("git-failure");
    }
    if (gitResult.kind === "unchanged") {
      return recoverUnchanged(input, gitResult.newPath);
    }
    if (gitResult.kind === "diff") {
      return recoverFromGitDiff(input, gitResult);
    }

    return this.recoverWithoutOldObject(input);
  }

  private async recoverWithoutOldObject(
    input: Readonly<HistoryRewriteRecoveryInput>
  ): Promise<HistoryRewriteRecoveryResult> {
    const samePath = input.currentFiles.filter(
      (candidate) => candidate.path === input.file.currentPath
    );
    if (samePath.length > 1) {
      return unresolved("ambiguous-file-mapping");
    }

    if (samePath.length === 1 && input.snapshotId !== undefined) {
      const result = await this.mapSnapshot(input, samePath[0] as HistoryRewriteCurrentFile);
      if (result.status === "recovered") {
        return result;
      }
      if (result.reason === "snapshot-failure") {
        return result;
      }
    }

    if (samePath.length === 0 && input.snapshotId !== undefined) {
      const surviving: Array<{
        readonly current: HistoryRewriteCurrentFile;
        readonly reviewedRanges: readonly LineInterval[];
      }> = [];
      for (const candidate of input.currentFiles) {
        let mapped: HistoryRewriteSnapshotResult;
        try {
          mapped = await this.snapshots.map(input.snapshotId, candidate, input.now);
        } catch {
          return unresolved("snapshot-failure");
        }
        if (mapped.kind === "mapped" && mapped.reviewedRanges.length > 0) {
          if (!rangesFit(mapped.reviewedRanges, candidate.lineCount)) {
            return unresolved("snapshot-failure");
          }
          surviving.push({ current: candidate, reviewedRanges: mapped.reviewedRanges });
        }
      }
      if (surviving.length === 1) {
        const evidence = surviving[0];
        if (evidence === undefined) {
          return unresolved("missing-evidence");
        }
        return recovered(
          "snapshot-diff",
          input,
          evidence.current,
          evidence.reviewedRanges
        );
      }
      if (surviving.length > 1) {
        return unresolved("ambiguous-file-mapping");
      }
    }

    const exactContent = uniqueExactContentCandidate(input);
    if (exactContent.kind === "ambiguous") {
      return unresolved("ambiguous-file-mapping");
    }
    if (exactContent.kind === "unique") {
      return recovered(
        "unique-content",
        input,
        exactContent.current,
        input.file.modifiedReviewed
      );
    }
    return unresolved("missing-evidence");
  }

  private async mapSnapshot(
    input: Readonly<HistoryRewriteRecoveryInput>,
    currentFile: HistoryRewriteCurrentFile
  ): Promise<HistoryRewriteRecoveryResult> {
    if (input.snapshotId === undefined) {
      return unresolved("missing-evidence");
    }
    let mapped: HistoryRewriteSnapshotResult;
    try {
      mapped = await this.snapshots.map(input.snapshotId, currentFile, input.now);
    } catch {
      return unresolved("snapshot-failure");
    }
    if (mapped.kind !== "mapped") {
      return unresolved("missing-evidence");
    }
    if (!rangesFit(mapped.reviewedRanges, currentFile.lineCount)) {
      return unresolved("snapshot-failure");
    }
    return recovered("snapshot-diff", input, currentFile, mapped.reviewedRanges);
  }
}

function recoverUnchanged(
  input: Readonly<HistoryRewriteRecoveryInput>,
  newPath: string
): HistoryRewriteRecoveryResult {
  const target = uniquePathCandidate(input.currentFiles, newPath);
  if (target.kind === "ambiguous") {
    return unresolved("ambiguous-file-mapping");
  }
  if (target.kind === "missing") {
    return unresolved("missing-evidence");
  }
  if (
    target.current.lineCount !== input.file.lineCount ||
    (
      input.file.contentHash !== undefined &&
      target.current.contentHash !== undefined &&
      input.file.contentHash !== target.current.contentHash
    )
  ) {
    return unresolved("invalid-git-diff");
  }
  return recovered(
    "git-object-diff",
    input,
    target.current,
    input.file.modifiedReviewed
  );
}

function recoverFromGitDiff(
  input: Readonly<HistoryRewriteRecoveryInput>,
  evidence: Extract<HistoryRewriteGitObjectResult, { readonly kind: "diff" }>
): HistoryRewriteRecoveryResult {
  if (
    evidence.oldPath !== input.file.currentPath ||
    (
      evidence.newText !== undefined &&
      uniquePathCandidate(input.currentFiles, evidence.newPath).kind === "unique" &&
      input.currentFiles.find((candidate) => candidate.path === evidence.newPath)?.content !== undefined &&
      input.currentFiles.find((candidate) => candidate.path === evidence.newPath)?.content !== evidence.newText
    )
  ) {
    return unresolved("invalid-git-diff");
  }
  const target = uniquePathCandidate(input.currentFiles, evidence.newPath);
  if (target.kind === "ambiguous") {
    return unresolved("ambiguous-file-mapping");
  }
  if (target.kind === "missing") {
    return unresolved("missing-evidence");
  }

  try {
    const mapped = mapReviewedIntervalsAcrossDiff({
      reviewed: input.file.modifiedReviewed,
      diff: evidence.diff,
      oldPath: evidence.oldPath,
      newPath: evidence.newPath,
      ...(evidence.oldText === undefined ? {} : { oldText: evidence.oldText }),
      ...(evidence.newText === undefined ? {} : { newText: evidence.newText }),
      options: input.options
    });
    if (!rangesFit(mapped.reviewed, target.current.lineCount)) {
      return unresolved("invalid-git-diff");
    }
    return recovered(
      "git-object-diff",
      input,
      target.current,
      mapped.reviewed
    );
  } catch {
    return unresolved("invalid-git-diff");
  }
}

function recovered(
  source: HistoryRewriteRecoverySource,
  input: Readonly<HistoryRewriteRecoveryInput>,
  current: HistoryRewriteCurrentFile,
  reviewedRanges: readonly LineInterval[]
): HistoryRewriteRecoveryResult {
  const previousPaths = input.file.currentPath === current.path
    ? input.file.previousPaths.filter((path) => path !== current.path)
    : [
        ...input.file.previousPaths.filter(
          (path) => path !== input.file.currentPath && path !== current.path
        ),
        input.file.currentPath
      ];
  return {
    status: "recovered",
    source,
    file: {
      ...input.file,
      currentPath: current.path,
      previousPaths,
      revisionId: input.newRevisionId,
      modifiedReviewed: normalizeLineIntervals(reviewedRanges),
      originalReviewedByDiff: Object.fromEntries(
        Object.entries(input.file.originalReviewedByDiff).map(([key, ranges]) => [
          key,
          ranges.map((range) => ({ ...range }))
        ])
      ),
      contentHash: current.contentHash,
      lineCount: current.lineCount,
      updatedAt: input.updatedAt
    }
  };
}

function uniqueExactContentCandidate(
  input: Readonly<HistoryRewriteRecoveryInput>
):
  | { readonly kind: "unique"; readonly current: HistoryRewriteCurrentFile }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "missing" } {
  if (input.file.contentHash === undefined || input.file.contentHash.length === 0) {
    return { kind: "missing" };
  }
  const candidates = input.currentFiles.filter(
    (candidate) =>
      candidate.contentHash === input.file.contentHash &&
      candidate.lineCount === input.file.lineCount
  );
  if (candidates.length > 1) {
    return { kind: "ambiguous" };
  }
  const current = candidates[0];
  return current === undefined
    ? { kind: "missing" }
    : { kind: "unique", current };
}

function uniquePathCandidate(
  currentFiles: readonly HistoryRewriteCurrentFile[],
  path: string
):
  | { readonly kind: "unique"; readonly current: HistoryRewriteCurrentFile }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "missing" } {
  const candidates = currentFiles.filter((candidate) => candidate.path === path);
  if (candidates.length > 1) {
    return { kind: "ambiguous" };
  }
  const current = candidates[0];
  return current === undefined
    ? { kind: "missing" }
    : { kind: "unique", current };
}

function unresolved(
  reason: HistoryRewriteUnresolvedReason
): HistoryRewriteRecoveryResult {
  return {
    status: "unresolved",
    source: "unreviewed",
    reason,
    reviewedRanges: []
  };
}

function rangesFit(
  ranges: readonly LineInterval[],
  lineCount: number
): boolean {
  try {
    return normalizeLineIntervals(ranges).every(
      (range) => range.startLine >= 0 && range.endLineExclusive <= lineCount
    );
  } catch {
    return false;
  }
}

function validateInput(input: Readonly<HistoryRewriteRecoveryInput>): void {
  if (!FULL_OBJECT_ID.test(input.file.revisionId) || !FULL_OBJECT_ID.test(input.newRevisionId)) {
    throw new TypeError("History rewrite revisions must be lowercase full SHA-1 or SHA-256 object IDs.");
  }
  if (input.file.currentPath.length === 0) {
    throw new TypeError("Persisted file path must not be empty.");
  }
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new TypeError("now must be a non-negative safe integer.");
  }
  if (Number.isNaN(Date.parse(input.updatedAt))) {
    throw new TypeError("updatedAt must be an ISO-compatible timestamp.");
  }
  const seenPaths = new Set<string>();
  for (const current of input.currentFiles) {
    if (current.fileId.length === 0 || current.path.length === 0) {
      throw new TypeError("Current file identity and path must not be empty.");
    }
    if (!Number.isSafeInteger(current.lineCount) || current.lineCount < 0) {
      throw new TypeError("Current file lineCount must be a non-negative safe integer.");
    }
    if (seenPaths.has(current.path)) {
      continue;
    }
    seenPaths.add(current.path);
  }
  if (!rangesFit(input.file.modifiedReviewed, input.file.lineCount)) {
    throw new RangeError("Persisted reviewed ranges must fit the persisted lineCount.");
  }
}

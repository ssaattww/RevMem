import type {
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import {
  normalizeLineIntervals,
  subtractLineIntervals
} from "../../core/intervals/index";
import type { ReviewStateFileTarget } from "../../core/review-state/index";

/** State layer that proves one normal-editor range is reviewed. */
export type NormalEditorDecorationSource = "context" | "global";

/** One certainly reviewed normal-editor range and its hover metadata. */
export interface NormalEditorReviewedDecoration {
  /** Zero-based half-open line interval rendered as a whole-line decoration. */
  readonly interval: LineInterval;
  /** State layer that supplied this non-overlapping visual range. */
  readonly source: NormalEditorDecorationSource;
  /** User-facing current context label rendered in hover text. */
  readonly contextLabel: string;
  /** ISO 8601 update timestamp rendered as the available reviewed-at evidence. */
  readonly reviewedAt: string;
  /** Whether the same range is currently valid in the enabled Global layer. */
  readonly globalActive: boolean;
}

/** Current mapped state required to calculate normal-editor decorations. */
export interface NormalEditorDecorationModelInput {
  readonly contextState: Readonly<ReviewContextState>;
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly target: Readonly<ReviewStateFileTarget>;
  readonly showGlobalReviewed: boolean;
}

const contextRevision = (contextState: Readonly<ReviewContextState>): string | undefined =>
  contextState.kind === "pull-request"
    ? contextState.pullRequest?.headSha
    : contextState.kind === "branch"
      ? contextState.branch?.headRevision
      : contextState.workspace?.snapshotRevision;

const contextLabel = (contextState: Readonly<ReviewContextState>): string => {
  if (contextState.kind === "pull-request" && contextState.pullRequest !== undefined) {
    const title = contextState.pullRequest.title?.trim();
    return title === undefined || title.length === 0
      ? `PR #${contextState.pullRequest.number}`
      : `PR #${contextState.pullRequest.number}: ${title}`;
  }

  if (contextState.kind === "branch" && contextState.branch !== undefined) {
    return contextState.branch.refName;
  }

  const displayName = contextState.displayName.trim();
  return displayName.length === 0 ? "Workspace review" : displayName;
};

const hasCertainContentHash = (
  persistedHash: string | undefined,
  targetHash: string | undefined
): boolean => targetHash === undefined || persistedHash === targetHash;

const certainIntervals = (
  intervals: readonly LineInterval[],
  lineCount: number
): LineInterval[] | undefined => {
  for (const interval of intervals) {
    if (
      !Number.isSafeInteger(interval.startLine) ||
      !Number.isSafeInteger(interval.endLineExclusive) ||
      interval.startLine < 0 ||
      interval.endLineExclusive <= interval.startLine ||
      interval.endLineExclusive > lineCount
    ) {
      return undefined;
    }
  }

  return normalizeLineIntervals(intervals);
};

const validGlobalFile = (
  input: NormalEditorDecorationModelInput
): { readonly file: GlobalFileReviewState; readonly intervals: LineInterval[] } | undefined => {
  if (
    input.globalState.repositoryId !== input.contextState.repositoryId ||
    input.globalState.currentRevisionId !== input.target.revisionId
  ) {
    return undefined;
  }

  const file = input.globalState.files[input.target.fileId];
  if (
    file === undefined ||
    file.fileId !== input.target.fileId ||
    file.currentPath !== input.target.currentPath ||
    file.revisionId !== input.target.revisionId ||
    !hasCertainContentHash(file.contentHash, input.target.contentHash)
  ) {
    return undefined;
  }

  const intervals = certainIntervals(file.reviewed, input.target.lineCount);
  return intervals === undefined ? undefined : { file, intervals };
};

const intervalIsCovered = (
  interval: Readonly<LineInterval>,
  coveringIntervals: readonly LineInterval[]
): boolean => coveringIntervals.some(
  (candidate) =>
    candidate.startLine <= interval.startLine &&
    candidate.endLineExclusive >= interval.endLineExclusive
);

/**
 * Builds non-overlapping reviewed decorations for one current normal-editor file.
 *
 * The current context has visual priority. Global contributes only the remaining
 * ranges when enabled. Any revision, path, line-count, or available hash mismatch
 * removes that uncertain layer instead of risking a false reviewed indication.
 */
export function createNormalEditorDecorationModel(
  input: NormalEditorDecorationModelInput
): readonly NormalEditorReviewedDecoration[] {
  const global = validGlobalFile(input);
  const contextFile = input.contextState.files[input.target.fileId];
  const contextIsCertain =
    input.contextState.repositoryId === input.globalState.repositoryId &&
    contextRevision(input.contextState) === input.target.revisionId &&
    contextFile !== undefined &&
    contextFile.fileId === input.target.fileId &&
    contextFile.currentPath === input.target.currentPath &&
    contextFile.revisionId === input.target.revisionId &&
    contextFile.lineCount === input.target.lineCount &&
    hasCertainContentHash(contextFile.contentHash, input.target.contentHash);
  const contextIntervals = contextIsCertain
    ? certainIntervals(contextFile.modifiedReviewed, input.target.lineCount)
    : undefined;
  const visibleGlobalIntervals = input.showGlobalReviewed
    ? global?.intervals ?? []
    : [];
  const decorations: NormalEditorReviewedDecoration[] = [];

  if (contextIntervals !== undefined && contextFile !== undefined) {
    for (const interval of contextIntervals) {
      decorations.push({
        interval: { ...interval },
        source: "context",
        contextLabel: contextLabel(input.contextState),
        reviewedAt: contextFile.updatedAt,
        globalActive:
          input.showGlobalReviewed &&
          intervalIsCovered(interval, global?.intervals ?? [])
      });
    }
  }

  if (global !== undefined && visibleGlobalIntervals.length > 0) {
    const globalOnly = subtractLineIntervals(
      visibleGlobalIntervals,
      contextIntervals ?? []
    );
    for (const interval of globalOnly) {
      decorations.push({
        interval: { ...interval },
        source: "global",
        contextLabel: "Global",
        reviewedAt: global.file.updatedAt,
        globalActive: true
      });
    }
  }

  return decorations.sort(
    (left, right) =>
      left.interval.startLine - right.interval.startLine ||
      left.interval.endLineExclusive - right.interval.endLineExclusive ||
      (left.source === "context" ? -1 : 1)
  );
}

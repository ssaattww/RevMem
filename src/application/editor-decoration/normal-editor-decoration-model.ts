import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import { ReviewFileExclusionPolicy } from "../../core/file-exclusion/index";
import {
  normalizeLineIntervals,
  subtractLineIntervals
} from "../../core/intervals/index";
import {
  calculatePullRequestDiffProgress,
  type PullRequestDiffSnapshot
} from "../../core/pr-progress/index";
import type { ReviewStateFileTarget } from "../../core/review-state/index";

export type NormalEditorDecorationSource = "context" | "other-context" | "global";

export interface NormalEditorReviewedDecoration {
  readonly interval: LineInterval;
  readonly source: NormalEditorDecorationSource;
  readonly contextLabel: string;
  readonly reviewedAt: string;
  readonly globalActive: boolean;
}

export interface NormalEditorDecorationModelInput {
  readonly contextState: Readonly<ReviewContextState>;
  readonly otherContextStates?: readonly Readonly<ReviewContextState>[];
  readonly currentPullRequestDiff?: Readonly<PullRequestDiffSnapshot>;
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly target: Readonly<ReviewStateFileTarget>;
  readonly showGlobalReviewed: boolean;
}

const DIFF_VALIDATION_POLICY = new ReviewFileExclusionPolicy({ userGlobs: [] });

const contextRevision = (contextState: Readonly<ReviewContextState>): string | undefined =>
  contextState.kind === "pull-request"
    ? contextState.pullRequest?.headSha
    : contextState.kind === "branch"
      ? contextState.branch?.headRevision
      : contextState.kind === "workspace"
        ? contextState.workspace?.snapshotRevision
        : contextState.externalFile?.snapshotRevision;

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

const validContextFile = (
  contextState: Readonly<ReviewContextState>,
  target: Readonly<ReviewStateFileTarget>
): { readonly file: Readonly<FileReviewState>; readonly intervals: LineInterval[] } | undefined => {
  const file = contextState.files[target.fileId];
  if (
    contextRevision(contextState) !== target.revisionId ||
    file === undefined ||
    file.fileId !== target.fileId ||
    file.currentPath !== target.currentPath ||
    file.revisionId !== target.revisionId ||
    file.lineCount !== target.lineCount ||
    !hasCertainContentHash(file.contentHash, target.contentHash)
  ) {
    return undefined;
  }
  const intervals = certainIntervals(file.modifiedReviewed, target.lineCount);
  return intervals === undefined ? undefined : { file, intervals };
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

const intersectLineIntervals = (
  leftIntervals: readonly LineInterval[],
  rightIntervals: readonly LineInterval[]
): LineInterval[] => {
  const left = normalizeLineIntervals(leftIntervals);
  const right = normalizeLineIntervals(rightIntervals);
  const intersections: LineInterval[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex]!;
    const rightInterval = right[rightIndex]!;
    const startLine = Math.max(leftInterval.startLine, rightInterval.startLine);
    const endLineExclusive = Math.min(leftInterval.endLineExclusive, rightInterval.endLineExclusive);
    if (startLine < endLineExclusive) {
      intersections.push({ startLine, endLineExclusive });
    }
    if (leftInterval.endLineExclusive <= rightInterval.endLineExclusive) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return intersections;
};

interface CurrentPullRequestChangeEvidence {
  readonly certain: boolean;
  readonly intervals: LineInterval[];
}

const currentPullRequestChangedIntervals = (
  input: NormalEditorDecorationModelInput
): CurrentPullRequestChangeEvidence => {
  const context = input.contextState;
  if (context.kind !== "pull-request") {
    return { certain: true, intervals: [] };
  }
  const diff = input.currentPullRequestDiff;
  if (
    context.pullRequest === undefined ||
    diff === undefined ||
    diff.contextId !== context.contextId ||
    diff.baseSha !== context.pullRequest.baseSha ||
    diff.headSha !== context.pullRequest.headSha
  ) {
    return { certain: false, intervals: [] };
  }

  try {
    calculatePullRequestDiffProgress({
      diff,
      reviewContext: context,
      exclusionPolicy: DIFF_VALIDATION_POLICY
    });
  } catch {
    return { certain: false, intervals: [] };
  }

  const file = diff.files.find((candidate) => candidate.fileId === input.target.fileId);
  if (file === undefined) {
    if (diff.files.some((candidate) => candidate.newPath === input.target.currentPath)) {
      return { certain: false, intervals: [] };
    }
    return { certain: true, intervals: [] };
  }
  if (file.newPath !== input.target.currentPath) {
    return { certain: false, intervals: [] };
  }
  return {
    certain: true,
    intervals: normalizeLineIntervals(
      file.hunks.flatMap((hunk) =>
        hunk.lines.flatMap((line) =>
          line.kind === "addition" && line.newLine !== undefined
            ? [{ startLine: line.newLine - 1, endLineExclusive: line.newLine }]
            : []
        )
      )
    )
  };
};

const appendDecorationRanges = (
  decorations: NormalEditorReviewedDecoration[],
  intervals: readonly LineInterval[],
  source: NormalEditorDecorationSource,
  label: string,
  reviewedAt: string,
  globalActive: boolean
): void => {
  for (const interval of intervals) {
    decorations.push({
      interval: { ...interval },
      source,
      contextLabel: label,
      reviewedAt,
      globalActive
    });
  }
};

export function createNormalEditorDecorationModel(
  input: NormalEditorDecorationModelInput
): readonly NormalEditorReviewedDecoration[] {
  const current = validContextFile(input.contextState, input.target);
  const global = validGlobalFile(input);
  const visibleGlobalIntervals = input.showGlobalReviewed ? global?.intervals ?? [] : [];
  const changeEvidence = currentPullRequestChangedIntervals(input);
  const currentReviewedChanges = intersectLineIntervals(
    current?.intervals ?? [],
    changeEvidence.intervals
  );
  const suppressedChangedIntervals = subtractLineIntervals(
    changeEvidence.intervals,
    currentReviewedChanges
  );
  const contextIntervals = current?.intervals ?? [];
  const contextGlobalActive = intersectLineIntervals(contextIntervals, visibleGlobalIntervals);
  const contextGlobalInactive = subtractLineIntervals(contextIntervals, contextGlobalActive);
  const decorations: NormalEditorReviewedDecoration[] = [];

  if (current !== undefined) {
    const label = contextLabel(input.contextState);
    appendDecorationRanges(
      decorations,
      contextGlobalInactive,
      "context",
      label,
      current.file.updatedAt,
      false
    );
    appendDecorationRanges(
      decorations,
      contextGlobalActive,
      "context",
      label,
      current.file.updatedAt,
      true
    );
  }

  if (changeEvidence.certain) {
    let occupied = contextIntervals;
    for (const otherContext of input.otherContextStates ?? []) {
      if (
        otherContext.contextId === input.contextState.contextId ||
        otherContext.repositoryId !== input.contextState.repositoryId
      ) {
        continue;
      }
      const other = validContextFile(otherContext, input.target);
      if (other === undefined) {
        continue;
      }
      const visible = subtractLineIntervals(
        subtractLineIntervals(other.intervals, occupied),
        suppressedChangedIntervals
      );
      const globalActive = intersectLineIntervals(visible, visibleGlobalIntervals);
      const globalInactive = subtractLineIntervals(visible, globalActive);
      const label = contextLabel(otherContext);
      appendDecorationRanges(
        decorations,
        globalInactive,
        "other-context",
        label,
        other.file.updatedAt,
        false
      );
      appendDecorationRanges(
        decorations,
        globalActive,
        "other-context",
        label,
        other.file.updatedAt,
        true
      );
      occupied = normalizeLineIntervals([...occupied, ...visible]);
    }

    if (global !== undefined && visibleGlobalIntervals.length > 0) {
      const globalOnly = subtractLineIntervals(
        subtractLineIntervals(visibleGlobalIntervals, occupied),
        suppressedChangedIntervals
      );
      appendDecorationRanges(
        decorations,
        globalOnly,
        "global",
        "Global",
        global.file.updatedAt,
        true
      );
    }
  }

  return decorations.sort(
    (left, right) =>
      left.interval.startLine - right.interval.startLine ||
      left.interval.endLineExclusive - right.interval.endLineExclusive ||
      (left.source === "context" ? -1 : left.source === "other-context" ? 0 : 1)
  );
}

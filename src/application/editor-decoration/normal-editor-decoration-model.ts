import type {
  FileReviewState,
  GlobalFileReviewState,
  LineInterval,
  PullRequestDiffSnapshot,
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import {
  normalizeLineIntervals,
  subtractLineIntervals
} from "../../core/intervals/index";
import type { ReviewStateFileTarget } from "../../core/review-state/index";

/** State layer that proves one normal-editor range is reviewed. */
export type NormalEditorDecorationSource =
  | "context"
  | "other-context"
  | "global";

/** One certainly reviewed normal-editor range and its hover metadata. */
export interface NormalEditorReviewedDecoration {
  readonly interval: LineInterval;
  readonly source: NormalEditorDecorationSource;
  readonly contextLabel: string;
  readonly reviewedAt: string;
  readonly globalActive: boolean;
}

/** Current mapped state required to calculate normal-editor decorations. */
export interface NormalEditorDecorationModelInput {
  readonly contextState: Readonly<ReviewContextState>;
  readonly otherContextStates?: readonly Readonly<ReviewContextState>[];
  readonly currentPullRequestDiff?: Readonly<PullRequestDiffSnapshot>;
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly target: Readonly<ReviewStateFileTarget>;
  readonly showGlobalReviewed: boolean;
}

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
    const endLineExclusive = Math.min(
      leftInterval.endLineExclusive,
      rightInterval.endLineExclusive
    );
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

const currentPullRequestChangedIntervals = (
  input: NormalEditorDecorationModelInput
): LineInterval[] => {
  const context = input.contextState;
  const diff = input.currentPullRequestDiff;
  if (
    context.kind !== "pull-request" ||
    context.pullRequest === undefined ||
    diff === undefined ||
    diff.contextId !== context.contextId ||
    diff.baseSha !== context.pullRequest.baseSha ||
    diff.headSha !== context.pullRequest.headSha
  ) {
    return [];
  }
  const file = diff.files.find((candidate) => candidate.fileId === input.target.fileId);
  if (file === undefined || file.newPath !== input.target.currentPath) {
    return [];
  }
  return normalizeLineIntervals(
    file.hunks.flatMap((hunk) =>
      hunk.lines.flatMap((line) =>
        line.kind === "addition" && line.newLine !== undefined
          ? [{ startLine: line.newLine - 1, endLineExclusive: line.newLine }]
          : []
      )
    )
  );
};

/**
 * Builds reviewed decorations using the design priority order: current PR
 * unreviewed changes, uncertain/changed, current context, other context, Global,
 * then unreviewed. The first two and last state intentionally produce no decoration.
 */
export function createNormalEditorDecorationModel(
  input: NormalEditorDecorationModelInput
): readonly NormalEditorReviewedDecoration[] {
  const current = validContextFile(input.contextState, input.target);
  const global = validGlobalFile(input);
  const visibleGlobalIntervals = input.showGlobalReviewed
    ? global?.intervals ?? []
    : [];
  const changedIntervals = currentPullRequestChangedIntervals(input);
  const currentReviewedChanges = intersectLineIntervals(
    current?.intervals ?? [],
    changedIntervals
  );
  const suppressedChangedIntervals = subtractLineIntervals(
    changedIntervals,
    currentReviewedChanges
  );
  const contextIntervals = current?.intervals ?? [];
  const contextGlobalActive = intersectLineIntervals(
    contextIntervals,
    visibleGlobalIntervals
  );
  const contextGlobalInactive = subtractLineIntervals(
    contextIntervals,
    contextGlobalActive
  );
  const decorations: NormalEditorReviewedDecoration[] = [];

  if (current !== undefined) {
    const label = contextLabel(input.contextState);
    for (const interval of contextGlobalInactive) {
      decorations.push({
        interval: { ...interval },
        source: "context",
        contextLabel: label,
        reviewedAt: current.file.updatedAt,
        globalActive: false
      });
    }
    for (const interval of contextGlobalActive) {
      decorations.push({
        interval: { ...interval },
        source: "context",
        contextLabel: label,
        reviewedAt: current.file.updatedAt,
        globalActive: true
      });
    }
  }

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
    for (const interval of visible) {
      decorations.push({
        interval: { ...interval },
        source: "other-context",
        contextLabel: contextLabel(otherContext),
        reviewedAt: other.file.updatedAt,
        globalActive: intersectLineIntervals([interval], visibleGlobalIntervals).length > 0
      });
    }
    occupied = normalizeLineIntervals([...occupied, ...visible]);
  }

  if (global !== undefined && visibleGlobalIntervals.length > 0) {
    const globalOnly = subtractLineIntervals(
      subtractLineIntervals(visibleGlobalIntervals, occupied),
      suppressedChangedIntervals
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
      (left.source === "context" ? -1 : left.source === "other-context" ? 0 : 1)
  );
}

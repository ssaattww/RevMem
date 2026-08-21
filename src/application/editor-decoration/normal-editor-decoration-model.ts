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
  calculatePullRequestDiffProgressCooperatively,
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

/** Deterministic, generation-aware budget for production normal-editor projection. */
export interface NormalEditorDecorationModelWorkBudget {
  readonly maxWorkItems: number;
  readonly yieldControl: () => void | Promise<void>;
  readonly isCurrent: () => boolean;
  readonly accountWorkBatch?: (entry: Readonly<{ kind: string; count: number }>) => void;
}

class CooperativeWork {
  private pending = 0;
  public constructor(private readonly budget: NormalEditorDecorationModelWorkBudget) {
    if (!Number.isSafeInteger(budget.maxWorkItems) || budget.maxWorkItems <= 0) {
      throw new RangeError("maxWorkItems must be a positive integer.");
    }
  }
  public async item(): Promise<boolean> {
    if (!this.budget.isCurrent()) return false;
    this.pending += 1;
    if (this.pending < this.budget.maxWorkItems) return true;
    this.budget.accountWorkBatch?.({ kind: "projected-decoration-model", count: this.pending });
    this.pending = 0;
    await this.budget.yieldControl();
    return this.budget.isCurrent();
  }
  public current(): boolean { return this.budget.isCurrent(); }
  public maxItems(): number { return this.budget.maxWorkItems; }
  public yieldControl(): () => void | Promise<void> { return this.budget.yieldControl; }
}

const compareIntervals = (left: LineInterval, right: LineInterval): number =>
  left.startLine - right.startLine || left.endLineExclusive - right.endLineExclusive;

const mergeSortIntervalsCooperatively = async (
  input: readonly LineInterval[], work: CooperativeWork
): Promise<LineInterval[] | undefined> => {
  let values: LineInterval[] = [];
  for (const value of input) {
    if (!await work.item()) return undefined;
    values.push({ ...value });
  }
  for (let width = 1; width < values.length; width *= 2) {
    const next: LineInterval[] = [];
    for (let start = 0; start < values.length; start += width * 2) {
      let left = start;
      let right = Math.min(start + width, values.length);
      const leftEnd = right;
      const rightEnd = Math.min(start + width * 2, values.length);
      while (left < leftEnd || right < rightEnd) {
        if (!await work.item()) return undefined;
        if (right >= rightEnd || (left < leftEnd && compareIntervals(values[left]!, values[right]!) <= 0)) next.push(values[left++]!);
        else next.push(values[right++]!);
      }
    }
    values = next;
  }
  return values;
};

const normalizedIntervalsCooperatively = async (
  intervals: readonly LineInterval[], lineCount: number, work: CooperativeWork
): Promise<LineInterval[] | undefined> => {
  const valid: LineInterval[] = [];
  for (const interval of intervals) {
    if (!await work.item()) return undefined;
    if (!Number.isSafeInteger(interval.startLine) || !Number.isSafeInteger(interval.endLineExclusive) || interval.startLine < 0 || interval.endLineExclusive <= interval.startLine || interval.endLineExclusive > lineCount) return undefined;
    valid.push(interval);
  }
  const sorted = await mergeSortIntervalsCooperatively(valid, work);
  if (sorted === undefined) return undefined;
  const normalized: LineInterval[] = [];
  for (const interval of sorted) {
    if (!await work.item()) return undefined;
    const previous = normalized.at(-1);
    if (previous !== undefined && interval.startLine <= previous.endLineExclusive) {
      normalized[normalized.length - 1] = { startLine: previous.startLine, endLineExclusive: Math.max(previous.endLineExclusive, interval.endLineExclusive) };
    } else normalized.push({ ...interval });
  }
  return normalized;
};

const intersectIntervalsCooperatively = async (
  left: readonly LineInterval[], right: readonly LineInterval[], work: CooperativeWork
): Promise<LineInterval[] | undefined> => {
  const output: LineInterval[] = []; let leftIndex = 0; let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (!await work.item()) return undefined;
    const leftInterval = left[leftIndex]!; const rightInterval = right[rightIndex]!;
    const startLine = Math.max(leftInterval.startLine, rightInterval.startLine);
    const endLineExclusive = Math.min(leftInterval.endLineExclusive, rightInterval.endLineExclusive);
    if (startLine < endLineExclusive) output.push({ startLine, endLineExclusive });
    if (leftInterval.endLineExclusive <= rightInterval.endLineExclusive) leftIndex += 1; else rightIndex += 1;
  }
  return output;
};

const subtractIntervalsCooperatively = async (
  source: readonly LineInterval[], removed: readonly LineInterval[], work: CooperativeWork
): Promise<LineInterval[] | undefined> => {
  const output: LineInterval[] = []; let removedIndex = 0;
  for (const interval of source) {
    let start = interval.startLine;
    while (removedIndex < removed.length && removed[removedIndex]!.endLineExclusive <= start) { if (!await work.item()) return undefined; removedIndex += 1; }
    let index = removedIndex;
    while (index < removed.length && removed[index]!.startLine < interval.endLineExclusive) {
      if (!await work.item()) return undefined;
      const blocker = removed[index]!;
      if (blocker.startLine > start) output.push({ startLine: start, endLineExclusive: Math.min(blocker.startLine, interval.endLineExclusive) });
      start = Math.max(start, blocker.endLineExclusive);
      if (start >= interval.endLineExclusive) break;
      index += 1;
    }
    if (start < interval.endLineExclusive) { if (!await work.item()) return undefined; output.push({ startLine: start, endLineExclusive: interval.endLineExclusive }); }
  }
  return output;
};

const unionIntervalsCooperatively = async (
  left: readonly LineInterval[], right: readonly LineInterval[], work: CooperativeWork
): Promise<LineInterval[] | undefined> => {
  const output: LineInterval[] = [];
  let leftIndex = 0; let rightIndex = 0;
  const append = (interval: LineInterval): void => {
    const previous = output[output.length - 1];
    if (previous === undefined || interval.startLine > previous.endLineExclusive) output.push({ ...interval });
    else if (interval.endLineExclusive > previous.endLineExclusive) output[output.length - 1] = { startLine: previous.startLine, endLineExclusive: interval.endLineExclusive };
  };
  while (leftIndex < left.length || rightIndex < right.length) {
    if (!await work.item()) return undefined;
    const takeLeft = rightIndex >= right.length || (leftIndex < left.length && compareIntervals(left[leftIndex]!, right[rightIndex]!) <= 0);
    append(takeLeft ? left[leftIndex++]! : right[rightIndex++]!);
  }
  return output;
};

const appendDecorationsCooperatively = async (
  output: NormalEditorReviewedDecoration[], intervals: readonly LineInterval[], source: NormalEditorDecorationSource, label: string, reviewedAt: string, globalActive: boolean, work: CooperativeWork
): Promise<boolean> => {
  for (const interval of intervals) {
    if (!await work.item()) return false;
    output.push({ interval: { ...interval }, source, contextLabel: label, reviewedAt, globalActive });
  }
  return true;
};

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

  let validatedDiff: ReturnType<typeof calculatePullRequestDiffProgress>;
  try {
    validatedDiff = calculatePullRequestDiffProgress({
      diff,
      reviewContext: context,
      exclusionPolicy: DIFF_VALIDATION_POLICY
    });
  } catch {
    return { certain: false, intervals: [] };
  }

  const file = diff.files.find((candidate) => candidate.fileId === input.target.fileId);
  if (file === undefined) {
    const targetPath = DIFF_VALIDATION_POLICY.evaluate({
      path: input.target.currentPath,
      isBinary: false
    }).normalizedPath;
    if (validatedDiff.files.some((candidate) => candidate.path === targetPath)) {
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

const currentPullRequestChangedIntervalsCooperatively = async (
  input: NormalEditorDecorationModelInput,
  work: CooperativeWork
): Promise<CurrentPullRequestChangeEvidence | undefined> => {
  const context = input.contextState;
  if (context.kind !== "pull-request") return { certain: true, intervals: [] };
  const diff = input.currentPullRequestDiff;
  if (context.pullRequest === undefined || diff === undefined || diff.contextId !== context.contextId || diff.baseSha !== context.pullRequest.baseSha || diff.headSha !== context.pullRequest.headSha) return { certain: false, intervals: [] };
  try {
    const validated = await calculatePullRequestDiffProgressCooperatively({ diff, reviewContext: context, exclusionPolicy: DIFF_VALIDATION_POLICY }, {
      maxWorkItems: work.maxItems(), yieldControl: work.yieldControl(), isCurrent: () => work.current()
    });
    if (validated === undefined) return undefined;
    let file: typeof diff.files[number] | undefined;
    for (const candidate of diff.files) { if (!await work.item()) return undefined; if (candidate.fileId === input.target.fileId) { file = candidate; break; } }
    if (file === undefined) {
      const targetPath = DIFF_VALIDATION_POLICY.evaluate({ path: input.target.currentPath, isBinary: false }).normalizedPath;
      for (const candidate of validated.files) { if (!await work.item()) return undefined; if (candidate.path === targetPath) return { certain: false, intervals: [] }; }
      return { certain: true, intervals: [] };
    }
    if (file.newPath !== input.target.currentPath) return { certain: false, intervals: [] };
    const intervals: LineInterval[] = [];
    for (const hunk of file.hunks) for (const line of hunk.lines) {
      if (!await work.item()) return undefined;
      if (line.kind === "addition" && line.newLine !== undefined) intervals.push({ startLine: line.newLine - 1, endLineExclusive: line.newLine });
    }
    const normalized = await normalizedIntervalsCooperatively(intervals, input.target.lineCount, work);
    return normalized === undefined ? undefined : { certain: true, intervals: normalized };
  } catch { return { certain: false, intervals: [] }; }
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

/**
 * Production asynchronous counterpart of `createNormalEditorDecorationModel`.
 * Every validation, merge-sort, set operation, decoration append, and final sort
 * observes the same bounded generation fence before a VS Code apply may occur.
 */
export async function createNormalEditorDecorationModelIncrementally(
  input: NormalEditorDecorationModelInput,
  budget: NormalEditorDecorationModelWorkBudget
): Promise<readonly NormalEditorReviewedDecoration[] | undefined> {
  const work = new CooperativeWork(budget);
  const currentFile = input.contextState.files[input.target.fileId];
  const current = currentFile === undefined || contextRevision(input.contextState) !== input.target.revisionId || currentFile.fileId !== input.target.fileId || currentFile.currentPath !== input.target.currentPath || currentFile.revisionId !== input.target.revisionId || currentFile.lineCount !== input.target.lineCount || !hasCertainContentHash(currentFile.contentHash, input.target.contentHash)
    ? undefined
    : { file: currentFile, intervals: await normalizedIntervalsCooperatively(currentFile.modifiedReviewed, input.target.lineCount, work) };
  if (!work.current()) return undefined;
  if (current !== undefined && current.intervals === undefined) return undefined;
  const globalFile = input.globalState.files[input.target.fileId];
  const global = globalFile === undefined || input.globalState.repositoryId !== input.contextState.repositoryId || input.globalState.currentRevisionId !== input.target.revisionId || globalFile.fileId !== input.target.fileId || globalFile.currentPath !== input.target.currentPath || globalFile.revisionId !== input.target.revisionId || !hasCertainContentHash(globalFile.contentHash, input.target.contentHash)
    ? undefined
    : { file: globalFile, intervals: await normalizedIntervalsCooperatively(globalFile.reviewed, input.target.lineCount, work) };
  if (!work.current()) return undefined;
  if (global !== undefined && global.intervals === undefined) return undefined;
  const visibleGlobal = input.showGlobalReviewed ? global?.intervals ?? [] : [];
  const changeEvidence = await currentPullRequestChangedIntervalsCooperatively(input, work);
  if (changeEvidence === undefined) return undefined;
  const currentIntervals = current?.intervals ?? [];
  const currentReviewedChanges = await intersectIntervalsCooperatively(currentIntervals, changeEvidence.intervals, work);
  if (currentReviewedChanges === undefined) return undefined;
  const suppressed = await subtractIntervalsCooperatively(changeEvidence.intervals, currentReviewedChanges, work);
  if (suppressed === undefined) return undefined;
  const active = await intersectIntervalsCooperatively(currentIntervals, visibleGlobal, work);
  if (active === undefined) return undefined;
  const inactive = await subtractIntervalsCooperatively(currentIntervals, active, work);
  if (inactive === undefined) return undefined;
  const decorations: NormalEditorReviewedDecoration[] = [];
  if (current !== undefined) {
    const label = contextLabel(input.contextState);
    if (!await appendDecorationsCooperatively(decorations, inactive, "context", label, current.file.updatedAt, false, work) || !await appendDecorationsCooperatively(decorations, active, "context", label, current.file.updatedAt, true, work)) return undefined;
  }
  if (changeEvidence.certain) {
    let occupied = currentIntervals;
    for (const otherContext of input.otherContextStates ?? []) {
      if (!await work.item()) return undefined;
      if (otherContext.contextId === input.contextState.contextId || otherContext.repositoryId !== input.contextState.repositoryId) continue;
      const file = otherContext.files[input.target.fileId];
      if (file === undefined || contextRevision(otherContext) !== input.target.revisionId || file.fileId !== input.target.fileId || file.currentPath !== input.target.currentPath || file.revisionId !== input.target.revisionId || file.lineCount !== input.target.lineCount || !hasCertainContentHash(file.contentHash, input.target.contentHash)) continue;
      const intervals = await normalizedIntervalsCooperatively(file.modifiedReviewed, input.target.lineCount, work);
      if (intervals === undefined) return undefined;
      const withoutOccupied = await subtractIntervalsCooperatively(intervals, occupied, work);
      const visible = withoutOccupied === undefined ? undefined : await subtractIntervalsCooperatively(withoutOccupied, suppressed, work);
      if (visible === undefined) return undefined;
      const otherActive = await intersectIntervalsCooperatively(visible, visibleGlobal, work);
      const otherInactive = otherActive === undefined ? undefined : await subtractIntervalsCooperatively(visible, otherActive, work);
      if (otherInactive === undefined || otherActive === undefined) return undefined;
      const label = contextLabel(otherContext);
      if (!await appendDecorationsCooperatively(decorations, otherInactive, "other-context", label, file.updatedAt, false, work) || !await appendDecorationsCooperatively(decorations, otherActive, "other-context", label, file.updatedAt, true, work)) return undefined;
      const combined = await unionIntervalsCooperatively(occupied, visible, work);
      if (combined === undefined) return undefined;
      occupied = combined;
    }
    if (global !== undefined && visibleGlobal.length > 0) {
      const unoccupied = await subtractIntervalsCooperatively(visibleGlobal, occupied, work);
      const globalOnly = unoccupied === undefined ? undefined : await subtractIntervalsCooperatively(unoccupied, suppressed, work);
      if (globalOnly === undefined || !await appendDecorationsCooperatively(decorations, globalOnly, "global", "Global", global.file.updatedAt, true, work)) return undefined;
    }
  }
  let sorted: Array<{ readonly decoration: NormalEditorReviewedDecoration; readonly index: number }> = [];
  for (let index = 0; index < decorations.length; index += 1) {
    if (!await work.item()) return undefined;
    sorted.push({ decoration: decorations[index]!, index });
  }
  const compare = (left: typeof sorted[number], right: typeof sorted[number]): number =>
    left.decoration.interval.startLine - right.decoration.interval.startLine ||
    left.decoration.interval.endLineExclusive - right.decoration.interval.endLineExclusive ||
    (left.decoration.source === "context" ? -1 : left.decoration.source === "other-context" ? 0 : 1) -
      (right.decoration.source === "context" ? -1 : right.decoration.source === "other-context" ? 0 : 1) || left.index - right.index;
  for (let width = 1; width < sorted.length; width *= 2) {
    const next: typeof sorted = [];
    for (let start = 0; start < sorted.length; start += width * 2) {
      let left = start; let right = Math.min(start + width, sorted.length); const leftEnd = right; const rightEnd = Math.min(start + width * 2, sorted.length);
      while (left < leftEnd || right < rightEnd) {
        if (!await work.item()) return undefined;
        if (right >= rightEnd || (left < leftEnd && compare(sorted[left]!, sorted[right]!) <= 0)) next.push(sorted[left++]!); else next.push(sorted[right++]!);
      }
    }
    sorted = next;
  }
  if (!work.current()) return undefined;
  const result: NormalEditorReviewedDecoration[] = [];
  for (const item of sorted) {
    if (!await work.item()) return undefined;
    result.push(item.decoration);
  }
  return result;
}

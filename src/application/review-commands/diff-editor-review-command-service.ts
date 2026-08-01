import type { TextSelection } from "../../core/intervals/index";
import { normalizeLineIntervals, selectionsToLineIntervals } from "../../core/intervals/index";
import {
  commitReviewStateTransaction,
  markFileReviewed,
  markOriginalReviewedRanges,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkOriginalReviewedRanges,
  unmarkReviewedRanges,
  type ReviewStateFileTarget,
  type ReviewStateMutationInput,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter
} from "../../core/review-state/index";
import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";

export type DiffReviewWholeFileOperation = "mark-file-reviewed" | "unmark-file-reviewed";
export type DiffEditorReviewCommandResult = "applied" | "cancelled" | "no-op";

export interface DiffEditorReviewStateSession {
  readonly contextState: ReviewStateMutationInput["contextState"];
  readonly globalState: ReviewStateMutationInput["globalState"];
  readonly target: ReviewStateFileTarget;
  readonly diffId: string;
  readonly originalLineCount: number;
  readonly originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[];
  readonly committer: ReviewStateTransactionCommitter;
}

export interface DiffEditorReviewCommandDependencies<Editor> {
  readonly getSide: (editor: Editor) => "original" | "modified";
  readonly getLineCount: (editor: Editor) => number;
  readonly getSelections: (editor: Editor) => readonly TextSelection[];
  readonly openSession: (editor: Editor) => Promise<DiffEditorReviewStateSession>;
  readonly confirmWholeFileOperation: (operation: DiffReviewWholeFileOperation) => Promise<boolean>;
  readonly requestHistory: (transaction: Readonly<ReviewStateTransaction>) => void | Promise<void>;
  readonly now?: () => Date;
}

const hasSemanticChange = (transaction: Readonly<ReviewStateTransaction>): boolean => {
  const expectedContext = transaction.expected.contextState.files[transaction.fileId];
  const nextContext = transaction.next.contextState.files[transaction.fileId];
  const expectedGlobal = transaction.expected.globalState.files[transaction.fileId];
  const nextGlobal = transaction.next.globalState.files[transaction.fileId];
  return JSON.stringify(expectedContext) !== JSON.stringify(nextContext) ||
    JSON.stringify(expectedGlobal) !== JSON.stringify(nextGlobal);
};

const intersectRanges = (
  selections: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
  allowed: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
) => normalizeLineIntervals(selections.flatMap((selection) =>
  allowed.flatMap((candidate) => {
    const startLine = Math.max(selection.startLine, candidate.startLine);
    const endLineExclusive = Math.min(selection.endLineExclusive, candidate.endLineExclusive);
    return startLine < endLineExclusive ? [{ startLine, endLineExclusive }] : [];
  })
));

const markDiffFileReviewed = (
  input: ReviewStateMutationInput,
  diffId: string,
  originalLineCount: number,
  originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
): ReviewStateTransaction => {
  if (diffId.trim().length === 0) throw new TypeError("diffId must be a non-empty string.");
  if (!Number.isSafeInteger(originalLineCount) || originalLineCount < 0) {
    throw new RangeError("originalLineCount must be a non-negative safe integer.");
  }
  const deletions = normalizeLineIntervals(originalDeletionIntervals);
  if (deletions.some((range) => range.endLineExclusive > originalLineCount)) {
    throw new RangeError("original deletion intervals must stay within the original file.");
  }
  const transaction = markFileReviewed(input);
  const nextContext = transaction.next.contextState as ReviewContextState;
  const nextGlobal = transaction.next.globalState as RepositoryGlobalState;
  const file = nextContext.files[input.target.fileId];
  if (file === undefined) throw new Error("Marked diff file must retain its context file state.");
  return {
    ...transaction,
    diffId,
    next: {
      contextState: {
        ...nextContext,
        files: {
          ...nextContext.files,
          [input.target.fileId]: {
            ...file,
            originalReviewedByDiff: { ...file.originalReviewedByDiff, [diffId]: deletions }
          }
        }
      },
      globalState: nextGlobal
    }
  };
};

export class DiffEditorReviewCommandService<Editor> {
  private readonly now: () => Date;
  public constructor(private readonly dependencies: DiffEditorReviewCommandDependencies<Editor>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  public async markSelectionReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "mark");
  }
  public async unmarkSelectionReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "unmark");
  }
  public async markFileReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "mark-file-reviewed");
  }
  public async unmarkFileReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "unmark-file-reviewed");
  }
  private async applySelectionOperation(editor: Editor, operation: "mark" | "unmark"): Promise<DiffEditorReviewCommandResult> {
    const side = this.dependencies.getSide(editor);
    const lineCount = this.dependencies.getLineCount(editor);
    const intervals = selectionsToLineIntervals(this.dependencies.getSelections(editor), lineCount);
    if (intervals.length === 0) return "no-op";
    const session = await this.openMatchingSession(editor, side, lineCount);
    const effectiveIntervals = side === "original" ? intersectRanges(intervals, session.originalDeletionIntervals) : intervals;
    if (effectiveIntervals.length === 0) return "no-op";
    const common = {
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      occurredAt: this.now().toISOString()
    };
    const transaction = side === "original"
      ? operation === "mark"
        ? markOriginalReviewedRanges({ ...common, side, diffId: session.diffId, originalLineCount: session.originalLineCount, intervals: effectiveIntervals })
        : unmarkOriginalReviewedRanges({ ...common, side, diffId: session.diffId, originalLineCount: session.originalLineCount, intervals: effectiveIntervals })
      : operation === "mark"
        ? markReviewedRanges({ ...common, intervals: effectiveIntervals })
        : unmarkReviewedRanges({ ...common, intervals: effectiveIntervals });
    return this.commitWhenChanged(transaction, session.committer);
  }
  private async applyWholeFileOperation(editor: Editor, operation: DiffReviewWholeFileOperation): Promise<DiffEditorReviewCommandResult> {
    if (!(await this.dependencies.confirmWholeFileOperation(operation))) return "cancelled";
    const side = this.dependencies.getSide(editor);
    const lineCount = this.dependencies.getLineCount(editor);
    const session = await this.openMatchingSession(editor, side, lineCount);
    const input: ReviewStateMutationInput = {
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      occurredAt: this.now().toISOString()
    };
    const transaction = operation === "mark-file-reviewed"
      ? markDiffFileReviewed(input, session.diffId, session.originalLineCount, session.originalDeletionIntervals)
      : unmarkFileReviewed(input);
    return this.commitWhenChanged(transaction, session.committer);
  }
  private async openMatchingSession(editor: Editor, side: "original" | "modified", lineCount: number): Promise<DiffEditorReviewStateSession> {
    const session = await this.dependencies.openSession(editor);
    const expected = side === "original" ? session.originalLineCount : session.target.lineCount;
    if (lineCount !== expected) throw new Error("Diff review-state session line count must match the focused side.");
    return session;
  }
  private async commitWhenChanged(transaction: ReviewStateTransaction, committer: ReviewStateTransactionCommitter): Promise<DiffEditorReviewCommandResult> {
    if (!hasSemanticChange(transaction)) return "no-op";
    await commitReviewStateTransaction(transaction, committer);
    await this.dependencies.requestHistory(transaction);
    return "applied";
  }
}

import type { TextSelection } from "../../core/intervals/index";
import { normalizeLineIntervals, selectionsToLineIntervals } from "../../core/intervals/index";
import {
  commitReviewStateTransaction,
  markFileReviewed,
  markOriginalSelectionReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkOriginalSelectionReviewed,
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
import {
  createOriginalSelectionReviewPlan,
  type OriginalToModifiedLineMapping
} from "./original-selection-review-plan";

/** User-confirmed operation that changes all reviewable ranges in a diff file. */
export type DiffReviewWholeFileOperation = "mark-file-reviewed" | "unmark-file-reviewed";
/** Observable result of a diff-editor review command. */
export type DiffEditorReviewCommandResult = "applied" | "cancelled" | "no-op";

/** Immutable state and identity snapshot required to mutate one diff-editor file. */
export interface DiffEditorReviewStateSession {
  /** Context-local state that must be atomically committed with the mutation. */
  readonly contextState: ReviewStateMutationInput["contextState"];
  /** Repository-global state that must be atomically committed with the mutation. */
  readonly globalState: ReviewStateMutationInput["globalState"];
  /** Current modified-side file identity and immutable revision. */
  readonly target: ReviewStateFileTarget;
  /** Original-side identity for non-PR contexts; PR contexts derive their canonical comparison ID. */
  readonly diffId: string;
  /** Number of lines in the immutable original-side document. */
  readonly originalLineCount: number;
  /** Original-side intervals representing deletions in the current diff. */
  readonly originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[];
  /** Immutable surviving-line mappings; an absent value must be treated as unprojectable. */
  readonly originalToModifiedLineMappings?: readonly OriginalToModifiedLineMapping[];
  /** Atomic persistence boundary for the generated transaction. */
  readonly committer: ReviewStateTransactionCommitter;
}

/** Host operations used by the API-independent diff-editor command service. */
export interface DiffEditorReviewCommandDependencies<Editor> {
  /** Returns the focused immutable original or mutable modified side. */
  readonly getSide: (editor: Editor) => "original" | "modified";
  /** Returns the line count for the focused side. */
  readonly getLineCount: (editor: Editor) => number;
  /** Returns the current host selections. */
  readonly getSelections: (editor: Editor) => readonly TextSelection[];
  /** Opens the state snapshot that matches the focused editor. */
  readonly openSession: (editor: Editor) => Promise<DiffEditorReviewStateSession>;
  /** Requests confirmation before a whole-file mutation. */
  readonly confirmWholeFileOperation: (operation: DiffReviewWholeFileOperation) => Promise<boolean>;
  /** Appends history only after the transaction has committed. */
  readonly requestHistory: (transaction: Readonly<ReviewStateTransaction>) => void | Promise<void>;
  /** Optional clock for transaction timestamps. */
  readonly now?: () => Date;
}

/** Returns only the persisted file attributes that distinguish an effective review mutation. */
const semanticFileEntry = <File extends { readonly updatedAt: string }>(file: File | undefined): Omit<File, "updatedAt"> | undefined => {
  if (file === undefined) return undefined;
  return Object.fromEntries(Object.entries(file).filter(([key]) => key !== "updatedAt")) as Omit<File, "updatedAt">;
};

/** Ignores generated timestamps while retaining file presence, ranges, path, revision, hash, and line-count changes. */
const hasSemanticChange = (transaction: Readonly<ReviewStateTransaction>): boolean => {
  const expectedContext = transaction.expected.contextState.files[transaction.fileId];
  const nextContext = transaction.next.contextState.files[transaction.fileId];
  const expectedGlobal = transaction.expected.globalState.files[transaction.fileId];
  const nextGlobal = transaction.next.globalState.files[transaction.fileId];
  return JSON.stringify(semanticFileEntry(expectedContext)) !== JSON.stringify(semanticFileEntry(nextContext)) ||
    JSON.stringify(semanticFileEntry(expectedGlobal)) !== JSON.stringify(semanticFileEntry(nextGlobal));
};

/** Derives the one canonical original-side state key required by a pull-request context. */
const canonicalDiffIdFor = (contextState: DiffEditorReviewStateSession["contextState"], fallback: string): string => {
  if (contextState.kind !== "pull-request") return fallback;
  if (contextState.pullRequest === undefined) throw new Error("Pull-request diff review session must include pull-request identity.");
  return `${contextState.pullRequest.baseSha}..${contextState.pullRequest.headSha}`;
};

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

/** Applies selection and whole-file review commands with atomic state and history ordering. */
export class DiffEditorReviewCommandService<Editor> {
  private readonly now: () => Date;
  /** Creates a command service whose host dependencies are kept outside the core transaction layer. */
  public constructor(private readonly dependencies: DiffEditorReviewCommandDependencies<Editor>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  /**
   * Marks the selected ranges on the focused original or modified side.
   * @returns `applied` only after an effective transaction commits and its history request completes; `no-op` for empty,
   * non-deletion original, or semantically unchanged selections.
   * @throws {Error} When the focused line count or pull-request identity does not match the opened session; commit and
   * history-request rejections propagate after their respective boundary.
   */
  public async markSelectionReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "mark");
  }
  /**
   * Removes review marks from selected ranges on the focused original or modified side.
   * @returns `applied` only after an effective commit and history request, or `no-op` when the selection changes no
   * persisted range.
   * @throws {Error} When the session line-count/PR identity preconditions fail; persistence and history failures are not swallowed.
   */
  public async unmarkSelectionReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "unmark");
  }
  /**
   * Marks all modified lines and current original deletion lines after confirmation.
   * @returns `cancelled` without opening state when confirmation is declined; otherwise `applied` after commit then
   * history, or `no-op` when the resulting state is semantically unchanged.
   * @throws {Error} When focused-side line counts, canonical PR identity, persistence, or history ordering cannot be satisfied.
   */
  public async markFileReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "mark-file-reviewed");
  }
  /**
   * Clears all context, Global, and original diff ranges after confirmation.
   * @returns `cancelled` before state access, `applied` after atomic commit then history, or `no-op` when no persisted
   * file attribute changes.
   * @throws {Error} When session preconditions fail or the commit/history boundary rejects; failures propagate to the caller.
   */
  public async unmarkFileReviewed(editor: Editor): Promise<DiffEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "unmark-file-reviewed");
  }
  private async applySelectionOperation(editor: Editor, operation: "mark" | "unmark"): Promise<DiffEditorReviewCommandResult> {
    const side = this.dependencies.getSide(editor);
    const lineCount = this.dependencies.getLineCount(editor);
    const intervals = selectionsToLineIntervals(this.dependencies.getSelections(editor), lineCount);
    if (intervals.length === 0) return "no-op";
    const session = await this.openMatchingSession(editor, side, lineCount);
    const common = {
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      occurredAt: this.now().toISOString()
    };
    if (side === "modified") {
      const transaction = operation === "mark"
        ? markReviewedRanges({ ...common, intervals })
        : unmarkReviewedRanges({ ...common, intervals });
      return this.commitWhenChanged(transaction, session.committer);
    }
    if (session.originalToModifiedLineMappings === undefined) return "no-op";
    const plan = createOriginalSelectionReviewPlan({
      selections: intervals,
      originalDeletionIntervals: session.originalDeletionIntervals,
      originalToModifiedLineMappings: session.originalToModifiedLineMappings
    });
    if (plan.modifiedIntervals.length === 0 && plan.originalDeletionIntervals.length === 0) return "no-op";
    const originalInput = {
      ...common,
      side,
      diffId: canonicalDiffIdFor(session.contextState, session.diffId),
      originalLineCount: session.originalLineCount,
      modifiedIntervals: plan.modifiedIntervals,
      originalIntervals: plan.originalDeletionIntervals
    } as const;
    const transaction = operation === "mark"
      ? markOriginalSelectionReviewed(originalInput)
      : unmarkOriginalSelectionReviewed(originalInput);
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
      ? markDiffFileReviewed(input, canonicalDiffIdFor(session.contextState, session.diffId), session.originalLineCount, session.originalDeletionIntervals)
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

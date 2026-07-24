import type { TextSelection } from "../../core/intervals/index";
import { selectionsToLineIntervals } from "../../core/intervals/index";
import {
  commitReviewStateTransaction,
  markFileReviewed,
  markReviewedRanges,
  unmarkFileReviewed,
  unmarkReviewedRanges,
  type ReviewStateFileTarget,
  type ReviewStateMutationInput,
  type ReviewStateTransaction,
  type ReviewStateTransactionCommitter
} from "../../core/review-state/index";

/** Whole-file operations that require explicit user confirmation. */
export type ReviewWholeFileOperation =
  | "mark-file-reviewed"
  | "unmark-file-reviewed";

/** Observable result of a normal-editor review command. */
export type NormalEditorReviewCommandResult =
  | "applied"
  | "cancelled"
  | "no-op";

/** Current mapped review state and atomic persistence boundary for one editor. */
export interface NormalEditorReviewStateSession {
  /**
   * Current mapped isolated-context snapshot. Its descriptor and existing target file,
   * when present, must match `target.revisionId`; command construction does not mutate it.
   */
  readonly contextState: ReviewStateMutationInput["contextState"];
  /**
   * Current mapped repository-wide Global snapshot. Its repository, schema, current
   * revision, and existing target file must remain consistent with `contextState` and `target`.
   */
  readonly globalState: ReviewStateMutationInput["globalState"];
  /**
   * Current file identity, revision, optional content hash, and line count shared by
   * both snapshots. The service rejects a session when its line count differs from the editor observed before opening it.
   */
  readonly target: ReviewStateFileTarget;
  /**
   * Single atomic compare-and-replace boundary for the detached transaction. It must
   * commit both context and Global snapshots or neither, and its rejection (including stale state) prevents history from being requested.
   */
  readonly committer: ReviewStateTransactionCommitter;
}

/** Platform-neutral dependencies supplied by the VS Code composition root. */
export interface NormalEditorReviewCommandDependencies<Editor> {
  /** Returns the current VS Code-equivalent document line count. */
  readonly getLineCount: (editor: Editor) => number;
  /** Returns all current selections, including cursor-only selections. */
  readonly getSelections: (editor: Editor) => readonly TextSelection[];
  /** Loads or initializes mapped state for the current editor. */
  readonly openSession: (
    editor: Editor
  ) => Promise<NormalEditorReviewStateSession>;
  /** Confirms only destructive or broad whole-file operations. */
  readonly confirmWholeFileOperation: (
    operation: ReviewWholeFileOperation
  ) => Promise<boolean>;
  /**
   * Requests append-only history only after the atomic committer fulfills. A rejection
   * propagates after state persistence has already succeeded, so it represents observable partial success rather than a rollback request.
   */
  readonly requestHistory: (
    transaction: Readonly<ReviewStateTransaction>
  ) => void | Promise<void>;
  /** Clock used to make state transitions deterministic in tests. */
  readonly now?: () => Date;
}

type SelectionOperation = "mark" | "unmark";

/**
 * Connects normal-editor selections and whole-file actions to Review State Service.
 *
 * The service is independent from the VS Code API. The UI adapter owns active-editor
 * lookup and dialogs, while the injected session provider owns context resolution and
 * persistence construction.
 */
export class NormalEditorReviewCommandService<Editor> {
  private readonly now: () => Date;

  public constructor(
    private readonly dependencies: NormalEditorReviewCommandDependencies<Editor>
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Marks all selected or cursor lines without displaying a confirmation dialog. */
  public async markSelectionReviewed(
    editor: Editor
  ): Promise<NormalEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "mark");
  }

  /** Unmarks all selected or cursor lines without displaying a confirmation dialog. */
  public async unmarkSelectionReviewed(
    editor: Editor
  ): Promise<NormalEditorReviewCommandResult> {
    return this.applySelectionOperation(editor, "unmark");
  }

  /** Marks every current line after the whole-file confirmation is accepted. */
  public async markFileReviewed(
    editor: Editor
  ): Promise<NormalEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "mark-file-reviewed");
  }

  /** Clears current, Global, and original-side state after explicit confirmation. */
  public async unmarkFileReviewed(
    editor: Editor
  ): Promise<NormalEditorReviewCommandResult> {
    return this.applyWholeFileOperation(editor, "unmark-file-reviewed");
  }

  private async applySelectionOperation(
    editor: Editor,
    operation: SelectionOperation
  ): Promise<NormalEditorReviewCommandResult> {
    const lineCount = this.dependencies.getLineCount(editor);
    const intervals = selectionsToLineIntervals(
      this.dependencies.getSelections(editor),
      lineCount
    );

    if (intervals.length === 0) {
      return "no-op";
    }

    const session = await this.openMatchingSession(editor, lineCount);
    const occurredAt = this.now().toISOString();
    const input = {
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      intervals,
      occurredAt
    };
    const transaction = operation === "mark"
      ? markReviewedRanges(input)
      : unmarkReviewedRanges(input);

    await this.commitAndRequestHistory(transaction, session.committer);
    return "applied";
  }

  private async applyWholeFileOperation(
    editor: Editor,
    operation: ReviewWholeFileOperation
  ): Promise<NormalEditorReviewCommandResult> {
    const confirmed = await this.dependencies.confirmWholeFileOperation(operation);
    if (!confirmed) {
      return "cancelled";
    }

    const lineCount = this.dependencies.getLineCount(editor);
    const session = await this.openMatchingSession(editor, lineCount);
    const input: ReviewStateMutationInput = {
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      occurredAt: this.now().toISOString()
    };
    const transaction = operation === "mark-file-reviewed"
      ? markFileReviewed(input)
      : unmarkFileReviewed(input);

    await this.commitAndRequestHistory(transaction, session.committer);
    return "applied";
  }

  private async openMatchingSession(
    editor: Editor,
    lineCount: number
  ): Promise<NormalEditorReviewStateSession> {
    const session = await this.dependencies.openSession(editor);
    if (session.target.lineCount !== lineCount) {
      throw new Error(
        "Review-state session line count must match the current editor document."
      );
    }

    return session;
  }

  private async commitAndRequestHistory(
    transaction: ReviewStateTransaction,
    committer: ReviewStateTransactionCommitter
  ): Promise<void> {
    await commitReviewStateTransaction(transaction, committer);
    await this.dependencies.requestHistory(transaction);
  }
}

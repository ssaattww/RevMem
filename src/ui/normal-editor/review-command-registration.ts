import { runWithActiveOperationFeedback } from "../../application/operation-feedback/index";

/** Command IDs defined by the editor command design. */
export const NORMAL_EDITOR_REVIEW_COMMAND_IDS = {
  markSelectionReviewed: "reviewRange.markSelectionReviewed",
  unmarkSelectionReviewed: "reviewRange.unmarkSelectionReviewed",
  markFileReviewed: "reviewRange.markFileReviewed",
  unmarkFileReviewed: "reviewRange.unmarkFileReviewed"
} as const;

const OPERATION_LABELS: Readonly<Record<keyof typeof NORMAL_EDITOR_REVIEW_COMMAND_IDS, string>> = {
  markSelectionReviewed: "選択範囲を確認済みにする",
  unmarkSelectionReviewed: "選択範囲の確認済みを解除する",
  markFileReviewed: "ファイル全体を確認済みにする",
  unmarkFileReviewed: "ファイル全体の確認済みを解除する"
};

/** One disposable registration returned by the VS Code command API. */
export interface CommandDisposable {
  /** Unregisters this command registration; calling it does not invoke the application handler. */
  dispose(): void;
}

/** Minimal VS Code UI boundary used by normal-editor command registration. */
export interface NormalEditorCommandHost<Editor> {
  /** @returns The active editor, or `undefined` when no normal or diff editor is active. */
  getActiveEditor(): Editor | undefined;
  /** @returns Whether an active editor is a diff editor, which this registration never passes to review handlers. */
  isDiffEditor(editor: Editor): boolean;
  /** Optionally handles the same contributed command while a supported diff editor is focused. */
  invokeDiffEditorCommand?(
    commandId: keyof typeof NORMAL_EDITOR_REVIEW_COMMAND_IDS,
    editor: Editor
  ): void | Promise<unknown>;
  /** Registers one command callback and returns the disposable that unregisters that exact callback. */
  registerCommand(
    commandId: string,
    handler: () => void | Promise<void>
  ): CommandDisposable;
  /** Displays the normal-editor-required message when no active editor exists or the active editor is a diff editor. */
  showNormalEditorRequired(): void | Promise<void>;
  /** Displays a handler error after it is caught; a failure from this presentation method remains observable to the command host. */
  showCommandError(error: unknown): void | Promise<void>;
}

/** Four normal-editor operations implemented by the application command service. */
export interface NormalEditorReviewCommandHandlers<Editor> {
  /** Marks selected or cursor lines in the supplied active normal editor; rejection is presented through `showCommandError`. */
  markSelectionReviewed(editor: Editor): void | Promise<unknown>;
  /** Unmarks selected or cursor lines in the supplied active normal editor; rejection is presented through `showCommandError`. */
  unmarkSelectionReviewed(editor: Editor): void | Promise<unknown>;
  /** Marks the supplied active normal editor's whole file after application-level confirmation; rejection is presented through `showCommandError`. */
  markFileReviewed(editor: Editor): void | Promise<unknown>;
  /** Unmarks the supplied active normal editor's whole file after application-level confirmation; rejection is presented through `showCommandError`. */
  unmarkFileReviewed(editor: Editor): void | Promise<unknown>;
}

/** Refreshes all currently visible normal-editor decorations after a state change. */
export interface NormalEditorDecorationRefresher {
  /** Reloads and applies decorations to every visible editor, clearing any visible diff editor. */
  refreshVisibleEditors(): void | Promise<void>;
}

type CommandInvocation<Editor> = (editor: Editor) => void | Promise<unknown>;

/**
 * Adds decoration refresh behavior to review command handlers.
 *
 * Applied commands refresh every visible editor so split views of the same document
 * cannot retain stale decorations. Cancelled and no-op commands leave decorations unchanged.
 */
export function createRefreshingNormalEditorReviewCommandHandlers<Editor>(
  handlers: NormalEditorReviewCommandHandlers<Editor>,
  refresher: NormalEditorDecorationRefresher
): NormalEditorReviewCommandHandlers<Editor> {
  const refreshAfterApplied = async (
    operation: () => void | Promise<unknown>
  ): Promise<unknown> => {
    const result = await operation();
    if (result === "applied") {
      await refresher.refreshVisibleEditors();
    }
    return result;
  };

  return {
    markSelectionReviewed: (editor) =>
      refreshAfterApplied(() => handlers.markSelectionReviewed(editor)),
    unmarkSelectionReviewed: (editor) =>
      refreshAfterApplied(() => handlers.unmarkSelectionReviewed(editor)),
    markFileReviewed: (editor) =>
      refreshAfterApplied(() => handlers.markFileReviewed(editor)),
    unmarkFileReviewed: (editor) =>
      refreshAfterApplied(() => handlers.unmarkFileReviewed(editor))
  };
}

const invokeForActiveNormalEditor = async <Editor>(
  host: NormalEditorCommandHost<Editor>,
  commandId: keyof typeof NORMAL_EDITOR_REVIEW_COMMAND_IDS,
  invocation: CommandInvocation<Editor>
): Promise<void> => {
  const editor = host.getActiveEditor();
  if (editor === undefined) {
    await host.showNormalEditorRequired();
    return;
  }

  try {
    if (host.isDiffEditor(editor)) {
      if (host.invokeDiffEditorCommand === undefined) {
        await host.showNormalEditorRequired();
        return;
      }
      await host.invokeDiffEditorCommand(commandId, editor);
      return;
    }
    await invocation(editor);
  } catch (error) {
    await host.showCommandError(error);
  }
};

/**
 * Registers all four designed normal-editor review commands.
 *
 * Each registered callback shows the normal-editor-required or handler-error
 * message when applicable; a rejection from that later message presentation
 * rejects callback execution, not this registration function.
 *
 * @returns Four disposables, one per command ID, for callers to dispose during extension teardown.
 * @throws Propagates a synchronous `registerCommand` failure while a callback is being registered.
 */
export function registerNormalEditorReviewCommands<Editor>(
  host: NormalEditorCommandHost<Editor>,
  handlers: NormalEditorReviewCommandHandlers<Editor>
): CommandDisposable[] {
  const registrations: ReadonlyArray<readonly [
    keyof typeof NORMAL_EDITOR_REVIEW_COMMAND_IDS,
    string,
    CommandInvocation<Editor>
  ]> = [
    [
      "markSelectionReviewed",
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed,
      (editor) => handlers.markSelectionReviewed(editor)
    ],
    [
      "unmarkSelectionReviewed",
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkSelectionReviewed,
      (editor) => handlers.unmarkSelectionReviewed(editor)
    ],
    [
      "markFileReviewed",
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.markFileReviewed,
      (editor) => handlers.markFileReviewed(editor)
    ],
    [
      "unmarkFileReviewed",
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkFileReviewed,
      (editor) => handlers.unmarkFileReviewed(editor)
    ]
  ];

  return registrations.map(([operation, commandId, invocation]) =>
    host.registerCommand(
      commandId,
      async () => runWithActiveOperationFeedback(
        OPERATION_LABELS[operation],
        () => invokeForActiveNormalEditor(host, operation, invocation)
      )
    )
  );
}

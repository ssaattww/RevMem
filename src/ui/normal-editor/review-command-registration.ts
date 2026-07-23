/** Command IDs defined by the editor command design. */
export const NORMAL_EDITOR_REVIEW_COMMAND_IDS = {
  markSelectionReviewed: "reviewRange.markSelectionReviewed",
  unmarkSelectionReviewed: "reviewRange.unmarkSelectionReviewed",
  markFileReviewed: "reviewRange.markFileReviewed",
  unmarkFileReviewed: "reviewRange.unmarkFileReviewed"
} as const;

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
  invocation: CommandInvocation<Editor>
): Promise<void> => {
  const editor = host.getActiveEditor();
  if (editor === undefined || host.isDiffEditor(editor)) {
    await host.showNormalEditorRequired();
    return;
  }

  try {
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
  const registrations: ReadonlyArray<readonly [string, CommandInvocation<Editor>]> = [
    [
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed,
      (editor) => handlers.markSelectionReviewed(editor)
    ],
    [
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkSelectionReviewed,
      (editor) => handlers.unmarkSelectionReviewed(editor)
    ],
    [
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.markFileReviewed,
      (editor) => handlers.markFileReviewed(editor)
    ],
    [
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkFileReviewed,
      (editor) => handlers.unmarkFileReviewed(editor)
    ]
  ];

  return registrations.map(([commandId, invocation]) =>
    host.registerCommand(
      commandId,
      async () => invokeForActiveNormalEditor(host, invocation)
    )
  );
}

/** Command IDs defined by the editor command design. */
export const NORMAL_EDITOR_REVIEW_COMMAND_IDS = {
  markSelectionReviewed: "reviewRange.markSelectionReviewed",
  unmarkSelectionReviewed: "reviewRange.unmarkSelectionReviewed",
  markFileReviewed: "reviewRange.markFileReviewed",
  unmarkFileReviewed: "reviewRange.unmarkFileReviewed"
} as const;

/** One disposable registration returned by the VS Code command API. */
export interface CommandDisposable {
  dispose(): void;
}

/** Minimal VS Code UI boundary used by normal-editor command registration. */
export interface NormalEditorCommandHost<Editor> {
  getActiveEditor(): Editor | undefined;
  isDiffEditor(editor: Editor): boolean;
  registerCommand(
    commandId: string,
    handler: () => void | Promise<void>
  ): CommandDisposable;
  showNormalEditorRequired(): void | Promise<void>;
  showCommandError(error: unknown): void | Promise<void>;
}

/** Four normal-editor operations implemented by the application command service. */
export interface NormalEditorReviewCommandHandlers<Editor> {
  markSelectionReviewed(editor: Editor): void | Promise<unknown>;
  unmarkSelectionReviewed(editor: Editor): void | Promise<unknown>;
  markFileReviewed(editor: Editor): void | Promise<unknown>;
  unmarkFileReviewed(editor: Editor): void | Promise<unknown>;
}

type CommandInvocation<Editor> = (editor: Editor) => void | Promise<unknown>;

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

/** Registers all four designed normal-editor review commands. */
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

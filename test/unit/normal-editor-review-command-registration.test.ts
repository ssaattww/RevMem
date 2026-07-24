import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMAL_EDITOR_REVIEW_COMMAND_IDS,
  registerNormalEditorReviewCommands,
  type CommandDisposable,
  type NormalEditorCommandHost,
  type NormalEditorReviewCommandHandlers
} from "../../src/ui/normal-editor/index";

interface FakeEditor {
  readonly id: string;
  readonly diff?: boolean;
}

class FakeDisposable implements CommandDisposable {
  public disposed = false;

  public dispose(): void {
    this.disposed = true;
  }
}

class FakeHost implements NormalEditorCommandHost<FakeEditor> {
  public activeEditor: FakeEditor | undefined;
  public readonly handlers = new Map<string, () => Promise<void>>();
  public readonly disposables: FakeDisposable[] = [];
  public unavailableMessages = 0;
  public readonly errors: unknown[] = [];

  public getActiveEditor(): FakeEditor | undefined {
    return this.activeEditor;
  }

  public isDiffEditor(editor: FakeEditor): boolean {
    return editor.diff === true;
  }

  public registerCommand(
    commandId: string,
    handler: () => void | Promise<void>
  ): CommandDisposable {
    const disposable = new FakeDisposable();
    this.disposables.push(disposable);
    this.handlers.set(commandId, async () => handler());
    return disposable;
  }

  public showNormalEditorRequired(): void {
    this.unavailableMessages += 1;
  }

  public showCommandError(error: unknown): void {
    this.errors.push(error);
  }
}

const createHandlers = (error?: Error) => {
  const calls: Array<{ readonly command: string; readonly editor: FakeEditor }> = [];
  const invoke = async (command: string, editor: FakeEditor): Promise<void> => {
    if (error !== undefined) {
      throw error;
    }
    calls.push({ command, editor });
  };
  const handlers: NormalEditorReviewCommandHandlers<FakeEditor> = {
    markSelectionReviewed: async (editor) => invoke("mark-selection", editor),
    unmarkSelectionReviewed: async (editor) => invoke("unmark-selection", editor),
    markFileReviewed: async (editor) => invoke("mark-file", editor),
    unmarkFileReviewed: async (editor) => invoke("unmark-file", editor)
  };

  return { handlers, calls };
};

test("registerNormalEditorReviewCommands registers the four designed command IDs", () => {
  const host = new FakeHost();
  const { handlers } = createHandlers();

  const disposables = registerNormalEditorReviewCommands(host, handlers);

  assert.deepEqual([...host.handlers.keys()], [
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed,
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkSelectionReviewed,
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markFileReviewed,
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkFileReviewed
  ]);
  assert.equal(disposables.length, 4);
  assert.deepEqual(disposables, host.disposables);
});

test("registered commands delegate only when an active normal editor exists", async () => {
  const host = new FakeHost();
  const { handlers, calls } = createHandlers();
  registerNormalEditorReviewCommands(host, handlers);
  const editor: FakeEditor = { id: "editor-1" };
  host.activeEditor = editor;

  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed
  )!();
  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkSelectionReviewed
  )!();
  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markFileReviewed
  )!();
  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.unmarkFileReviewed
  )!();

  assert.deepEqual(calls, [
    { command: "mark-selection", editor },
    { command: "unmark-selection", editor },
    { command: "mark-file", editor },
    { command: "unmark-file", editor }
  ]);
  assert.equal(host.unavailableMessages, 0);
  assert.deepEqual(host.errors, []);
});

test("registered commands reject missing and diff editors without invoking state commands", async () => {
  const host = new FakeHost();
  const { handlers, calls } = createHandlers();
  registerNormalEditorReviewCommands(host, handlers);
  const execute = host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed
  )!;

  await execute();
  host.activeEditor = { id: "diff-editor", diff: true };
  await execute();

  assert.equal(host.unavailableMessages, 2);
  assert.deepEqual(calls, []);
  assert.deepEqual(host.errors, []);
});

test("registered commands report handler failures through the UI host", async () => {
  const failure = new Error("state commit failed");
  const host = new FakeHost();
  const { handlers, calls } = createHandlers(failure);
  registerNormalEditorReviewCommands(host, handlers);
  host.activeEditor = { id: "editor-1" };

  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed
  )!();

  assert.deepEqual(calls, []);
  assert.deepEqual(host.errors, [failure]);
});

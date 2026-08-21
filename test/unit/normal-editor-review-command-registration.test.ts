import assert from "node:assert/strict";
import test from "node:test";

import {
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry
} from "../../src/application/operation-feedback/index";
import {
  NORMAL_EDITOR_REVIEW_COMMAND_IDS,
  createRefreshingNormalEditorReviewCommandHandlers,
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
  public readonly capturedFailures: Array<{
    readonly operation: string;
    readonly error: unknown;
  }> = [];
  public captureCommandOperationErrorForTest: ((operation: string, error: unknown) => void) | undefined;

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

  public enableFailureCaptureForTest(): void {
    this.captureCommandOperationErrorForTest = (operation, error) => {
      this.capturedFailures.push({ operation, error });
    };
  }
}

class FakeOperationFeedbackHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public revealCount = 0;

  public showBusy(): void {}
  public clearBusy(): void {}

  public appendLog(entry: OperationLogEntry): void {
    this.logs.push(entry);
  }

  public revealLog(): void {
    this.revealCount += 1;
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

test("registered commands report a privacy-safe handler failure through the UI host", async () => {
  const failure = new Error("state commit failed");
  const host = new FakeHost();
  const { handlers, calls } = createHandlers(failure);
  registerNormalEditorReviewCommands(host, handlers);
  host.activeEditor = { id: "editor-1" };

  await host.handlers.get(
    NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed
  )!();

  assert.deepEqual(calls, []);
  assert.deepEqual(host.errors, ["操作を完了できませんでした。詳細は Review Range Output を確認してください。"]);
});

test("handler failure is recorded as failed operation before the UI host reports it", async () => {
  const failure = new Error("state commit failed");
  const host = new FakeHost();
  const operationHost = new FakeOperationFeedbackHost();
  const { handlers } = createHandlers(failure);
  host.activeEditor = { id: "editor-1" };
  setActiveOperationFeedback(new OperationFeedback(operationHost, () => 100));

  try {
    registerNormalEditorReviewCommands(host, handlers);
    await host.handlers.get(
      NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed
    )!();

    assert.deepEqual(host.errors, ["操作を完了できませんでした。詳細は Review Range Output を確認してください。"]);
    assert.deepEqual(operationHost.logs.map((entry) => entry.event), ["started", "failed"]);
    assert.equal(operationHost.logs.at(-1)?.message, "Operation failed; details were redacted.");
    assert.equal(operationHost.revealCount, 1);
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("Test-mode command failure is captured by operation and rejects with the original error without waiting for UI", async () => {
  const failure = new Error("state commit failed");
  const host = new FakeHost();
  host.enableFailureCaptureForTest();
  const { handlers } = createHandlers(failure);
  host.activeEditor = { id: "editor-1" };
  registerNormalEditorReviewCommands(host, handlers);

  await assert.rejects(
    host.handlers.get(NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed)!(),
    (error: unknown) => error === failure
  );

  assert.deepEqual(host.capturedFailures, [{
    operation: "markSelectionReviewed",
    error: failure
  }]);
  assert.deepEqual(host.errors, []);
});

test("applied production handlers await one automatic decoration refresh", async () => {
  let resolveRefresh: (() => void) | undefined;
  let refreshCount = 0;
  const refreshPending = new Promise<void>((resolve) => {
    resolveRefresh = resolve;
  });
  const handlers = createRefreshingNormalEditorReviewCommandHandlers(
    {
      markSelectionReviewed: async () => "applied",
      unmarkSelectionReviewed: async () => "no-op",
      markFileReviewed: async () => "no-op",
      unmarkFileReviewed: async () => "no-op"
    },
    {
      refreshVisibleEditors: async () => {
        refreshCount += 1;
        await refreshPending;
      }
    }
  );

  let settled = false;
  const invocation = Promise.resolve(handlers.markSelectionReviewed({ id: "editor-1" })).then(() => {
    settled = true;
  });
  await Promise.resolve();

  assert.equal(refreshCount, 1);
  assert.equal(settled, false, "production command completion must await its automatic refresh");
  resolveRefresh!();
  await invocation;
  assert.equal(settled, true);
});

test("Test-mode public command settles after state application without an automatic decoration refresh", async () => {
  const host = new FakeHost();
  host.activeEditor = { id: "editor-1" };
  let applied = 0;
  let refreshCount = 0;
  const handlers = createRefreshingNormalEditorReviewCommandHandlers(
    {
      markSelectionReviewed: async () => {
        applied += 1;
        return "applied";
      },
      unmarkSelectionReviewed: async () => "no-op",
      markFileReviewed: async () => "no-op",
      unmarkFileReviewed: async () => "no-op"
    },
    { refreshVisibleEditors: async () => { refreshCount += 1; } },
    { deferAppliedDecorationRefresh: true }
  );
  registerNormalEditorReviewCommands(host, handlers);

  await host.handlers.get(NORMAL_EDITOR_REVIEW_COMMAND_IDS.markSelectionReviewed)!();

  assert.equal(applied, 1, "the public command must keep its production state-application path");
  assert.equal(refreshCount, 0, "Test mode must defer automatic decoration refresh");
});

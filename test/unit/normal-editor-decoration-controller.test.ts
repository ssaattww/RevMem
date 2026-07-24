import assert from "node:assert/strict";
import test from "node:test";

import type {
  NormalEditorReviewedDecoration
} from "../../src/application/editor-decoration/index";
import {
  NormalEditorDecorationController,
  createRefreshingNormalEditorReviewCommandHandlers,
  type DecorationDisposable,
  type NormalEditorDecorationHost,
  type NormalEditorDecorationSettings
} from "../../src/ui/normal-editor/index";

interface FakeEditor {
  readonly id: string;
  readonly diff?: boolean;
}

class FakeDisposable implements DecorationDisposable {
  public disposed = false;

  public dispose(): void {
    this.disposed = true;
  }
}

class FakeDecorationType extends FakeDisposable {
  public constructor(
    public readonly settings: NormalEditorDecorationSettings
  ) {
    super();
  }
}

interface SetDecorationCall {
  readonly editor: FakeEditor;
  readonly decorationType: FakeDecorationType;
  readonly decorations: readonly NormalEditorReviewedDecoration[];
}

class FakeHost implements NormalEditorDecorationHost<FakeEditor, FakeDecorationType> {
  public visibleEditors: readonly FakeEditor[] = [];
  public settings: NormalEditorDecorationSettings = {
    showGlobalReviewed: true,
    showGutterIcon: true,
    showOverviewRuler: false
  };
  public readonly decorationTypes: FakeDecorationType[] = [];
  public readonly loadCalls: Array<{
    readonly editor: FakeEditor;
    readonly showGlobalReviewed: boolean;
  }> = [];
  public readonly setCalls: SetDecorationCall[] = [];
  public readonly errors: unknown[] = [];
  public readonly models = new Map<
    FakeEditor,
    readonly NormalEditorReviewedDecoration[] | Promise<readonly NormalEditorReviewedDecoration[]>
  >();

  private readonly visibleListeners: Array<() => void | Promise<void>> = [];
  private readonly activeListeners: Array<() => void | Promise<void>> = [];
  private readonly settingsListeners: Array<() => void | Promise<void>> = [];

  public getVisibleEditors(): readonly FakeEditor[] {
    return this.visibleEditors;
  }

  public isDiffEditor(editor: FakeEditor): boolean {
    return editor.diff === true;
  }

  public getSettings(): NormalEditorDecorationSettings {
    return { ...this.settings };
  }

  public async loadDecorations(
    editor: FakeEditor,
    showGlobalReviewed: boolean
  ): Promise<readonly NormalEditorReviewedDecoration[]> {
    this.loadCalls.push({ editor, showGlobalReviewed });
    return this.models.get(editor) ?? [];
  }

  public createDecorationType(
    settings: NormalEditorDecorationSettings
  ): FakeDecorationType {
    const decorationType = new FakeDecorationType({ ...settings });
    this.decorationTypes.push(decorationType);
    return decorationType;
  }

  public setDecorations(
    editor: FakeEditor,
    decorationType: FakeDecorationType,
    decorations: readonly NormalEditorReviewedDecoration[]
  ): void {
    this.setCalls.push({ editor, decorationType, decorations });
  }

  public onDidChangeVisibleEditors(
    listener: () => void | Promise<void>
  ): DecorationDisposable {
    this.visibleListeners.push(listener);
    return new FakeDisposable();
  }

  public onDidChangeActiveEditor(
    listener: () => void | Promise<void>
  ): DecorationDisposable {
    this.activeListeners.push(listener);
    return new FakeDisposable();
  }

  public onDidChangeSettings(
    listener: () => void | Promise<void>
  ): DecorationDisposable {
    this.settingsListeners.push(listener);
    return new FakeDisposable();
  }

  public showDecorationError(error: unknown): void {
    this.errors.push(error);
  }

  public async fireVisibleEditorsChanged(): Promise<void> {
    await Promise.all(this.visibleListeners.map(async (listener) => listener()));
  }

  public async fireActiveEditorChanged(): Promise<void> {
    await Promise.all(this.activeListeners.map(async (listener) => listener()));
  }

  public async fireSettingsChanged(): Promise<void> {
    await Promise.all(this.settingsListeners.map(async (listener) => listener()));
  }
}

const decoration = (
  startLine: number,
  endLineExclusive: number
): NormalEditorReviewedDecoration => ({
  interval: { startLine, endLineExclusive },
  source: "context",
  contextLabel: "Workspace review",
  reviewedAt: "2026-07-23T09:30:00.000Z",
  globalActive: true
});

test("controller loads only visible normal editors and clears visible diff editors", async () => {
  const normalEditor: FakeEditor = { id: "normal" };
  const diffEditor: FakeEditor = { id: "diff", diff: true };
  const hiddenEditor: FakeEditor = { id: "hidden" };
  const host = new FakeHost();
  host.visibleEditors = [normalEditor, diffEditor];
  host.models.set(normalEditor, [decoration(1, 3)]);
  host.models.set(hiddenEditor, [decoration(4, 5)]);
  const controller = new NormalEditorDecorationController(host);

  await controller.start();

  assert.deepEqual(host.loadCalls, [
    { editor: normalEditor, showGlobalReviewed: true }
  ]);
  assert.deepEqual(host.setCalls, [
    {
      editor: normalEditor,
      decorationType: host.decorationTypes[0],
      decorations: [decoration(1, 3)]
    },
    {
      editor: diffEditor,
      decorationType: host.decorationTypes[0],
      decorations: []
    }
  ]);
  assert.equal(host.loadCalls.some(({ editor }) => editor === hiddenEditor), false);
});

test("controller ignores a stale async result after the editor stops being visible", async () => {
  const editor: FakeEditor = { id: "normal" };
  let resolveModel: ((value: readonly NormalEditorReviewedDecoration[]) => void) | undefined;
  const deferredModel = new Promise<readonly NormalEditorReviewedDecoration[]>((resolve) => {
    resolveModel = resolve;
  });
  const host = new FakeHost();
  host.visibleEditors = [editor];
  host.models.set(editor, deferredModel);
  const controller = new NormalEditorDecorationController(host);

  const initialRefresh = controller.start();
  host.visibleEditors = [];
  const visibilityRefresh = host.fireVisibleEditorsChanged();
  resolveModel!([decoration(2, 4)]);
  await Promise.all([initialRefresh, visibilityRefresh]);

  assert.deepEqual(host.setCalls, []);
});

test("controller recreates theme decoration type and refreshes on settings change", async () => {
  const editor: FakeEditor = { id: "normal" };
  const host = new FakeHost();
  host.visibleEditors = [editor];
  host.models.set(editor, [decoration(0, 1)]);
  const controller = new NormalEditorDecorationController(host);
  await controller.start();
  const initialType = host.decorationTypes[0]!;

  host.settings = {
    showGlobalReviewed: false,
    showGutterIcon: false,
    showOverviewRuler: true
  };
  await host.fireSettingsChanged();

  assert.equal(initialType.disposed, true);
  assert.deepEqual(host.decorationTypes.map(({ settings }) => settings), [
    {
      showGlobalReviewed: true,
      showGutterIcon: true,
      showOverviewRuler: false
    },
    {
      showGlobalReviewed: false,
      showGutterIcon: false,
      showOverviewRuler: true
    }
  ]);
  assert.deepEqual(host.loadCalls.at(-1), {
    editor,
    showGlobalReviewed: false
  });
  assert.equal(host.setCalls.at(-1)?.decorationType, host.decorationTypes[1]);
});

test("controller refreshes a visible editor immediately after a state update", async () => {
  const editor: FakeEditor = { id: "normal" };
  const host = new FakeHost();
  host.visibleEditors = [editor];
  host.models.set(editor, []);
  const controller = new NormalEditorDecorationController(host);
  await controller.start();

  host.models.set(editor, [decoration(3, 5)]);
  await controller.refreshEditor(editor);

  assert.deepEqual(host.setCalls.at(-1), {
    editor,
    decorationType: host.decorationTypes[0],
    decorations: [decoration(3, 5)]
  });
});

test("applied commands refresh every visible split editor for the same document", async () => {
  const sourceEditor: FakeEditor = { id: "source-editor" };
  const splitEditor: FakeEditor = { id: "split-editor" };
  const host = new FakeHost();
  host.visibleEditors = [sourceEditor, splitEditor];
  host.models.set(sourceEditor, []);
  host.models.set(splitEditor, []);
  const controller = new NormalEditorDecorationController(host);
  await controller.start();

  host.models.set(sourceEditor, [decoration(1, 2)]);
  host.models.set(splitEditor, [decoration(1, 2)]);
  const handlers = createRefreshingNormalEditorReviewCommandHandlers(
    {
      markSelectionReviewed: async () => "applied",
      unmarkSelectionReviewed: async () => "cancelled",
      markFileReviewed: async () => "no-op",
      unmarkFileReviewed: async () => "no-op"
    },
    controller
  );

  await handlers.markSelectionReviewed(sourceEditor);

  assert.deepEqual(host.setCalls.slice(-2), [
    {
      editor: sourceEditor,
      decorationType: host.decorationTypes[0],
      decorations: [decoration(1, 2)]
    },
    {
      editor: splitEditor,
      decorationType: host.decorationTypes[0],
      decorations: [decoration(1, 2)]
    }
  ]);
  await handlers.unmarkSelectionReviewed(sourceEditor);
  assert.equal(host.setCalls.length, 4);
});

test("controller clears uncertain output and reports decoration load errors", async () => {
  const editor: FakeEditor = { id: "normal" };
  const failure = new Error("state load failed");
  const host = new FakeHost();
  host.visibleEditors = [editor];
  host.models.set(editor, Promise.reject(failure));
  const controller = new NormalEditorDecorationController(host);

  await controller.start();

  assert.deepEqual(host.setCalls, [
    {
      editor,
      decorationType: host.decorationTypes[0],
      decorations: []
    }
  ]);
  assert.deepEqual(host.errors, [failure]);
});

test("controller event handlers refresh visible editors and dispose all resources", async () => {
  const editor: FakeEditor = { id: "normal" };
  const host = new FakeHost();
  host.visibleEditors = [editor];
  host.models.set(editor, [decoration(1, 2)]);
  const controller = new NormalEditorDecorationController(host);
  await controller.start();
  const callsAfterStart = host.loadCalls.length;

  await host.fireActiveEditorChanged();
  await host.fireVisibleEditorsChanged();
  assert.equal(host.loadCalls.length, callsAfterStart + 2);

  const activeType = host.decorationTypes.at(-1)!;
  controller.dispose();
  assert.equal(activeType.disposed, true);
});

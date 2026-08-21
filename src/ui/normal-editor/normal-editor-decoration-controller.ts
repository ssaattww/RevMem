import type {
  NormalEditorReviewedDecoration
} from "../../application/editor-decoration/index";

/** Minimal disposable contract shared with VS Code event and decoration handles. */
export interface DecorationDisposable {
  dispose(): void;
}

/** User settings that affect normal-editor reviewed-range decoration. */
export interface NormalEditorDecorationSettings {
  readonly showGlobalReviewed: boolean;
  readonly showGutterIcon: boolean;
  readonly showOverviewRuler: boolean;
}

/** Deterministic work budget for copying a loaded decoration model before one VS Code apply. */
export interface NormalEditorDecorationWorkBudget {
  readonly maxDecorationsPerStage: number;
  readonly yieldControl: () => void | Promise<void>;
}

/** Identity and cancellation fence passed through the production decoration load path. */
export interface NormalEditorDecorationLoadContext {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}

const DEFAULT_WORK_BUDGET: NormalEditorDecorationWorkBudget = Object.freeze({
  maxDecorationsPerStage: 128,
  yieldControl: async () => await Promise.resolve()
});

/** Platform boundary used to keep decoration orchestration independent from VS Code. */
export interface NormalEditorDecorationHost<
  Editor,
  DecorationType extends DecorationDisposable
> {
  /** Returns only editors currently visible to the user. */
  getVisibleEditors(): readonly Editor[];
  /** Identifies diff editors, which T106 intentionally leaves undecorated. */
  isDiffEditor(editor: Editor): boolean;
  /** Reads the current settings snapshot. */
  getSettings(): NormalEditorDecorationSettings;
  /** Loads certain, non-overlapping decoration ranges for one visible editor. */
  loadDecorations(
    editor: Editor,
    showGlobalReviewed: boolean,
    context: NormalEditorDecorationLoadContext
  ): Promise<readonly NormalEditorReviewedDecoration[]>;
  /** Creates the theme-aware platform decoration type for one settings snapshot. */
  createDecorationType(settings: NormalEditorDecorationSettings): DecorationType;
  /** Replaces all reviewed-range decorations for one editor and decoration type. */
  setDecorations(
    editor: Editor,
    decorationType: DecorationType,
    decorations: readonly NormalEditorReviewedDecoration[],
    context: NormalEditorDecorationLoadContext
  ): void | Promise<void>;
  /** Subscribes to visible-editor changes. */
  onDidChangeVisibleEditors(
    listener: () => void | Promise<void>
  ): DecorationDisposable;
  /** Subscribes to active-editor changes. */
  onDidChangeActiveEditor(
    listener: () => void | Promise<void>
  ): DecorationDisposable;
  /** Subscribes only to decoration-relevant setting changes. */
  onDidChangeSettings(
    listener: () => void | Promise<void>
  ): DecorationDisposable;
  /** Reports a failed state load after the uncertain editor output has been cleared. */
  showDecorationError(error: unknown): void | Promise<void>;
}

/**
 * Keeps reviewed-range decoration synchronized for visible normal editors only.
 *
 * Refreshes are intentionally not debounced so a committed review command can call
 * `refreshEditor` immediately. Per-editor request generations prevent a slower stale
 * load from overwriting a newer editor, visibility, or settings state.
 */
export class NormalEditorDecorationController<
  Editor,
  DecorationType extends DecorationDisposable
> implements DecorationDisposable {
  private decorationType: DecorationType | undefined;
  private readonly subscriptions: DecorationDisposable[] = [];
  private readonly requestGeneration = new Map<Editor, number>();
  private readonly requestCancellation = new Map<Editor, AbortController>();
  private nextGeneration = 0;
  private started = false;
  private disposed = false;

  public constructor(
    private readonly host: NormalEditorDecorationHost<Editor, DecorationType>,
    private readonly workBudget: NormalEditorDecorationWorkBudget = DEFAULT_WORK_BUDGET
  ) {
    if (!Number.isSafeInteger(workBudget.maxDecorationsPerStage) || workBudget.maxDecorationsPerStage <= 0) {
      throw new RangeError("maxDecorationsPerStage must be a positive integer.");
    }
  }

  /** Registers editor/settings listeners and performs the initial visible-editor refresh. */
  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("A disposed decoration controller cannot be started.");
    }

    if (!this.started) {
      this.started = true;
      this.decorationType = this.host.createDecorationType(this.host.getSettings());
      this.subscriptions.push(
        this.host.onDidChangeVisibleEditors(() => this.refreshVisibleEditors()),
        this.host.onDidChangeActiveEditor(() => this.refreshVisibleEditors()),
        this.host.onDidChangeSettings(() => this.refreshSettings())
      );
    }

    await this.refreshVisibleEditors();
  }

  /** Refreshes every currently visible editor and invalidates loads for hidden editors. */
  public async refreshVisibleEditors(): Promise<void> {
    if (!this.started || this.disposed) {
      return;
    }

    const visibleEditors = this.host.getVisibleEditors();
    for (const editor of this.requestGeneration.keys()) {
      if (!visibleEditors.includes(editor)) {
        this.requestCancellation.get(editor)?.abort();
        this.requestGeneration.set(editor, ++this.nextGeneration);
      }
    }

    await Promise.all(visibleEditors.map(async (editor) => this.refreshEditor(editor)));
  }

  /** Refreshes one editor immediately when it remains visible. */
  public async refreshEditor(editor: Editor): Promise<void> {
    const decorationType = this.decorationType;
    if (
      !this.started ||
      this.disposed ||
      decorationType === undefined ||
      !this.host.getVisibleEditors().includes(editor)
    ) {
      return;
    }

    const generation = ++this.nextGeneration;
    this.requestCancellation.get(editor)?.abort();
    const cancellation = new AbortController();
    this.requestCancellation.set(editor, cancellation);
    this.requestGeneration.set(editor, generation);

    if (this.host.isDiffEditor(editor)) {
      await this.host.setDecorations(editor, decorationType, [], {
        signal: cancellation.signal,
        isCurrent: () => this.canApply(editor, generation, decorationType, cancellation)
      });
      return;
    }

    const settings = this.host.getSettings();
    try {
      const decorations = await this.host.loadDecorations(
        editor,
        settings.showGlobalReviewed,
        {
          signal: cancellation.signal,
          isCurrent: () => this.canApply(editor, generation, decorationType, cancellation)
        }
      );
      const projected = await this.copyDecorationsIncrementally(
        decorations,
        () => this.canApply(editor, generation, decorationType, cancellation)
      );
      if (projected === undefined || !this.canApply(editor, generation, decorationType, cancellation)) {
        return;
      }
      await this.host.setDecorations(editor, decorationType, projected, {
        signal: cancellation.signal,
        isCurrent: () => this.canApply(editor, generation, decorationType, cancellation)
      });
    } catch (error) {
      if (!this.canApply(editor, generation, decorationType, cancellation)) {
        return;
      }
      await this.host.setDecorations(editor, decorationType, [], {
        signal: cancellation.signal,
        isCurrent: () => this.canApply(editor, generation, decorationType, cancellation)
      });
      await this.host.showDecorationError(error);
    }
  }

  /** Disposes listeners and the active platform decoration type. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.invalidateAllRequests();
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
    this.decorationType?.dispose();
    this.decorationType = undefined;
  }

  private canApply(
    editor: Editor,
    generation: number,
    decorationType: DecorationType,
    cancellation?: AbortController
  ): boolean {
    return (
      !this.disposed &&
      this.decorationType === decorationType &&
      this.requestGeneration.get(editor) === generation &&
      (cancellation === undefined || (this.requestCancellation.get(editor) === cancellation && !cancellation.signal.aborted)) &&
      this.host.getVisibleEditors().includes(editor)
    );
  }

  private async copyDecorationsIncrementally(
    decorations: readonly NormalEditorReviewedDecoration[],
    isCurrent: () => boolean
  ): Promise<readonly NormalEditorReviewedDecoration[] | undefined> {
    const projected: NormalEditorReviewedDecoration[] = [];
    for (let start = 0; start < decorations.length; start += this.workBudget.maxDecorationsPerStage) {
      if (!isCurrent()) return undefined;
      const end = Math.min(start + this.workBudget.maxDecorationsPerStage, decorations.length);
      for (let index = start; index < end; index += 1) {
        const decoration = decorations[index]!;
        projected.push({ ...decoration, interval: { ...decoration.interval } });
      }
      await this.workBudget.yieldControl();
      if (!isCurrent()) return undefined;
    }
    return projected;
  }

  private async refreshSettings(): Promise<void> {
    if (!this.started || this.disposed) {
      return;
    }

    this.invalidateAllRequests();
    this.decorationType?.dispose();
    this.decorationType = this.host.createDecorationType(this.host.getSettings());
    await this.refreshVisibleEditors();
  }

  private invalidateAllRequests(): void {
    for (const editor of this.requestGeneration.keys()) {
      this.requestCancellation.get(editor)?.abort();
      this.requestGeneration.set(editor, ++this.nextGeneration);
    }
  }
}

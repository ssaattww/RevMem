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
    showGlobalReviewed: boolean
  ): Promise<readonly NormalEditorReviewedDecoration[]>;
  /** Creates the theme-aware platform decoration type for one settings snapshot. */
  createDecorationType(settings: NormalEditorDecorationSettings): DecorationType;
  /** Replaces all reviewed-range decorations for one editor and decoration type. */
  setDecorations(
    editor: Editor,
    decorationType: DecorationType,
    decorations: readonly NormalEditorReviewedDecoration[]
  ): void;
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
  private nextGeneration = 0;
  private started = false;
  private disposed = false;

  public constructor(
    private readonly host: NormalEditorDecorationHost<Editor, DecorationType>
  ) {}

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
        this.requestGeneration.set(editor, ++this.nextGeneration);
      }
    }

    for (const editor of visibleEditors) {
      await this.refreshEditor(editor);
    }
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
    this.requestGeneration.set(editor, generation);

    if (this.host.isDiffEditor(editor)) {
      this.host.setDecorations(editor, decorationType, []);
      return;
    }

    const settings = this.host.getSettings();
    try {
      const decorations = await this.host.loadDecorations(
        editor,
        settings.showGlobalReviewed
      );
      if (!this.canApply(editor, generation, decorationType)) {
        return;
      }
      this.host.setDecorations(editor, decorationType, decorations);
    } catch (error) {
      if (!this.canApply(editor, generation, decorationType)) {
        return;
      }
      this.host.setDecorations(editor, decorationType, []);
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
    decorationType: DecorationType
  ): boolean {
    return (
      !this.disposed &&
      this.decorationType === decorationType &&
      this.requestGeneration.get(editor) === generation &&
      this.host.getVisibleEditors().includes(editor)
    );
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
      this.requestGeneration.set(editor, ++this.nextGeneration);
    }
  }
}

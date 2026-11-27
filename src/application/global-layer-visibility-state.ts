/** Storage for a display preference, separate from shared workspace settings. */
export interface GlobalLayerVisibilityStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = "reviewRange.globalLayerVisibility.v1";
type Preference = { readonly selected: boolean; readonly settingAtSave: boolean };

/** Commits display changes serially, only after the workspace state accepts them. */
export class GlobalLayerVisibilityState {
  private state: Preference;
  private observedSetting: boolean;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly store: GlobalLayerVisibilityStore, initialSetting: boolean) {
    this.observedSetting = initialSetting;
    const saved = store.get<Partial<Preference> | null>(KEY);
    this.state = typeof saved?.selected === "boolean" && typeof saved.settingAtSave === "boolean"
      ? { selected: saved.selected, settingAtSave: saved.settingAtSave }
      : { selected: initialSetting, settingAtSave: initialSetting };
  }

  public isEnabled(): boolean {
    return this.state.selected;
  }

  public toggle(): Promise<boolean> {
    return this.enqueue(async () => {
      const next = !this.state.selected;
      await this.save(next, this.observedSetting);
      return next;
    });
  }

  public applySetting(setting: boolean): Promise<boolean> {
    return this.enqueue(async () => {
      this.observedSetting = setting;
      if (setting === this.state.settingAtSave) return false;
      const changed = setting !== this.state.selected;
      await this.save(setting, setting);
      return changed;
    });
  }

  private async save(selected: boolean, settingAtSave: boolean): Promise<void> {
    const next = { selected, settingAtSave };
    await this.store.update(KEY, next);
    this.state = next;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** Coordinates a transient Viewed overlay without storing or changing review progress. */
export class GitHubViewedDisplayController {
  private epoch = 0;
  private pending: AbortController | undefined;
  private localChanges = 0;

  public constructor(private readonly clear: () => void) {}

  public invalidate(): number {
    this.epoch += 1;
    this.pending?.abort();
    this.pending = undefined;
    this.clear();
    return this.epoch;
  }

  public beginLocalChange(): () => void {
    this.localChanges += 1;
    this.invalidate();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.localChanges -= 1;
      this.invalidate();
    };
  }

  public async read<T>(input: {
    readonly epoch: number;
    readonly enabled: boolean;
    readonly isSourceCurrent: () => boolean;
    readonly run: (context: {
      readonly generation: number;
      readonly isCurrent: () => boolean;
      readonly signal: AbortSignal;
    }) => Promise<T | undefined>;
    readonly publish: (value: T, current: () => boolean) => void;
  }): Promise<void> {
    if (!input.enabled || this.localChanges !== 0 ||
        input.epoch !== this.epoch || !input.isSourceCurrent()) return;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const isCurrent = (): boolean => !controller.signal.aborted &&
      this.localChanges === 0 && input.epoch === this.epoch && input.isSourceCurrent();
    try {
      const value = await input.run({ generation: input.epoch, isCurrent, signal: controller.signal });
      if (value !== undefined && isCurrent()) input.publish(value, isCurrent);
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }
}

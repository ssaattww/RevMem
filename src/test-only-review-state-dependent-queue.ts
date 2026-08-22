/** Test-only names for background projections triggered after a durable review-state command. */
export type TestReviewStateDependentName =
  | "global"
  | "pull-request-progress"
  | "review-contexts";

type TestDependentWork = (signal: AbortSignal) => void | Promise<void>;

/**
 * Contains Test-mode background fakes so a public review command remains
 * complete at its durable state/history boundary.
 */
export class TestReviewStateDependentQueue {
  private readonly controller = new AbortController();
  private readonly failures: TestReviewStateDependentName[] = [];
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly work: Readonly<Record<TestReviewStateDependentName, TestDependentWork>>
  ) {}

  /** Queues the named test fakes in the same projection order as production listeners. */
  public enqueueAll(): void {
    for (const name of ["global", "pull-request-progress", "review-contexts"] as const) {
      this.tail = this.tail.then(async () => {
        if (this.controller.signal.aborted) return;
        try {
          await this.work[name](this.controller.signal);
        } catch {
          if (!this.controller.signal.aborted) this.failures.push(name);
        }
      });
    }
  }

  /** Waits only for tests that deliberately inspect background fake completion. */
  public drainForTest(): Promise<void> {
    return this.tail;
  }

  /** Returns contained non-abort fake failures without exposing a rejecting background promise. */
  public failuresForTest(): readonly TestReviewStateDependentName[] {
    return [...this.failures];
  }

  /** Prevents queued fakes from publishing after Extension Host teardown. */
  public dispose(): void {
    this.controller.abort();
  }
}

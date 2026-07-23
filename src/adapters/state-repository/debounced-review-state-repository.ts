import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "./contracts";

/** Persistence surface wrapped by the lifecycle-aware debounce adapter. */
export interface ReviewStatePersistenceDelegate {
  load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined>;
  save(target: ReviewStateRepositoryTarget, commit: ReviewStateCommit): Promise<void>;
  commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void>;
}

/** Timer boundary injected to make debounce and deactivation behavior deterministic in tests. */
export interface ReviewStateSaveScheduler {
  schedule(callback: () => void, delayMilliseconds: number): unknown;
  cancel(handle: unknown): void;
}

/** Constructor options for lifecycle-aware review-state persistence. */
export interface DebouncedReviewStateRepositoryOptions {
  /** Atomic repository that owns actual load, save, and transaction commit operations. */
  readonly delegate: ReviewStatePersistenceDelegate;
  /** Delay used only for background complete-snapshot saves. */
  readonly debounceMilliseconds?: number;
  /** Optional deterministic timer implementation. */
  readonly scheduler?: ReviewStateSaveScheduler;
}

interface SaveWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface PendingSave {
  readonly target: ReviewStateRepositoryTarget;
  commit: ReviewStateCommit;
  timerHandle: unknown;
  readonly waiters: SaveWaiter[];
}

const DEFAULT_SAVE_DEBOUNCE_MILLISECONDS = 50;

const defaultScheduler: ReviewStateSaveScheduler = {
  schedule: (callback, delayMilliseconds) =>
    setTimeout(callback, delayMilliseconds),
  cancel: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

const targetKey = (
  target: Pick<ReviewStateRepositoryTarget, "repositoryId" | "contextId">
): string => `${target.repositoryId}\u0000${target.contextId}`;

/**
 * Coalesces background state saves while preserving immediate command commits.
 *
 * `save` is the background complete-snapshot path used by mapping/lifecycle work. Calls for
 * one context are coalesced and all callers complete only after the newest snapshot is written.
 * `commit` first flushes pending state for the same context and then delegates immediately, so
 * a confirmation command cannot display success before its atomic transaction is durable.
 * `dispose` is the Extension Host deactivation boundary and flushes every pending save.
 */
export class DebouncedReviewStateRepository {
  private readonly debounceMilliseconds: number;
  private readonly scheduler: ReviewStateSaveScheduler;
  private readonly pendingByTarget = new Map<string, PendingSave>();
  private readonly operationByTarget = new Map<string, Promise<unknown>>();
  private disposed = false;

  public constructor(
    private readonly options: DebouncedReviewStateRepositoryOptions
  ) {
    const debounceMilliseconds =
      options.debounceMilliseconds ?? DEFAULT_SAVE_DEBOUNCE_MILLISECONDS;
    if (!Number.isSafeInteger(debounceMilliseconds) || debounceMilliseconds < 0) {
      throw new RangeError(
        "debounceMilliseconds must be a non-negative safe integer."
      );
    }

    this.debounceMilliseconds = debounceMilliseconds;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  /** Loads after any pending save for the same context has reached durable storage. */
  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    this.assertNotDisposed();
    const key = targetKey(target);
    await this.flushPendingTarget(key);
    return this.enqueue(key, () => this.options.delegate.load(target));
  }

  /**
   * Schedules one complete snapshot for delayed persistence.
   *
   * Repeated calls for the same context reset the timer and retain only the newest snapshot.
   * Every returned promise resolves or rejects with that eventual write, never at schedule time.
   */
  public save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new Error("Debounced review-state repository has been disposed.")
      );
    }

    const key = targetKey(target);
    return new Promise<void>((resolve, reject) => {
      const existing = this.pendingByTarget.get(key);
      if (existing !== undefined) {
        this.scheduler.cancel(existing.timerHandle);
        existing.commit = commit;
        existing.waiters.push({ resolve, reject });
        existing.timerHandle = this.scheduleFlush(key);
        return;
      }

      const pending: PendingSave = {
        target: { ...target },
        commit,
        timerHandle: undefined,
        waiters: [{ resolve, reject }]
      };
      pending.timerHandle = this.scheduleFlush(key);
      this.pendingByTarget.set(key, pending);
    });
  }

  /** Flushes pending background state for this context, then commits the command immediately. */
  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    this.assertNotDisposed();
    const key = targetKey(transaction);
    await this.flushPendingTarget(key);
    await this.enqueue(key, () => this.options.delegate.commit(transaction));
  }

  /** Flushes every pending background snapshot and waits for all in-flight operations. */
  public async flush(): Promise<void> {
    const failures: unknown[] = [];

    const pendingResults = await Promise.allSettled(
      [...this.pendingByTarget.keys()].map((key) => this.flushPendingTarget(key))
    );
    for (const result of pendingResults) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }

    const inFlightResults = await Promise.allSettled([
      ...this.operationByTarget.values()
    ]);
    for (const result of inFlightResults) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }

    if (failures.length > 0) {
      throw failures[0];
    }
  }

  /** Stops new work and flushes pending state for Extension Host deactivation. */
  public async dispose(): Promise<void> {
    if (this.disposed) {
      await this.flush();
      return;
    }

    this.disposed = true;
    await this.flush();
  }

  private scheduleFlush(key: string): unknown {
    return this.scheduler.schedule(() => {
      void this.flushPendingTarget(key).catch(() => undefined);
    }, this.debounceMilliseconds);
  }

  private async flushPendingTarget(key: string): Promise<void> {
    const pending = this.pendingByTarget.get(key);
    if (pending === undefined) {
      const inFlight = this.operationByTarget.get(key);
      if (inFlight !== undefined) {
        await inFlight;
      }
      return;
    }

    this.pendingByTarget.delete(key);
    this.scheduler.cancel(pending.timerHandle);

    try {
      await this.enqueue(key, () =>
        this.options.delegate.save(pending.target, pending.commit)
      );
      for (const waiter of pending.waiters) {
        waiter.resolve();
      }
    } catch (error) {
      for (const waiter of pending.waiters) {
        waiter.reject(error);
      }
      throw error;
    }
  }

  private async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationByTarget.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operationByTarget.set(key, current);

    try {
      return await current;
    } finally {
      if (this.operationByTarget.get(key) === current) {
        this.operationByTarget.delete(key);
      }
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Debounced review-state repository has been disposed.");
    }
  }
}

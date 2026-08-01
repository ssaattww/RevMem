import type {
  GitReviewContextRepositorySnapshot,
  GitStateChange,
  GitStateMonitorSchedule,
  GitStateMonitorScheduler,
  PollingGitStateMonitorOptions
} from "./contracts";

const DEFAULT_INTERVAL_MS = 1000;

interface ObservedGitState {
  readonly generation: number;
  readonly snapshot: GitReviewContextRepositorySnapshot | undefined;
}

const cloneSnapshot = (
  snapshot: GitReviewContextRepositorySnapshot
): GitReviewContextRepositorySnapshot => ({
  repositoryId: snapshot.repositoryId,
  rootPath: snapshot.rootPath,
  branch: snapshot.branch.kind === "branch"
    ? { kind: "branch", fullRef: snapshot.branch.fullRef }
    : { kind: "detached" },
  ...(snapshot.head === undefined ? {} : { head: snapshot.head })
});

const fingerprint = (
  snapshot: GitReviewContextRepositorySnapshot | undefined
): string => snapshot === undefined
  ? "not-repository"
  : JSON.stringify({
      repositoryId: snapshot.repositoryId,
      rootPath: snapshot.rootPath,
      branch: snapshot.branch,
      head: snapshot.head ?? null
    });

const defaultScheduler: GitStateMonitorScheduler = {
  scheduleRepeating: (callback, intervalMs): GitStateMonitorSchedule => {
    const handle = setInterval(callback, intervalMs);
    if (
      typeof handle === "object" &&
      handle !== null &&
      "unref" in handle &&
      typeof handle.unref === "function"
    ) {
      handle.unref();
    }
    return {
      dispose: () => clearInterval(handle)
    };
  }
};

/** Polls observed Git roots and emits only distinct branch/HEAD transitions. */
export class PollingGitStateMonitor {
  private readonly intervalMs: number;
  private readonly scheduler: GitStateMonitorScheduler;
  private readonly observed = new Map<string, ObservedGitState>();
  private schedule: GitStateMonitorSchedule | undefined;
  private activePoll: Promise<void> | undefined;
  private disposed = false;

  /** Creates an idle monitor; call {@link start} after registering observations. */
  public constructor(private readonly options: PollingGitStateMonitorOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new RangeError("intervalMs must be a positive safe integer.");
    }
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  /** Registers a repository root and advances its baseline generation with the already inspected snapshot. */
  public observe(
    rootPath: string,
    snapshot: GitReviewContextRepositorySnapshot
  ): void {
    if (this.disposed) {
      return;
    }
    if (rootPath.trim().length === 0 || rootPath.includes("\0")) {
      throw new TypeError("rootPath must be a non-empty path without null characters.");
    }
    const previous = this.observed.get(rootPath);
    this.observed.set(rootPath, {
      generation: (previous?.generation ?? 0) + 1,
      snapshot: cloneSnapshot(snapshot)
    });
  }

  /** Starts one repeating poll schedule; repeated calls are idempotent. */
  public start(): void {
    if (this.disposed || this.schedule !== undefined) {
      return;
    }
    this.schedule = this.scheduler.scheduleRepeating(() => {
      void this.pollNow().catch((error: unknown) => {
        this.reportScheduledError(error);
      });
    }, this.intervalMs);
  }

  /** Runs one serialized poll across all observed roots. */
  public pollNow(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.activePoll !== undefined) {
      return this.activePoll;
    }
    const poll = this.pollObserved().finally(() => {
      if (this.activePoll === poll) {
        this.activePoll = undefined;
      }
    });
    this.activePoll = poll;
    return poll;
  }

  /** Stops polling and forgets all observations. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.schedule?.dispose();
    this.schedule = undefined;
    this.observed.clear();
  }

  private reportScheduledError(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      return;
    }
  }

  private async pollObserved(): Promise<void> {
    const failures: unknown[] = [];
    for (const [rootPath, observed] of [...this.observed.entries()]) {
      try {
        const { generation, snapshot: previous } = observed;
        const inspection = await this.options.inspector.inspectRepository(rootPath);
        const current = inspection.kind === "repository"
          ? cloneSnapshot(inspection.repository)
          : undefined;
        if (fingerprint(previous) === fingerprint(current)) {
          continue;
        }
        const change: GitStateChange = {
          rootPath,
          ...(previous === undefined ? {} : { previous: cloneSnapshot(previous) }),
          ...(current === undefined ? {} : { current: cloneSnapshot(current) })
        };
        await this.options.onDidChange(change);
        const latest = this.observed.get(rootPath);
        if (latest?.generation !== generation) {
          continue;
        }
        this.observed.set(rootPath, {
          generation,
          snapshot: current === undefined ? undefined : cloneSnapshot(current)
        });
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Git state polling failed for multiple repository roots."
      );
    }
  }
}

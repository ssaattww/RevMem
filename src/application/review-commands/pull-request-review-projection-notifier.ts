export interface PullRequestReviewProjectionSubscription {
  dispose(): void;
}

/** Runtime-owned async projection signal; no state is shared between Extension Hosts. */
export class PullRequestReviewProjectionNotifier {
  private readonly listeners = new Set<() => void | Promise<void>>();

  public subscribe(
    listener: () => void | Promise<void>
  ): PullRequestReviewProjectionSubscription {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  public async notify(): Promise<void> {
    for (const listener of [...this.listeners]) await listener();
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  PollingGitStateMonitor,
  type GitReviewContextRepositorySnapshot,
  type GitStateInspectionPort,
  type GitStateMonitorScheduler
} from "../../src/application/review-context/index";

const oldRevision = "0123456789abcdef0123456789abcdef01234567";
const newRevision = "89abcdef0123456789abcdef0123456789abcdef";
const rootPath = "/repo";

const snapshot = (head: string): GitReviewContextRepositorySnapshot => ({
  repositoryId: "github.com/example/review-range",
  rootPath,
  branch: { kind: "branch", fullRef: "refs/heads/main" },
  head
});

class ManualScheduler implements GitStateMonitorScheduler {
  public callback: (() => void) | undefined;

  public scheduleRepeating(callback: () => void): { dispose(): void } {
    this.callback = callback;
    return { dispose: () => undefined };
  }
}

class MutableInspector implements GitStateInspectionPort {
  public current = snapshot(oldRevision);

  public async inspectRepository(): Promise<{
    readonly kind: "repository";
    readonly repository: GitReviewContextRepositorySnapshot;
  }> {
    return { kind: "repository", repository: this.current };
  }
}

/** Timer-driven failures are reported and the same Git transition remains eligible for a later retry. */
test("scheduled polling reports and retries change-handler failures", async () => {
  const scheduler = new ManualScheduler();
  const inspector = new MutableInspector();
  const failure = new Error("mapping failed");
  let attempts = 0;
  let resolveReported: ((error: unknown) => void) | undefined;
  const reported = new Promise<unknown>((resolve) => {
    resolveReported = resolve;
  });
  const monitor = new PollingGitStateMonitor({
    inspector,
    scheduler,
    intervalMs: 100,
    onDidChange: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw failure;
      }
    },
    onError: (error) => {
      resolveReported?.(error);
    }
  });

  monitor.observe(rootPath, inspector.current);
  monitor.start();
  inspector.current = snapshot(newRevision);
  scheduler.callback?.();

  assert.equal(await reported, failure);
  await monitor.pollNow();
  assert.equal(attempts, 2);
  monitor.dispose();
});

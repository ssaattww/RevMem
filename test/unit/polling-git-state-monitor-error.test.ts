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
const failingRootPath = "/repo-failing";
const healthyRootPath = "/repo-healthy";

const snapshot = (
  root: string,
  head: string
): GitReviewContextRepositorySnapshot => ({
  repositoryId: `github.com/example${root}`,
  rootPath: root,
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
  public current = snapshot(rootPath, oldRevision);

  public async inspectRepository(): Promise<{
    readonly kind: "repository";
    readonly repository: GitReviewContextRepositorySnapshot;
  }> {
    return { kind: "repository", repository: this.current };
  }
}

class MultiRootInspector implements GitStateInspectionPort {
  public readonly outcomes = new Map<
    string,
    GitReviewContextRepositorySnapshot | Error
  >();

  public async inspectRepository(startPath: string): Promise<{
    readonly kind: "repository";
    readonly repository: GitReviewContextRepositorySnapshot;
  }> {
    const outcome = this.outcomes.get(startPath);
    assert.ok(outcome, `Missing inspection outcome for ${startPath}`);
    if (outcome instanceof Error) {
      throw outcome;
    }
    return { kind: "repository", repository: outcome };
  }
}

const createDeferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

/** A poll completion cannot overwrite a foreground observation registered while its callback was mapping. */
test("polling discards a stale callback completion after a newer observation", async () => {
  const inspector = new MutableInspector();
  const callbackStarted = createDeferred();
  const releaseCallback = createDeferred();
  const changes: string[] = [];
  const monitor = new PollingGitStateMonitor({
    inspector,
    onDidChange: async (change) => {
      changes.push(change.current?.head ?? "missing");
      callbackStarted.resolve();
      await releaseCallback.promise;
    }
  });

  monitor.observe(rootPath, inspector.current);
  inspector.current = snapshot(rootPath, newRevision);
  const polling = monitor.pollNow();
  await callbackStarted.promise;

  const foregroundRevision = "fedcba9876543210fedcba9876543210fedcba98";
  monitor.observe(rootPath, snapshot(rootPath, foregroundRevision));
  inspector.current = snapshot(rootPath, foregroundRevision);
  releaseCallback.resolve();
  await polling;
  await monitor.pollNow();

  assert.deepEqual(changes, [newRevision]);
  monitor.dispose();
});

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
  inspector.current = snapshot(rootPath, newRevision);
  scheduler.callback?.();

  assert.equal(await reported, failure);
  await monitor.pollNow();
  assert.equal(attempts, 2);
  monitor.dispose();
});

/** One root's inspection failure does not starve later roots and remains retryable. */
test("polling continues after an inspection failure in an earlier root", async () => {
  const inspector = new MultiRootInspector();
  const failure = new Error("Git inspection failed");
  const changes: string[] = [];
  const failingOld = snapshot(failingRootPath, oldRevision);
  const healthyOld = snapshot(healthyRootPath, oldRevision);
  inspector.outcomes.set(failingRootPath, failingOld);
  inspector.outcomes.set(healthyRootPath, healthyOld);
  const monitor = new PollingGitStateMonitor({
    inspector,
    onDidChange: (change) => {
      changes.push(change.rootPath);
    }
  });

  monitor.observe(failingRootPath, failingOld);
  monitor.observe(healthyRootPath, healthyOld);
  inspector.outcomes.set(failingRootPath, failure);
  inspector.outcomes.set(
    healthyRootPath,
    snapshot(healthyRootPath, newRevision)
  );

  await assert.rejects(
    () => monitor.pollNow(),
    (error: unknown) => error === failure
  );
  assert.deepEqual(changes, [healthyRootPath]);

  inspector.outcomes.set(
    failingRootPath,
    snapshot(failingRootPath, newRevision)
  );
  await monitor.pollNow();
  assert.deepEqual(changes, [healthyRootPath, failingRootPath]);
  monitor.dispose();
});

/** One root's callback failure does not starve later roots and its baseline remains retryable. */
test("polling continues after a change callback failure in an earlier root", async () => {
  const inspector = new MultiRootInspector();
  const failure = new Error("mapping callback failed");
  const changes: string[] = [];
  const attempts = new Map<string, number>();
  const failingOld = snapshot(failingRootPath, oldRevision);
  const healthyOld = snapshot(healthyRootPath, oldRevision);
  inspector.outcomes.set(failingRootPath, failingOld);
  inspector.outcomes.set(healthyRootPath, healthyOld);
  const monitor = new PollingGitStateMonitor({
    inspector,
    onDidChange: (change) => {
      const attempt = (attempts.get(change.rootPath) ?? 0) + 1;
      attempts.set(change.rootPath, attempt);
      if (change.rootPath === failingRootPath && attempt === 1) {
        throw failure;
      }
      changes.push(change.rootPath);
    }
  });

  monitor.observe(failingRootPath, failingOld);
  monitor.observe(healthyRootPath, healthyOld);
  inspector.outcomes.set(
    failingRootPath,
    snapshot(failingRootPath, newRevision)
  );
  inspector.outcomes.set(
    healthyRootPath,
    snapshot(healthyRootPath, newRevision)
  );

  await assert.rejects(
    () => monitor.pollNow(),
    (error: unknown) => error === failure
  );
  assert.deepEqual(changes, [healthyRootPath]);
  assert.equal(attempts.get(failingRootPath), 1);
  assert.equal(attempts.get(healthyRootPath), 1);

  await monitor.pollNow();
  assert.deepEqual(changes, [healthyRootPath, failingRootPath]);
  assert.equal(attempts.get(failingRootPath), 2);
  assert.equal(attempts.get(healthyRootPath), 1);
  monitor.dispose();
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  OperationFeedback,
  formatOperationLogEntry,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import {
  InMemoryReviewContextVisibilityStore,
  ReviewContextsController,
  projectReviewContexts,
} from "../../src/application/review-contexts/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";

const context = (
  contextId: string,
  kind: ReviewContextState["kind"],
  displayName: string,
  overrides: Partial<ReviewContextState> = {},
): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind,
  repositoryId: REPOSITORY_ID,
  displayName,
  files: {},
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
  ...overrides,
});

const branch = context("branch:main", "branch", "main", {
  branch: { refName: "refs/heads/main", headRevision: SHA_B },
});
const currentPr = context("github-pr:github.com/ssaattww/revmem#52", "pull-request", "PR #52", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "open",
    title: "Current PR",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const savedOpenPr = context("github-pr:github.com/ssaattww/revmem#51", "pull-request", "PR #51", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 51,
    state: "open",
    title: "Saved open",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const savedClosedPr = context("github-pr:github.com/ssaattww/revmem#50", "pull-request", "PR #50", {
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 50,
    state: "closed",
    title: "Saved closed",
    baseSha: SHA_A,
    headSha: SHA_B,
  },
});
const workspace = context("workspace:sample", "workspace", "sample", {
  workspace: { workspaceId: "sample", snapshotRevision: "snapshot-1" },
});

test("current PR and branch are shown with saved open/closed PR and workspace without duplicate current PR", () => {
  const items = projectReviewContexts({
    current: [currentPr, branch],
    saved: [savedClosedPr, currentPr, workspace, savedOpenPr],
    hiddenContextIds: new Set(),
  });

  assert.deepEqual(items.map((item) => [item.context.contextId, item.current, item.layerEnabled]), [
    [currentPr.contextId, true, true],
    [branch.contextId, true, undefined],
    [savedOpenPr.contextId, false, true],
    [savedClosedPr.contextId, false, false],
    [workspace.contextId, false, undefined],
  ]);
});

test("hidden presentation identity filters current and saved contexts without deleting state", () => {
  const hiddenContextIds = new Set([currentPr.contextId, savedClosedPr.contextId]);
  const items = projectReviewContexts({
    current: [currentPr, branch],
    saved: [currentPr, savedClosedPr],
    hiddenContextIds,
  });

  assert.deepEqual(items.map((item) => item.context.contextId), [branch.contextId]);
  assert.equal(currentPr.pullRequest?.state, "open");
});

test("controller hides only the presentation identity and delegates T405 operations without deleting review state", async () => {
  const visibility = new InMemoryReviewContextVisibilityStore();
  const calls: string[] = [];
  const controller = new ReviewContextsController({
    visibility,
    setPullRequestLayerEnabled: async (contextState, enabled) => {
      calls.push(`layer:${contextState.contextId}:${enabled}`);
    },
    refreshPullRequestCache: async (contextState) => {
      calls.push(`cache:${contextState.contextId}`);
    },
    openPullRequestDiff: async (contextState) => {
      calls.push(`diff:${contextState.contextId}`);
    },
    redetectPullRequest: async () => {
      calls.push("redetect");
    },
    reconnectGitHub: async () => {
      calls.push("reconnect");
    },
  });

  await controller.hide(savedClosedPr.contextId);
  assert.deepEqual(await visibility.readHiddenContextIds(), [savedClosedPr.contextId]);
  assert.equal(savedClosedPr.pullRequest?.state, "closed");

  await controller.setLayerEnabled(savedClosedPr, true);
  await controller.refreshCache(savedClosedPr);
  await controller.openDiff(savedClosedPr);
  await controller.redetectPullRequest();
  await controller.reconnectGitHub();

  assert.deepEqual(calls, [
    `layer:${savedClosedPr.contextId}:true`,
    `cache:${savedClosedPr.contextId}`,
    `diff:${savedClosedPr.contextId}`,
    "redetect",
    "reconnect",
  ]);
});


class FakeOperationFeedbackHost implements OperationFeedbackHost {
  public readonly statuses: Array<{ label: string; activeCount: number } | undefined> = [];
  public readonly logs: OperationLogEntry[] = [];
  public revealCount = 0;

  public showBusy(label: string, activeCount: number): void {
    this.statuses.push({ label, activeCount });
  }

  public clearBusy(): void {
    this.statuses.push(undefined);
  }

  public appendLog(entry: OperationLogEntry): void {
    this.logs.push(entry);
  }

  public revealLog(): void {
    this.revealCount += 1;
  }
}

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("reports start and success while keeping the busy status visible until completion", async () => {
  const host = new FakeOperationFeedbackHost();
  let now = 1_000;
  const feedback = new OperationFeedback(host, () => now);
  const gate = deferred<string>();

  const running = feedback.run("PR進捗を計算", () => gate.promise);

  assert.deepEqual(host.statuses, [{ label: "PR進捗を計算", activeCount: 1 }]);
  assert.deepEqual(host.logs.map((entry) => entry.event), ["started"]);

  now = 1_125;
  gate.resolve("done");
  assert.equal(await running, "done");

  assert.deepEqual(host.statuses, [
    { label: "PR進捗を計算", activeCount: 1 },
    undefined
  ]);
  assert.equal(host.logs[1]?.event, "succeeded");
  assert.equal(host.logs[1]?.durationMs, 125);
  assert.equal(host.revealCount, 0);
});

test("restores the previous operation status after a nested operation finishes", async () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 10);
  const outerGate = deferred<void>();
  const innerGate = deferred<void>();

  const outer = feedback.run("Review Contextsを更新", () => outerGate.promise);
  const inner = feedback.run("PR差分を取得", () => innerGate.promise);

  assert.deepEqual(host.statuses.at(-1), { label: "PR差分を取得", activeCount: 2 });

  innerGate.resolve();
  await inner;
  assert.deepEqual(host.statuses.at(-1), { label: "Review Contextsを更新", activeCount: 1 });

  outerGate.resolve();
  await outer;
  assert.equal(host.statuses.at(-1), undefined);
});

test("logs and reveals failures before rethrowing them", async () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 42);
  const failure = new Error("private repository authentication failed");

  await assert.rejects(
    feedback.run("PR差分を取得", async () => { throw failure; }),
    failure
  );

  assert.equal(host.logs.at(-1)?.event, "failed");
  assert.equal(host.logs.at(-1)?.message, failure.message);
  assert.equal(host.revealCount, 1);
  assert.equal(host.statuses.at(-1), undefined);
});

test("records a swallowed diagnostic failure without changing active status", () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 99);

  feedback.reportFailure("PR進捗を計算", new Error("diff unavailable"));

  assert.deepEqual(host.statuses, []);
  assert.equal(host.logs[0]?.event, "failed");
  assert.equal(host.logs[0]?.message, "diff unavailable");
  assert.equal(host.revealCount, 1);
});


test("formats one-line Output entries without exposing a stack trace", () => {
  assert.equal(
    formatOperationLogEntry({
      timestamp: "2026-08-18T00:00:00.000Z",
      label: "PR差分を取得",
      event: "failed",
      durationMs: 25,
      errorName: "Error",
      message: "first line\nsecond line"
    }),
    "[2026-08-18T00:00:00.000Z] ERROR PR差分を取得 (25 ms): Error: first line second line"
  );
});

test("does not duplicate the same Error when a UI error boundary reports it again", async () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 7);
  const failure = new Error("duplicate boundary");

  await assert.rejects(
    feedback.run("確認済み装飾を初期化", async () => { throw failure; }),
    failure
  );
  feedback.reportFailure("確認済み装飾を更新", failure);

  assert.equal(host.logs.filter((entry) => entry.event === "failed").length, 1);
  assert.equal(host.revealCount, 1);
});

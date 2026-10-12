import assert from "node:assert/strict";
import test from "node:test";

import { OperationFeedback, type OperationLogEntry } from "../../src/application/operation-feedback/index.js";

import {
  refreshAfterDocumentEdit,
  refreshCurrentContextDependents,
  refreshSelectedPullRequestProgress,
} from "../../src/application/review-context/projection-refresh.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

test("PR68-R003 source switch never publishes the previous PR snapshot under the new PR source", async () => {
  const gate = deferred<void>();
  let snapshot: string | undefined = "old-pr";
  const source = { id: "github-pr" };
  const sourceSwitchSnapshots: Array<string | undefined> = [];
  const refreshSnapshots: Array<string | undefined> = [];

  const refreshing = refreshSelectedPullRequestProgress({
    contextId: "new-pr",
    source,
    activateProgress: async () => {
      snapshot = undefined;
      await gate.promise;
      snapshot = "new-pr";
    },
    clearProgress: () => {
      snapshot = undefined;
    },
    setSource: (next) => {
      if (next === source) sourceSwitchSnapshots.push(snapshot);
    },
    refreshTree: () => {
      refreshSnapshots.push(snapshot);
    },
  });

  assert.deepEqual(sourceSwitchSnapshots, [undefined]);
  assert.equal(refreshSnapshots[0], undefined);
  gate.resolve();
  await refreshing;
  assert.equal(refreshSnapshots.at(-1), "new-pr");
});

test("PR68-R004 PR Progress failure cannot block new-owner decoration Global or Review Contexts refresh", async () => {
  const events: string[] = [];
  const progressError = new Error("progress failed");

  await refreshCurrentContextDependents({
    refreshPullRequestProgress: async () => {
      events.push("progress:start");
      throw progressError;
    },
    refreshDecorations: async () => {
      events.push("decorations:new-owner");
    },
    refreshGlobal: async () => {
      events.push("global:new-owner");
    },
    refreshReviewContexts: async () => {
      events.push("contexts:new-owner");
    },
    reportPullRequestProgressError: async (error) => {
      assert.equal(error, progressError);
      events.push("progress:reported");
    },
  });

  assert.deepEqual(events, [
    "contexts:new-owner",
    "progress:start",
    "decorations:new-owner",
    "global:new-owner",
    "progress:reported",
  ]);
});

test("Current Context records every Review Contexts, decorations, and Global failure under one terminal", async () => {
  const logs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog(entry) { logs.push(entry); }, revealLog() {} }, () => 4);
  const errors = [new Error("Review Contexts failed"), new Error("decorations failed"), new Error("Global failed")];
  await assert.rejects(feedback.run("Current Context dependents", () => refreshCurrentContextDependents({
    refreshReviewContexts: async () => { throw errors[0]; },
    refreshPullRequestProgress: async () => assert.fail("PR Progress requires a registered Review Contexts snapshot"),
    refreshDecorations: async () => { throw errors[1]; },
    refreshGlobal: async () => { throw errors[2]; },
    reportPullRequestProgressError: async () => undefined,
  })), (error: unknown) => error instanceof AggregateError && error.errors.length === 3);
  assert.deepEqual(logs.map((entry) => entry.event), ["started", "failed"]);
  assert.deepEqual(logs.at(-1)?.errorDetails?.causes?.map((cause) => cause.message), errors.map((error) => error.message));
});

test("PR Progress activation and final Tree failure retain both causes", async () => {
  const logs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog(entry) { logs.push(entry); }, revealLog() {} }, () => 5);
  const activationError = new Error("snapshot calculation failed");
  const treeError = Object.assign(new Error("tree publication failed token=fixture-tree-secret"), { code: "EACCES" });
  let treeRefreshes = 0;
  await assert.rejects(feedback.run("PR Progress projection", (context) => refreshSelectedPullRequestProgress({
    contextId: "context",
    source: "source",
    feedbackContext: context,
    activateProgress: async () => { throw activationError; },
    clearProgress() {}, setSource() {},
    refreshTree() { treeRefreshes += 1; if (treeRefreshes === 2) throw treeError; },
  })), (error: unknown) => error === activationError);
  assert.equal(treeRefreshes, 2);
  assert.deepEqual(logs.map((entry) => entry.event), ["started", "failed"]);
  const causes = logs.at(-1)?.errorDetails?.causes ?? [];
  assert.equal(causes.some((cause) => cause.message.includes("snapshot calculation failed")), true);
  assert.equal(causes.some((cause) => cause.message.includes("tree publication failed")), true);
  assert.doesNotMatch(logs.map((entry) => entry.message ?? "").join("\n"), /fixture-tree-secret/u);
});

test("PR68-R004 successful edit-state mutation keeps its success when only PR projection refresh fails", async () => {
  const events: string[] = [];
  const progressError = new Error("progress failed");

  await refreshAfterDocumentEdit({
    refreshPullRequestProgress: async () => {
      events.push("progress:start");
      throw progressError;
    },
    refreshDecorations: async () => {
      events.push("decorations");
    },
    refreshGlobal: async () => {
      events.push("global");
    },
    reportPullRequestProgressError: async (error) => {
      assert.equal(error, progressError);
      events.push("progress:reported");
    },
  });

  assert.deepEqual(events, [
    "progress:start",
    "decorations",
    "global",
    "progress:reported",
  ]);
});

test("T610-NR-006 decoration failure cannot block open-document Global reconciliation", async () => {
  const events: string[] = [];
  const decorationError = new Error("decoration failed");
  await assert.rejects(() => refreshCurrentContextDependents({
    refreshPullRequestProgress: async () => undefined,
    refreshDecorations: async () => { events.push("decorations"); throw decorationError; },
    refreshGlobal: async () => { events.push("global"); },
    refreshReviewContexts: async () => { events.push("contexts"); },
    reportPullRequestProgressError: async () => undefined,
  }), decorationError);
  assert.deepEqual(events, ["contexts", "decorations", "global"]);
});

test("Issue #84 Review Contexts registers the selected PR before PR Progress starts", async () => {
  let pullRequestRuntimeRegistered = false;
  let progressObservedRegistration = false;

  await refreshCurrentContextDependents({
    refreshPullRequestProgress: async () => {
      progressObservedRegistration = pullRequestRuntimeRegistered;
    },
    refreshDecorations: async () => undefined,
    refreshGlobal: async () => undefined,
    refreshReviewContexts: async () => {
      pullRequestRuntimeRegistered = true;
    },
    reportPullRequestProgressError: async () => undefined,
  });

  assert.equal(
    progressObservedRegistration,
    true,
    "PR Progress must not run before Review Contexts has registered the selected PR diff runtime",
  );
});

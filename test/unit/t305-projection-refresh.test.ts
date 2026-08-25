import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshAfterDocumentEdit,
  refreshCurrentContextDependents,
  refreshSelectedPullRequestProgress,
} from "../../src/t305-projection-refresh.js";

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
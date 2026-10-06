import assert from "node:assert/strict";
import test from "node:test";

const { CurrentContextRuntimeCoordinator } = await import(
  "../../test-dist/src/ui/current-context/current-context-runtime-coordinator.js"
);

test("Review Contexts refresh enters the same coordinator and orders selection before dependent PR Progress", async () => {
  const events = [];
  const selection = {
    kind: "pull-request",
    repositoryId: "opaque-repo",
    repositoryRoot: "/private/repo",
    contextId: "opaque-context",
    pullRequestNumber: 42,
  };
  const snapshot = { context: { kind: "pull-request", label: "#42", selection }, progress: undefined };
  const signal = { aborted: false };
  const feedbackContext = { owner: {}, id: 17 };
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async (actualSignal, actualFeedbackContext) => {
      assert.equal(actualSignal, signal);
      assert.equal(actualFeedbackContext, feedbackContext);
      events.push("recompute-current-context");
      return { snapshot, stale: false };
    },
  }, {
    setSelectedContext: (actualSelection) => {
      assert.equal(actualSelection, selection);
      events.push("accept-selection");
    },
    acceptCurrentContextPreparation: () => events.push("accept-pr-preparation"),
    refreshDependents: () => events.push("refresh-list-and-progress"),
  });

  assert.equal(typeof coordinator.refreshFromReviewContexts, "function",
    "the Review Contexts command needs an entry into the shared refresh coordinator");
  await coordinator.refreshFromReviewContexts(signal, feedbackContext);

  assert.deepEqual(events, [
    "recompute-current-context",
    "accept-selection",
    "accept-pr-preparation",
    "refresh-list-and-progress",
  ]);
});

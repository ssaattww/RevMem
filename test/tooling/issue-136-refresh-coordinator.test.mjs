import assert from "node:assert/strict";
import test from "node:test";

const { CurrentContextRuntimeCoordinator } = await import(
  "../../test-dist/src/ui/current-context/current-context-runtime-coordinator.js"
);
const { OperationFeedback } = await import(
  "../../test-dist/src/application/operation-feedback/operation-feedback.js"
);
const { refreshCurrentContextDependents } = await import(
  "../../test-dist/src/application/review-context/projection-refresh.js"
);
const { augmentCurrentContextCandidatesWithBranchFallback } = await import(
  "../../test-dist/src/ui/current-context/current-context-runtime-composition.js"
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

test("a superseded branch-list failure cannot clear a newer successful PR tree", async () => {
  let oldReject;
  let oldStarted;
  const oldFailure = new Promise((_, reject) => { oldReject = reject; });
  const began = new Promise((resolve) => { oldStarted = resolve; });
  let reads = 0;
  let tree = "old";
  const clears = [];
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({
      snapshot: { context: { kind: ++reads === 1 ? "branch" : "pull-request", label: "current" }, progress: undefined },
      stale: false,
    }),
  }, {
    refreshDependents: async ({ generation }) => {
      if (generation === 1) { oldStarted(); await oldFailure; }
      else tree = "new-pr-success";
    },
    clearPullRequestProgress: () => { clears.push("clear"); tree = "cleared"; },
  });
  const stale = coordinator.refreshFromReviewContexts();
  await began;
  await coordinator.refresh();
  assert.equal(tree, "new-pr-success");
  oldReject(new Error("stale list failure"));
  await stale;
  assert.equal(tree, "new-pr-success");
  assert.deepEqual(clears, []);
});

test("a delayed old success cannot publish over a newer explicit PR selection", async () => {
  let oldResolve;
  let oldStarted;
  const oldGate = new Promise((resolve) => { oldResolve = resolve; });
  const began = new Promise((resolve) => { oldStarted = resolve; });
  let refreshCount = 0;
  let tree = "old";
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({
      snapshot: { context: { kind: ++refreshCount === 1 ? "branch" : "pull-request", label: "selected" }, progress: undefined },
      stale: false,
    }),
    selectContext: async () => ({
      context: { kind: "pull-request", label: "#52", selection: { kind: "pull-request" } }, progress: undefined,
    }),
  }, {
    refreshDependents: async ({ generation }) => {
      if (generation === 1) { oldStarted(); await oldGate; return; }
      tree = "new-explicit-pr";
    },
    clearPullRequestProgress: () => { tree = "cleared"; },
  });
  const oldRefresh = coordinator.refreshFromReviewContexts();
  await began;
  await coordinator.selectContext();
  assert.equal(tree, "new-explicit-pr");
  oldResolve();
  await oldRefresh;
  assert.equal(tree, "new-explicit-pr");
});

test("a superseded cancelled branch refresh cannot clear a newer explicit PR selection", async () => {
  const { OperationCancelledError } = await import(
    "../../test-dist/src/application/operation-feedback/operation-feedback.js"
  );
  let oldReject;
  let oldStarted;
  const oldGate = new Promise((_, reject) => { oldReject = reject; });
  const began = new Promise((resolve) => { oldStarted = resolve; });
  let tree = "old";
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({
      snapshot: { context: { kind: "branch", label: "checked-out" }, progress: undefined },
      stale: false,
    }),
    selectContext: async () => ({
      context: { kind: "pull-request", label: "#52", selection: { kind: "pull-request" } }, progress: undefined,
    }),
  }, {
    refreshDependents: async ({ generation }) => {
      if (generation === 1) { oldStarted(); await oldGate; }
      tree = "new-explicit-pr";
    },
    clearPullRequestProgress: () => { tree = "cleared"; },
  });
  const oldRefresh = coordinator.refreshFromReviewContexts();
  await began;
  await coordinator.selectContext();
  assert.equal(tree, "new-explicit-pr");
  oldReject(new OperationCancelledError());
  await oldRefresh;
  assert.equal(tree, "new-explicit-pr");
});

test("early T405 augmentation failure keeps the verified branch and clears dependent PR state", async () => {
  const acquisitionFailure = new Error("T405 repository list failed");
  const branch = {
    context: {
      kind: "branch", label: "checked-out", headRevision: "verified-head",
      selection: { kind: "branch", repositoryId: "opaque-repo", repositoryRoot: "/fixture", branchRef: "refs/heads/checked-out" },
    },
    progress: undefined,
  };
  const candidate = await augmentCurrentContextCandidatesWithBranchFallback(
    [branch], async () => { throw acquisitionFailure; },
  );
  assert.deepEqual(candidate, [branch]);

  const applied = [];
  const cleared = [];
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({ snapshot: candidate[0], stale: false }),
  }, {
    setSelectedContext: (selection) => applied.push(selection),
    refreshDependents: async () => { throw acquisitionFailure; },
    clearPullRequestProgress: () => cleared.push("old-pr-progress"),
  });
  await assert.rejects(coordinator.refreshFromReviewContexts(), (error) => coordinator.isPreservedBranchRefreshFailure(error));
  assert.equal(applied[0]?.kind, "branch");
  assert.deepEqual(cleared, ["old-pr-progress"]);
});

test("a failed shared PR projection records a failed publication and one failed owner terminal", async () => {
  const logs = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog: (entry) => logs.push(entry), revealLog() {},
  });
  const failure = new Error("private PR acquisition failure");
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({
      snapshot: { context: { kind: "pull-request", label: "#42", selection: { kind: "pull-request" } }, progress: undefined },
      stale: false,
    }),
  }, {
    refreshDependents: async (context) => {
      let projectionFailure;
      await refreshCurrentContextDependents({
        refreshReviewContexts: async () => {},
        refreshPullRequestProgress: async () => { context.report("pr-progress", "started"); throw failure; },
        refreshDecorations: async () => {},
        refreshGlobal: async () => {},
        reportPullRequestProgressError: (error) => {
          projectionFailure = error;
          feedback.reportFailure("PR進捗を再計算", error, context.feedbackContext);
        },
      });
      if (projectionFailure !== undefined) {
        context.report("tree-publication", "failed", { reasonCode: "refresh-failed" });
        throw projectionFailure;
      }
    },
  });
  await assert.rejects(feedback.run("Current Contextを更新", (context) => coordinator.refresh(undefined, context)), failure);
  assert.equal(logs.filter((entry) => entry.event === "failed").length, 1);
  assert.equal(logs.filter((entry) => entry.event === "succeeded").length, 0);
  assert.ok(logs.some((entry) => entry.event === "refresh" && entry.pullRequestRefresh?.stage === "tree-publication" && entry.pullRequestRefresh.status === "failed"));
});

test("resolved selection provenance flows from the Current Context snapshot into refresh records", async () => {
  const logs = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog: (entry) => logs.push(entry), revealLog() {},
  });
  const snapshot = {
    context: {
      kind: "branch", label: "checked-out", selectionReason: "ambiguous-pr-match",
      pullRequestCandidateCount: 2,
      selection: { kind: "branch", repositoryId: "opaque", repositoryRoot: "/fixture", branchRef: "refs/heads/main" },
    },
    progress: undefined,
  };
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({ snapshot, stale: false }),
  }, {
    refreshDependents: async (context) => {
      const provenance = context.selectionProvenance();
      context.report("pr-selection", "succeeded", {
        reasonCode: provenance.reason,
        counts: { pullRequestCandidates: provenance.candidateCount, selectedContextOrdinal: 0, snapshotOrdinal: 0 },
      });
    },
  });
  await feedback.run("Current Contextを更新", (context) => coordinator.refresh(undefined, context));
  const record = logs.find((entry) => entry.event === "refresh" && entry.pullRequestRefresh?.stage === "pr-selection");
  assert.equal(record?.pullRequestRefresh?.reasonCode, "ambiguous-pr-match");
  assert.equal(record?.pullRequestRefresh?.counts?.pullRequestCandidates, 2);
  assert.equal(record?.pullRequestRefresh?.operationId, undefined);
  assert.equal(record?.operationId, 1);
});

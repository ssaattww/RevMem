import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const loadWithVscode = (modulePath, vscode) => {
  const original = Module._load;
  Module._load = function (request, ...args) {
    return request === "vscode" ? vscode : original.call(this, request, ...args);
  };
  try {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } finally { Module._load = original; }
};
const disposable = { dispose() {} };
class FixtureEventEmitter {
  event = () => disposable;
  fire() {}
  dispose() {}
}
const { PullRequestReviewRuntime } = await import("../../test-dist/src/composition/pull-request/pull-request-review-runtime.js");
const { ReviewFileExclusionPolicy } = await import("../../test-dist/src/core/file-exclusion/index.js");
const { REVIEW_RANGE_SCHEMA_VERSION } = await import("../../test-dist/src/core/contracts/index.js");
const { refreshSelectedPullRequestProgress } = await import("../../test-dist/src/application/review-context/projection-refresh.js");
const { refreshCurrentContextPullRequestViews } = await import("../../test-dist/src/composition/current-context/current-context-pull-request-views.js");
const { CurrentContextUiController } = await import("../../test-dist/src/ui/current-context/current-context-ui-controller.js");

const createProgressFixture = (beforeRead = async () => {}) => {
  const baseSha = "a".repeat(40), headSha = "b".repeat(40);
  const persisted = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, contextId: "opaque-pr", kind: "pull-request", repositoryId: "opaque", displayName: "PR",
      pullRequest: { host: "github.com", owner: "fixture", repository: "fixture", number: 52, state: "open", baseSha, headSha },
      files: {}, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z" },
    globalState: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, repositoryId: "opaque", currentRevisionId: headSha, files: {}, updatedAt: "2026-10-06T00:00:00Z" },
  };
  let failRead = false;
  const runtime = new PullRequestReviewRuntime({
    repository: { load: async () => { await beforeRead(); return failRead ? undefined : JSON.parse(JSON.stringify(persisted)); } },
    requestHistory: async () => {}, diffHost: { parseUri: (uri) => uri, openDiff: async () => {} },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({ repositoryId: "opaque", repositoryRoot: "/fixture", fileSystemPathSemantics: "posix",
    snapshot: { contextId: "opaque-pr", baseSha, headSha, originalDiffId: baseSha + ".." + headSha,
      files: [{ fileId: "opaque-file", oldPath: "fixture.bin", newPath: "fixture.bin", status: "binary", additions: 0, deletions: 0, hunks: [] }] },
    readTextContent: async () => ({ kind: "found", content: "" }),
  });
  return { runtime, failNextRead: () => { failRead = true; } };
};

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
  const signal = new globalThis.AbortController().signal;
  const feedbackContext = { owner: {}, id: 17 };
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async (actualSignal, actualFeedbackContext) => {
      assert.equal(actualSignal.aborted, signal.aborted);
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

test("R2 NR-001 owning cancellation reaches the actual list provider before publication", async () => {
  const { ReviewContextsTreeProvider } = loadWithVscode(
    "../../test-dist/src/ui/review-contexts/vscode-review-contexts-runtime.js",
    { EventEmitter: FixtureEventEmitter },
  );
  let release, entered, acquisitionSignal, published = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const began = new Promise((resolve) => { entered = resolve; });
  const provider = new ReviewContextsTreeProvider({
    load: async (signal) => { acquisitionSignal = signal; entered(); await gate; return []; },
    publishLoaded: async () => { published++; return []; },
  });
  const owner = new globalThis.AbortController();
  const pending = provider.refresh(undefined, owner.signal);
  await began;
  owner.abort();
  release();
  await Promise.allSettled([pending]);
  assert.equal(acquisitionSignal.aborted, true, "owner cancellation must reach deep list acquisition");
  assert.equal(published, 0, "cancelled acquisition cannot commit or publish");
  provider.dispose();
});

test("R2 NR-001 selected progress helper fences its finally publication after supersession", async () => {
  let release, entered, current = true, publications = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const began = new Promise((resolve) => { entered = resolve; });
  const { runtime } = createProgressFixture(async () => { entered(); await gate; });
  const pending = refreshSelectedPullRequestProgress({
    contextId: "opaque-pr", source: runtime.progress, shouldContinue: () => current,
    activateProgress: (id) => runtime.activateProgress(id), clearProgress: () => runtime.clearProgress(),
    setSource() {}, refreshTree: () => { publications++; },
  });
  await began;
  current = false;
  release();
  await pending;
  assert.equal(publications, 1, "old completion must not redraw the newer tree");
});

test("R2 NR-001 actual PR calculation cancels when its accepted Current Context owner is aborted", async () => {
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const began = new Promise((resolve) => { entered = resolve; });
  const { runtime } = createProgressFixture(async () => { entered(); await gate; });
  const owner = new globalThis.AbortController();
  const pending = runtime.activateProgress("opaque-pr", undefined, owner.signal);
  await began;
  owner.abort();
  release();
  const outcome = await Promise.allSettled([pending]);
  assert.equal(outcome[0].status, "rejected", "cancelled owner must not accept a PR snapshot");
  assert.equal(runtime.progress.getEffectiveProgress().files.length, 0);
});

test("R2 NR-001 old same-snapshot calculation failure cannot clear a newer accepted runtime tree", async () => {
  let release, entered, reads = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const began = new Promise((resolve) => { entered = resolve; });
  const { runtime, failNextRead } = createProgressFixture(async () => {
    if (++reads === 2) { entered(); await gate; }
  });
  await runtime.activateProgress("opaque-pr");
  const old = runtime.activateProgress("opaque-pr", undefined, new globalThis.AbortController().signal);
  const settledOld = Promise.allSettled([old]);
  await began;
  await runtime.activateProgress("opaque-pr", undefined, new globalThis.AbortController().signal);
  assert.equal(runtime.progress.getEffectiveProgress().files.length, 1);
  failNextRead(); release(); await settledOld;
  assert.equal(runtime.progress.getEffectiveProgress().files.length, 1, "obsolete wrapper cleanup must preserve accepted newer snapshot");
});

test("R2 NR-001 both entry owners abort running production PR work and retain newer immutable tree", async () => {
  for (const trigger of ["current-context-refresh", "review-contexts-refresh"]) {
    let release, entered, reads = 0, selected, oldSignal, publications = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    const began = new Promise((resolve) => { entered = resolve; });
    const { runtime, failNextRead } = createProgressFixture(async () => {
      if (++reads === 2) { entered(); await gate; }
    });
    await runtime.activateProgress("opaque-pr");
    const immutable = runtime.snapshotForContext("opaque-pr");
    const snapshot = { context: { kind: "pull-request", label: "#52", headRevision: immutable.headSha,
      selection: { kind: "pull-request", repositoryId: "opaque", repositoryRoot: "/fixture", contextId: immutable.contextId,
        pullRequestNumber: 52, headRevision: immutable.headSha } }, progress: undefined };
    const entries = [];
    const feedback = new OperationFeedback({ showBusy() {}, clearBusy() {}, appendLog: (entry) => entries.push(entry), revealLog() {} });
    const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
      recompute: async () => snapshot, selectContext: async () => snapshot,
    });
    const coordinator = new CurrentContextRuntimeCoordinator(controller, {
      setSelectedContext: (value) => { selected = value; },
      refreshDependents: async (owner) => {
        if (owner.generation === 1) oldSignal = owner.signal;
        const accepted = selected;
        await refreshCurrentContextPullRequestViews({ selection: accepted, runtime,
          refreshList: async () => {},
          refreshProgress: (parent) => refreshSelectedPullRequestProgress({
            contextId: accepted.contextId, source: runtime.progress, shouldContinue: () => owner.isCurrent(),
            activateProgress: (id) => runtime.activateProgress(id, parent, owner.signal),
            clearProgress: () => runtime.clearProgress(), setSource() {}, refreshTree: () => { publications++; },
          }),
          refreshDecorations: async () => {}, refreshGlobal: async () => {}, reportProgressError() {},
        }, owner);
      },
    });
    const old = feedback.run("Current Contextを更新", (owner) => coordinator.refresh(undefined, owner, undefined, trigger));
    try {
      await began;
      await feedback.run("Current Contextを選択", (owner) => coordinator.selectContext(undefined, owner));
      assert.equal(oldSignal.aborted, true, `${trigger} owns cancellation across PR I/O`);
      assert.equal(runtime.progress.getEffectiveProgress().files.length, 1);
      const newerPublications = publications;
      failNextRead(); release(); await old;
      assert.equal(publications, newerPublications, `${trigger} old finally cannot publish`);
      const file = runtime.progress.getChildren().flatMap((category) => runtime.progress.getChildren(category))[0];
      assert.deepEqual([file.openTarget.contextId, file.openTarget.baseSha, file.openTarget.headSha], [immutable.contextId, immutable.baseSha, immutable.headSha]);
      assert.equal(entries.some((entry) => entry.pullRequestRefresh?.generation === 1 && entry.pullRequestRefresh.stage === "tree-publication" && entry.pullRequestRefresh.status === "succeeded"), false);
      assert.ok(entries.some((entry) => entry.pullRequestRefresh?.generation === 1 && entry.pullRequestRefresh.status === "superseded"));
    } finally { release(); await Promise.allSettled([old]); }
  }
});

test("R2 NR-001 a registered BASE change after accepted identity cannot activate or publish that replacement", async () => {
  const { runtime } = createProgressFixture();
  const immutable = runtime.snapshotForContext("opaque-pr");
  const snapshot = { context: { kind: "pull-request", label: "#52", baseRevision: immutable.baseSha, headRevision: immutable.headSha,
    selection: { kind: "pull-request", repositoryId: "opaque", repositoryRoot: "/fixture", contextId: immutable.contextId,
      pullRequestNumber: 52, headRevision: immutable.headSha } }, progress: undefined };
  const controller = new CurrentContextUiController({ setCurrentContext() {}, setStatusBar() {}, clearCurrentContext() {}, clearStatusBar() {} }, {
    recompute: async () => snapshot, selectContext: async () => snapshot,
  });
  let activations = 0;
  const coordinator = new CurrentContextRuntimeCoordinator(controller, {
    refreshDependents: (owner) => refreshCurrentContextPullRequestViews({ selection: snapshot.context.selection, runtime,
      refreshList: async () => runtime.register({ repositoryId: "opaque", repositoryRoot: "/fixture", fileSystemPathSemantics: "posix",
        snapshot: { ...immutable, baseSha: "c".repeat(40), originalDiffId: "c".repeat(40) + ".." + immutable.headSha },
        readTextContent: async () => ({ kind: "found", content: "" }) }),
      refreshProgress: async (parent) => { activations++; await runtime.activateProgress("opaque-pr", parent, owner.signal); },
      refreshDecorations: async () => {}, refreshGlobal: async () => {}, reportProgressError() {},
    }, owner),
  });
  await assert.rejects(coordinator.refresh());
  assert.equal(activations, 0, "accepted BASE/HEAD is required before PR activation");
  assert.equal(runtime.progress.getEffectiveProgress().files.length, 0);
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

test("R2 NR-001 suppressed old list publication must not reactivate PR progress after newer explicit selection", async () => {
  const { ReviewContextsTreeProvider } = loadWithVscode(
    "../../test-dist/src/ui/review-contexts/vscode-review-contexts-runtime.js",
    { EventEmitter: FixtureEventEmitter },
  );
  const { runtime, failNextRead } = createProgressFixture();
  let releaseOld, enteredOld;
  const gate = new Promise((resolve) => { releaseOld = resolve; });
  const entered = new Promise((resolve) => { enteredOld = resolve; });
  let publications = 0;
  const list = new ReviewContextsTreeProvider({
    load: async () => [],
    publishLoaded: async () => {
      if (++publications === 1) { enteredOld(); await gate; }
      return [];
    },
  });
  let selected;
  const activations = [];
  const coordinator = new CurrentContextRuntimeCoordinator({
    refresh: async () => ({ snapshot: { context: { kind: "branch", label: "old", selection: { kind: "branch" } } }, stale: false }),
    selectContext: async () => ({ context: { kind: "pull-request", label: "#52", selection: { kind: "pull-request", contextId: "opaque-pr" } }, progress: undefined }),
  }, {
    setSelectedContext: (value) => { selected = value; },
    refreshDependents: async (context) => {
      let failure;
      await refreshCurrentContextDependents({
        shouldContinue: () => context.isCurrent(),
        refreshReviewContexts: () => list.refresh(context.feedbackContext),
        refreshPullRequestProgress: async () => {
          activations.push(context.generation);
          await refreshSelectedPullRequestProgress({
            contextId: selected.contextId, source: runtime.progress,
            feedbackContext: context.feedbackContext,
            activateProgress: (id, owner) => runtime.activateProgress(id, owner),
            clearProgress: () => runtime.clearProgress(), setSource() {}, refreshTree() {},
          });
        },
        refreshDecorations: async () => {}, refreshGlobal: async () => {},
        reportPullRequestProgressError: (error) => { failure = error; },
      });
      if (failure !== undefined) throw failure;
    },
  });
  try {
    const old = coordinator.refreshFromReviewContexts();
    await entered;
    await coordinator.selectContext();
    assert.equal(runtime.progress.getEffectiveProgress().files.length, 1);
    failNextRead();
    releaseOld();
    await old;
    // The real list provider resolves when its own fence suppresses stale publication.
    assert.equal(publications, 2);
    assert.equal(selected.kind, "pull-request");
    assert.deepEqual({ activations, acceptedFiles: runtime.progress.getEffectiveProgress().files.length },
      { activations: [2], acceptedFiles: 1 },
      "suppressed stale list completion must not start PR work or erase accepted newer files");
  } finally { releaseOld(); list.dispose(); }
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
  assert.deepEqual(candidate, [{ ...branch, context: { ...branch.context, pullRequestAcquisition: "failed-branch-preserved" } }]);
  assert.equal(branch.context.pullRequestAcquisition, undefined, "fallback must not mutate the verified local candidate");

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


test("R2 NR-003 actual Current Context and Review Contexts entries preserve verified branch on identical PR acquisition failure", async () => {
  const providers = new Map();
  const { registerCurrentContextRuntime } = loadWithVscode(
    "../../test-dist/src/ui/current-context/vscode-current-context-runtime.js", {
      EventEmitter: FixtureEventEmitter, StatusBarAlignment: { Left: 1 },
      window: {
        registerTreeDataProvider: (id, provider) => { providers.set(id, provider); return disposable; },
        createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
        onDidChangeActiveTextEditor: () => disposable,
      }, commands: { registerCommand: () => disposable },
    },
  );
  const results = [];
  for (const entry of ["current-context-refresh", "review-contexts-refresh"]) {
    const { runtime: progressRuntime } = createProgressFixture();
    await progressRuntime.activateProgress("opaque-pr");
    assert.equal(progressRuntime.progress.getEffectiveProgress().files.length, 1);
    let fail = false, selected, clears = 0;
    const branch = { context: { kind: "branch", label: "checked-out", headRevision: "verified-new-head",
      selection: { kind: "branch", repositoryId: "opaque", repositoryRoot: "/fixture", branchRef: "refs/heads/checked-out" } }, progress: undefined };
    const runtime = registerCurrentContextRuntime({ subscriptions: [] }, {
      recompute: async (signal) => (await augmentCurrentContextCandidatesWithBranchFallback(
        [branch], async () => { if (fail) throw new Error("PR enrichment failed"); return [branch]; }, signal,
      ))[0],
      selectContext: async () => branch,
    }, {
      setSelectedContext: (value) => { selected = value; },
      refreshDependents: async () => { if (fail) throw new Error("PR list failed"); },
      clearPullRequestProgress: () => { clears++; progressRuntime.clearProgress(); },
    }, () => {});
    try {
      await runtime.startupRefresh;
      assert.equal(selected.kind, "branch");
      fail = true;
      if (entry === "current-context-refresh") await runtime.refresh();
      else await assert.rejects(runtime.refreshFromReviewContexts({ owner: {}, id: 1 }));
      results.push({ entry, selectedKind: selected?.kind,
        items: providers.get("reviewRange.currentContext").getChildren().map((item) => item.label),
        files: progressRuntime.progress.getEffectiveProgress().files.length, clears });
    } finally { runtime.dispose(); }
  }
  assert.deepEqual(results, ["current-context-refresh", "review-contexts-refresh"].map((entry) => ({
    entry, selectedKind: "branch", items: ["Branch: checked-out"], files: 0, clears: 1,
  })), "both public entries must retain proven branch while clearing obsolete PR progress");
});

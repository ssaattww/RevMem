import assert from "node:assert/strict";
import test from "node:test";

import { OperationCancelledError, OperationFeedback, setActiveOperationFeedback, type OperationLogEntry } from "../../src/application/operation-feedback/index.js";

import {
  reportDocumentEditFailure,
  refreshAfterDocumentEdit,
  refreshCurrentContextDependents,
  refreshSelectedPullRequestProgress,
} from "../../src/application/review-context/projection-refresh.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("document edit failure reporting preserves original diagnostics when notification fails and avoids lower-level duplicates", async () => {
  const logs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog(entry) { logs.push(entry); }, revealLog() {}
  }, () => 7);
  setActiveOperationFeedback(feedback);
  try {
    const cause = Object.assign(new Error("underlying edit persistence failure"), { code: "EACCES" });
    const applyError = Object.assign(new Error("document review state apply failed", { cause }), { code: "EIO" });
    const notificationCause = Object.assign(new Error("notification transport unavailable"), { code: "ECONNRESET" });
    const notificationError = Object.assign(new Error("notification surface unavailable", { cause: notificationCause }), { code: "EHOSTUNREACH" });
    let notifications = 0;
    await reportDocumentEditFailure("Document edit state apply", applyError, async () => {
      notifications += 1;
      throw notificationError;
    });
    assert.equal(notifications, 1, "the original error notification is still attempted");
    assert.deepEqual(logs.map((entry) => [entry.event, entry.label]), [
      ["started", "Document edit state apply"],
      ["failed", "Document edit state apply"],
      ["started", "Document edit state apply notification"],
      ["failed", "Document edit state apply notification"],
    ], "notification failure gets its own diagnostic after the original failure");
    const originalDiagnostic = logs[1]?.errorDetails;
    assert.deepEqual({
      code: originalDiagnostic?.code,
      message: originalDiagnostic?.message,
      causeCode: originalDiagnostic?.cause?.code,
      causeMessage: originalDiagnostic?.cause?.message,
    }, {
      code: "EIO",
      message: "document review state apply failed",
      causeCode: "EACCES",
      causeMessage: "underlying edit persistence failure",
    });
    assert.match(originalDiagnostic?.stack ?? "", /document review state apply failed/u);
    assert.match(originalDiagnostic?.cause?.stack ?? "", /underlying edit persistence failure/u);
    const notificationDiagnostic = logs[3]?.errorDetails;
    assert.deepEqual({
      code: notificationDiagnostic?.code,
      message: notificationDiagnostic?.message,
      causeCode: notificationDiagnostic?.cause?.code,
      causeMessage: notificationDiagnostic?.cause?.message,
    }, {
      code: "EHOSTUNREACH",
      message: "notification surface unavailable",
      causeCode: "ECONNRESET",
      causeMessage: "notification transport unavailable",
    });
    assert.match(notificationDiagnostic?.stack ?? "", /notification surface unavailable/u);
    assert.match(notificationDiagnostic?.cause?.stack ?? "", /notification transport unavailable/u);

    const projectionError = new Error("projection calculation failed");
    await assert.rejects(feedback.run("PR Progress projection", async () => { throw projectionError; }),
      (error: unknown) => error === projectionError);
    const loggedCount = logs.length;
    await reportDocumentEditFailure("Document edit PR Progress refresh", projectionError, async () => {
      notifications += 1;
      return undefined;
    });
    assert.equal(notifications, 2);
    assert.equal(logs.length, loggedCount, "a failure already recorded by the lower-level operation is not duplicated");

    const cancelled = new OperationCancelledError();
    await assert.rejects(feedback.run("PR Progress generation", async () => { throw cancelled; }),
      (error: unknown) => error === cancelled);
    assert.equal(logs.at(-1)?.event, "cancelled", "the lower-level stale result retains its cancelled terminal");
    const cancelledLogCount = logs.length;
    await reportDocumentEditFailure("Document edit PR Progress refresh", cancelled, async () => {
      notifications += 1;
    });
    assert.equal(logs.length, cancelledLogCount, "cancellation is not turned into a second failed terminal");
    assert.equal(notifications, 2, "stale cancellation does not show an ordinary failure notification");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

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
  })), (error: unknown) => error instanceof AggregateError
    && error.errors.includes(activationError)
    && error.errors.includes(treeError));
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

test("document edit refresh preserves stale PR Progress cancellation as a successful edit", async () => {
  const events: string[] = [];
  const cancelled = new OperationCancelledError();
  let notifications = 0;

  await refreshAfterDocumentEdit({
    refreshPullRequestProgress: async () => {
      events.push("progress:start");
      throw cancelled;
    },
    refreshDecorations: async () => { events.push("decorations"); },
    refreshGlobal: async () => { events.push("global"); },
    reportPullRequestProgressError: async (error) => {
      assert.equal(error, cancelled);
      events.push("progress:reported");
      await reportDocumentEditFailure("Document edit PR Progress refresh", error, async () => {
        notifications += 1;
      });
    },
  });

  assert.deepEqual(events, ["progress:start", "decorations", "global", "progress:reported"]);
  assert.equal(notifications, 0, "stale cancellation does not become a user-facing failure");
});

test("document edit refresh reports progress and returns every independent projection failure", async () => {
  const events: string[] = [];
  const progress = deferred<void>();
  const global = deferred<void>();
  const globalStarted = deferred<void>();
  const progressError = new Error("progress projection failed");
  const decorationError = new Error("decoration projection failed");
  const globalError = new Error("Global projection failed");
  const reported: unknown[] = [];

  const refreshing = refreshAfterDocumentEdit({
    refreshPullRequestProgress: () => {
      events.push("progress:start");
      return progress.promise;
    },
    refreshDecorations: async () => {
      events.push("decorations:start");
      throw decorationError;
    },
    refreshGlobal: () => {
      events.push("global:start");
      globalStarted.resolve();
      return global.promise;
    },
    reportPullRequestProgressError: async (error) => {
      reported.push(error);
      events.push("progress:reported");
    },
  });

  assert.deepEqual(events, ["progress:start", "decorations:start"]);
  await globalStarted.promise;
  assert.deepEqual(events, ["progress:start", "decorations:start", "global:start"]);
  progress.reject(progressError);
  global.reject(globalError);

  await assert.rejects(refreshing, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [decorationError, globalError]);
    return true;
  });
  assert.deepEqual(reported, [progressError], "the independently started Progress failure is still reported");
  assert.deepEqual(events, [
    "progress:start",
    "decorations:start",
    "global:start",
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

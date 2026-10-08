import assert from "node:assert/strict";
import test from "node:test";

import { OperationFeedback } from "../../src/application/operation-feedback/operation-feedback.js";
import { PullRequestLifecycleOperationCacheRegistry } from "../../src/composition/review-contexts/pull-request-lifecycle-operation-cache.js";
import { createPr108ProductionFixture } from "../helpers/pr108-production-fixture.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
};

test("PR lifecycle cache keeps concurrent operation scopes independent and stable", async () => {
  const feedback = new OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: () => undefined,
    revealLog: () => undefined,
  });
  const registry = new PullRequestLifecycleOperationCacheRegistry();
  const gateA = deferred();
  const gateB = deferred();
  const startedA = deferred();
  const startedB = deferred();
  let contextA!: import("../../src/application/operation-feedback/operation-feedback.js").OperationFeedbackContext;
  let cacheA: ReturnType<typeof registry.forOperation> | undefined;
  let cacheAAfterB: ReturnType<typeof registry.forOperation> | undefined;
  let cacheB: ReturnType<typeof registry.forOperation> | undefined;

  const operationA = feedback.run("A", async (context) => {
    contextA = context;
    cacheA = registry.forOperation(context);
    startedA.resolve();
    await gateA.promise;
    cacheAAfterB = registry.forOperation(context);
  });
  await startedA.promise;
  const operationB = feedback.run("B", async (context) => {
    cacheB = registry.forOperation(context);
    startedB.resolve();
    await gateB.promise;
  });
  await startedB.promise;
  gateA.resolve();
  await operationA;
  gateB.resolve();
  await operationB;

  assert.notEqual(cacheA, cacheB, "overlapping owner/id scopes must never share snapshots");
  assert.equal(cacheAAfterB, cacheA, "A→B→A access must retain A's operation-local memo");
  assert.notEqual(registry.forOperation(contextA), cacheA, "operation completion must release its memo");
});

test("operation cleanup listener failures do not skip later cleanup or replace success", async () => {
  const busy: number[] = [];
  const feedback = new OperationFeedback({
    showBusy: (_label, count) => busy.push(count),
    clearBusy: () => busy.push(0),
    appendLog: () => undefined,
    revealLog: () => undefined,
  });
  const cleanup: string[] = [];
  const result = await feedback.run("cleanup failure isolation", async (context) => {
    feedback.onOperationFinished(context, () => { cleanup.push("throwing"); throw new Error("cleanup failure"); });
    feedback.onOperationFinished(context, () => cleanup.push("next"));
    return "completed";
  });

  assert.equal(result, "completed");
  assert.deepEqual(cleanup, ["throwing", "next"]);
  assert.deepEqual(busy, [1, 0]);
});

test("PR lifecycle synchronization and projection reuse one operation snapshot and merge-base GET", async () => {
  const contexts = Array.from({ length: 40 }, (_, index) => 200 + index);
  const fixture = await createPr108ProductionFixture({
    contexts,
    contextHead: "B",
    ownerHead: "D",
    ownerSynchronizationRevision: "C",
    githubResponseDelayMilliseconds: 1,
    operationFeedback: true,
  });
  try {
    for (const number of contexts) fixture.remote.set(number, { base: "A", head: "C", state: "open" });
    const projectionsBefore = fixture.runtime.getProjectionGenerationCountForTest?.() ?? 0;
    const before = fixture.metrics();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    const after = fixture.metrics();
    assert.equal((fixture.runtime.getProjectionGenerationCountForTest?.() ?? 0) - projectionsBefore, 1,
      "publishing deferred cache metadata must reuse the completed projection");
    const delta = (path: string): number =>
      (after.githubFetchRequestCountsByPath[path] ?? 0) - (before.githubFetchRequestCountsByPath[path] ?? 0);

    assert.equal(delta("/repos/ssaattww/revmem/pulls"), 0);
    assert.equal(Object.entries(after.githubFetchRequestCountsByPath)
      .filter(([path]) => /\/pulls\/\d+$/u.test(path))
      .reduce((sum, [, count]) => sum + count, 0) - Object.entries(before.githubFetchRequestCountsByPath)
      .filter(([path]) => /\/pulls\/\d+$/u.test(path))
      .reduce((sum, [, count]) => sum + count, 0), contexts.length);
    assert.equal(Object.entries(after.githubFetchRequestCountsByPath)
      .filter(([path]) => /\/compare\//u.test(path))
      .reduce((sum, [, count]) => sum + count, 0) - Object.entries(before.githubFetchRequestCountsByPath)
      .filter(([path]) => /\/compare\//u.test(path))
      .reduce((sum, [, count]) => sum + count, 0), 1);
    for (const number of contexts) {
      assert.equal((await fixture.state(number))?.contextState.pullRequest?.headSha, fixture.revisions.C);
      assert.equal(fixture.item(number).context.pullRequest?.headSha, fixture.revisions.C);
      assert.ok(fixture.item(number).cache, "published cache metadata must remain visible on the projected item");
    }
  } finally {
    await fixture.dispose();
  }
});

test("PR lifecycle operation cache is discarded before a later projection operation", async () => {
  const fixture = await createPr108ProductionFixture({ contexts: [200], githubResponseDelayMilliseconds: 1, operationFeedback: true });
  try {
    const before = fixture.metrics();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    const once = fixture.metrics();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    const twice = fixture.metrics();
    const endpoint = "/repos/ssaattww/revmem/pulls/200";
    const firstOperationGets = (once.githubFetchRequestCountsByPath[endpoint] ?? 0) - (before.githubFetchRequestCountsByPath[endpoint] ?? 0);
    const secondOperationGets = (twice.githubFetchRequestCountsByPath[endpoint] ?? 0) - (once.githubFetchRequestCountsByPath[endpoint] ?? 0);
    assert.ok(firstOperationGets > 0);
    assert.equal(secondOperationGets, firstOperationGets, "a new operation must not reuse the previous operation's lifecycle snapshot");
  } finally {
    await fixture.dispose();
  }
});

test("PR redetection shares lifecycle and merge-base reads with the same-head candidate search", async () => {
  const contexts = Array.from({ length: 40 }, (_, index) => 300 + index);
  const fixture = await createPr108ProductionFixture({
    contexts,
    contextHead: "D",
    ownerHead: "D",
    githubResponseDelayMilliseconds: 1,
    operationFeedback: true,
  });
  try {
    const before = fixture.metrics();
    assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
    const after = fixture.metrics();
    const deltaFor = (pattern: RegExp): number =>
      Object.entries(after.githubFetchRequestCountsByPath)
        .filter(([endpoint]) => pattern.test(endpoint))
        .reduce((sum, [, count]) => sum + count, 0) - Object.entries(before.githubFetchRequestCountsByPath)
        .filter(([endpoint]) => pattern.test(endpoint))
        .reduce((sum, [, count]) => sum + count, 0);

    assert.equal(deltaFor(/\/pulls\/\d+$/u), contexts.length);
    assert.equal(deltaFor(/\/compare\//u), 1);
    assert.equal(deltaFor(/\/pulls$/u), 1);
    assert.equal(fixture.errors.length, 0);
    assert.equal(fixture.registrations.length, contexts.length);
  } finally {
    await fixture.dispose();
  }
});

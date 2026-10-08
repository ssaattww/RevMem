import assert from "node:assert/strict";
import test from "node:test";

import { createPr108ProductionFixture } from "../helpers/pr108-production-fixture.js";

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
    const before = fixture.metrics();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    const after = fixture.metrics();
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

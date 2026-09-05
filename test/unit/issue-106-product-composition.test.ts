import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerProductFixture, OWNER_FILE, ownerContextId } from "../support/t405-owner-product-fixture.js";

test("PR108-PRODUCT-001 actual registration maps deferred Context and current owner Global independently", async () => {
  const fixture = await createOwnerProductFixture();
  try {
    fixture.remote.get(52)!.head = fixture.C;
    fixture.remote.get(53)!.head = fixture.D;
    await fixture.setOwner(fixture.C);
    await fixture.invoke();
    // PRODUCT-003 may still report a projection failure; inspect durable owner publication here.
    assert.equal((await fixture.load(52))?.contextState.pullRequest?.headSha, fixture.C);
    assert.equal((await fixture.load(53))?.contextState.pullRequest?.headSha, fixture.B);
    assert.equal((await fixture.load(53))?.globalState.currentRevisionId, fixture.C);
    assert.equal(fixture.publications.owner, 1);
    await fixture.setOwner(fixture.D, 53);
    await fixture.invoke();
    const result52 = await fixture.load(52);
    const result53 = await fixture.load(53);
    assert.equal(result52?.contextState.pullRequest?.headSha, fixture.C);
    assert.equal(result53?.contextState.pullRequest?.headSha, fixture.D);
    assert.equal(result53?.globalState.currentRevisionId, fixture.D);
    assert.deepEqual(result53?.contextState.files[OWNER_FILE]?.modifiedReviewed, [{ startLine: 1, endLineExclusive: 2 }]);
    assert.deepEqual(result53?.globalState.files[OWNER_FILE]?.reviewed, [{ startLine: 1, endLineExclusive: 2 }]);
    assert.equal(fixture.publications.owner, 2, "one owner CAS per command, not per Context");
    assert.equal(fixture.publications.context, 0);
    const beforeRetry = await fixture.durableFiles();
    await fixture.invoke();
    assert.deepEqual(await fixture.durableFiles(), beforeRetry);
    assert.equal(fixture.publications.owner, 2);
    assert.ok(fixture.history.some((event) => event.contextId === ownerContextId(53)));
  } finally { await fixture.dispose(); }
});

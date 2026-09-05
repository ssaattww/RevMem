import assert from "node:assert/strict";
import test from "node:test";
import { createPr108ProductionFixture, PR108_FILE, pr108ContextId } from "../helpers/pr108-production-fixture.js";

test("PR108-PRODUCT-001 actual T405 command maps B/B/B -> C/B/C -> C/D/D with one owner CAS each", async () => {
  const fixture = await createPr108ProductionFixture();
  try {
    fixture.remote.set(52, { base: "A", head: "C", state: "open" });
    fixture.remote.set(53, { base: "A", head: "D", state: "open" });
    await fixture.owner("C");
    // PRODUCT-003 separately asserts the post-command projection. Here the
    // durable owner boundary is observed even when the old projection fails.
    await fixture.invoke("reviewRange.redetectPullRequest");
    assert.equal((await fixture.state(52))?.contextState.pullRequest?.headSha, fixture.revisions.C);
    assert.equal((await fixture.state(53))?.contextState.pullRequest?.headSha, fixture.revisions.B);
    assert.equal((await fixture.state(52))?.globalState.currentRevisionId, fixture.revisions.C);
    assert.equal(fixture.ownerPublications(), 1);
    fixture.control.selected = 53;
    await fixture.owner("D");
    await fixture.invoke("reviewRange.redetectPullRequest");
    const second = await fixture.state(53);
    assert.equal(second?.contextState.pullRequest?.headSha, fixture.revisions.D);
    assert.equal((await fixture.state(52))?.contextState.pullRequest?.headSha, fixture.revisions.C);
    assert.equal(second?.globalState.currentRevisionId, fixture.revisions.D);
    assert.deepEqual(second?.contextState.files[PR108_FILE]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
    assert.equal(fixture.ownerPublications(), 2);
    assert.ok(fixture.histories.some((entry) => entry.contextId === pr108ContextId(53)));
    const durable = await fixture.snapshot();
    const historyCount = fixture.histories.length;
    await fixture.invoke("reviewRange.redetectPullRequest");
    assert.deepEqual(await fixture.snapshot(), durable, "retry must not repeat publication or history");
    assert.equal(fixture.ownerPublications(), 2);
    assert.equal(fixture.histories.length, historyCount);
    await fixture.restart();
    assert.deepEqual(await fixture.snapshot(), durable);
  } finally { await fixture.dispose(); }
});

for (const preserveSourceSnapshot of [true, false]) {
  test(`PR108-PRODUCT-001 actual command catches up to advanced Global with source snapshot=${preserveSourceSnapshot}`, async () => {
    const fixture = await createPr108ProductionFixture({ globalHead: "C", preserveSourceSnapshot });
    try {
      fixture.remote.set(52, { base: "A", head: "C", state: "open" });
      fixture.remote.set(53, { base: "A", head: "D", state: "closed" });
      await fixture.owner("C");
      const originalGlobal = (await fixture.state(52))!.globalState;
      await fixture.invoke("reviewRange.redetectPullRequest");
      const state = await fixture.state(52);
      assert.equal(state?.contextState.pullRequest?.headSha, fixture.revisions.C);
      assert.deepEqual(state?.globalState, originalGlobal, "catch-up must not remap or replace advanced owner Global");
      assert.equal((await fixture.state(53))?.contextState.pullRequest?.headSha, fixture.revisions.B);
      assert.equal((await fixture.state(53))?.contextState.pullRequest?.state, "closed");
      assert.equal(fixture.ownerPublications(), 1);
    } finally { await fixture.dispose(); }
  });
}

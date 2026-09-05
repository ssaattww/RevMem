import assert from "node:assert/strict";
import test from "node:test";
import { createPr108ProductionFixture } from "../helpers/pr108-production-fixture.js";

for (const entry of ["redetect", "explicit-selection"] as const) {
  test(`PR108-PRODUCT-002 ${entry} does not create a new PR while a sibling lifecycle is unavailable`, async () => {
    const fixture = await createPr108ProductionFixture({ contexts: [52] });
    try {
      await fixture.owner("C");
      fixture.remote.set(53, { base: "A", head: "C", state: "open" });
      fixture.control.selected = 53;
      fixture.unavailable.add(52);
      const before = await fixture.durableFiles();
      const selection = structuredClone(fixture.workspaceState.values);
      if (entry === "redetect") {
        const errors = await fixture.invoke("reviewRange.redetectPullRequest");
        assert.equal(errors.length, 1, "the public command must report a failure");
      } else {
        await assert.rejects(
          () => fixture.runtime.preparePullRequestCandidateForExplicitContextSelection!(),
          /Repository-owner synchronization must complete/u,
        );
      }
      assert.deepEqual(await fixture.durableFiles(), before, "manifest, Context, Global and JSONL history must remain byte-identical");
      assert.deepEqual(fixture.workspaceState.values, selection);
      assert.equal(await fixture.state(53), undefined);
      assert.equal(fixture.ownerPublications(), 0);
      assert.deepEqual(fixture.histories, []);
    } finally { await fixture.dispose(); }
  });
}

test("PR108-PRODUCT-002 existing PR selection fails closed even when the selected revision already matches", async () => {
  const fixture = await createPr108ProductionFixture();
  try {
    fixture.control.selected = 53;
    fixture.unavailable.add(52);
    const before = await fixture.durableFiles();
    const selection = structuredClone(fixture.workspaceState.values);
    const errors = await fixture.invoke("reviewRange.redetectPullRequest");
    assert.equal(errors.length, 1, "the public command must report a failure");
    assert.deepEqual(await fixture.durableFiles(), before);
    assert.deepEqual(fixture.workspaceState.values, selection);
    assert.equal(fixture.ownerPublications(), 0);
    assert.deepEqual(fixture.histories, []);
  } finally { await fixture.dispose(); }
});

for (const existing of [false, true]) {
  test(`PR108-PRODUCT-002 interactive private authentication recovers owner synchronization for existing=${existing}`, async () => {
    const fixture = await createPr108ProductionFixture({ contexts: existing ? [52, 53] : [52] });
    try {
      fixture.control.requireAuthentication = true;
      fixture.control.selected = 53;
      fixture.remote.set(52, { base: "A", head: "C", state: "open" });
      fixture.remote.set(53, { base: "A", head: "C", state: "open" });
      await fixture.owner("C");
      assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
      assert.ok(fixture.authenticationCalls.some((call) => call.interactive));
      assert.equal(fixture.control.authenticated, true);
      assert.equal((await fixture.state(52))?.contextState.pullRequest?.headSha, fixture.revisions.C);
      assert.equal((await fixture.state(53))?.contextState.pullRequest?.headSha, fixture.revisions.C);
      assert.equal((await fixture.state(53))?.globalState.currentRevisionId, fixture.revisions.C);
      assert.equal(fixture.ownerPublications(), 1);
      assert.equal((await fixture.snapshot())?.contextStates.length, 2);
    } finally { await fixture.dispose(); }
  });
}

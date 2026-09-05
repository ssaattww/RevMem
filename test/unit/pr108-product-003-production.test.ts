import assert from "node:assert/strict";
import test from "node:test";
import { ReviewDiffUriCodec } from "../../src/application/diff-document/index.js";
import { createPr108ProductionFixture, pr108ContextId } from "../helpers/pr108-production-fixture.js";

const assertPinned = async (
  fixture: Awaited<ReturnType<typeof createPr108ProductionFixture>>,
  expectedHeads: readonly ["B" | "C" | "D", "B" | "C" | "D"],
): Promise<void> => {
  assert.equal(fixture.provider.getChildren().filter((item) => item.context.kind === "pull-request").length, 2);
  for (const [index, number] of [52, 53].entries()) {
    const persisted = (await fixture.state(number))!.contextState.pullRequest!;
    const item = fixture.item(number);
    assert.equal(persisted.headSha, fixture.revisions[expectedHeads[index]!]);
    assert.equal(item.context.pullRequest?.baseSha, persisted.baseSha);
    assert.equal(item.context.pullRequest?.headSha, persisted.headSha);
    const registration = fixture.registrations.filter((entry) => entry.contextId === pr108ContextId(number)).at(-1)!;
    assert.equal(registration.baseSha, persisted.baseSha);
    assert.equal(registration.headSha, persisted.headSha);
    assert.ok(item.progress);
    assert.notEqual(item.cache?.freshness, "unavailable");
    await fixture.review.getProgress(pr108ContextId(number));
  }
};

test("PR108-PRODUCT-003 different remote HEADs retain both pinned PRs through command, refresh, diff and restart", async () => {
  const fixture = await createPr108ProductionFixture();
  try {
    fixture.remote.set(52, { base: "A", head: "C", state: "open" });
    fixture.remote.set(53, { base: "A", head: "D", state: "open" });
    await fixture.owner("C");
    assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
    await assertPinned(fixture, ["C", "B"]);
    const durable = await fixture.durableFiles();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    await assertPinned(fixture, ["C", "B"]);
    assert.deepEqual(await fixture.durableFiles(), durable, "read refresh cannot publish a remote revision");
    assert.deepEqual(await fixture.invoke("reviewRange.openReviewContextDiff", fixture.item(53)), []);
    const opened = fixture.opened.at(-1)!;
    const codec = new ReviewDiffUriCodec();
    assert.equal(codec.decode(opened.modified).revision, fixture.revisions.B);
    assert.equal(codec.decode(opened.original).revision, fixture.revisions.A);
    await fixture.restart();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    await assertPinned(fixture, ["C", "B"]);
    fixture.control.selected = 53;
    await fixture.owner("D");
    assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
    await assertPinned(fixture, ["C", "D"]);
  } finally { await fixture.dispose(); }
});

test("PR108-PRODUCT-003 read projection pins a changed remote base as well as HEAD", async () => {
  const fixture = await createPr108ProductionFixture({ contextHead: "C" });
  try {
    fixture.remote.set(53, { base: "B", head: "C", state: "open" });
    const before = await fixture.durableFiles();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    await assertPinned(fixture, ["C", "C"]);
    assert.equal(fixture.item(53).context.pullRequest?.baseSha, fixture.revisions.A);
    assert.deepEqual(await fixture.durableFiles(), before);
    fixture.control.selected = 53;
    assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
    assert.equal(fixture.item(53).context.pullRequest?.baseSha, fixture.revisions.B);
    assert.equal((await fixture.state(53))?.contextState.pullRequest?.baseSha, fixture.revisions.B);
    assert.equal(fixture.ownerPublications(), 1);
  } finally { await fixture.dispose(); }
});

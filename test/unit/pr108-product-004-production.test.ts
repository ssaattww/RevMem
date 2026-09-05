import assert from "node:assert/strict";
import test from "node:test";
import { createPr108ProductionFixture } from "../helpers/pr108-production-fixture.js";

const prepareNonOwnerHead = async () => {
  const fixture = await createPr108ProductionFixture();
  fixture.remote.set(52, { base: "A", head: "C", state: "open" });
  fixture.remote.set(53, { base: "A", head: "C", state: "open" });
  await fixture.owner("C");
  fixture.control.selected = 52;
  assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);

  fixture.remote.set(52, { base: "A", head: "D", state: "open" });
  fixture.remote.set(53, { base: "A", head: "C", state: "open" });
  await fixture.owner("D");
  fixture.control.selected = 52;
  assert.deepEqual(await fixture.invoke("reviewRange.redetectPullRequest"), []);
  assert.equal((await fixture.state(52))?.globalState.currentRevisionId, fixture.revisions.D);
  assert.equal((await fixture.state(53))?.contextState.pullRequest?.headSha, fixture.revisions.C);
  assert.equal((await fixture.state(53))?.globalState.currentRevisionId, fixture.revisions.D);
  assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
  assert.deepEqual(await fixture.invoke("reviewRange.openReviewContextDiff", fixture.item(53)), []);
  return fixture;
};

const commandService = (fixture: Awaited<ReturnType<typeof createPr108ProductionFixture>>) =>
  fixture.review.createCommandService<{ readonly uri: string }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => fixture.review.sideForDiffDocumentUri(editor.uri),
    getLineCount: () => 3,
    getSelections: () => [{
      anchor: { line: 1, character: 0 },
      active: { line: 1, character: 0 },
    }],
    confirmWholeFileOperation: async () => true,
  });

test("PR108-PRODUCT-004 modified mark/unmark on a non-owner PR HEAD preserves owner Global and sibling Context", async () => {
  const fixture = await prepareNonOwnerHead();
  try {
    const opened = fixture.opened.at(-1)!;
    const commands = commandService(fixture);
    const siblingBefore = structuredClone((await fixture.state(52))!.contextState);
    const historyBefore = fixture.histories.length;

    assert.equal(await commands.markSelectionReviewed({ uri: opened.modified }), "applied");
    let state53 = (await fixture.state(53))!;
    assert.equal(state53.globalState.currentRevisionId, fixture.revisions.D, "owner Global current revision must not move to the non-owner PR HEAD");
    assert.deepEqual(state53.contextState.files["src/example.ts"]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 2 }]);
    assert.deepEqual(state53.globalState.revisionSnapshots?.[fixture.revisions.C]?.files["src/example.ts"]?.reviewed, [{ startLine: 0, endLineExclusive: 2 }]);
    assert.deepEqual((await fixture.state(52))!.contextState, siblingBefore, "sibling Context must remain isolated");
    assert.equal(fixture.histories.at(-1)?.contextId, state53.contextState.contextId);
    assert.equal(fixture.histories.length, historyBefore + 1);

    assert.equal(await commands.unmarkSelectionReviewed({ uri: opened.modified }), "applied");
    state53 = (await fixture.state(53))!;
    assert.equal(state53.globalState.currentRevisionId, fixture.revisions.D);
    assert.deepEqual(state53.contextState.files["src/example.ts"]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
    assert.deepEqual(state53.globalState.revisionSnapshots?.[fixture.revisions.C]?.files["src/example.ts"]?.reviewed, [{ startLine: 0, endLineExclusive: 1 }]);

    await fixture.restart();
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    state53 = (await fixture.state(53))!;
    assert.equal(state53.globalState.currentRevisionId, fixture.revisions.D);
    assert.deepEqual(state53.contextState.files["src/example.ts"]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 1 }]);
  } finally { await fixture.dispose(); }
});

test("PR108-PRODUCT-004 original-side mark/unmark on a non-owner PR HEAD preserves owner Global", async () => {
  const fixture = await prepareNonOwnerHead();
  try {
    const opened = fixture.opened.at(-1)!;
    const commands = commandService(fixture);
    assert.equal(await commands.markSelectionReviewed({ uri: opened.original }), "applied");
    let state53 = (await fixture.state(53))!;
    assert.equal(state53.globalState.currentRevisionId, fixture.revisions.D);
    const diffId = `${fixture.revisions.A}..${fixture.revisions.C}`;
    assert.deepEqual(state53.contextState.files["src/example.ts"]?.originalReviewedByDiff[diffId], [{ startLine: 1, endLineExclusive: 2 }]);

    assert.equal(await commands.unmarkSelectionReviewed({ uri: opened.original }), "applied");
    state53 = (await fixture.state(53))!;
    assert.equal(state53.globalState.currentRevisionId, fixture.revisions.D);
    assert.deepEqual(state53.contextState.files["src/example.ts"]?.originalReviewedByDiff[diffId], []);
  } finally { await fixture.dispose(); }
});

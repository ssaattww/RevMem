import assert from "node:assert/strict";
import test from "node:test";
import { createPr108ProductionFixture, PR108_FILE, pr108ContextId } from "../helpers/pr108-production-fixture.js";

const makeFixture = async (preserveSourceSnapshot = true) => {
  const fixture = await createPr108ProductionFixture({
    contextHead: "C", globalHead: "D", ownerHead: "D", preserveSourceSnapshot,
  });
  assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
  assert.deepEqual(await fixture.invoke("reviewRange.openReviewContextDiff", fixture.item(53)), []);
  return fixture;
};
const commandsFor = (fixture: Awaited<ReturnType<typeof makeFixture>>, line = 2) =>
  fixture.review.createCommandService<{ uri: string }>({
    getDocumentUri: (editor) => editor.uri,
    getSide: (editor) => fixture.review.sideForDiffDocumentUri(editor.uri),
    getLineCount: () => 3,
    getSelections: () => [{ anchor: { line, character: 0 }, active: { line, character: 0 } }],
    confirmWholeFileOperation: async () => true,
  });

for (const side of ["modified", "original"] as const) {
  for (const preserveSourceSnapshot of [true, false]) {
    test(`PR108-PRODUCT-004 ${side} unchanged-line review isolates owner Global, snapshot=${preserveSourceSnapshot}`, async () => {
      const fixture = await makeFixture(preserveSourceSnapshot);
      try {
        const before = (await fixture.state(53))!;
        const sibling = (await fixture.state(52))!.contextState;
        const uri = fixture.opened.at(-1)![side];
        const commands = commandsFor(fixture);
        assert.equal(await commands.markSelectionReviewed({ uri }), "applied");
        const after = (await fixture.state(53))!;
        const currentGlobal = structuredClone(after.globalState);
        const expectedGlobal = structuredClone(before.globalState);
        delete currentGlobal.revisionSnapshots;
        delete expectedGlobal.revisionSnapshots;
        assert.deepEqual(currentGlobal, expectedGlobal, "owner current revision/files/hash/ranges/timestamp must be unchanged");
        assert.deepEqual((await fixture.state(52))!.contextState, sibling);
        assert.deepEqual(after.globalState.revisionSnapshots?.[fixture.revisions.C]?.files[PR108_FILE]?.reviewed,
          preserveSourceSnapshot
            ? [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]
            : [{ startLine: 2, endLineExclusive: 3 }], "missing snapshot must not inherit ranges from a different revision");
        assert.deepEqual(fixture.histories.map((entry) => [entry.contextId, entry.revisionId]),
          [[pr108ContextId(53), fixture.revisions.C]]);
        const durable = await fixture.durableFiles();
        await fixture.restart();
        assert.deepEqual(await fixture.durableFiles(), durable, "restart must preserve both owner and target snapshot");
        assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
        assert.deepEqual(await fixture.invoke("reviewRange.openReviewContextDiff", fixture.item(53)), []);
        assert.equal(await commandsFor(fixture).unmarkSelectionReviewed({ uri: fixture.opened.at(-1)![side] }), "applied");
        const unmarked = (await fixture.state(53))!;
        const unmarkedGlobal = structuredClone(unmarked.globalState);
        delete unmarkedGlobal.revisionSnapshots;
        assert.deepEqual(unmarkedGlobal, expectedGlobal);
        assert.deepEqual(unmarked.globalState.revisionSnapshots?.[fixture.revisions.C]?.files[PR108_FILE]?.reviewed,
          preserveSourceSnapshot ? [{ startLine: 0, endLineExclusive: 1 }] : []);
      } finally { await fixture.dispose(); }
    });
  }
}

test("PR108-PRODUCT-004 owner-current CAS protects non-owner review from concurrent Global updates", async () => {
  const fixture = await makeFixture();
  try {
    const beforeContext = (await fixture.state(53))!.contextState;
    const commit = fixture.repository.commit.bind(fixture.repository);
    let raced = false;
    fixture.repository.commit = async (transaction) => {
      if (!raced) {
        raced = true;
        const expected = (await fixture.atomic.loadRepositorySnapshot("github.com/ssaattww/revmem"))!;
        const next = structuredClone(expected);
        next.globalState.files[PR108_FILE]!.reviewed = [{ startLine: 0, endLineExclusive: 3 }];
        next.globalState.updatedAt = "2026-09-05T00:10:00.000Z";
        await fixture.atomic.commitRepository({ repositoryId: expected.repositoryId, expected, next });
      }
      await commit(transaction);
    };
    await assert.rejects(() => commandsFor(fixture).markSelectionReviewed({ uri: fixture.opened.at(-1)!.modified }),
      /changed|stale|conflict|expected/iu);
    assert.equal(raced, true, "the command must reach the real persistence CAS after validation");
    assert.deepEqual((await fixture.state(53))!.contextState, beforeContext);
    assert.deepEqual(fixture.histories, [], "rejected mutation must not append history");
    assert.deepEqual((await fixture.state(53))!.globalState.files[PR108_FILE]!.reviewed,
      [{ startLine: 0, endLineExclusive: 3 }], "the concurrent owner write must be retained");
  } finally { await fixture.dispose(); }
});

test("PR108-PRODUCT-004 non-owner review uses its own file identity rather than owner-current path identity", async () => {
  const fixture = await makeFixture();
  try {
    const expected = (await fixture.snapshot())!;
    const next = structuredClone(expected);
    const file = next.globalState.files[PR108_FILE]!;
    delete next.globalState.files[PR108_FILE];
    next.globalState.files["owner-only-id"] = { ...file, fileId: "owner-only-id" };
    await fixture.atomic.commitRepository({ repositoryId: expected.repositoryId, expected, next });
    assert.equal(await commandsFor(fixture).markSelectionReviewed({ uri: fixture.opened.at(-1)!.modified }), "applied");
    const state = (await fixture.state(53))!;
    assert.deepEqual(state.globalState.files, next.globalState.files);
    assert.equal(state.globalState.revisionSnapshots?.[fixture.revisions.C]?.files[PR108_FILE]?.fileId, PR108_FILE);
  } finally { await fixture.dispose(); }
});

test("PR108-PRODUCT-004 target snapshot content-hash mismatch still fails closed", async () => {
  const fixture = await makeFixture();
  try {
    const expected = (await fixture.snapshot())!;
    const next = structuredClone(expected);
    next.globalState.revisionSnapshots![fixture.revisions.C]!.files[PR108_FILE]!.contentHash = "0".repeat(64);
    await fixture.atomic.commitRepository({ repositoryId: expected.repositoryId, expected, next });
    const before = await fixture.durableFiles();
    await assert.rejects(() => commandsFor(fixture).markSelectionReviewed({ uri: fixture.opened.at(-1)!.modified }),
      /Existing file content hash must match the target content hash/iu);
    assert.deepEqual(await fixture.durableFiles(), before);
    assert.deepEqual(fixture.histories, []);
  } finally { await fixture.dispose(); }
});

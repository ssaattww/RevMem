import assert from "node:assert/strict";
import test from "node:test";

import { formatOperationLogEntry, type OperationLogEntry } from "../../src/application/operation-feedback/index.js";
import { createPr108ProductionFixture, pr108ContextId, type FixtureRevision } from "../helpers/pr108-production-fixture.js";

type Fixture = Awaited<ReturnType<typeof createPr108ProductionFixture>>;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const assertTarget = (fixture: Fixture, number: number, revision: FixtureRevision): void => {
  const selection = fixture.currentContextSnapshot()?.context.selection;
  assert.equal(selection?.kind, "pull-request");
  assert.ok(selection?.kind === "pull-request");
  assert.equal(selection.contextId, pr108ContextId(number));
  assert.equal(selection.pullRequestNumber, number);
  const snapshot = fixture.review.snapshotForContext(selection.contextId);
  assert.ok(snapshot);
  assert.equal(snapshot.headSha, fixture.revisions[revision]);
  assert.equal(snapshot.baseSha, fixture.revisions.A);
  assert.equal(snapshot.originalDiffId, `${snapshot.baseSha}..${snapshot.headSha}`);
  assert.equal(snapshot.files.length, 1);
  const files = fixture.review.progress.getChildren().flatMap((category) => fixture.review.progress.getChildren(category));
  assert.equal(files.length, 1, "the target immutable diff must actually reach Progress");
  for (const file of files) {
    assert.equal(file.kind, "file");
    assert.deepEqual([file.openTarget.contextId, file.openTarget.baseSha, file.openTarget.headSha, file.openTarget.originalDiffId],
      [snapshot.contextId, snapshot.baseSha, snapshot.headSha, snapshot.originalDiffId]);
  }
  assert.deepEqual(fixture.progressPublications.at(-1), [{
    contextId: snapshot.contextId, baseSha: snapshot.baseSha, headSha: snapshot.headSha, originalDiffId: snapshot.originalDiffId,
  }], "the published Tree must correspond to the accepted selection and snapshot");
};

const assertTrace = (logs: readonly OperationLogEntry[], scenario: string, treeItems: number): void => {
  const publication = logs.find((entry) => entry.pullRequestRefresh?.stage === "tree-publication" && entry.pullRequestRefresh.status === "succeeded");
  assert.ok(publication);
  const generation = publication.pullRequestRefresh!.generation;
  const operation = publication.operationId;
  assert.ok(operation !== undefined);
  for (const stage of ["current-context", "repository-identity", "pr-acquisition", "review-contexts-list", "diff-registration", "pr-selection", "pr-progress"] as const) {
    const entry = logs.find((item) => item.pullRequestRefresh?.stage === stage && item.pullRequestRefresh.status === "succeeded");
    assert.ok(entry, `${scenario}: ${stage} must complete`);
    assert.equal(entry.operationId, operation, `${stage} belongs to the publication owner`);
    assert.equal(entry.pullRequestRefresh!.generation, generation);
  }
  const progress = logs.find((entry) => entry.pullRequestRefresh?.stage === "pr-progress" && entry.pullRequestRefresh.status === "succeeded")!;
  assert.equal(progress.pullRequestRefresh!.counts?.treeItems, treeItems);
  assert.equal(progress.pullRequestRefresh!.counts?.snapshotOrdinal, treeItems === 0 ? 0 : 1);
  assert.equal(logs.filter((entry) => entry.operationId === operation && ["succeeded", "failed", "cancelled"].includes(entry.event)).length, 1);
  const rendered = logs.map(formatOperationLogEntry).join("\n");
  for (const forbidden of ["ssaattww", "revmem-pr108-production-", "src/example.ts", "issue136-a", "issue136-b", "https://", "fixture-token"]) {
    assert.equal(rendered.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
  }
  console.log(`[Issue137 production trace: ${scenario}]\n${rendered}`);
};

for (const detailed of [false, true]) {
test(`Issue136 checkout/list/target Progress and no-match clearing, detailed ${detailed}`, async () => {
  const fixture = await createPr108ProductionFixture({ contexts: [52, 53], contextHeads: { 53: "C" }, operationFeedback: true, detailedDiagnostics: detailed, includePullRequestProgress: true });
  try {
    fixture.remote.set(52, { base: "A", head: "B", state: "open", branch: "issue136-a" });
    fixture.remote.set(53, { base: "A", head: "C", state: "open", branch: "issue136-b" });
    for (const [branch, revision, number] of [["issue136-a", "B", 52], ["issue136-b", "C", 53]] as const) {
      await fixture.checkoutBranch(branch, revision);
      const before = fixture.operationLogs.length;
      assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
      assertTarget(fixture, number, revision);
      assertTrace(fixture.operationLogs.slice(before), `checkout-${revision}`, 1);
    }
    await fixture.checkoutBranch("issue136-unmatched", "D");
    const before = fixture.operationLogs.length;
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    assert.equal(fixture.currentContextSnapshot()?.context.selection?.kind, "branch");
    assert.equal(fixture.review.progress.getEffectiveProgress().files.length, 0);
    assert.deepEqual(fixture.progressPublications.at(-1), []);
    const logs = fixture.operationLogs.slice(before);
    assert.ok(logs.some((entry) => entry.pullRequestRefresh?.stage === "pr-selection" && entry.pullRequestRefresh.reasonCode === "no-matching-pr"));
    assertTrace(logs, "no-matching-pr", 0);
  } finally { await fixture.dispose(); }
});

test(`Issue123 tracking-ahead checkout/list publishes remote immutable HEAD, detailed ${detailed}`, async () => {
  const fixture = await createPr108ProductionFixture({ contexts: [52], operationFeedback: true, detailedDiagnostics: detailed, includePullRequestProgress: true });
  try {
    fixture.remote.set(52, { base: "A", head: "C", state: "open", branch: "issue136-a" });
    await fixture.checkoutBranch("issue136-a", "B", "C");
    const before = fixture.operationLogs.length;
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    assertTarget(fixture, 52, "C");
    assert.notEqual(fixture.revisions.B, fixture.revisions.C);
    assert.equal((await fixture.state(52))?.contextState.pullRequest?.headSha, fixture.revisions.C);
    assert.ok(fixture.review.snapshotForContext(pr108ContextId(52))?.files[0]?.hunks.some((hunk) =>
      hunk.lines.some((line) => line.kind === "addition" && line.text === "c")), "snapshot contains the actual tracking revision change");
    assertTrace(fixture.operationLogs.slice(before), "tracking-ahead", 1);
  } finally { await fixture.dispose(); }
});

test(`Issue136 old branch acquisition cannot publish after newer checkout/list refresh, detailed ${detailed}`, async () => {
  const entered = deferred(), release = deferred();
  let blockNext = false;
  const fixture = await createPr108ProductionFixture({ contexts: [52, 53], contextHeads: { 53: "C" }, operationFeedback: true, detailedDiagnostics: detailed, includePullRequestProgress: true,
    beforeGitHubResponse: async (url) => {
      if (blockNext && url.pathname.endsWith("/pulls/52")) { blockNext = false; entered.resolve(); await release.promise; }
    },
  });
  let old: Promise<unknown> | undefined;
  try {
    fixture.remote.set(52, { base: "A", head: "B", state: "open", branch: "issue136-a" });
    fixture.remote.set(53, { base: "A", head: "C", state: "open", branch: "issue136-b" });
    await fixture.checkoutBranch("issue136-a", "B");
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    assertTarget(fixture, 52, "B");
    const before = fixture.operationLogs.length;
    blockNext = true;
    old = fixture.invoke("reviewRange.refreshReviewContexts");
    await entered.promise;
    await fixture.checkoutBranch("issue136-b", "C");
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    assertTarget(fixture, 53, "C");
    const published = fixture.progressPublications.length;
    release.resolve();
    await old;
    assert.equal(fixture.progressPublications.length, published, "late old-branch completion must not publish or clear the new Tree");
    assertTarget(fixture, 53, "C");
    const logs = fixture.operationLogs.slice(before);
    const oldStart = logs.find((entry) => entry.pullRequestRefresh?.stage === "current-context" && entry.pullRequestRefresh.status === "started")!;
    assert.ok(oldStart);
    assert.equal(logs.some((entry) => entry.operationId === oldStart.operationId && entry.pullRequestRefresh?.stage === "tree-publication" && entry.pullRequestRefresh.status === "succeeded"), false);
    assert.ok(logs.some((entry) => entry.operationId === oldStart.operationId && entry.pullRequestRefresh?.status === "superseded" && entry.pullRequestRefresh.supersededByGeneration !== undefined));
    const newer = logs.filter((entry) => entry.operationId !== oldStart.operationId);
    assertTrace(newer, "newer-checkout", 1);
    console.log(`[Issue137 superseded owner trace]\n${logs.filter((entry) => entry.operationId === oldStart.operationId).map(formatOperationLogEntry).join("\n")}`);
  } finally { release.resolve(); await Promise.allSettled(old === undefined ? [] : [old]); await fixture.dispose(); }
});
}

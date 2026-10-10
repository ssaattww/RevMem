import assert from "node:assert/strict";
import test from "node:test";

import { formatOperationLogEntry, OperationFeedback, PullRequestRefreshAliasAllocator, validatePullRequestRefreshAliases, type OperationLogEntry, type PullRequestRefreshAliases } from "../../src/application/operation-feedback/index.js";
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

const assertTrace = (logs: readonly OperationLogEntry[], scenario: string, treeItems: number, fixture: Fixture): void => {
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
  const identityAliases = (entry: OperationLogEntry): Record<string, unknown> | undefined =>
    (entry.pullRequestRefresh as unknown as { aliases?: Record<string, unknown> }).aliases;
  const selected = logs.find((entry) => entry.pullRequestRefresh?.stage === "repository-identity" && entry.pullRequestRefresh.status === "succeeded")!;
  const selectionAliases = identityAliases(selected);
  assert.ok(selectionAliases?.repository, "verified repository needs an allocated alias, not a presence count");
  assert.ok(selectionAliases.context, "accepted Current Context needs an allocated alias");
  assert.ok(selectionAliases.branch, "verified checked-out branch needs an allocated alias");
  if (treeItems > 0) {
    assert.ok(selectionAliases.pullRequest, "selected PR needs an allocated alias");
    const registered = logs.find((entry) => entry.pullRequestRefresh?.stage === "diff-registration" && entry.pullRequestRefresh.status === "succeeded")!;
    const registeredAliases = identityAliases(registered);
    assert.ok(registeredAliases?.snapshot, "matched immutable registration needs a snapshot alias");
    for (const entry of [registered, progress, publication]) {
      const aliases = identityAliases(entry);
      for (const key of ["repository", "branch", "pullRequest", "context"] as const) {
        assert.deepEqual(aliases?.[key], selectionAliases[key], `${key} must correlate the accepted selection and actual publication`);
      }
      assert.deepEqual(aliases?.snapshot, registeredAliases.snapshot);
      assert.match(formatOperationLogEntry(entry), / repository=repo-\d+.* pullRequest=pr-\d+.* context=context-\d+.* snapshot=snapshot-\d+/);
    }
  } else {
    assert.equal(selectionAliases.pullRequest, undefined);
    assert.equal(identityAliases(progress)?.snapshot, undefined, "unselected snapshots must not be attributed to an empty Tree");
  }
  assert.equal(progress.pullRequestRefresh!.counts?.treeItems, treeItems);
  assert.equal(progress.pullRequestRefresh!.counts?.snapshotOrdinal, treeItems === 0 ? 0 : 1);
  assert.equal(logs.filter((entry) => entry.operationId === operation && ["succeeded", "failed", "cancelled"].includes(entry.event)).length, 1);
  const rendered = logs.map(formatOperationLogEntry).join("\n");
  const diagnostics = rendered + JSON.stringify(logs);
  for (const privateIdentity of [fixture.root, ...Object.values(fixture.revisions), pr108ContextId(52), pr108ContextId(53)]) {
    assert.equal(diagnostics.includes(privateIdentity), false, "raw accepted identity must not appear in structured or formatted diagnostics");
  }
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
    let priorAliases: unknown;
    for (const [branch, revision, number] of [["issue136-a", "B", 52], ["issue136-b", "C", 53], ["issue136-b", "C", 53]] as const) {
      await fixture.checkoutBranch(branch, revision);
      const before = fixture.operationLogs.length;
      assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
      assertTarget(fixture, number, revision);
      assertTrace(fixture.operationLogs.slice(before), `checkout-${revision}`, 1, fixture);
      const aliases = fixture.operationLogs.slice(before).find((entry) => entry.pullRequestRefresh?.stage === "pr-progress" && entry.pullRequestRefresh.status === "succeeded")?.pullRequestRefresh?.aliases;
      assert.ok(aliases);
      assert.notDeepEqual(aliases, priorAliases, "a new owner allocates fresh references even for the same target; aliases cannot become stable identity tags");
      priorAliases = aliases;
    }
    await fixture.checkoutBranch("issue136-unmatched", "D");
    const before = fixture.operationLogs.length;
    assert.deepEqual(await fixture.invoke("reviewRange.refreshReviewContexts"), []);
    assert.equal(fixture.currentContextSnapshot()?.context.selection?.kind, "branch");
    assert.equal(fixture.review.progress.getEffectiveProgress().files.length, 0);
    assert.deepEqual(fixture.progressPublications.at(-1), []);
    const logs = fixture.operationLogs.slice(before);
    assert.ok(logs.some((entry) => entry.pullRequestRefresh?.stage === "pr-selection" && entry.pullRequestRefresh.reasonCode === "no-matching-pr"));
    assertTrace(logs, "no-matching-pr", 0, fixture);
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
    assertTrace(fixture.operationLogs.slice(before), "tracking-ahead", 1, fixture);
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
    assertTrace(newer, "newer-checkout", 1, fixture);
    console.log(`[Issue137 superseded owner trace]\n${logs.filter((entry) => entry.operationId === oldStart.operationId).map(formatOperationLogEntry).join("\n")}`);
  } finally { release.resolve(); await Promise.allSettled(old === undefined ? [] : [old]); await fixture.dispose(); }
});
}

for (const detailed of [false, true]) {
test(`Issue137 alias provenance, multiple identities, owner/generation isolation and disposal, detailed ${detailed}`, async () => {
  const entries: OperationLogEntry[] = [];
  const host = { isDetailedDiagnosticsEnabled: () => detailed, showBusy() {}, clearBusy() {}, revealLog() {}, appendLog: (entry: OperationLogEntry) => entries.push(entry) };
  const feedback = new OperationFeedback(host);
  let previous: PullRequestRefreshAliases | undefined;
  for (const outcome of ["success", "failure", "cancelled"] as const) {
    let completedAllocator: PullRequestRefreshAliasAllocator | undefined;
    const result = feedback.run("PR Progressを更新", async (owner) => {
      const allocator = new PullRequestRefreshAliasAllocator(1, owner);
      completedAllocator = allocator;
      owner.owner.onOperationFinished(owner, () => allocator.dispose());
      const identity = ["private-repository", "private/source", "private-branch", "private-context", "private-sha", "ghp_fixture-secret"];
      const repository = allocator.allocate("repo", identity);
      assert.ok(repository);
      assert.equal(allocator.allocate("repo", identity), repository, "same verified identity reuses one reference within its owner");
      assert.notEqual(allocator.allocate("repo", [...identity, "other-repository"]), repository);
      const context = allocator.allocate("context", identity);
      const anotherContext = allocator.allocate("context", [...identity, "another-context"]);
      const snapshot = allocator.allocate("snapshot", [...identity, "base-A", "head-B"]);
      assert.notEqual(allocator.allocate("snapshot", [...identity, "base-A", "head-C"]), snapshot);
      assert.notEqual(context, anotherContext);
      const aliases = { repository, context, snapshot };
      assert.notDeepEqual(aliases, previous, "terminal owners do not reuse identity references");
      if (previous !== undefined) {
        assert.throws(() => owner.owner.reportPullRequestRefresh(owner, {
          generation: 1, trigger: "review-contexts-refresh", stage: "pr-selection", status: "succeeded", aliases: previous,
        }), /owner-scoped/);
      }
      assert.throws(() => validatePullRequestRefreshAliases(aliases, 2), /owner-scoped/);
      assert.throws(() => validatePullRequestRefreshAliases({ repository: { ...repository } } as PullRequestRefreshAliases, 1), /owner-scoped/);
      assert.throws(() => validatePullRequestRefreshAliases({ context: repository } as unknown as PullRequestRefreshAliases, 1), /owner-scoped/);
      const foreign = new PullRequestRefreshAliasAllocator(1, owner);
      assert.throws(() => validatePullRequestRefreshAliases({ ...aliases, snapshot: foreign.allocate("snapshot", identity) }, 1), /owner-scoped/);
      foreign.dispose();
      owner.owner.reportPullRequestRefresh(owner, { generation: 1, trigger: "review-contexts-refresh", stage: "pr-progress",
        status: outcome === "success" ? "succeeded" : outcome === "failure" ? "failed" : "cancelled", aliases });
      previous = aliases;
      if (outcome === "failure") throw new Error("private-repository ghp_fixture-secret private-sha");
    });
    if (outcome === "failure") await assert.rejects(result);
    else await result;
    assert.ok(completedAllocator);
    assert.equal(completedAllocator.allocate("repo", ["private-repository"]), undefined, "every terminal outcome releases the allocator and forbids rebuilding its raw identity map");
  }
  const diagnostic = JSON.stringify(entries) + entries.map(formatOperationLogEntry).join("\n");
  for (const forbidden of ["private-repository", "private/source", "private-branch", "private-context", "private-sha", "ghp_fixture-secret", "base-A", "head-B", "head-C"]) {
    assert.equal(diagnostic.includes(forbidden), false);
  }
  assert.equal(entries.filter((entry) => entry.pullRequestRefresh?.aliases?.repository !== undefined).length, 3);
});
}

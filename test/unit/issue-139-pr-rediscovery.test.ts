import assert from "node:assert/strict";
import test from "node:test";

import { FetchGitHubPullRequestAdapter } from "../../src/adapters/github/index.js";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import type { GitHubPullRequestSearchResult } from "../../src/application/github-pr-context/index.js";
import { createTemporaryGitRepository } from "../support/temporary-git-repository.js";
import { createOwnerProductFixture, ownerContextId } from "../support/t405-owner-product-fixture.js";

const localCandidate = (root: string, head: string, ref = "main") => ({
  context: { kind: "branch" as const, label: ref, headRevision: head,
    selection: { kind: "branch" as const, repositoryId: "github.com/ssaattww/revmem", repositoryRoot: root, branchRef: `refs/heads/${ref}` } },
  progress: undefined,
});

test("Issue139 production: 同じHEADの別branchへ明示選択を持ち越さない", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    fixture.remote.clear();
    fixture.remote.set(52, { base: fixture.A, head: fixture.B, state: "open" });
    await fixture.git("checkout", "-B", "main", fixture.B);
    await fixture.invoke();
    assert.deepEqual(fixture.errors, []);
    const other = await fixture.runtime.augmentCurrentContextCandidates([localCandidate(fixture.repositoryRoot, fixture.B, "other")]);
    assert.ok(other.every(candidate => candidate.context.kind !== "pull-request"), "同じSHAの別branchに選択PRを表示しない");
    const original = await fixture.runtime.augmentCurrentContextCandidates([localCandidate(fixture.repositoryRoot, fixture.B)]);
    assert.ok(original.some(candidate => candidate.context.kind === "pull-request"), "元branchの選択は保持する");
  } finally { await fixture.dispose(); }
});

const identity = { host: "github.com", owner: "example", repository: "project" };
const head = "a".repeat(40);
const base = "b".repeat(40);
const response = (number: number, state: string, owner = "example", ref = "feature", sha = head) => ({
  number, title: `PR ${number}`, html_url: `https://github.com/example/project/pull/${number}`,
  state: state === "merged" ? "closed" : state, merged_at: state === "merged" ? "2026-10-09T00:00:00Z" : null,
  head: { sha, ref, repo: { full_name: `${owner}/project` } }, base: { ref: "main", sha: base },
});

for (const state of ["open", "closed", "merged"]) {
  test(`Issue139 production: 未保存${state}をbranchから選択しimmutable revisionとProgressを表示する`, async () => {
    const fixture = await createOwnerProductFixture([]);
    try {
      fixture.remote.clear();
      fixture.remote.set(52, { base: fixture.A, head: fixture.C, state });
      await fixture.git("checkout", "-B", "main", fixture.B);
      await fixture.runtime.preparePullRequestCandidateForExplicitContextSelection!();
      assert.deepEqual(fixture.errors, []);
      const saved = await fixture.load(52);
      assert.equal(saved?.contextState.pullRequest?.state, state);
      assert.equal(saved?.contextState.pullRequest?.headSha, fixture.C);
      assert.equal(saved?.contextState.pullRequest?.baseSha, fixture.A);
      const candidates = await fixture.runtime.augmentCurrentContextCandidates([{
        context: { kind: "branch", label: "main", headRevision: fixture.B,
          selection: { kind: "branch", repositoryId: "github.com/ssaattww/revmem", repositoryRoot: fixture.repositoryRoot, branchRef: "refs/heads/main" } },
        progress: undefined,
      }]);
      assert.ok(candidates.some(candidate => candidate.context.selection?.kind === "pull-request" &&
        candidate.context.selection.contextId === ownerContextId(52)), "Current Context候補へ表示される");
      assert.ok(fixture.registrations.has(ownerContextId(52)), "選択PRのimmutable diffを登録する");
      assert.ok(await fixture.review.getProgress(ownerContextId(52)), "選択PRのProgressを取得できる");
    } finally { await fixture.dispose(); }
  });
}

test("Issue139 production: 複数状態を選択UIに表示し別PRのreview stateを汚染しない", async () => {
  const fixture = await createOwnerProductFixture([53]);
  try {
    const before = await fixture.load(53);
    fixture.remote.set(52, { base: fixture.A, head: fixture.B, state: "closed" });
    fixture.remote.set(53, { base: fixture.A, head: fixture.B, state: "open" });
    fixture.remote.set(54, { base: fixture.A, head: fixture.B, state: "merged" });
    await fixture.git("checkout", "-B", "main", fixture.B);
    await fixture.invoke();
    assert.deepEqual(fixture.errors, []);
    assert.equal(fixture.candidatePicks.length, 1);
    assert.deepEqual(fixture.candidatePicks[0]!.map(item => item.description.split(" · ")[0]), ["closed", "open", "merged"]);
    assert.equal((await fixture.load(52))?.contextState.pullRequest?.state, "closed");
    assert.deepEqual((await fixture.load(53))?.contextState.files, before?.contextState.files);
    assert.equal((await fixture.load(53))?.contextState.pullRequest?.headSha, fixture.B);
    assert.equal(await fixture.load(54), undefined, "未選択PRのContextは作成しない");
    assert.ok(!fixture.history.some(event => event.contextId === ownerContextId(53)), "別PRへreview historyを記録しない");
  } finally { await fixture.dispose(); }
});

for (const state of ["closed", "merged"]) {
  test(`Issue139 production: 保存済み${state}を再選択して別PRのrevision/reviewを保持する`, async () => {
    const fixture = await createOwnerProductFixture([52, 53]);
    try {
      const before = await fixture.load(53);
      fixture.remote.set(52, { base: fixture.A, head: fixture.C, state });
      await fixture.git("checkout", "-B", "main", fixture.B);
      await fixture.invoke();
      assert.deepEqual(fixture.errors, []);
      const selected = await fixture.load(52);
      assert.equal(selected?.contextState.pullRequest?.state, state);
      assert.equal(selected?.contextState.pullRequest?.headSha, fixture.C);
      assert.deepEqual((await fixture.load(53))?.contextState.files, before?.contextState.files);
      assert.equal((await fixture.load(53))?.contextState.pullRequest?.headSha, fixture.B);
      const candidates = await fixture.runtime.augmentCurrentContextCandidates([localCandidate(fixture.repositoryRoot, fixture.B)]);
      assert.ok(candidates.some(candidate => candidate.context.selection?.kind === "pull-request" &&
        candidate.context.selection.contextId === ownerContextId(52)));
    } finally { await fixture.dispose(); }
  });
}

test("Issue139: 別hostの同名repository/branchを候補にしない", async () => {
  const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: "https://api.github.com", fetch: async () => {
    throw new Error("別hostを検索しない");
  } });
  assert.deepEqual(await adapter.findByHead(identity, head, { headRef: "feature", headRepository: { ...identity, host: "enterprise.example" } }),
    { kind: "found", candidates: [] });
});

for (const state of ["open", "closed", "merged"]) {
  test(`Issue139: ${state}候補をbranch/remoteからSHA不一致でも再検出する`, async () => {
    const requests: URL[] = [];
    const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: "https://api.github.com", fetch: async input => {
      const url = new URL(String(input)); requests.push(url);
      return Response.json(url.pathname.includes("/compare/") ? { merge_base_commit: { sha: base } } : [response(139, state)]);
    } });
    const search = adapter.findByHead.bind(adapter) as (
      repository: typeof identity, headSha: string, branch: { headRef: string; headRepository: typeof identity },
    ) => Promise<GitHubPullRequestSearchResult>;
    const result = await search(identity, "c".repeat(40), { headRef: "feature", headRepository: identity });
    assert.equal(result.kind, "found");
    if (result.kind !== "found") return;
    assert.equal(result.candidates.length, 1);
    assert.equal((result.candidates[0] as unknown as { state: string }).state, state);
    assert.equal(result.candidates[0]!.headSha, head);
    assert.equal(requests[0]!.searchParams.get("state"), "all");
  });
}

test("Issue139: SHAが同じでも別fork・別branch・削除repositoryの候補を除外する", async () => {
  const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: "https://api.github.com", fetch: async input => {
    const url = new URL(String(input));
    return Response.json(url.pathname.includes("/compare/") ? { merge_base_commit: { sha: base } } : [
      response(1, "open"), response(2, "closed", "other"), response(3, "merged", "example", "other"),
      { ...response(4, "closed"), head: { sha: head, ref: "feature", repo: null } },
    ]);
  } });
  const search = adapter.findByHead.bind(adapter) as (
    repository: typeof identity, headSha: string, branch: { headRef: string; headRepository: typeof identity },
  ) => Promise<GitHubPullRequestSearchResult>;
  const result = await search(identity, head, { headRef: "feature", headRepository: identity });
  assert.equal(result.kind, "found");
  if (result.kind === "found") assert.deepEqual(result.candidates.map(candidate => candidate.number), [1]);
});

test("Issue139: ローカル名が異なるtracking branchをGit設定から識別する", async () => {
  const repository = await createTemporaryGitRepository();
  try {
    await repository.runGit(["remote", "add", "origin", "https://github.com/example/project.git"]);
    await repository.runGit(["config", "branch.main.remote", "origin"]);
    await repository.runGit(["config", "branch.main.merge", "refs/heads/feature"]);
    const adapter = createNodeLocalGitAdapter();
    const inspection = await adapter.inspectRepository(repository.path);
    assert.equal(inspection.kind, "repository");
    if (inspection.kind !== "repository") return;
    const local = inspection.repository;
    const resolve = (adapter as unknown as { resolvePullRequestBranch: (repository: typeof local) => Promise<unknown> }).resolvePullRequestBranch;
    assert.equal(typeof resolve, "function");
    assert.deepEqual(await resolve.call(adapter, inspection.repository), { headRef: "feature", remoteUrl: "https://github.com/example/project.git" });
  } finally { await repository.cleanup(); }
});

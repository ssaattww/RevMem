import assert from "node:assert/strict";
import test from "node:test";

import { FetchGitHubPullRequestAdapter, FetchGitHubPullRequestLifecycleAdapter } from "../../src/adapters/github/index.js";
import { createNodeLocalGitAdapter } from "../../src/adapters/local-git/index.js";
import type { GitHubPullRequestSearchResult } from "../../src/application/github-pr-context/index.js";
import { createTemporaryGitRepository } from "../support/temporary-git-repository.js";
import { createOwnerProductFixture, ownerContextId, OWNER_ID, OWNER_FILE } from "../support/t405-owner-product-fixture.js";

const localCandidate = (root: string, head: string, ref = "main") => ({
  context: { kind: "branch" as const, label: ref, headRevision: head,
    selection: { kind: "branch" as const, repositoryId: "github.com/ssaattww/revmem", repositoryRoot: root, branchRef: `refs/heads/${ref}` } },
  progress: undefined,
});

test("IR139-002: branch不明の旧選択を同SHAの別branchへ継承しない", async () => {
  const fixture = await createOwnerProductFixture([52]);
  try {
    await fixture.git("checkout", "-B", "main", fixture.B);
    fixture.remote.clear();
    fixture.remote.set(52, { base: fixture.A, head: fixture.C, state: "closed" });
    await fixture.workspaceState.update("reviewRange.currentPullRequestSelections.v1", {
      [`${OWNER_ID}\0${fixture.B}`]: ownerContextId(52),
    });
    await fixture.git("checkout", "-B", "unrelated", fixture.B);
    const candidates = await fixture.runtime.augmentCurrentContextCandidates([localCandidate(fixture.repositoryRoot, fixture.B, "unrelated")]);
    assert.ok(candidates.every(candidate => candidate.context.kind !== "pull-request"));
    const saved = await fixture.load(52);
    assert.ok(saved, "旧Contextは削除しない");
    assert.equal(saved.contextState.pullRequest?.headSha, fixture.B);
    assert.equal(saved.contextState.pullRequest?.state, "open", "旧Contextの保存状態は変更しない");
  } finally { await fixture.dispose(); }
});

test("IR139-001: 同じremote HEADの未選択兄弟PRのrevision・確認済み範囲・履歴を保持する", async () => {
  const fixture = await createOwnerProductFixture([52, 53]);
  try {
    const sibling = await fixture.load(53);
    assert.ok(sibling);
    const file = sibling.contextState.files[OWNER_FILE];
    assert.ok(file);
    const target = { kind: "pull-request" as const, repositoryId: OWNER_ID, contextId: ownerContextId(53) };
    await fixture.repository.save(target, {
      ...sibling, contextState: { ...sibling.contextState, files: {
        ...sibling.contextState.files, [OWNER_FILE]: { ...file, modifiedReviewed: [{ startLine: 1, endLineExclusive: 2 }] },
      } },
    });
    const before = await fixture.load(53);
    fixture.remote.set(52, { base: fixture.A, head: fixture.C, state: "closed" });
    fixture.remote.set(53, { base: fixture.A, head: fixture.C, state: "open" });
    await fixture.git("checkout", "-B", "main", fixture.B);
    await fixture.invoke();
    assert.deepEqual(fixture.errors, []);
    assert.equal((await fixture.load(52))?.contextState.pullRequest?.headSha, fixture.C);
    const after = await fixture.load(53);
    assert.equal(after?.contextState.pullRequest?.headSha, fixture.B);
    assert.deepEqual(after?.contextState.files, before?.contextState.files);
    assert.ok(!fixture.history.some(event => event.contextId === ownerContextId(53)));
  } finally { await fixture.dispose(); }
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

for (const state of ["open", "closed", "merged"] as const) {
  test(`Issue142 base revision: ${state}の検索とlifecycleの比較元を一致させる`, async () => {
    const mergeBase = "d".repeat(40);
    const requests: URL[] = [];
    const payload = response(139, state);
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.includes("/compare/")) return Response.json({ merge_base_commit: { sha: mergeBase } });
      if (url.pathname.endsWith("/pulls/139")) return Response.json(payload);
      assert.ok(url.pathname.endsWith("/pulls"));
      return Response.json([payload]);
    };
    const search = new FetchGitHubPullRequestAdapter({ apiBaseUrl: "https://api.github.com", fetch });
    const lifecycle = new FetchGitHubPullRequestLifecycleAdapter({ apiBaseUrl: "https://api.github.com", fetch });
    const found = await search.findByHead(identity, head);
    assert.equal(found.kind, "found");
    if (found.kind !== "found") return;
    assert.equal(found.candidates.length, 1);
    const searchCompareCount = requests.filter(url => url.pathname.includes("/compare/")).length;
    const current = await lifecycle.fetchCurrent(identity, 139);
    assert.equal(current.kind, "available");
    if (current.kind !== "available") return;
    const candidate = found.candidates[0]!;
    assert.equal(candidate.state, state);
    assert.equal(current.metadata.state, state);
    assert.equal(candidate.headSha, current.metadata.headSha);
    assert.equal(candidate.baseSha, current.metadata.baseSha);
    assert.equal(candidate.baseSha, state === "open" ? mergeBase : base);
    assert.equal(searchCompareCount, state === "open" ? 1 : 0);
  });

  test(`Issue142 base revision: API baseとmerge-baseが異なる保存済み${state}を選択してProgressを取得する`, async () => {
    const fixture = await createOwnerProductFixture([52]);
    try {
      await fixture.git("checkout", "-B", "fixture-base-tip", fixture.A);
      await fixture.git("commit", "--allow-empty", "-m", "fixture base advance");
      const baseTip = await fixture.git("rev-parse", "HEAD");
      await fixture.git("checkout", "-B", "main", fixture.B);
      const mergeBase = await fixture.git("merge-base", baseTip, fixture.C);
      assert.equal(mergeBase, fixture.A);
      assert.notEqual(baseTip, mergeBase);
      fixture.remote.clear();
      fixture.remote.set(52, { base: baseTip, head: fixture.C, state });
      fixture.remote.set(53, { base: fixture.A, head: fixture.C, state: "open" });
      fixture.auth.required = true;
      fixture.auth.connected = false;
      await fixture.workspaceState.update("reviewRange.currentPullRequestSelections.v1", {
        [`${OWNER_ID}\0${fixture.B}`]: ownerContextId(53),
      });
      const publicationsBefore = fixture.publications.owner;

      await fixture.runtime.preparePullRequestCandidateForExplicitContextSelection!();

      assert.equal(fixture.auth.connected, true);
      assert.ok(fixture.candidatePicks.some(items => items.some(item => item.candidate.number === 52)),
        "選択した保存済みPRがPR一覧に表示される");
      assert.deepEqual(fixture.errors, []);
      const expectedBase = state === "open" ? mergeBase : baseTip;
      const saved = (await fixture.load(52))?.contextState.pullRequest;
      assert.equal(saved?.state, state);
      assert.equal(saved?.baseSha, expectedBase);
      assert.equal(saved?.headSha, fixture.C);
      assert.equal(fixture.publications.owner, publicationsBefore + 1);
      const candidates = await fixture.runtime.augmentCurrentContextCandidates([localCandidate(fixture.repositoryRoot, fixture.B)]);
      const selected = candidates.find(candidate => candidate.context.selection?.kind === "pull-request" &&
        candidate.context.selection.contextId === ownerContextId(52));
      assert.ok(selected, "Current Context候補へ表示する");
      assert.equal(selected.context.baseRevision, expectedBase);
      assert.equal(selected.context.headRevision, fixture.C);
      assert.ok(selected.progress);
      assert.ok(fixture.registrations.has(ownerContextId(52)));
      assert.ok(await fixture.review.getProgress(ownerContextId(52)));
    } finally { await fixture.dispose(); }
  });
}

for (const state of ["closed", "merged"] as const) {
  for (const field of ["base", "head"] as const) {
    test(`Issue146 object ID: ${state}の不正な${field}を候補に返さない`, async () => {
      for (const invalid of ["abc123", "f".repeat(39), "g".repeat(40), "A".repeat(40), "f".repeat(63), "refs/heads/main"]) {
        const payload = response(139, state);
        payload[field].sha = invalid;
        const requests: URL[] = [];
        const adapter = new FetchGitHubPullRequestAdapter({
          apiBaseUrl: "https://api.github.com",
          fetch: async input => { requests.push(new URL(String(input))); return Response.json([payload]); },
        });
        // Branch matching allows a different head SHA, so malformed head IDs
        // must be rejected by validation, not accidentally filtered by SHA equality.
        assert.deepEqual(await adapter.findByHead(identity, head, { headRef: "feature", headRepository: identity }),
          { kind: "unavailable", reason: "api" });
        assert.equal(requests.length, 1, "reject malformed IDs without a comparison request");
        assert.ok(requests[0]!.pathname.endsWith("/pulls"));
      }
    });
  }

  test(`Issue146 object ID: ${state}の完全なSHA-256を保持する`, async () => {
    const payload = response(139, state, "example", "feature", "a".repeat(64));
    payload.base.sha = "b".repeat(64);
    const requests: URL[] = [];
    const adapter = new FetchGitHubPullRequestAdapter({
      apiBaseUrl: "https://api.github.com",
      fetch: async input => { requests.push(new URL(String(input))); return Response.json([payload]); },
    });
    const result = await adapter.findByHead(identity, head, { headRef: "feature", headRepository: identity });
    assert.equal(result.kind, "found");
    if (result.kind !== "found") return;
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.baseSha, payload.base.sha);
    assert.equal(result.candidates[0]!.headSha, payload.head.sha);
    assert.equal(requests.length, 1);
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

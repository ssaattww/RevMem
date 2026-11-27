import assert from "node:assert/strict";
import test from "node:test";
import {
  FetchGitHubPullRequestViewedAdapter,
  type GitHubPullRequestViewedRequest,
} from "../../src/adapters/github/fetch-github-pull-request-viewed-adapter";

const repository = { host: "github.com", owner: "example", repository: "reviewed-repo" };
const m = "a".repeat(40);
const h = "b".repeat(40);
const b = "c".repeat(40);
const request: GitHubPullRequestViewedRequest = {
  repository, expectedViewerId: "viewer",
  selectedPullRequest: {
    nodeId: "pr", number: 42, state: "open", repository,
    headSha: h, comparisonBaseSha: m, originalDiffId: m + ".." + h, generation: 1,
  },
  isCurrent: () => true,
};

function page(path: string, args: {
  base?: string; next?: boolean; cursor?: string | null; total?: number; viewer?: string;
} = {}) {
  return {
    data: {
      viewer: { id: args.viewer ?? "viewer", login: "view" },
      repository: {
        nameWithOwner: "example/reviewed-repo",
        pullRequest: {
          id: "pr", number: 42, state: "OPEN", baseRefOid: args.base ?? b, headRefOid: h,
          files: {
            totalCount: args.total ?? 1,
            pageInfo: { hasNextPage: args.next ?? false, endCursor: args.cursor ?? null },
            nodes: [{ path, changeType: "MODIFIED", additions: 2, deletions: 1, viewerViewedState: "UNVIEWED" }],
          },
        },
      },
    },
  };
}

function mock(payloads: readonly unknown[], mergeBase = m, knownHosts = ["github.com"]) {
  let index = 0;
  const calls: string[] = [];
  const adapter = new FetchGitHubPullRequestViewedAdapter({
    apiBaseUrl: "https://api.github.com",
    token: "fixture-not-a-credential",
    knownHosts,
    fetch: async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.host, "api.github.com");
      assert.equal(options?.redirect, "error");
      calls.push(url.pathname);
      if (url.pathname === "/graphql") return Response.json(payloads[index++]);
      assert.equal(url.pathname, "/repos/example/reviewed-repo/compare/" + b + "..." + h);
      return Response.json({ merge_base_commit: { sha: mergeBase } });
    },
  });
  return { adapter, calls };
}

test("uses one fixed comparison and separates the base ref from the merge base over multiple pages", async () => {
  const { adapter, calls } = mock([
    page("a.ts", { next: true, cursor: "page2", total: 2 }),
    page("b.ts", { total: 2 }),
  ]);
  const result = await adapter.fetch(request);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") assert.fail("expected a complete snapshot");
  assert.deepEqual(result.snapshot.files.map(file => file.path), ["a.ts", "b.ts"]);
  assert.equal(result.snapshot.comparisonBaseSha, m);
  assert.equal(calls.length, 3);
});

test("does not copy an unverified compare anchor or accept a changed base ref in page two", async () => {
  const wrong = mock([page("a.ts")], "d".repeat(40));
  assert.deepEqual(await wrong.adapter.fetch(request), { kind: "unavailable", reason: "identity-mismatch" });
  const changed = mock([
    page("a.ts", { next: true, cursor: "page2", total: 2 }),
    page("b.ts", { base: "d".repeat(40), total: 2 }),
  ]);
  assert.deepEqual(await changed.adapter.fetch(request), { kind: "unavailable", reason: "identity-mismatch" });
});

test("rejects incomplete pagination and conflicting duplicate file paths", async () => {
  const missing = mock([page("a.ts", { next: true, total: 2 })]);
  assert.deepEqual(await missing.adapter.fetch(request), { kind: "unavailable", reason: "incomplete" });
  const duplicate = mock([
    page("a.ts", { next: true, cursor: "page2", total: 2 }),
    page("a.ts", { total: 2 }),
  ]);
  assert.deepEqual(await duplicate.adapter.fetch(request), { kind: "unavailable", reason: "incomplete" });
});

test("binds the read to its viewer, host, and current generation", async () => {
  const mismatch = mock([page("a.ts", { viewer: "different" })]);
  assert.deepEqual(await mismatch.adapter.fetch(request), { kind: "unavailable", reason: "identity-mismatch" });
  assert.equal(mismatch.calls.length, 1);
  const untrusted = mock([], m, []);
  assert.deepEqual(await untrusted.adapter.fetch(request), { kind: "unavailable", reason: "authentication" });
  assert.equal(untrusted.calls.length, 0);
  const stale = mock([page("a.ts")]);
  assert.deepEqual(await stale.adapter.fetch({ ...request, isCurrent: () => stale.calls.length === 0 }),
    { kind: "unavailable", reason: "stale" });
});

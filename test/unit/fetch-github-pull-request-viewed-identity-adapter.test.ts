// test/unit/fetch-github-pull-request-viewed-identity-adapter.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import type { GitHubRepositoryIdentity } from "../../src/application/github-pr-context/index";
import {
  FetchGitHubPullRequestViewedIdentityAdapter,
  type GitHubViewedIdentityRequest
} from "../../src/adapters/github/fetch-github-pull-request-viewed-identity-adapter";
import type { GitHubSilentSessionResult } from
  "../../src/adapters/github/vscode-github-authentication-provider";

const repository: GitHubRepositoryIdentity = {
  host: "github.com", owner: "example", repository: "reviewed-repo"
};
const session: Extract<GitHubSilentSessionResult, { kind: "available" }> = {
  kind: "available",
  accessToken: "mock-token",
  binding: {
    host: "github.com",
    providerId: "github",
    sessionId: "session-1",
    accountId: "vscode-account-1",
    authenticationGeneration: 4
  }
};
const body = (headSha = "b".repeat(40)) => ({
  data: {
    viewer: { id: "U_graphql_viewer_1", login: "example-viewer" },
    repository: {
      nameWithOwner: "example/reviewed-repo",
      pullRequest: {
        id: "PR_graphql_node_42",
        number: 42,
        state: "OPEN",
        headRefOid: headSha
      }
    }
  }
});
const request = (overrides: Partial<GitHubViewedIdentityRequest> = {}): GitHubViewedIdentityRequest => ({
  enabled: true,
  session,
  repository,
  pullRequestNumber: 42,
  headSha: "b".repeat(40),
  generation: 9,
  isCurrent: () => true,
  ...overrides
});
const adapter = (fetch: typeof globalThis.fetch) =>
  new FetchGitHubPullRequestViewedIdentityAdapter({
    apiBaseUrl: "https://api.github.com",
    knownHosts: ["github.com"],
    fetch
  });

test("returns GraphQL viewer and PR node IDs bound to the same silent session", async () => {
  let init: RequestInit | undefined;
  const result = await adapter(async (_url, options) => {
    init = options;
    return new Response(JSON.stringify(body()), { status: 200 });
  }).fetchIdentity(request());

  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.viewer.id, "U_graphql_viewer_1");
  assert.equal(result.pullRequest.nodeId, "PR_graphql_node_42");
  assert.notEqual(result.viewer.id, session.binding.accountId);
  assert.equal(result.generation, 9);
  assert.equal(result.session.sessionId, "session-1");
  assert.equal(init?.redirect, "error");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer mock-token");
});

test("setting OFF makes no HTTP request", async () => {
  let calls = 0;
  const result = await adapter(async () => {
    calls += 1;
    return new Response();
  }).fetchIdentity(request({ enabled: false }));

  assert.deepEqual(result, { kind: "unavailable", reason: "disabled" });
  assert.equal(calls, 0);
});

test("rejects a different PR HEAD and a stale acquisition generation", async () => {
  const mismatch = await adapter(async () =>
    new Response(JSON.stringify(body("c".repeat(40))), { status: 200 })
  ).fetchIdentity(request());
  assert.deepEqual(mismatch, { kind: "unavailable", reason: "identity-mismatch" });

  let current = true;
  const stale = await adapter(async () => {
    current = false;
    return new Response(JSON.stringify(body()), { status: 200 });
  }).fetchIdentity(request({ isCurrent: () => current }));
  assert.deepEqual(stale, { kind: "stale" });
});

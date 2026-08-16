import assert from "node:assert/strict";
import test from "node:test";

import {
  FetchGitHubPullRequestLifecycleAdapter,
} from "../../src/adapters/github/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const identity = { host: "github.com", owner: "ssaattww", repository: "revmem" };

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("R405-2 lifecycle adapter reports closed and merged PR state by stable PR identity", async () => {
  let merged = false;
  const adapter = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => jsonResponse({
      number: 52,
      title: "Saved PR",
      html_url: "https://github.com/ssaattww/revmem/pull/52",
      state: "closed",
      merged_at: merged ? "2026-08-16T00:00:00Z" : null,
      base: { sha: A },
      head: { sha: B },
    }),
  });

  const closed = await adapter.fetchCurrent(identity, 52);
  assert.equal(closed.kind, "available");
  if (closed.kind === "available") assert.equal(closed.metadata.state, "closed");

  merged = true;
  const mergedResult = await adapter.fetchCurrent(identity, 52);
  assert.equal(mergedResult.kind, "available");
  if (mergedResult.kind === "available") assert.equal(mergedResult.metadata.state, "merged");
});

test("R405-1 lifecycle adapter acquires an exact immutable revision comparison for T404 mapping", async () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const urls: string[] = [];
  const adapter = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async (input) => {
      urls.push(String(input));
      return new Response(diff, { status: 200, headers: { "content-type": "text/plain" } });
    },
  });

  const result = await adapter.compareRevisions(identity, A, B);
  assert.deepEqual(result, { kind: "available", diff });
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /\/compare\/a{40}\.\.\.b{40}$/u);
});

test("lifecycle adapter classifies rate-limit and network failures without substituting another revision", async () => {
  const rateLimited = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => new Response("", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    }),
  });
  assert.deepEqual(await rateLimited.fetchCurrent(identity, 52), {
    kind: "unavailable",
    reason: "rate-limit",
  });

  const offline = new FetchGitHubPullRequestLifecycleAdapter({
    apiBaseUrl: "https://api.github.com",
    fetch: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(await offline.compareRevisions(identity, A, B), {
    kind: "unavailable",
    reason: "network",
  });
});

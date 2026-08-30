import assert from "node:assert/strict";
import test from "node:test";

import {
  GitHubPullRequestContextResolver,
  type GitHubPullRequestCandidate
} from "../../src/application/github-pr-context/index";
import {
  FetchGitHubPullRequestAdapter,
  VsCodeGitHubAuthenticationProvider,
  gitHubApiBaseUrl,
  parseGitHubRemote
} from "../../src/adapters/github/index";
import { normalizeGitRemoteUrl } from "../../src/adapters/local-git/index";
import { createMockGitHubServer } from "../support/mock-github-server";

test("mock GitHub server returns fixtures, records requests, and closes", async () => {
  const server = await createMockGitHubServer([
    {
      body: { number: 42, title: "Fixture pull request" },
      method: "GET",
      pathname: "/repos/example/review-range/pulls/42",
      status: 200
    }
  ]);

  try {
    const response = await fetch(`${server.baseUrl}/repos/example/review-range/pulls/42`, {
      headers: { authorization: "Bearer test-token" }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { number: 42, title: "Fixture pull request" });
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0]?.method, "GET");
    assert.equal(server.requests[0]?.pathname, "/repos/example/review-range/pulls/42");
    assert.equal(server.requests[0]?.headers.authorization, "Bearer test-token");
  } finally {
    await server.close();
  }

  assert.equal(server.isClosed, true);
});

test("GitHub remote parser reuses the T202 canonical remote identity for HTTPS, SCP-like SSH, ports, and GitHub.com casing", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/example/review-range.git"), {
    host: "github.com",
    owner: "example",
    repository: "review-range"
  });
  assert.deepEqual(parseGitHubRemote("git@github.com:example/review-range.git"), {
    host: "github.com",
    owner: "example",
    repository: "review-range"
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@git.example.test/example/review-range.git"), {
    host: "git.example.test",
    owner: "example",
    repository: "review-range"
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@git.example.test:8443/Team/Review-Range.git"), {
    host: "git.example.test:8443",
    owner: "Team",
    repository: "Review-Range"
  });
  assert.deepEqual(parseGitHubRemote("https://git.example.test:8443/Team/Review-Range.git"), {
    host: "git.example.test:8443",
    owner: "Team",
    repository: "Review-Range"
  });
  assert.deepEqual(parseGitHubRemote("https://GitHub.com/Owner/Review-Range.git"), {
    host: "github.com",
    owner: "owner",
    repository: "review-range"
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com:22/Owner/Review-Range.git"), {
    host: "github.com",
    owner: "owner",
    repository: "review-range"
  });
  assert.equal(
    normalizeGitRemoteUrl("https://git.example.test:8443/Team/Review-Range.git"),
    "git.example.test:8443/Team/Review-Range"
  );
  assert.equal(gitHubApiBaseUrl("git.example.test:8443"), "https://git.example.test:8443/api/v3");
  assert.equal(parseGitHubRemote("/srv/git/review-range.git"), undefined);
});

test("GitHub adapter searches open pull requests for the exact HEAD with an optional token", async () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const server = await createMockGitHubServer([
    {
      body: [
        {
          number: 17,
          title: "T401",
          html_url: "https://github.com/example/review-range/pull/17",
          head: { sha: head },
          base: { ref: "main", sha: "89abcdef0123456789abcdef0123456789abcdef" }
        }
      ],
      method: "GET",
      pathname: "/repos/example/review-range/pulls",
      status: 200
    }
  ]);

  try {
    const adapter = new FetchGitHubPullRequestAdapter({
      apiBaseUrl: server.baseUrl,
      token: "test-token"
    });
    const result = await adapter.findOpenByHead(
      { host: "github.com", owner: "example", repository: "review-range" },
      head
    );

    assert.equal(result.kind, "found");
    assert.deepEqual(result.candidates, [
      {
        baseRef: "main",
        baseSha: "89abcdef0123456789abcdef0123456789abcdef",
        headSha: head,
        number: 17,
        title: "T401",
        url: "https://github.com/example/review-range/pull/17"
      }
    ]);
    assert.equal(server.requests[0]?.headers.authorization, "Bearer test-token");
  } finally {
    await server.close();
  }
});

test("GitHub adapter follows pagination until an exact HEAD candidate is found", async () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const requestedPages: number[] = [];
  const adapter = new FetchGitHubPullRequestAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async input => {
      const url = new URL(input.toString());
      const page = Number(url.searchParams.get("page") ?? "1");
      requestedPages.push(page);
      if (page === 1) {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({
          number: index + 1,
          title: `PR ${index + 1}`,
          html_url: `https://github.test/example/review-range/pull/${index + 1}`,
          head: { sha: `not-${head}-${index}` },
          base: { ref: "main", sha: "89abcdef0123456789abcdef0123456789abcdef" }
        }));
        return new Response(JSON.stringify(firstPage), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.test/repos/example/review-range/pulls?state=open&per_page=100&page=2>; rel="next"'
          }
        });
      }
      return new Response(JSON.stringify([
        {
          number: 101,
          title: "Target PR",
          html_url: "https://github.test/example/review-range/pull/101",
          head: { sha: head },
          base: { ref: "main", sha: "89abcdef0123456789abcdef0123456789abcdef" }
        }
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await adapter.findOpenByHead(
    { host: "github.test", owner: "example", repository: "review-range" },
    head
  );

  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(result, {
    kind: "found",
    candidates: [{
      baseRef: "main",
      baseSha: "89abcdef0123456789abcdef0123456789abcdef",
      headSha: head,
      number: 101,
      title: "Target PR",
      url: "https://github.test/example/review-range/pull/101"
    }]
  });
});

test("GitHub adapter rejects cross-origin pagination before forwarding authentication", async () => {
  const requestedUrls: string[] = [];
  const authorizationHeaders: Array<string | null> = [];
  const adapter = new FetchGitHubPullRequestAdapter({
    apiBaseUrl: "https://api.github.test",
    token: "private-token",
    fetch: async (input, init) => {
      requestedUrls.push(input.toString());
      authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://attacker.example/steal?page=2>; rel="next"'
        }
      });
    }
  });

  const result = await adapter.findOpenByHead(
    { host: "github.test", owner: "example", repository: "review-range" },
    "0123456789abcdef0123456789abcdef01234567"
  );

  assert.deepEqual(result, { kind: "unavailable", reason: "api" });
  assert.equal(requestedUrls.length, 1);
  assert.deepEqual(authorizationHeaders, ["Bearer private-token"]);
});

test("GitHub adapter attempts a public API request without authentication", async () => {
  const server = await createMockGitHubServer([
    {
      body: [],
      method: "GET",
      pathname: "/repos/example/review-range/pulls",
      status: 200
    }
  ]);

  try {
    const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: server.baseUrl });
    const result = await adapter.findOpenByHead(
      { host: "github.com", owner: "example", repository: "review-range" },
      "0123456789abcdef0123456789abcdef01234567"
    );

    assert.deepEqual(result, { kind: "found", candidates: [] });
    assert.equal(server.requests[0]?.headers.authorization, undefined);
  } finally {
    await server.close();
  }
});

test("T406 resolves a public PR unauthenticated and falls back to branch for GitHub failures", async () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const publicServer = await createMockGitHubServer([
    {
      body: [{
        number: 70,
        title: "Public PR",
        html_url: "https://github.com/example/review-range/pull/70",
        head: { sha: head },
        base: { ref: "main", sha: "89abcdef0123456789abcdef0123456789abcdef" }
      }],
      method: "GET",
      pathname: "/repos/example/review-range/pulls",
      status: 200
    }
  ]);

  try {
    const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: publicServer.baseUrl });
    const resolver = new GitHubPullRequestContextResolver({
      chooseCandidate: async () => {
        throw new Error("a single PR must not need an explicit selection");
      }
    });
    const resolution = await resolver.resolveSearchResult(await adapter.findOpenByHead(
      { host: "github.com", owner: "example", repository: "review-range" },
      head
    ));
    assert.equal(resolution.kind, "pull-request");
    assert.equal(resolution.kind === "pull-request" ? resolution.pullRequest.number : undefined, 70);
    assert.equal(publicServer.requests[0]?.headers.authorization, undefined);
  } finally {
    await publicServer.close();
  }

  for (const scenario of [
    { status: 401, expectedReason: "authentication" },
    { status: 403, expectedReason: "authentication" },
    { status: 404, expectedReason: "api" },
    { status: 429, expectedReason: "rate-limit" }
  ] as const) {
    const server = await createMockGitHubServer([{
      body: { message: `GitHub ${scenario.status}` },
      method: "GET",
      pathname: "/repos/example/review-range/pulls",
      status: scenario.status
    }]);
    try {
      const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: server.baseUrl });
      const resolver = new GitHubPullRequestContextResolver({ chooseCandidate: async () => undefined });
      assert.deepEqual(await adapter.findOpenByHead(
        { host: "github.com", owner: "example", repository: "review-range" }, head
      ), scenario.status === 404
        ? { kind: "unavailable", reason: scenario.expectedReason, httpStatus: 404 }
        : { kind: "unavailable", reason: scenario.expectedReason });
      assert.deepEqual(await resolver.resolveSearchResult({
        kind: "unavailable",
        reason: scenario.expectedReason
      }), { kind: "branch", reason: "unavailable" });
    } finally {
      await server.close();
    }
  }

  const networkAdapter = new FetchGitHubPullRequestAdapter({
    apiBaseUrl: "https://api.github.test",
    fetch: async () => { throw new Error("network interrupted"); }
  });
  assert.deepEqual(await networkAdapter.findOpenByHead(
    { host: "github.com", owner: "example", repository: "review-range" }, head
  ), { kind: "unavailable", reason: "network" });
});

test("GitHub adapter classifies rate-limit and API failures as unavailable", async () => {
  const server = await createMockGitHubServer([
    {
      body: { message: "API rate limit exceeded" },
      method: "GET",
      pathname: "/repos/example/review-range/pulls",
      status: 429
    }
  ]);

  try {
    const adapter = new FetchGitHubPullRequestAdapter({ apiBaseUrl: server.baseUrl });
    const result = await adapter.findOpenByHead(
      { host: "github.com", owner: "example", repository: "review-range" },
      "0123456789abcdef0123456789abcdef01234567"
    );

    assert.deepEqual(result, { kind: "unavailable", reason: "rate-limit" });
  } finally {
    await server.close();
  }
});

test("GitHub adapter classifies malformed elements, JSON, shapes, network errors, HTTP errors, and pagination cycles as unavailable", async () => {
  const head = "0123456789abcdef0123456789abcdef01234567";
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly fetch: typeof globalThis.fetch;
  }> = [
    {
      name: "network",
      fetch: async () => Promise.reject(new Error("offline"))
    },
    {
      name: "http",
      fetch: async () => new Response(JSON.stringify({ message: "broken" }), { status: 500 })
    },
    {
      name: "invalid json",
      fetch: async () => new Response("{", { status: 200 })
    },
    {
      name: "non-array shape",
      fetch: async () => new Response(JSON.stringify({ items: [] }), { status: 200 })
    },
    {
      name: "malformed array element",
      fetch: async () => new Response(JSON.stringify([null]), { status: 200 })
    },
    {
      name: "self pagination cycle",
      fetch: async input => new Response(JSON.stringify([]), {
        status: 200,
        headers: { link: `<${input.toString()}>; rel="next"` }
      })
    },
    {
      name: "multi-page pagination cycle",
      fetch: async input => {
        const url = new URL(input.toString());
        const page = url.searchParams.get("page") ?? "1";
        url.searchParams.set("page", page === "1" ? "2" : "1");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { link: `<${url}>; rel="next"` }
        });
      }
    }
  ];

  for (const scenario of cases) {
    const adapter = new FetchGitHubPullRequestAdapter({
      apiBaseUrl: "https://api.github.test",
      fetch: scenario.fetch
    });
    const resolver = new GitHubPullRequestContextResolver({
      chooseCandidate: async () => undefined
    });
    const result = await adapter.findOpenByHead(
      { host: "github.test", owner: "example", repository: "review-range" },
      head
    );
    assert.deepEqual(result, scenario.name === "http"
      ? { kind: "unavailable", reason: "api", httpStatus: 500 }
      : { kind: "unavailable", reason: scenario.name === "network" ? "network" : "api" }, scenario.name);
    assert.deepEqual(await resolver.resolveSearchResult(result), { kind: "branch", reason: "unavailable" }, scenario.name);
  }
});

test("VS Code authentication selects GitHub.com and only the configured Enterprise authority without prompting", async () => {
  const calls: Array<{ providerId: string; createIfNone: boolean }> = [];
  const provider = new VsCodeGitHubAuthenticationProvider({
    getSession: async (providerId, _scopes, options) => {
      calls.push({ providerId, createIfNone: options.createIfNone });
      return { accessToken: `${providerId}-token` } as never;
    }
  }, ["repo"], "https://git.example.test:8443");

  assert.equal(await provider.getAccessToken("github.com"), "github-token");
  assert.equal(await provider.getAccessToken("git.example.test:8443"), "github-enterprise-token");
  assert.equal(await provider.getAccessToken("attacker.example"), undefined);
  assert.deepEqual(calls, [
    { providerId: "github", createIfNone: false },
    { providerId: "github-enterprise", createIfNone: false }
  ]);
});

test("an Enterprise token is never forwarded to an unconfigured remote authority", async () => {
  const provider = new VsCodeGitHubAuthenticationProvider({
    getSession: async () => ({ accessToken: "enterprise-secret" }) as never
  }, ["repo"], "https://git.example.test");
  const token = await provider.getAccessToken("attacker.example");
  const authorizations: Array<string | null> = [];
  const adapter = new FetchGitHubPullRequestAdapter({
    apiBaseUrl: gitHubApiBaseUrl("attacker.example"),
    token,
    fetch: async (_input, init) => {
      authorizations.push(new Headers(init?.headers).get("authorization"));
      return new Response(JSON.stringify([]), { status: 200 });
    }
  });

  const result = await adapter.findOpenByHead(
    { host: "attacker.example", owner: "example", repository: "review-range" },
    "0123456789abcdef0123456789abcdef01234567"
  );
  assert.deepEqual(result, { kind: "found", candidates: [] });
  assert.deepEqual(authorizations, [null]);
});

test("authentication-provider failures fall back to an unauthenticated request", async () => {
  const provider = new VsCodeGitHubAuthenticationProvider({
    getSession: async () => Promise.reject(new Error("provider unavailable"))
  }, ["repo"], "https://git.example.test");
  const token = await provider.getAccessToken("git.example.test");
  assert.equal(token, undefined);
});

const candidate = (number: number): GitHubPullRequestCandidate => ({
  baseRef: "main",
  baseSha: "89abcdef0123456789abcdef0123456789abcdef",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  number,
  title: `PR ${number}`,
  url: `https://github.com/example/review-range/pull/${number}`
});

test("PR resolver auto-selects one candidate and falls back to branch for zero candidates", async () => {
  const one = new GitHubPullRequestContextResolver({
    chooseCandidate: async () => {
      throw new Error("selection must not be requested for one candidate");
    }
  });
  assert.deepEqual(await one.resolve([candidate(1)]), {
    kind: "pull-request",
    pullRequest: candidate(1)
  });
  assert.deepEqual(await one.resolve([]), { kind: "branch", reason: "not-found" });
});

test("PR resolver asks for multiple candidates and returns branch when selection is cancelled", async () => {
  const selected = new GitHubPullRequestContextResolver({
    chooseCandidate: async candidates => candidates[1]
  });
  assert.deepEqual(await selected.resolve([candidate(1), candidate(2)]), {
    kind: "pull-request",
    pullRequest: candidate(2)
  });

  const cancelled = new GitHubPullRequestContextResolver({
    chooseCandidate: async () => undefined
  });
  assert.deepEqual(await cancelled.resolve([candidate(1), candidate(2)]), {
    kind: "branch",
    reason: "cancelled"
  });
});

import assert from "node:assert/strict";
import test from "node:test";

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

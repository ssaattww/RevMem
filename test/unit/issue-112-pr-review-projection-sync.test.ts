import assert from "node:assert/strict";
import test from "node:test";

import { synchronizeAppliedPullRequestReview } from "../../src/t405-pr-review-projection-sync";

test("applied PR review waits for progress and owned projection refresh in order", async () => {
  const calls: string[] = [];
  const result = await synchronizeAppliedPullRequestReview(
    "applied",
    async () => { calls.push("progress"); },
    async () => { calls.push("projection"); }
  );

  assert.equal(result, "applied");
  assert.deepEqual(calls, ["progress", "projection"]);
});

test("non-applied PR review does not refresh progress or projections", async () => {
  let calls = 0;
  for (const result of ["cancelled", "no-op"] as const) {
    assert.equal(await synchronizeAppliedPullRequestReview(
      result,
      async () => { calls += 1; },
      async () => { calls += 1; }
    ), result);
  }
  assert.equal(calls, 0);
});

test("applied PR review keeps its durable result and attempts the owned projection when progress refresh fails", async () => {
  const calls: string[] = [];
  const reported: unknown[] = [];

  const result = await synchronizeAppliedPullRequestReview(
    "applied",
    async () => {
      calls.push("progress");
      throw new Error("PR Progress refresh failed");
    },
    async () => { calls.push("projection"); },
    async (error) => { reported.push(error); }
  );

  assert.equal(result, "applied");
  assert.deepEqual(calls, ["progress", "projection"]);
  assert.equal(reported.length, 1);
  assert.match(String(reported[0]), /PR Progress refresh failed/);
});

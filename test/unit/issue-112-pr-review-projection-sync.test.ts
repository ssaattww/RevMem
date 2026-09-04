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

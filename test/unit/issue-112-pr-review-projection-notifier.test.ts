import assert from "node:assert/strict";
import test from "node:test";

import { PullRequestReviewProjectionNotifier } from "../../src/t405-pr-review-projection-notifier";

test("PR review projection notifier awaits only listeners owned by that runtime", async () => {
  const first = new PullRequestReviewProjectionNotifier();
  const second = new PullRequestReviewProjectionNotifier();
  const calls: string[] = [];
  first.subscribe(async () => { calls.push("first"); });
  second.subscribe(async () => { calls.push("second"); });

  await first.notify();
  assert.deepEqual(calls, ["first"]);
});

test("disposing a PR review projection listener removes it from later notifications", async () => {
  const notifier = new PullRequestReviewProjectionNotifier();
  let calls = 0;
  const registration = notifier.subscribe(() => { calls += 1; });
  await notifier.notify();
  registration.dispose();
  await notifier.notify();
  assert.equal(calls, 1);
});

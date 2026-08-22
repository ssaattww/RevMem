import assert from "node:assert/strict";
import test from "node:test";

import {
  TestReviewStateDependentQueue,
  type TestReviewStateDependentName
} from "../../src/test-only-review-state-dependent-queue";

test("T609 Test dependent queue names every background dependent and does not make the public command wait", async () => {
  const started: TestReviewStateDependentName[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const queue = new TestReviewStateDependentQueue({
    global: async () => { started.push("global"); await pending; },
    "pull-request-progress": async () => { started.push("pull-request-progress"); },
    "review-contexts": async () => { started.push("review-contexts"); }
  });

  queue.enqueueAll();
  await Promise.resolve();
  assert.deepEqual(started, ["global"], "the first fake may remain pending without becoming a command completion condition");
  release();
  await queue.drainForTest();
  assert.deepEqual(started, ["global", "pull-request-progress", "review-contexts"]);
  assert.deepEqual(queue.failuresForTest(), []);
});

test("T609 Test dependent queue aborts stale fakes and contains their rejection during disposal", async () => {
  let publishCount = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const queue = new TestReviewStateDependentQueue({
    global: async (signal) => {
      await pending;
      if (!signal.aborted) publishCount += 1;
      throw new Error("late fake rejection");
    },
    "pull-request-progress": async () => undefined,
    "review-contexts": async () => undefined
  });

  queue.enqueueAll();
  queue.dispose();
  release();
  await queue.drainForTest();
  assert.equal(publishCount, 0, "disposed Test fakes must not publish stale state");
  assert.deepEqual(queue.failuresForTest(), [], "aborted fake rejection must be contained without an unhandled rejection");
});

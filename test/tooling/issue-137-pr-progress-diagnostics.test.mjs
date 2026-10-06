import assert from "node:assert/strict";
import test from "node:test";

const { OperationFeedback, formatOperationLogEntry } = await import(
  "../../test-dist/src/application/operation-feedback/operation-feedback.js"
);

const fakeHost = (logs) => ({
  showBusy() {},
  clearBusy() {},
  appendLog(entry) { logs.push(entry); },
  revealLog() {},
});

test("Issue #137 correlates a safe PR Progress lifecycle without serializing private input values", async () => {
  const logs = [];
  const feedback = new OperationFeedback(fakeHost(logs), () => Date.parse("2026-10-06T12:00:00.000Z"));

  await feedback.run("Review Contextsを更新", async (context) => {
    assert.equal(typeof feedback.reportPullRequestRefresh, "function",
      "PR Progress refresh needs a privacy-safe lifecycle reporting boundary");
    feedback.reportPullRequestRefresh(context, {
      generation: 8,
      trigger: "review-contexts-refresh",
      stage: "pr-selection",
      status: "succeeded",
      durationMs: 12,
      counts: { pullRequestCandidates: 2, registeredPullRequests: 1 },
      reasonCode: "ambiguous-pr-match",
    });
  });

  assert.deepEqual(logs.map((entry) => entry.event), ["started", "refresh", "succeeded"],
    "a successful refresh stage must not be confused with the owning operation terminal");

  const rendered = logs.map(formatOperationLogEntry).join("\n");
  assert.match(rendered, /operation=1\b/u);
  assert.match(rendered, /generation=8\b/u);
  assert.match(rendered, /trigger=review-contexts-refresh\b/u);
  assert.match(rendered, /stage=pr-selection\b/u);
  assert.match(rendered, /status=succeeded\b/u);
  assert.match(rendered, /duration=12ms\b/u);
  assert.match(rendered, /pullRequestCandidates=2\b/u);
  assert.match(rendered, /registeredPullRequests=1\b/u);
  assert.match(rendered, /reason=ambiguous-pr-match\b/u);

  const hostileValues = [
    "private-repository-name",
    "secret-branch-name",
    "https://private.example/pr/42?token=secret",
    "deadbeef-private-sha",
    "/private/repo/source.ts",
    "source body with token=do-not-log",
    "diff body with private content",
    "raw dependency exception containing /private/repo/source.ts",
  ];
  for (const value of hostileValues) assert.equal(rendered.includes(value), false, `log leaked ${value}`);

  assert.throws(() => feedback.reportPullRequestRefresh(undefined, {
    generation: 9,
    trigger: "secret-branch-name",
    stage: "pr-selection",
    status: "progress",
  }), /allowlist/u);
});

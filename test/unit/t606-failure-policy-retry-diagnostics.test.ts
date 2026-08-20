import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OperationFeedback,
  classifyOperationFailure,
  runWithBoundedRetry,
  type OperationFeedbackHost,
  type OperationLogEntry,
} from "../../src/application/operation-feedback/index";
import { StaleReviewStateError } from "../../src/adapters/state-repository/index";

class FakeHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public busy = 0;
  public clear = 0;
  public reveals = 0;
  public showBusy(): void { this.busy += 1; }
  public clearBusy(): void { this.clear += 1; }
  public appendLog(entry: OperationLogEntry): void { this.logs.push(entry); }
  public revealLog(): void { this.reveals += 1; }
}

test("T606 classifies retryable, permanent, stale, authentication, and validation failures without raw messages", () => {
  assert.equal(classifyOperationFailure(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })).kind, "retryable");
  assert.equal(classifyOperationFailure(Object.assign(new Error("disk"), { code: "ENOSPC" })).kind, "permanent");
  assert.equal(classifyOperationFailure(Object.assign(new Error("limit"), { status: 429 })).kind, "retryable");
  assert.equal(classifyOperationFailure({ name: "GitCommandFailedError", result: { exitCode: -1 } }).kind, "retryable");
  assert.equal(classifyOperationFailure(Object.assign(new Error("expired"), { name: "AbortError" })).kind, "stale");
  assert.equal(classifyOperationFailure(Object.assign(new Error("token"), { status: 401 })).kind, "authentication");
  assert.equal(classifyOperationFailure(new TypeError("bad input")).kind, "validation");
  assert.equal(classifyOperationFailure(new StaleReviewStateError({
    kind: "git", repositoryId: "root-a", contextId: "branch:main"
  })).kind, "stale");
});

test("T606 retries only retryable faults with a bounded cancellable sequence", async () => {
  let calls = 0;
  const result = await runWithBoundedRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("network"), { code: "ECONNRESET" });
    return "ok";
  }, { maxAttempts: 3, sleep: async () => undefined });
  assert.equal(result.value, "ok");
  assert.deepEqual(result.attempts.map((attempt) => attempt.category), ["retryable", "retryable"]);
  assert.equal(calls, 3);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runWithBoundedRetry(async () => "never", { signal: controller.signal }),
    (error: unknown) => classifyOperationFailure(error).kind === "stale",
  );
});

test("T606 emits one bounded single-line redacted ERROR and always clears activity", async () => {
  const host = new FakeHost();
  const feedback = new OperationFeedback(host, () => 1);
  const failure = Object.assign(new Error("token=abc\nC:\\private\\repo\\source.ts"), { code: "ENOSPC" });
  await assert.rejects(() => feedback.run("Storage state", async () => { throw failure; }));
  feedback.reportFailure("Storage state", failure);
  const errors = host.logs.filter((entry) => entry.event === "failed");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "Operation failed (code ENOSPC); details were redacted.");
  assert.ok((errors[0]?.message?.length ?? 0) <= 160);
  assert.equal(host.clear, 1);
});

test("T606 production boundaries use the shared lifecycle", async () => {
  const [entry, reviewContexts, globalRuntime, normalCommands] = await Promise.all([
    readFile("src/t305-extension.ts", "utf8"),
    readFile("src/t405-review-contexts-runtime.ts", "utf8"),
    readFile("src/ui/global-understanding/vscode-global-understanding-runtime.ts", "utf8"),
    readFile("src/ui/normal-editor/review-command-registration.ts", "utf8"),
  ]);
  assert.match(entry, /composeStartupFeedback/u);
  assert.match(reviewContexts, /reportActiveOperationFailure/u);
  assert.match(globalRuntime, /runWithActiveOperationFeedback/u);
  assert.match(normalCommands, /runWithActiveOperationFeedback/u);
});

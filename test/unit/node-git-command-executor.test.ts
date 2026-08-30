import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  NodeGitCommandExecutor,
  type GitCommandInvocation
} from "../../src/adapters/local-git/index";
import {
  OperationFeedback,
  type OperationFeedbackHost,
  type OperationLogEntry
} from "../../src/application/operation-feedback/index";

class FakeOperationFeedbackHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public revealCount = 0;

  public showBusy(): void {}
  public clearBusy(): void {}
  public appendLog(entry: OperationLogEntry): void {
    this.logs.push(entry);
  }
  public revealLog(): void {
    this.revealCount += 1;
  }
}

class SigtermIgnoringGitChild extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killSignals: string[] = [];

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(String(signal));
    if (signal === "SIGKILL") {
      queueMicrotask(() => this.emit("close", null, "SIGKILL"));
    }
    return true;
  }

  public unref(): void {}
}

class NeverClosingGitChild extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killSignals: string[] = [];
  public unrefCount = 0;

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(String(signal));
    return false;
  }

  public unref(): void {
    this.unrefCount += 1;
  }
}

test("streams stdout larger than the legacy 4 MiB child-process buffer", async () => {
  const outputBytes = 5 * 1024 * 1024 + 17;
  const executor = new NodeGitCommandExecutor({
    executable: process.execPath,
    timeoutMs: 10_000
  });

  const result = await executor.execute({
    argumentsList: ["-e", `process.stdout.write("x".repeat(${outputBytes}))`]
  });

  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.byteLength(result.stdout, "utf8"), outputBytes);
  assert.equal(result.stderr, "");
});

test("metadata command timeout preserves invocation and diagnostics as GitCommandFailedError", async () => {
  const timeoutMs = 50;
  const invocation: GitCommandInvocation = {
    argumentsList: ["-e", "setTimeout(() => {}, 10_000)"]
  };
  const executor = new NodeGitCommandExecutor({
    executable: process.execPath,
    timeoutMs
  });

  await assert.rejects(
    executor.execute(invocation),
    (error: unknown) => {
      assert.ok(error instanceof GitCommandFailedError);
      assert.deepEqual(error.invocation.argumentsList, invocation.argumentsList);
      assert.equal(error.invocation.cwd, undefined);
      assert.equal(error.result.exitCode, -1);
      assert.equal(error.result.stdout, "");
      assert.match(error.result.stderr, new RegExp(`timed out after ${timeoutMs} ms`, "u"));
      return true;
    }
  );
});

test("metadata timeout escalates to SIGKILL when the process ignores SIGTERM", async () => {
  const child = new SigtermIgnoringGitChild();
  const executor = new NodeGitCommandExecutor({
    timeoutMs: 10,
    terminationGraceMs: 10,
    processFactory: () => child
  });

  await assert.rejects(
    executor.execute({ argumentsList: ["status"] }),
    (error: unknown) => {
      assert.ok(error instanceof GitCommandFailedError);
      assert.equal(error.result.exitCode, -1);
      assert.match(error.result.stderr, /sent SIGKILL/u);
      assert.match(error.result.stderr, /terminated by SIGKILL/u);
      return true;
    }
  );
  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
});

test("metadata timeout force-fails when signals cannot be sent and close never arrives", async () => {
  const child = new NeverClosingGitChild();
  const executor = new NodeGitCommandExecutor({
    timeoutMs: 10,
    terminationGraceMs: 10,
    processFactory: () => child
  });

  const execution = executor.execute({ argumentsList: ["status"] });
  setTimeout(() => {
    const error = Object.assign(new Error("post-timeout process error /private/repo"), {
      code: "EIO"
    });
    child.emit("error", error);
  }, 15);

  await assert.rejects(
    execution,
    (error: unknown) => {
      assert.ok(error instanceof GitCommandFailedError);
      assert.equal(error.result.exitCode, -1);
      assert.match(error.result.stderr, /SIGTERM could not be sent/u);
      assert.match(error.result.stderr, /SIGKILL could not be sent/u);
      assert.match(error.result.stderr, /did not emit close after SIGKILL/u);
      assert.match(error.result.stderr, /Git process error after timeout/u);
      return true;
    }
  );
  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.unrefCount, 1);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
});

test("operation diagnostics redact arbitrary dependency details before Output logging", async () => {
  const cases: readonly Error[] = [
    new GitCommandFailedError(
      {
        cwd: "/Users/alice/customer-private-repo",
        argumentsList: ["diff", "base..head", "--", "src/customer-secret.ts"]
      },
      {
        exitCode: 128,
        stdout: "customer source text",
        stderr: "fatal: private repository failure"
      }
    ),
    Object.assign(
      new Error("ENOENT: no such file or directory, open '/Users/alice/customer-private-repo/state.json'"),
      { code: "ENOENT", path: "/Users/alice/customer-private-repo/state.json" }
    ),
    new Error("request failed: https://user:password@github.com/customer/private?token=ghp_supersecret"),
    new Error("PR #65 Customer Acquisition Secret Plan failed\nsource: apiKey = customer-secret")
  ];

  for (const failure of cases) {
    const host = new FakeOperationFeedbackHost();
    const feedback = new OperationFeedback(host, () => 1);

    await assert.rejects(
      feedback.run("PR進捗を計算", async () => { throw failure; }),
      failure
    );

    const terminal = host.logs.at(-1);
    assert.equal(terminal?.event, "failed");
    assert.equal(terminal?.errorName, failure.name);
    assert.ok(terminal?.message !== undefined);
    assert.doesNotMatch(terminal.message, /customer-private-repo|customer-secret|Customer Acquisition|ghp_supersecret|password|apiKey|src\/customer-secret\.ts/u);
    assert.doesNotMatch(terminal.message, /[\r\n\u2028\u2029]/u);
    assert.equal(host.revealCount, 1);
  }
});

test("operation diagnostics never emit ordinary-word private dependency text", async () => {
  const cases = [
    "Add customer acquisition dashboard failed",
    "Unexpected value quarterly payroll record"
  ] as const;

  for (const message of cases) {
    const failure = new Error(message);
    const host = new FakeOperationFeedbackHost();
    const feedback = new OperationFeedback(host, () => 1);

    await assert.rejects(
      feedback.run("PR進捗を計算", async () => { throw failure; }),
      failure
    );

    const terminal = host.logs.at(-1);
    assert.equal(terminal?.event, "failed");
    assert.equal(terminal?.message, "Operation failed; details were redacted.");
    assert.doesNotMatch(terminal?.message ?? "", /customer acquisition dashboard|quarterly payroll record/iu);
  }
});

test("operation diagnostics do not expose arbitrary custom Error names", async () => {
  const failure = new Error("ordinary dependency failure");
  failure.name = "CustomerAcquisitionDashboard";
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);

  await assert.rejects(
    feedback.run("PR進捗を計算", async () => { throw failure; }),
    failure
  );

  const terminal = host.logs.at(-1);
  assert.equal(terminal?.event, "failed");
  assert.equal(terminal?.errorName, "Error");
  assert.equal(terminal?.message, "Operation failed; details were redacted.");
});

test("nested operation failures emit one terminal ERROR for every started operation", async () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  const failure = new Error("shared failure");

  await assert.rejects(
    feedback.run("outer", () =>
      feedback.run("inner", async () => { throw failure; })
    ),
    failure
  );

  assert.deepEqual(
    host.logs.map((entry) => [entry.label, entry.event]),
    [
      ["outer", "started"],
      ["inner", "started"],
      ["inner", "failed"],
      ["outer", "failed"]
    ]
  );
});

test("the same Error object can fail separate operations without suppressing terminal events", async () => {
  const host = new FakeOperationFeedbackHost();
  const feedback = new OperationFeedback(host, () => 1);
  const failure = new Error("reused failure");

  for (const label of ["first", "second"] as const) {
    await assert.rejects(
      feedback.run(label, async () => { throw failure; }),
      failure
    );
  }

  assert.deepEqual(
    host.logs.map((entry) => [entry.label, entry.event]),
    [
      ["first", "started"],
      ["first", "failed"],
      ["second", "started"],
      ["second", "failed"]
    ]
  );
});

test("an invalid working directory is preserved as an invocation failure instead of Git unavailability", async () => {
  const executor = new NodeGitCommandExecutor();
  const missingDirectory = path.join(process.cwd(), "review-range-missing-git-cwd");

  await assert.rejects(
    executor.execute({ cwd: missingDirectory, argumentsList: ["--version"] }),
    (error: unknown) => {
      assert.equal(error instanceof GitExecutableNotFoundError, false);
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    }
  );
});

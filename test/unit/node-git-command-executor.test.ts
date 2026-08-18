import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  NodeGitCommandExecutor,
  type GitCommandInvocation
} from "../../src/adapters/local-git/index";

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

test("large stdout is returned even when it exceeds the configured stream buffer", async () => {
  const outputBytes = 512 * 1024;
  const executor = new NodeGitCommandExecutor({
    executable: process.execPath,
    maxBufferBytes: 1024
  });

  const result = await executor.execute({
    argumentsList: [
      "-e",
      `process.stdout.write("x".repeat(${outputBytes}))`
    ]
  });

  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.byteLength(result.stdout, "utf8"), outputBytes);
  assert.equal(result.stderr, "");
});

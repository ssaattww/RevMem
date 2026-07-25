import assert from "node:assert/strict";
import test from "node:test";

import {
  GitCommandFailedError,
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

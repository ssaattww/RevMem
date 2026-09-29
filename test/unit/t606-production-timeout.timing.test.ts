import assert from "node:assert/strict";
import test from "node:test";

import {
  GitCommandFailedError,
  NodeGitCommandExecutor,
} from "../../src/adapters/local-git/index";

test("T606 runs the production Git executor timeout boundary and preserves its stable timeout result", async () => {
  const executor = new NodeGitCommandExecutor({ executable: process.execPath, timeoutMs: 25 });
  await assert.rejects(
    () => executor.execute({ argumentsList: ["-e", "setTimeout(() => {}, 10_000)"] }),
    (error: unknown) =>
      error instanceof GitCommandFailedError &&
      error.result.exitCode === -1 &&
      /timed out after 25 ms/u.test(error.result.stderr),
  );
});

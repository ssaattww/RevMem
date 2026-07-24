import assert from "node:assert/strict";
import test from "node:test";

import {
  GitCommandFailedError,
  LocalGitAdapter,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";

class RootResultExecutor implements GitCommandExecutor {
  public constructor(private readonly rootResult: GitCommandResult) {}

  public async execute(
    invocation: GitCommandInvocation
  ): Promise<GitCommandResult> {
    if (invocation.argumentsList.length === 1 && invocation.argumentsList[0] === "--version") {
      return {
        exitCode: 0,
        stdout: "git version 2.55.0\n",
        stderr: ""
      };
    }

    assert.deepEqual(invocation.argumentsList, [
      "rev-parse",
      "--show-toplevel"
    ]);
    return this.rootResult;
  }
}

test("the known not-a-repository result falls back to non-Git ownership", async () => {
  const adapter = new LocalGitAdapter(new RootResultExecutor({
    exitCode: 128,
    stdout: "",
    stderr: "fatal: not a git repository (or any of the parent directories): .git\n"
  }));

  assert.deepEqual(await adapter.inspectRepository("/outside"), {
    kind: "not-repository",
    gitVersion: "2.55.0"
  });
});

test("an unexpected repository inspection failure is not relabeled as non-Git", async () => {
  const adapter = new LocalGitAdapter(new RootResultExecutor({
    exitCode: 128,
    stdout: "",
    stderr: "fatal: cannot access parent directory: Permission denied\n"
  }));

  await assert.rejects(
    adapter.inspectRepository("/restricted"),
    (error: unknown) =>
      error instanceof GitCommandFailedError &&
      error.result.stderr.includes("Permission denied")
  );
});

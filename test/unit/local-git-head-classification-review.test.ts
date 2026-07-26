import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  LocalGitAdapter,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";

const repositoryRoot = path.resolve("workspace", "repository");
const repositorySource = path.join(repositoryRoot, "src");

const success = (stdout = ""): GitCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: ""
});

const failure = (exitCode: number, stderr: string): GitCommandResult => ({
  exitCode,
  stdout: "",
  stderr
});

class PlannedExecutor implements GitCommandExecutor {
  private readonly planned: Array<{
    readonly invocation: GitCommandInvocation;
    readonly result: GitCommandResult;
  }> = [];

  public queue(
    cwd: string | undefined,
    argumentsList: readonly string[],
    result: GitCommandResult
  ): void {
    this.planned.push({
      invocation: { cwd, argumentsList: [...argumentsList] },
      result
    });
  }

  public async execute(
    invocation: GitCommandInvocation
  ): Promise<GitCommandResult> {
    const next = this.planned.shift();
    assert.ok(next, `Unexpected Git invocation: ${invocation.argumentsList.join(" ")}`);
    assert.deepEqual(invocation, next.invocation);
    return next.result;
  }

  public assertExhausted(): void {
    assert.equal(this.planned.length, 0);
  }
}

const queueInspection = (
  executor: PlannedExecutor,
  headResult: GitCommandResult
): void => {
  executor.queue(undefined, ["--version"], success("git version 2.55.0\n"));
  executor.queue(
    repositorySource,
    ["rev-parse", "--show-toplevel"],
    success(`${repositoryRoot}\n`)
  );
  executor.queue(repositoryRoot, ["remote"], success(""));
  executor.queue(
    repositoryRoot,
    ["symbolic-ref", "--quiet", "HEAD"],
    success("refs/heads/main\n")
  );
  executor.queue(
    repositoryRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    headResult
  );
};

/** Verifies that the known unborn-HEAD diagnostic is classified as an empty repository state instead of a command failure. */
test("known unborn HEAD diagnostic is accepted as a missing HEAD commit", async () => {
  const executor = new PlannedExecutor();
  queueInspection(
    executor,
    failure(128, "fatal: Needed a single revision\n")
  );

  const inspection = await new LocalGitAdapter(executor).inspectRepository(
    repositorySource
  );

  assert.equal(inspection.kind, "repository");
  if (inspection.kind === "repository") {
    assert.equal(inspection.repository.head, undefined);
    assert.deepEqual(inspection.repository.branch, {
      kind: "branch",
      fullRef: "refs/heads/main"
    });
  }
  executor.assertExhausted();
});

/** Verifies that an unrecognized Git exit-128 diagnostic remains an operational command failure. */
test("unexpected HEAD exit code 128 is propagated as GitCommandFailedError", async () => {
  const executor = new PlannedExecutor();
  queueInspection(
    executor,
    failure(128, "fatal: bad object HEAD\n")
  );

  await assert.rejects(
    new LocalGitAdapter(executor).inspectRepository(repositorySource),
    (error: unknown) => {
      assert.ok(error instanceof GitCommandFailedError);
      assert.equal(error.result.exitCode, 128);
      assert.match(error.result.stderr, /bad object HEAD/u);
      assert.deepEqual(error.invocation.argumentsList, [
        "rev-parse",
        "--verify",
        "HEAD^{commit}"
      ]);
      return true;
    }
  );
  executor.assertExhausted();
});

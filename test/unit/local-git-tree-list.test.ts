import assert from "node:assert/strict";
import test from "node:test";

import {
  GitCommandFailedError,
  LocalGitAdapter,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";
import { unreachableGitBlobReader } from "../support/unreachable-git-blob-reader";

const REVISION = "0123456789abcdef0123456789abcdef01234567";

class PlannedExecutor implements GitCommandExecutor {
  private readonly planned: Array<{
    readonly invocation: GitCommandInvocation;
    readonly result: GitCommandResult;
  }> = [];

  public queue(
    invocation: GitCommandInvocation,
    result: GitCommandResult
  ): void {
    this.planned.push({ invocation, result });
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
    assert.deepEqual(this.planned, []);
  }
}

const success = (stdout: string): GitCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: ""
});

const missing = (): GitCommandResult => ({
  exitCode: 1,
  stdout: "",
  stderr: ""
});

test("Local Git lists immutable tree paths with NUL framing and preserves embedded newlines", async () => {
  const executor = new PlannedExecutor();
  executor.queue({
    cwd: "/repo",
    argumentsList: [
      "rev-parse",
      "--verify",
      "--quiet",
      `${REVISION}^{commit}`
    ]
  }, success(`${REVISION}\n`));
  executor.queue({
    cwd: "/repo",
    argumentsList: [
      "ls-tree",
      "--full-tree",
      "-r",
      "--name-only",
      "-z",
      REVISION,
      "--"
    ]
  }, success("src/a.ts\0src/line\nbreak.ts\0src/with space.ts\0"));

  const adapter = new LocalGitAdapter(executor, unreachableGitBlobReader);
  const paths = await adapter.listFilePathsAtRevision("/repo", REVISION);

  assert.deepEqual(paths, [
    "src/a.ts",
    "src/line\nbreak.ts",
    "src/with space.ts"
  ]);
  executor.assertExhausted();
});

test("Local Git distinguishes a missing immutable revision from an empty tree", async () => {
  const missingExecutor = new PlannedExecutor();
  missingExecutor.queue({
    cwd: "/repo",
    argumentsList: [
      "rev-parse",
      "--verify",
      "--quiet",
      `${REVISION}^{commit}`
    ]
  }, missing());
  const missingAdapter = new LocalGitAdapter(
    missingExecutor,
    unreachableGitBlobReader
  );
  assert.equal(
    await missingAdapter.listFilePathsAtRevision("/repo", REVISION),
    undefined
  );
  missingExecutor.assertExhausted();

  const emptyExecutor = new PlannedExecutor();
  emptyExecutor.queue({
    cwd: "/repo",
    argumentsList: [
      "rev-parse",
      "--verify",
      "--quiet",
      `${REVISION}^{commit}`
    ]
  }, success(`${REVISION}\n`));
  emptyExecutor.queue({
    cwd: "/repo",
    argumentsList: [
      "ls-tree",
      "--full-tree",
      "-r",
      "--name-only",
      "-z",
      REVISION,
      "--"
    ]
  }, success(""));
  const emptyAdapter = new LocalGitAdapter(emptyExecutor, unreachableGitBlobReader);
  assert.deepEqual(
    await emptyAdapter.listFilePathsAtRevision("/repo", REVISION),
    []
  );
  emptyExecutor.assertExhausted();
});

test("Local Git rejects non-NUL-terminated or duplicate tree path evidence", async () => {
  for (const output of ["src/a.ts", "src/a.ts\0src/a.ts\0"]) {
    const executor = new PlannedExecutor();
    executor.queue({
      cwd: "/repo",
      argumentsList: [
        "rev-parse",
        "--verify",
        "--quiet",
        `${REVISION}^{commit}`
      ]
    }, success(`${REVISION}\n`));
    executor.queue({
      cwd: "/repo",
      argumentsList: [
        "ls-tree",
        "--full-tree",
        "-r",
        "--name-only",
        "-z",
        REVISION,
        "--"
      ]
    }, success(output));
    const adapter = new LocalGitAdapter(executor, unreachableGitBlobReader);
    await assert.rejects(
      adapter.listFilePathsAtRevision("/repo", REVISION),
      Error
    );
  }
});

test("Local Git treats rev-parse exit 128 as a fatal Git command failure", async () => {
  const executor = new PlannedExecutor();
  executor.queue({
    cwd: "/repo",
    argumentsList: [
      "rev-parse",
      "--verify",
      "--quiet",
      `${REVISION}^{commit}`
    ]
  }, {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: not a git repository"
  });

  const adapter = new LocalGitAdapter(executor, unreachableGitBlobReader);
  await assert.rejects(
    adapter.listFilePathsAtRevision("/repo", REVISION),
    (error: unknown) => {
      assert.ok(error instanceof GitCommandFailedError);
      assert.equal(error.result.exitCode, 128);
      assert.equal(error.result.stderr, "fatal: not a git repository");
      return true;
    }
  );
  executor.assertExhausted();
});

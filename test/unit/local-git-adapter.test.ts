import assert from "node:assert/strict";
import test from "node:test";

import {
  GitExecutableNotFoundError,
  LocalGitAdapter,
  normalizeGitRemoteUrl,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";

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

interface PlannedCommand {
  readonly invocation: GitCommandInvocation;
  readonly result?: GitCommandResult;
  readonly error?: Error;
}

class RecordingGitCommandExecutor implements GitCommandExecutor {
  public readonly invocations: GitCommandInvocation[] = [];
  private readonly planned: PlannedCommand[] = [];

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

  public queueError(
    cwd: string | undefined,
    argumentsList: readonly string[],
    error: Error
  ): void {
    this.planned.push({
      invocation: { cwd, argumentsList: [...argumentsList] },
      error
    });
  }

  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    this.invocations.push({
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    });

    const next = this.planned.shift();
    assert.ok(next, `Unexpected Git invocation: ${invocation.argumentsList.join(" ")}`);
    assert.deepEqual(invocation, next.invocation);

    if (next.error !== undefined) {
      throw next.error;
    }

    assert.ok(next.result);
    return next.result;
  }

  public assertExhausted(): void {
    assert.equal(this.planned.length, 0, "Every planned Git invocation must run");
  }
}

const queueRepositoryInspection = (
  executor: RecordingGitCommandExecutor,
  options: {
    readonly startPath?: string;
    readonly rootPath?: string;
    readonly remoteUrl?: string;
    readonly symbolicRef?: string;
    readonly head?: string;
  } = {}
): void => {
  const startPath = options.startPath ?? "/workspace/repository/src";
  const rootPath = options.rootPath ?? "/workspace/repository";
  const symbolicRef = options.symbolicRef ?? "refs/heads/main";
  const head = options.head ?? "0123456789abcdef0123456789abcdef01234567";

  executor.queue(undefined, ["--version"], success("git version 2.55.0\n"));
  executor.queue(
    startPath,
    ["rev-parse", "--show-toplevel"],
    success(`${rootPath}\n`)
  );
  executor.queue(
    rootPath,
    ["remote"],
    success(options.remoteUrl === undefined ? "" : "upstream\norigin\n")
  );
  if (options.remoteUrl !== undefined) {
    executor.queue(
      rootPath,
      ["remote", "get-url", "origin"],
      success(`${options.remoteUrl}\n`)
    );
  }
  executor.queue(
    rootPath,
    ["symbolic-ref", "--quiet", "HEAD"],
    symbolicRef.length === 0 ? failure(1, "") : success(`${symbolicRef}\n`)
  );
  executor.queue(
    rootPath,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    success(`${head}\n`)
  );
};

test("repository inspection uses argument arrays and returns normalized Git identity", async () => {
  const executor = new RecordingGitCommandExecutor();
  queueRepositoryInspection(executor, {
    remoteUrl: "git@GitHub.com:Owner/Repository.git"
  });

  const inspection = await new LocalGitAdapter(executor).inspectRepository(
    "/workspace/repository/src"
  );

  assert.equal(inspection.kind, "repository");
  if (inspection.kind !== "repository") {
    return;
  }

  assert.deepEqual(inspection.repository, {
    gitVersion: "2.55.0",
    rootPath: "/workspace/repository",
    repositoryId: "github.com/owner/repository",
    remote: {
      name: "origin",
      rawUrl: "git@GitHub.com:Owner/Repository.git",
      normalizedUrl: "github.com/owner/repository"
    },
    branch: {
      kind: "branch",
      fullRef: "refs/heads/main"
    },
    head: "0123456789abcdef0123456789abcdef01234567"
  });

  assert.deepEqual(
    executor.invocations.map((invocation) => invocation.argumentsList),
    [
      ["--version"],
      ["rev-parse", "--show-toplevel"],
      ["remote"],
      ["remote", "get-url", "origin"],
      ["symbolic-ref", "--quiet", "HEAD"],
      ["rev-parse", "--verify", "HEAD^{commit}"]
    ]
  );
  executor.assertExhausted();
});

test("remote normalization unifies common GitHub URL forms without credentials", () => {
  assert.equal(
    normalizeGitRemoteUrl("git@github.com:Owner/Repository.git"),
    "github.com/owner/repository"
  );
  assert.equal(
    normalizeGitRemoteUrl("ssh://git@github.com/Owner/Repository.git/"),
    "github.com/owner/repository"
  );
  assert.equal(
    normalizeGitRemoteUrl(
      "https://user:secret@GITHUB.com/Owner/Repository.git?transport=1#fragment"
    ),
    "github.com/owner/repository"
  );
  assert.equal(
    normalizeGitRemoteUrl("ssh://git@example.com/Team/Repository.git"),
    "example.com/Team/Repository"
  );
});

test("fork remotes remain distinct repository identities", async () => {
  const upstreamExecutor = new RecordingGitCommandExecutor();
  const forkExecutor = new RecordingGitCommandExecutor();
  queueRepositoryInspection(upstreamExecutor, {
    remoteUrl: "https://github.com/upstream/project.git"
  });
  queueRepositoryInspection(forkExecutor, {
    remoteUrl: "https://github.com/contributor/project.git"
  });

  const upstream = await new LocalGitAdapter(upstreamExecutor).inspectRepository(
    "/workspace/repository/src"
  );
  const fork = await new LocalGitAdapter(forkExecutor).inspectRepository(
    "/workspace/repository/src"
  );

  assert.equal(upstream.kind, "repository");
  assert.equal(fork.kind, "repository");
  if (upstream.kind !== "repository" || fork.kind !== "repository") {
    return;
  }

  assert.equal(upstream.repository.repositoryId, "github.com/upstream/project");
  assert.equal(fork.repository.repositoryId, "github.com/contributor/project");
  assert.notEqual(upstream.repository.repositoryId, fork.repository.repositoryId);
});

test("a repository without remotes receives a stable root-derived identity", async () => {
  const firstExecutor = new RecordingGitCommandExecutor();
  const secondExecutor = new RecordingGitCommandExecutor();
  const otherRootExecutor = new RecordingGitCommandExecutor();
  queueRepositoryInspection(firstExecutor);
  queueRepositoryInspection(secondExecutor);
  queueRepositoryInspection(otherRootExecutor, {
    startPath: "/workspace/other/src",
    rootPath: "/workspace/other"
  });

  const first = await new LocalGitAdapter(firstExecutor).inspectRepository(
    "/workspace/repository/src"
  );
  const afterRestart = await new LocalGitAdapter(secondExecutor).inspectRepository(
    "/workspace/repository/src"
  );
  const otherRoot = await new LocalGitAdapter(otherRootExecutor).inspectRepository(
    "/workspace/other/src"
  );

  assert.equal(first.kind, "repository");
  assert.equal(afterRestart.kind, "repository");
  assert.equal(otherRoot.kind, "repository");
  if (
    first.kind !== "repository" ||
    afterRestart.kind !== "repository" ||
    otherRoot.kind !== "repository"
  ) {
    return;
  }

  assert.equal(first.repository.remote, undefined);
  assert.match(first.repository.repositoryId, /^git-root:[0-9a-f]{64}$/);
  assert.equal(first.repository.repositoryId, afterRestart.repository.repositoryId);
  assert.notEqual(first.repository.repositoryId, otherRoot.repository.repositoryId);
});

test("detached HEAD is distinguished while retaining the exact HEAD object", async () => {
  const executor = new RecordingGitCommandExecutor();
  queueRepositoryInspection(executor, {
    symbolicRef: "",
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  });

  const inspection = await new LocalGitAdapter(executor).inspectRepository(
    "/workspace/repository/src"
  );

  assert.equal(inspection.kind, "repository");
  if (inspection.kind !== "repository") {
    return;
  }

  assert.deepEqual(inspection.repository.branch, { kind: "detached" });
  assert.equal(
    inspection.repository.head,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
});

test("Git executable absence and non-repositories are separate outcomes", async () => {
  const unavailableExecutor = new RecordingGitCommandExecutor();
  unavailableExecutor.queueError(
    undefined,
    ["--version"],
    new GitExecutableNotFoundError("missing-git")
  );

  const unavailable = await new LocalGitAdapter(
    unavailableExecutor
  ).inspectRepository("/workspace/repository");
  assert.equal(unavailable.kind, "git-unavailable");
  if (unavailable.kind === "git-unavailable") {
    assert.equal(unavailable.executable, "missing-git");
  }

  const nonRepositoryExecutor = new RecordingGitCommandExecutor();
  nonRepositoryExecutor.queue(
    undefined,
    ["--version"],
    success("git version 2.55.0\n")
  );
  nonRepositoryExecutor.queue(
    "/workspace/plain-folder",
    ["rev-parse", "--show-toplevel"],
    failure(128, "fatal: not a git repository")
  );

  const nonRepository = await new LocalGitAdapter(
    nonRepositoryExecutor
  ).inspectRepository("/workspace/plain-folder");
  assert.deepEqual(nonRepository, {
    kind: "not-repository",
    gitVersion: "2.55.0"
  });
});

test("merge-base and object existence use bounded argument-array commands", async () => {
  const executor = new RecordingGitCommandExecutor();
  executor.queue(
    "/workspace/repository",
    ["merge-base", "base-ref", "head-ref"],
    success("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n")
  );
  executor.queue(
    "/workspace/repository",
    ["cat-file", "-e", "base-ref^{object}"],
    success()
  );
  executor.queue(
    "/workspace/repository",
    ["cat-file", "-e", "missing-ref^{object}"],
    failure(1, "")
  );

  const adapter = new LocalGitAdapter(executor);

  assert.equal(
    await adapter.findMergeBase(
      "/workspace/repository",
      "base-ref",
      "head-ref"
    ),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );
  assert.equal(
    await adapter.objectExists("/workspace/repository", "base-ref"),
    true
  );
  assert.equal(
    await adapter.objectExists("/workspace/repository", "missing-ref"),
    false
  );
  executor.assertExhausted();
});

test("revision arguments that could be parsed as options are rejected", async () => {
  const adapter = new LocalGitAdapter(new RecordingGitCommandExecutor());

  await assert.rejects(
    adapter.findMergeBase("/workspace/repository", "--help", "HEAD"),
    TypeError
  );
  await assert.rejects(
    adapter.objectExists("/workspace/repository", "-p"),
    TypeError
  );
});

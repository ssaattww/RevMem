import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  LocalGitAdapter,
  NodeGitCommandExecutor,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";
import {
  ReviewDiffUriCodec,
  ReviewDiffUriCodecError,
  type ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";
import { createTemporaryGitRepository } from "../support/temporary-git-repository";

const immutableRevision = "0123456789abcdef0123456789abcdef01234567";

class SequenceGitCommandExecutor implements GitCommandExecutor {
  public readonly invocations: GitCommandInvocation[] = [];
  private nextResult = 0;

  public constructor(private readonly results: readonly GitCommandResult[]) {}

  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    this.invocations.push({
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    });
    const result = this.results[this.nextResult];
    this.nextResult += 1;
    assert.ok(result, `Unexpected Git invocation: ${invocation.argumentsList.join(" ")}`);
    return result;
  }
}

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

const createDescriptor = (
  overrides: Partial<ReviewDiffDocumentDescriptor> = {}
): ReviewDiffDocumentDescriptor => ({
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/file.ts",
  fileSystemPathSemantics: "posix",
  side: "original",
  revisionSource: "git-commit",
  revision: immutableRevision,
  ...overrides
});

test("review diff URI round-trip preserves filesystem path semantics", () => {
  const codec = new ReviewDiffUriCodec();
  const descriptor = createDescriptor({ filePath: "src/a\\b.ts" });

  assert.deepEqual(codec.decode(codec.encode(descriptor)), descriptor);
});

test("review diff URI rejects moving refs and non-canonical repository paths", () => {
  const codec = new ReviewDiffUriCodec();

  for (const descriptor of [
    createDescriptor({ revision: "HEAD" }),
    createDescriptor({ filePath: "/absolute.ts" }),
    createDescriptor({ filePath: "../secret.ts" }),
    createDescriptor({ filePath: "src//file.ts" }),
    createDescriptor({ filePath: "src/./file.ts" })
  ]) {
    assert.throws(
      () => codec.encode(descriptor),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-descriptor"
    );
  }
});

test("POSIX review diff URI preserves tab, newline, and backslash filename characters", () => {
  const codec = new ReviewDiffUriCodec();
  const descriptor = createDescriptor({
    filePath: "src/tab\tline\nback\\slash.ts",
    fileSystemPathSemantics: "posix"
  });

  assert.deepEqual(codec.decode(codec.encode(descriptor)), descriptor);
});

test("Windows review diff URI rejects backslash and control characters", () => {
  const codec = new ReviewDiffUriCodec();

  for (const filePath of ["src\\file.ts", "src/tab\tfile.ts", "C:/file.ts"]) {
    assert.throws(
      () =>
        codec.encode(
          createDescriptor({ filePath, fileSystemPathSemantics: "windows" })
        ),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-descriptor"
    );
  }
});

test("fatal revision lookup exit 128 is preserved instead of reported as missing", async () => {
  const adapter = new LocalGitAdapter(
    new SequenceGitCommandExecutor([
      failure(128, "fatal: detected dubious ownership in repository")
    ])
  );

  await assert.rejects(
    adapter.readTextFileAtRevision(
      "/workspace/repository",
      immutableRevision,
      "src/file.ts",
      "posix"
    ),
    GitCommandFailedError
  );
});

test("fatal file lookup exit 128 is preserved instead of reported as missing", async () => {
  const adapter = new LocalGitAdapter(
    new SequenceGitCommandExecutor([
      success(`${immutableRevision}\n`),
      failure(128, "fatal: object database is corrupt")
    ])
  );

  await assert.rejects(
    adapter.readTextFileAtRevision(
      "/workspace/repository",
      immutableRevision,
      "src/file.ts",
      "posix"
    ),
    GitCommandFailedError
  );
});

test("moving refs are rejected before immutable Git content lookup", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());

  try {
    await assert.rejects(
      adapter.readTextFileAtRevision(
        repository.path,
        "HEAD",
        "fixture.txt",
        "posix"
      ),
      TypeError
    );
  } finally {
    await repository.cleanup();
  }
});

test("POSIX Git content lookup supports tab, newline, and backslash filenames", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX filename semantics are unavailable on Windows runners.");
    return;
  }

  const repository = await createTemporaryGitRepository();
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());
  const fileName = "tab\tline\nback\\slash.txt";

  try {
    await writeFile(path.join(repository.path, fileName), "unusual path\n", "utf8");
    await repository.runGit(["add", "--", fileName]);
    await repository.runGit(["commit", "--message", "add unusual path"]);
    const revision = await repository.runGit(["rev-parse", "HEAD"]);

    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        revision,
        fileName,
        "posix"
      ),
      { kind: "found", content: "unusual path\n" }
    );
  } finally {
    await repository.cleanup();
  }
});

test("POSIX Git content lookup supports a filename made only of a newline", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX filename semantics are unavailable on Windows runners.");
    return;
  }

  const repository = await createTemporaryGitRepository();
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());
  const fileName = "\n";

  try {
    await writeFile(path.join(repository.path, fileName), "newline name\n", "utf8");
    await repository.runGit(["add", "--", fileName]);
    await repository.runGit(["commit", "--message", "add newline-only path"]);
    const revision = await repository.runGit(["rev-parse", "HEAD"]);

    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        revision,
        fileName,
        "posix"
      ),
      { kind: "found", content: "newline name\n" }
    );
  } finally {
    await repository.cleanup();
  }
});

test("Git content lookup reads UTF-8 text immediately below and above 4 MiB", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());
  const fourMiB = 4 * 1024 * 1024;
  const below = "a".repeat(fourMiB - 1);
  const above = "b".repeat(fourMiB + 1);

  try {
    await writeFile(path.join(repository.path, "below.txt"), below, "utf8");
    await writeFile(path.join(repository.path, "above.txt"), above, "utf8");
    await repository.runGit(["add", "below.txt", "above.txt"]);
    await repository.runGit(["commit", "--message", "add large text fixtures"]);
    const revision = await repository.runGit(["rev-parse", "HEAD"]);

    const belowResult = await adapter.readTextFileAtRevision(
      repository.path,
      revision,
      "below.txt",
      "posix"
    );
    const aboveResult = await adapter.readTextFileAtRevision(
      repository.path,
      revision,
      "above.txt",
      "posix"
    );

    assert.equal(belowResult.kind, "found");
    assert.equal(aboveResult.kind, "found");
    if (belowResult.kind === "found" && aboveResult.kind === "found") {
      assert.equal(belowResult.content.length, below.length);
      assert.equal(aboveResult.content.length, above.length);
    }
  } finally {
    await repository.cleanup();
  }
});

test("non-UTF-8 Git blob is rejected deterministically without replacement characters", async () => {
  const repository = await createTemporaryGitRepository();
  const adapter = new LocalGitAdapter(new NodeGitCommandExecutor());

  try {
    await writeFile(
      path.join(repository.path, "invalid-utf8.txt"),
      Buffer.from([0x66, 0x6f, 0x80, 0x6f])
    );
    await repository.runGit(["add", "invalid-utf8.txt"]);
    await repository.runGit(["commit", "--message", "add invalid UTF-8 fixture"]);
    const revision = await repository.runGit(["rev-parse", "HEAD"]);

    assert.deepEqual(
      await adapter.readTextFileAtRevision(
        repository.path,
        revision,
        "invalid-utf8.txt",
        "posix"
      ),
      { kind: "invalid-encoding", encoding: "utf-8" }
    );
  } finally {
    await repository.cleanup();
  }
});

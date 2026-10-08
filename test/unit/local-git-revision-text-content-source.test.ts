import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  LocalGitRevisionTextContentSource,
  type ReviewDiffRepositoryRootResolver
} from "../../src/adapters/diff-document/index";
import {
  LocalGitAdapter,
  type GitBlobReader,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";
import type {
  ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";

const commitObjectId = "0123456789abcdef0123456789abcdef01234567";
const blobObjectId = "89abcdef0123456789abcdef0123456789abcdef";

class StaticRepositoryRootResolver implements ReviewDiffRepositoryRootResolver {
  public readonly contextIds: string[] = [];

  public constructor(private readonly root: string | undefined) {}

  public async resolveRepositoryRoot(contextId: string): Promise<string | undefined> {
    this.contextIds.push(contextId);
    return this.root;
  }
}

class RecordingGitCommandExecutor implements GitCommandExecutor {
  public readonly invocations: GitCommandInvocation[] = [];

  public constructor(private readonly results: readonly GitCommandResult[]) {}

  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    this.invocations.push({
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    });
    const result = this.results[this.invocations.length - 1];
    assert.ok(result, "Every Git invocation must have a planned result");
    return result;
  }
}

class RecordingGitBlobReader implements GitBlobReader {
  public readonly requests: Array<{
    readonly repositoryRoot: string;
    readonly blobObjectId: string;
  }> = [];

  public async readBlob(
    repositoryRoot: string,
    requestedBlobObjectId: string
  ): Promise<Uint8Array> {
    this.requests.push({ repositoryRoot, blobObjectId: requestedBlobObjectId });
    return Buffer.from("before\n", "utf8");
  }
}

const descriptor: ReviewDiffDocumentDescriptor = {
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/file.ts",
  fileSystemPathSemantics: "posix",
  side: "original",
  revisionSource: "git-commit",
  revision: commitObjectId
};

test("local Git content source resolves the encoded context before reading its revision", async () => {
  const repositoryRoot = path.resolve("workspace", "repository");
  const resolver = new StaticRepositoryRootResolver(repositoryRoot);
  const executor = new RecordingGitCommandExecutor([
    { exitCode: 0, stdout: `${commitObjectId}\n`, stderr: "" },
    {
      exitCode: 0,
      stdout: `100644 blob ${blobObjectId}\tsrc/file.ts\0`,
      stderr: ""
    }
  ]);
  const blobReader = new RecordingGitBlobReader();
  const source = new LocalGitRevisionTextContentSource(
    resolver,
    new LocalGitAdapter(executor, blobReader)
  );

  assert.deepEqual(await source.readTextContent(descriptor), {
    kind: "found",
    content: "before\n"
  });
  assert.deepEqual(resolver.contextIds, [descriptor.contextId]);
  assert.deepEqual(executor.invocations, [
    {
      cwd: repositoryRoot,
      argumentsList: [
        "rev-parse",
        "--verify",
        "--quiet",
        `${commitObjectId}^{commit}`
      ]
    },
    {
      cwd: repositoryRoot,
      argumentsList: [
        "ls-tree",
        "--full-tree",
        "-z",
        commitObjectId,
        "--",
        ":(literal)src/file.ts"
      ]
    }
  ]);
  assert.deepEqual(blobReader.requests, [
    { repositoryRoot, blobObjectId }
  ]);
});

test("local Git content source does not fall back when the encoded context is missing", async () => {
  const resolver = new StaticRepositoryRootResolver(undefined);
  const executor = new RecordingGitCommandExecutor([]);
  const blobReader = new RecordingGitBlobReader();
  const source = new LocalGitRevisionTextContentSource(
    resolver,
    new LocalGitAdapter(executor, blobReader)
  );

  assert.deepEqual(await source.readTextContent(descriptor), {
    kind: "missing-context"
  });
  assert.deepEqual(resolver.contextIds, [descriptor.contextId]);
  assert.deepEqual(executor.invocations, []);
  assert.deepEqual(blobReader.requests, []);
});

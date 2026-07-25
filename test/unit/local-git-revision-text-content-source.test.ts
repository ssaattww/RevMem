import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  LocalGitRevisionTextContentSource,
  type ReviewDiffRepositoryRootResolver
} from "../../src/adapters/diff-document/index";
import {
  LocalGitAdapter,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "../../src/adapters/local-git/index";
import type {
  ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";

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

const descriptor: ReviewDiffDocumentDescriptor = {
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/file.ts",
  side: "original",
  revision: "base-ref"
};

test("local Git content source resolves the encoded context before reading its revision", async () => {
  const repositoryRoot = path.resolve("workspace", "repository");
  const resolver = new StaticRepositoryRootResolver(repositoryRoot);
  const executor = new RecordingGitCommandExecutor([
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "before\n", stderr: "" }
  ]);
  const source = new LocalGitRevisionTextContentSource(
    resolver,
    new LocalGitAdapter(executor)
  );

  assert.deepEqual(await source.readTextContent(descriptor), {
    kind: "found",
    content: "before\n"
  });
  assert.deepEqual(resolver.contextIds, [descriptor.contextId]);
  assert.deepEqual(executor.invocations, [
    {
      cwd: repositoryRoot,
      argumentsList: ["cat-file", "-e", "base-ref^{commit}"]
    },
    {
      cwd: repositoryRoot,
      argumentsList: ["cat-file", "blob", "base-ref:src/file.ts"]
    }
  ]);
});

test("local Git content source does not fall back when the encoded context is missing", async () => {
  const resolver = new StaticRepositoryRootResolver(undefined);
  const executor = new RecordingGitCommandExecutor([]);
  const source = new LocalGitRevisionTextContentSource(
    resolver,
    new LocalGitAdapter(executor)
  );

  assert.deepEqual(await source.readTextContent(descriptor), {
    kind: "missing-context"
  });
  assert.deepEqual(resolver.contextIds, [descriptor.contextId]);
  assert.deepEqual(executor.invocations, []);
});

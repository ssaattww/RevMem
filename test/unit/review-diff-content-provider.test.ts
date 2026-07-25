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
import {
  ReviewDiffUriCodec,
  ReviewDiffUriCodecError,
  RevisionTextContentProvider,
  RevisionTextContentProviderError,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentReadResult,
  type RevisionTextContentSource
} from "../../src/application/diff-document/index";

const originalDescriptor: ReviewDiffDocumentDescriptor = {
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/日本語/space name.ts",
  side: "original",
  revision: "0123456789abcdef0123456789abcdef01234567"
};

const modifiedDescriptor: ReviewDiffDocumentDescriptor = {
  ...originalDescriptor,
  side: "modified",
  revision: "89abcdef0123456789abcdef0123456789abcdef"
};

class RecordingRevisionTextContentSource implements RevisionTextContentSource {
  public readonly requests: ReviewDiffDocumentDescriptor[] = [];

  public constructor(
    private readonly results: readonly RevisionTextContentReadResult[]
  ) {}

  public async readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult> {
    this.requests.push({ ...descriptor });
    const result = this.results[this.requests.length - 1];
    assert.ok(result, "Every content request must have a planned result");
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

interface PlannedCommand {
  readonly invocation: GitCommandInvocation;
  readonly result: GitCommandResult;
}

class RecordingGitCommandExecutor implements GitCommandExecutor {
  private readonly planned: PlannedCommand[] = [];

  public queue(
    cwd: string,
    argumentsList: readonly string[],
    result: GitCommandResult
  ): void {
    this.planned.push({
      invocation: { cwd, argumentsList: [...argumentsList] },
      result
    });
  }

  public async execute(invocation: GitCommandInvocation): Promise<GitCommandResult> {
    const next = this.planned.shift();
    assert.ok(next, `Unexpected Git invocation: ${invocation.argumentsList.join(" ")}`);
    assert.deepEqual(invocation, next.invocation);
    return next.result;
  }

  public assertExhausted(): void {
    assert.equal(this.planned.length, 0, "Every planned Git invocation must run");
  }
}

test("review diff URI round-trips context, file, side, and revision", () => {
  const codec = new ReviewDiffUriCodec();

  const originalUri = codec.encode(originalDescriptor);
  const modifiedUri = codec.encode(modifiedDescriptor);

  assert.match(
    originalUri,
    /^review-range-diff:\/\/document\/v1\/[A-Za-z0-9_-]+\/original\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u
  );
  assert.deepEqual(codec.decode(originalUri), originalDescriptor);
  assert.deepEqual(codec.decode(modifiedUri), modifiedDescriptor);
  assert.notEqual(originalUri, modifiedUri);
});

test("review diff URIs from different contexts never collide", () => {
  const codec = new ReviewDiffUriCodec();
  const first = codec.encode(originalDescriptor);
  const second = codec.encode({
    ...originalDescriptor,
    contextId: "pull-request:github.com/owner/repository#43"
  });

  assert.notEqual(first, second);
  assert.deepEqual(codec.decode(first), originalDescriptor);
  assert.equal(codec.decode(second).contextId.endsWith("#43"), true);
});

test("review diff URI decoding rejects non-canonical or malformed inputs deterministically", () => {
  const codec = new ReviewDiffUriCodec();
  const valid = codec.encode(originalDescriptor);
  const invalidUris = [
    valid.replace("review-range-diff:", "file:"),
    valid.replace("//document/", "//other/"),
    valid.replace("/v1/", "/v2/"),
    `${valid}?query=forbidden`,
    `${valid}#fragment-forbidden`,
    valid.replace("/original/", "/unknown/"),
    valid.replace(/\/[A-Za-z0-9_-]+$/u, "/***")
  ];

  for (const uri of invalidUris) {
    assert.throws(
      () => codec.decode(uri),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-uri"
    );
  }
});

test("review diff URI encoding rejects empty and control-character fields", () => {
  const codec = new ReviewDiffUriCodec();

  for (const descriptor of [
    { ...originalDescriptor, contextId: "" },
    { ...originalDescriptor, filePath: "src/a\0.ts" },
    { ...originalDescriptor, revision: "HEAD\nother" }
  ]) {
    assert.throws(
      () => codec.encode(descriptor),
      (error: unknown) =>
        error instanceof ReviewDiffUriCodecError &&
        error.code === "invalid-review-diff-descriptor"
    );
  }
});

test("content provider restores original and modified revision content", async () => {
  const codec = new ReviewDiffUriCodec();
  const source = new RecordingRevisionTextContentSource([
    { kind: "found", content: "before\n" },
    { kind: "found", content: "after\n" }
  ]);
  const provider = new RevisionTextContentProvider(codec, source);

  assert.equal(
    await provider.provideTextDocumentContent(codec.encode(originalDescriptor)),
    "before\n"
  );
  assert.equal(
    await provider.provideTextDocumentContent(codec.encode(modifiedDescriptor)),
    "after\n"
  );
  assert.deepEqual(source.requests, [originalDescriptor, modifiedDescriptor]);
});

test("content provider reports missing context, revision, and file with stable codes", async () => {
  const codec = new ReviewDiffUriCodec();
  const source = new RecordingRevisionTextContentSource([
    { kind: "missing-context" },
    { kind: "missing-revision" },
    { kind: "missing-file" }
  ]);
  const provider = new RevisionTextContentProvider(codec, source);
  const uri = codec.encode(originalDescriptor);
  const expected = [
    ["missing-context", "Review context is unavailable"],
    ["missing-revision", "Revision object is unavailable"],
    ["missing-file", "File is unavailable at the requested revision"]
  ] as const;

  for (const [code, message] of expected) {
    await assert.rejects(
      provider.provideTextDocumentContent(uri),
      (error: unknown) =>
        error instanceof RevisionTextContentProviderError &&
        error.code === code &&
        error.message === message
    );
  }
});

test("local Git adapter reads exact text content at a revision", async () => {
  const executor = new RecordingGitCommandExecutor();
  const repositoryRoot = path.resolve("workspace", "repository");
  executor.queue(
    repositoryRoot,
    ["cat-file", "-e", "base-ref^{commit}"],
    success()
  );
  executor.queue(
    repositoryRoot,
    ["cat-file", "blob", "base-ref:src/file.ts"],
    success("const value = 1;\n")
  );

  const result = await new LocalGitAdapter(executor).readTextFileAtRevision(
    repositoryRoot,
    "base-ref",
    "src/file.ts"
  );

  assert.deepEqual(result, {
    kind: "found",
    content: "const value = 1;\n"
  });
  executor.assertExhausted();
});

test("local Git adapter distinguishes missing revisions and missing files", async () => {
  const repositoryRoot = path.resolve("workspace", "repository");
  const missingRevisionExecutor = new RecordingGitCommandExecutor();
  missingRevisionExecutor.queue(
    repositoryRoot,
    ["cat-file", "-e", "missing-ref^{commit}"],
    failure(128, "fatal: Not a valid object name")
  );

  assert.deepEqual(
    await new LocalGitAdapter(missingRevisionExecutor).readTextFileAtRevision(
      repositoryRoot,
      "missing-ref",
      "src/file.ts"
    ),
    { kind: "missing-revision" }
  );
  missingRevisionExecutor.assertExhausted();

  const missingFileExecutor = new RecordingGitCommandExecutor();
  missingFileExecutor.queue(
    repositoryRoot,
    ["cat-file", "-e", "base-ref^{commit}"],
    success()
  );
  missingFileExecutor.queue(
    repositoryRoot,
    ["cat-file", "blob", "base-ref:src/missing.ts"],
    failure(128, "fatal: path does not exist")
  );

  assert.deepEqual(
    await new LocalGitAdapter(missingFileExecutor).readTextFileAtRevision(
      repositoryRoot,
      "base-ref",
      "src/missing.ts"
    ),
    { kind: "missing-file" }
  );
  missingFileExecutor.assertExhausted();
});

test("local Git adapter rejects unsafe revision and repository-relative path inputs", async () => {
  const adapter = new LocalGitAdapter(new RecordingGitCommandExecutor());

  await assert.rejects(
    adapter.readTextFileAtRevision("/workspace/repository", "--help", "src/file.ts"),
    TypeError
  );
  await assert.rejects(
    adapter.readTextFileAtRevision("/workspace/repository", "HEAD", "../secret.ts"),
    TypeError
  );
  await assert.rejects(
    adapter.readTextFileAtRevision("/workspace/repository", "HEAD", "/absolute.ts"),
    TypeError
  );
});

test("local Git adapter preserves unexpected Git failures", async () => {
  const executor = new RecordingGitCommandExecutor();
  executor.queue(
    "/workspace/repository",
    ["cat-file", "-e", "HEAD^{commit}"],
    failure(2, "fatal: I/O failure")
  );

  await assert.rejects(
    new LocalGitAdapter(executor).readTextFileAtRevision(
      "/workspace/repository",
      "HEAD",
      "src/file.ts"
    ),
    GitCommandFailedError
  );
  executor.assertExhausted();
});

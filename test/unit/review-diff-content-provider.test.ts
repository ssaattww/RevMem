import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  GitCommandFailedError,
  LocalGitAdapter,
  type GitBlobReader,
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

const originalRevision = "0123456789abcdef0123456789abcdef01234567";
const modifiedRevision = "89abcdef0123456789abcdef0123456789abcdef";
const blobObjectId = "abcdef0123456789abcdef0123456789abcdef01";

const originalDescriptor: ReviewDiffDocumentDescriptor = {
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/日本語/space name.ts",
  fileSystemPathSemantics: "posix",
  side: "original",
  revisionSource: "git-commit",
  revision: originalRevision
};

const modifiedDescriptor: ReviewDiffDocumentDescriptor = {
  ...originalDescriptor,
  side: "modified",
  revision: modifiedRevision
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

class RecordingGitBlobReader implements GitBlobReader {
  public readonly requests: Array<{
    readonly repositoryRoot: string;
    readonly blobObjectId: string;
  }> = [];

  public constructor(private readonly contents: readonly Uint8Array[]) {}

  public async readBlob(
    repositoryRoot: string,
    requestedBlobObjectId: string
  ): Promise<Uint8Array> {
    this.requests.push({ repositoryRoot, blobObjectId: requestedBlobObjectId });
    const content = this.contents[this.requests.length - 1];
    assert.ok(content, "Every blob request must have planned bytes");
    return content;
  }
}

const createAdapterWithoutBlobReads = (
  executor: GitCommandExecutor
): LocalGitAdapter => new LocalGitAdapter(executor, new RecordingGitBlobReader([]));

test("review diff URI round-trips context, file, semantics, side, source, and revision", () => {
  const codec = new ReviewDiffUriCodec();

  const originalUri = codec.encode(originalDescriptor);
  const modifiedUri = codec.encode(modifiedDescriptor);

  assert.match(
    originalUri,
    /^review-range-diff:\/\/document\/v1\/[A-Za-z0-9_-]+\/posix\/original\/git-commit\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u
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
    valid.replace("/posix/", "/unknown/"),
    valid.replace("/original/", "/unknown/"),
    valid.replace("/git-commit/", "/moving-ref/"),
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

test("review diff URI encoding rejects invalid descriptor fields", () => {
  const codec = new ReviewDiffUriCodec();

  for (const descriptor of [
    { ...originalDescriptor, contextId: "" },
    { ...originalDescriptor, filePath: "src/a\0.ts" },
    { ...originalDescriptor, revision: "HEAD" }
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

test("content provider reports unavailable and invalid-encoding outcomes with stable codes", async () => {
  const codec = new ReviewDiffUriCodec();
  const source = new RecordingRevisionTextContentSource([
    { kind: "missing-context" },
    { kind: "missing-revision" },
    { kind: "missing-file" },
    { kind: "invalid-encoding", encoding: "utf-8" }
  ]);
  const provider = new RevisionTextContentProvider(codec, source);
  const uri = codec.encode(originalDescriptor);
  const expected = [
    ["missing-context", "Review context is unavailable"],
    ["missing-revision", "Revision object is unavailable"],
    ["missing-file", "File is unavailable at the requested revision"],
    ["invalid-encoding", "File content is not valid UTF-8"]
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

test("local Git adapter reads exact streamed text content at a commit", async () => {
  const executor = new RecordingGitCommandExecutor();
  const blobReader = new RecordingGitBlobReader([
    Buffer.from("const value = 1;\n", "utf8")
  ]);
  const repositoryRoot = path.resolve("workspace", "repository");
  executor.queue(
    repositoryRoot,
    ["rev-parse", "--verify", "--quiet", `${originalRevision}^{commit}`],
    success(`${originalRevision}\n`)
  );
  executor.queue(
    repositoryRoot,
    [
      "ls-tree",
      "--full-tree",
      "-z",
      originalRevision,
      "--",
      ":(literal)src/file.ts"
    ],
    success(`100644 blob ${blobObjectId}\tsrc/file.ts\0`)
  );

  const result = await new LocalGitAdapter(
    executor,
    blobReader
  ).readTextFileAtRevision(
    repositoryRoot,
    originalRevision,
    "src/file.ts",
    "posix"
  );

  assert.deepEqual(result, {
    kind: "found",
    content: "const value = 1;\n"
  });
  assert.deepEqual(blobReader.requests, [{ repositoryRoot, blobObjectId }]);
  executor.assertExhausted();
});

test("local Git adapter distinguishes missing commits and missing files", async () => {
  const repositoryRoot = path.resolve("workspace", "repository");
  const missingRevisionExecutor = new RecordingGitCommandExecutor();
  missingRevisionExecutor.queue(
    repositoryRoot,
    ["rev-parse", "--verify", "--quiet", `${originalRevision}^{commit}`],
    failure(1, "")
  );

  assert.deepEqual(
    await createAdapterWithoutBlobReads(
      missingRevisionExecutor
    ).readTextFileAtRevision(
      repositoryRoot,
      originalRevision,
      "src/file.ts",
      "posix"
    ),
    { kind: "missing-revision" }
  );
  missingRevisionExecutor.assertExhausted();

  const missingFileExecutor = new RecordingGitCommandExecutor();
  missingFileExecutor.queue(
    repositoryRoot,
    ["rev-parse", "--verify", "--quiet", `${originalRevision}^{commit}`],
    success(`${originalRevision}\n`)
  );
  missingFileExecutor.queue(
    repositoryRoot,
    [
      "ls-tree",
      "--full-tree",
      "-z",
      originalRevision,
      "--",
      ":(literal)src/missing.ts"
    ],
    success()
  );

  assert.deepEqual(
    await createAdapterWithoutBlobReads(missingFileExecutor).readTextFileAtRevision(
      repositoryRoot,
      originalRevision,
      "src/missing.ts",
      "posix"
    ),
    { kind: "missing-file" }
  );
  missingFileExecutor.assertExhausted();
});

test("local Git adapter rejects moving revisions and unsafe repository paths", async () => {
  const adapter = createAdapterWithoutBlobReads(new RecordingGitCommandExecutor());

  await assert.rejects(
    adapter.readTextFileAtRevision(
      "/workspace/repository",
      "HEAD",
      "src/file.ts",
      "posix"
    ),
    TypeError
  );
  await assert.rejects(
    adapter.readTextFileAtRevision(
      "/workspace/repository",
      originalRevision,
      "../secret.ts",
      "posix"
    ),
    TypeError
  );
  await assert.rejects(
    adapter.readTextFileAtRevision(
      "/workspace/repository",
      originalRevision,
      "/absolute.ts",
      "posix"
    ),
    TypeError
  );
});

test("local Git adapter preserves unexpected Git failures", async () => {
  const executor = new RecordingGitCommandExecutor();
  executor.queue(
    "/workspace/repository",
    ["rev-parse", "--verify", "--quiet", `${originalRevision}^{commit}`],
    failure(128, "fatal: I/O failure")
  );

  await assert.rejects(
    createAdapterWithoutBlobReads(executor).readTextFileAtRevision(
      "/workspace/repository",
      originalRevision,
      "src/file.ts",
      "posix"
    ),
    GitCommandFailedError
  );
  executor.assertExhausted();
});

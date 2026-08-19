import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type EmptyReviewDiffDocumentDescriptor,
  type GitCommitReviewDiffDocumentDescriptor,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentSource
} from "../../src/application/diff-document/index";
import {
  LocalGitRevisionTextContentSource
} from "../../src/adapters/diff-document/index";
import type { LocalGitAdapter } from "../../src/adapters/local-git/index";
import type {
  PullRequestDiffFileProgress,
  PullRequestDiffProgress
} from "../../src/core/pr-progress/index";
import {
  ReviewDiffEditorController,
  type ReviewDiffEditorHost,
  type ReviewDiffEditorSideInput
} from "../../src/ui/diff-editor/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestEffectiveProgress,
  type PullRequestLineReviewUnsupportedReason,
  type PullRequestLineReviewability,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode,
  type PullRequestProgressTreeSelectionResult,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

const fileProgress = (
  fileId: string,
  path: string,
  options: Partial<PullRequestDiffFileProgress> = {}
): PullRequestDiffFileProgress => ({
  fileId,
  oldPath: path,
  newPath: path,
  status: "modified",
  path,
  additions: 2,
  deletions: 1,
  reviewedLineCount: 0,
  totalLineCount: 3,
  progress: 0,
  excluded: false,
  ...options
});

const aggregate = (
  files: readonly PullRequestDiffFileProgress[]
): PullRequestDiffProgress => {
  const reviewedLineCount = files.reduce(
    (sum, file) => sum + file.reviewedLineCount,
    0
  );
  const totalLineCount = files.reduce(
    (sum, file) => sum + file.totalLineCount,
    0
  );
  return {
    reviewedLineCount,
    totalLineCount,
    progress: totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount,
    files
  };
};

const snapshot = (
  file: PullRequestDiffFileProgress,
  reviewability: PullRequestLineReviewability,
  fileSystemPathSemantics: "posix" | "windows" = "posix"
): PullRequestProgressTreeSnapshot => ({
  snapshotId: `snapshot-${file.fileId}`,
  contextId: "github.com/ssaattww/RevMem#38",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
  fileSystemPathSemantics,
  progress: aggregate([file]),
  lineReviewabilityByFileId: { [file.fileId]: reviewability }
});

const onlyFileNode = (
  provider: PullRequestProgressTreeDataProvider,
  categoryIndex: number
): PullRequestProgressTreeFileNode => {
  const category = provider.getChildren()[categoryIndex];
  assert.ok(category && category.kind === "category");
  const node = provider.getChildren(category)[0];
  assert.ok(node && node.kind === "file");
  return node;
};

class RecordingCodec extends ReviewDiffUriCodec {
  public readonly descriptors: ReviewDiffDocumentDescriptor[] = [];

  public override encode(descriptor: ReviewDiffDocumentDescriptor): string {
    this.descriptors.push({ ...descriptor });
    return super.encode(descriptor);
  }
}

class RecordingDiffHost implements ReviewDiffEditorHost<string> {
  public readonly parsed: string[] = [];
  public readonly opened: Array<{
    readonly original: string;
    readonly modified: string;
    readonly title: string;
  }> = [];

  public parseUri(value: string): string {
    this.parsed.push(value);
    return value;
  }

  public async openDiff(
    original: string,
    modified: string,
    title: string
  ): Promise<void> {
    this.opened.push({ original, modified, title });
  }
}

test("line-review unsupported selections open the file host without opening the text diff", async () => {
  const cases: ReadonlyArray<{
    readonly file: PullRequestDiffFileProgress;
    readonly reason: PullRequestLineReviewUnsupportedReason;
  }> = [
    {
      file: fileProgress("binary", "assets/logo.png", {
        status: "binary",
        additions: 0,
        deletions: 0,
        reviewedLineCount: 0,
        totalLineCount: 0,
        progress: 1,
        excluded: true,
        exclusionReason: { kind: "binary" }
      }),
      reason: { kind: "binary" }
    },
    {
      file: fileProgress("invalid", "data/invalid.txt"),
      reason: { kind: "invalid-encoding", encoding: "UTF-8" }
    },
    {
      file: fileProgress("unsupported", "data/legacy.txt"),
      reason: { kind: "unsupported-encoding", encoding: "Shift_JIS" }
    }
  ];

  for (const item of cases) {
    let openedDiffs = 0;
    const openedFiles: PullRequestProgressTreeDiffTarget[] = [];
    const provider = new PullRequestProgressTreeDataProvider({
      openDiff: async () => { openedDiffs += 1; },
      openFile: async (target: PullRequestProgressTreeDiffTarget) => { openedFiles.push(target); }
    } as unknown as ConstructorParameters<typeof PullRequestProgressTreeDataProvider>[0]);
    provider.replaceSnapshot(snapshot(item.file, {
      kind: "unsupported",
      reason: item.reason
    }));

    const node = onlyFileNode(provider, 4);
    assert.deepEqual(node.reviewability, {
      kind: "unsupported",
      reason: item.reason
    });
    const result: PullRequestProgressTreeSelectionResult = await provider.select(node);

    assert.equal(result.kind, "opened-file");
    assert.equal(openedFiles.length, 1);
    assert.equal(openedFiles[0]?.file.fileId, item.file.fileId);
    assert.equal(openedDiffs, 0);
  }
});

test("effective progress has a dedicated public type with raw source and reviewability evidence", () => {
  const unsupported = fileProgress("invalid", "data/invalid.txt", {
    additions: 4,
    deletions: 2,
    reviewedLineCount: 3,
    totalLineCount: 6,
    progress: 0.5
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined
  });
  provider.replaceSnapshot(snapshot(unsupported, {
    kind: "unsupported",
    reason: { kind: "invalid-encoding", encoding: "UTF-8" }
  }));

  const effective: PullRequestEffectiveProgress = provider.getEffectiveProgress();
  assert.equal(effective.reviewedLineCount, 0);
  assert.equal(effective.totalLineCount, 0);
  assert.equal(effective.progress, 1);
  assert.equal(effective.files.length, 1);
  assert.equal(effective.files[0]!.raw.fileId, "invalid");
  assert.equal(effective.files[0]!.raw.additions, 4);
  assert.equal(effective.files[0]!.raw.deletions, 2);
  assert.deepEqual(effective.files[0]!.reviewability, {
    kind: "unsupported",
    reason: { kind: "invalid-encoding", encoding: "UTF-8" }
  });
  assert.equal(
    effective.files[0]!.effectiveReason,
    "不正な文字エンコーディング: UTF-8"
  );
});

test("empty descriptors stay outside the external git content port and local Git rejects them at runtime", async () => {
  const emptyDescriptor: EmptyReviewDiffDocumentDescriptor = {
    contextId: "github.com/ssaattww/RevMem#38",
    filePath: "src/added.ts",
    fileSystemPathSemantics: "posix",
    side: "original",
    revisionSource: "empty",
    revision: BASE_SHA
  };
  const gitDescriptor: GitCommitReviewDiffDocumentDescriptor = {
    ...emptyDescriptor,
    side: "modified",
    revisionSource: "git-commit",
    revision: HEAD_SHA
  };

  let contentPortCalls = 0;
  const contentSource: RevisionTextContentSource = {
    async readTextContent(descriptor) {
      const exactGitDescriptor: GitCommitReviewDiffDocumentDescriptor = descriptor;
      contentPortCalls += 1;
      return exactGitDescriptor.revision === gitDescriptor.revision
        ? { kind: "found", content: "added\n" }
        : { kind: "missing-revision" };
    }
  };
  const codec = new ReviewDiffUriCodec();
  const provider = new RevisionTextContentProvider(codec, contentSource);

  assert.equal(
    await provider.provideTextDocumentContent(codec.encode(emptyDescriptor)),
    ""
  );
  assert.equal(
    await provider.provideTextDocumentContent(codec.encode(gitDescriptor)),
    "added\n"
  );
  assert.equal(contentPortCalls, 1);

  let resolverCalls = 0;
  const localSource = new LocalGitRevisionTextContentSource(
    {
      resolveRepositoryRoot: async () => {
        resolverCalls += 1;
        return "/workspace/repository";
      }
    },
    {
      readTextFileAtRevision: async () => {
        throw new Error("Local Git adapter must not receive an empty descriptor");
      }
    } as unknown as LocalGitAdapter
  );

  await assert.rejects(
    localSource.readTextContent(
      emptyDescriptor as unknown as GitCommitReviewDiffDocumentDescriptor
    ),
    /git-commit|revision source/i
  );
  assert.equal(resolverCalls, 0);
});

test("effective files remain plain enumerable DTOs through spread and JSON", () => {
  const raw = fileProgress("invalid", "data/invalid.txt", {
    additions: 4,
    deletions: 2,
    reviewedLineCount: 3,
    totalLineCount: 6,
    progress: 0.5
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined
  });
  provider.replaceSnapshot(snapshot(raw, {
    kind: "unsupported",
    reason: { kind: "invalid-encoding", encoding: "UTF-8" }
  }));

  const first = provider.getEffectiveProgress();
  const second = provider.getEffectiveProgress();
  const effectiveFile = first.files[0]!;
  const expected = {
    raw: { ...raw },
    reviewability: {
      kind: "unsupported",
      reason: { kind: "invalid-encoding", encoding: "UTF-8" }
    },
    category: "line-review-unsupported",
    effectiveReason: "不正な文字エンコーディング: UTF-8",
    reviewedLineCount: 0,
    totalLineCount: 0,
    progress: 1
  };

  assert.deepEqual({ ...effectiveFile }, expected);
  assert.deepEqual(JSON.parse(JSON.stringify(effectiveFile)), expected);
  assert.deepEqual(Object.keys(effectiveFile), Object.keys(expected));
  assert.equal(Object.hasOwn(effectiveFile, "fileId"), false);
  assert.equal(Object.hasOwn(effectiveFile, "additions"), false);
  assert.notEqual(first.files[0], second.files[0]);
  assert.notEqual(first.files[0]!.raw, second.files[0]!.raw);
  assert.notEqual(
    first.files[0]!.reviewability,
    second.files[0]!.reviewability
  );
  if (
    first.files[0]!.reviewability.kind === "unsupported" &&
    second.files[0]!.reviewability.kind === "unsupported"
  ) {
    assert.notEqual(
      first.files[0]!.reviewability.reason,
      second.files[0]!.reviewability.reason
    );
  }
});

test("PR progress paths follow canonical POSIX and Windows filesystem semantics", () => {
  const whitespacePath = "   ";
  const file = fileProgress("spaces", whitespacePath, {
    additions: 1,
    deletions: 0,
    totalLineCount: 1,
    progress: 0
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined
  });

  assert.doesNotThrow(() => provider.replaceSnapshot(snapshot(
    file,
    { kind: "reviewable" },
    "posix"
  )));
  assert.equal(onlyFileNode(provider, 0).path, whitespacePath);

  assert.throws(
    () => provider.replaceSnapshot(snapshot(
      file,
      { kind: "reviewable" },
      "windows"
    )),
    /path|space|canonical/i
  );
});

test("unknown diff-side kinds are rejected before URI or host calls", async () => {
  const validSide: ReviewDiffEditorSideInput = {
    kind: "present",
    filePath: "src/file.ts",
    revision: BASE_SHA
  };
  const invalidSide = {
    kind: "future",
    filePath: "src/file.ts",
    revision: HEAD_SHA
  } as unknown as ReviewDiffEditorSideInput;

  for (const input of [
    { original: invalidSide, modified: validSide },
    { original: validSide, modified: invalidSide }
  ]) {
    const codec = new RecordingCodec();
    const host = new RecordingDiffHost();
    const controller = new ReviewDiffEditorController(codec, host);

    await assert.rejects(
      controller.openReviewDiff({
        contextId: "github.com/ssaattww/RevMem#38",
        fileSystemPathSemantics: "posix",
        original: input.original,
        modified: input.modified,
        title: "src/file.ts"
      }),
      /kind|side/i
    );
    assert.equal(codec.descriptors.length, 0);
    assert.equal(host.parsed.length, 0);
    assert.equal(host.opened.length, 0);
  }
});
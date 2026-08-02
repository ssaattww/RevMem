import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type EmptyReviewDiffDocumentDescriptor,
  type GitCommitReviewDiffDocumentDescriptor,
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
  PullRequestProgressTreeDataProvider,
  type PullRequestEffectiveProgress,
  type PullRequestLineReviewUnsupportedReason,
  type PullRequestLineReviewability,
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
  reviewability: PullRequestLineReviewability
): PullRequestProgressTreeSnapshot => ({
  snapshotId: `snapshot-${file.fileId}`,
  contextId: "github.com/ssaattww/RevMem#38",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
  fileSystemPathSemantics: "posix",
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

test("line-review unsupported selections return a typed unavailable result without opening text diff", async () => {
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
    let opened = 0;
    const provider = new PullRequestProgressTreeDataProvider({
      openDiff: async () => {
        opened += 1;
      }
    });
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

    assert.deepEqual(result, {
      kind: "line-review-unavailable",
      file: item.file,
      reason: item.reason
    });
    assert.equal(opened, 0);
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

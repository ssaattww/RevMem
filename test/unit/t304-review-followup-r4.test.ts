import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  type ReviewDiffDocumentDescriptor
} from "../../src/application/diff-document/index";
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
  type PullRequestLineReviewability,
  type PullRequestProgressTreeSnapshot
} from "../../src/ui/pr-progress/index";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

const progressFile = (
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
  files: readonly PullRequestDiffFileProgress[],
  lineReviewabilityByFileId: Readonly<Record<string, PullRequestLineReviewability>>,
  fileSystemPathSemantics: "posix" | "windows" = "posix"
): PullRequestProgressTreeSnapshot => ({
  snapshotId: "snapshot-r4",
  contextId: "github.com/ssaattww/RevMem#38",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
  fileSystemPathSemantics,
  progress: aggregate(files),
  lineReviewabilityByFileId
});

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

test("effective files are plain enumerable DTOs and detached through spread and JSON", () => {
  const raw = progressFile("invalid", "data/invalid.txt", {
    additions: 4,
    deletions: 2,
    reviewedLineCount: 3,
    totalLineCount: 6,
    progress: 0.5
  });
  const reviewability = {
    kind: "unsupported",
    reason: { kind: "invalid-encoding", encoding: "UTF-8" }
  } satisfies PullRequestLineReviewability;
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined
  });
  provider.replaceSnapshot(snapshot([raw], { invalid: reviewability }));

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
  const file = progressFile("spaces", whitespacePath, {
    additions: 1,
    deletions: 0,
    totalLineCount: 1,
    progress: 0
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined
  });

  assert.doesNotThrow(() => provider.replaceSnapshot(snapshot(
    [file],
    { spaces: { kind: "reviewable" } },
    "posix"
  )));
  const category = provider.getChildren()[0]!;
  assert.equal(category.kind, "category");
  const node = provider.getChildren(category)[0]!;
  assert.equal(node.kind, "file");
  assert.equal(node.path, whitespacePath);

  assert.throws(
    () => provider.replaceSnapshot(snapshot(
      [file],
      { spaces: { kind: "reviewable" } },
      "windows"
    )),
    /path|space|canonical/i
  );
});

test("unknown diff-side kinds are rejected before any URI or host call", async () => {
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

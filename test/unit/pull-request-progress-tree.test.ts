import { createGitHubViewedSelectionReader } from "../../src/composition/review-contexts/github-viewed-selection-reader";
import { GitHubViewedDisplayController, publishGitHubViewedSelection } from "../../src/composition/pull-request/github-viewed-display-controller";
import { VsCodeGitHubAuthenticationProvider } from "../../src/adapters/github/vscode-github-authentication-provider";
import type { ReviewStateCommit } from "../../src/adapters/state-repository/index";
import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentReadResult,
  type RevisionTextContentSource
} from "../../src/application/diff-document/index";
import type { PullRequestDiffFileProgress, PullRequestDiffProgress } from "../../src/core/pr-progress/index";
import { ReviewDiffEditorController } from "../../src/ui/diff-editor/index";
import {
  PullRequestProgressTreeDataProvider,
  type PullRequestLineReviewability,
  type PullRequestProgressTreeCategoryNode,
  type PullRequestProgressTreeDiffTarget,
  type PullRequestProgressTreeFileNode,
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

const progress = (files: readonly PullRequestDiffFileProgress[]): PullRequestDiffProgress => {
  const included = files.filter((file) => !file.excluded);
  const reviewedLineCount = included.reduce((sum, file) => sum + file.reviewedLineCount, 0);
  const totalLineCount = included.reduce((sum, file) => sum + file.totalLineCount, 0);
  return {
    reviewedLineCount,
    totalLineCount,
    progress: totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount,
    files
  };
};

const defaultReviewability = (
  files: readonly PullRequestDiffFileProgress[]
): Readonly<Record<string, PullRequestLineReviewability>> =>
  Object.fromEntries(files.map((file) => [
    file.fileId,
    file.status === "binary"
      ? { kind: "unsupported", reason: { kind: "binary" } }
      : { kind: "reviewable" }
  ]));

const snapshot = (
  files: readonly PullRequestDiffFileProgress[],
  options: Partial<Omit<PullRequestProgressTreeSnapshot, "progress">> = {}
): PullRequestProgressTreeSnapshot => {
  const baseSha = options.baseSha ?? BASE_SHA;
  const headSha = options.headSha ?? HEAD_SHA;
  return {
    snapshotId: "snapshot-1",
    contextId: "github.com/ssaattww/RevMem#38",
    baseSha,
    headSha,
    originalDiffId: `${baseSha}..${headSha}`,
    fileSystemPathSemantics: "posix",
    lineReviewabilityByFileId: defaultReviewability(files),
    ...options,
    progress: progress(files)
  };
};

const categories = (
  provider: PullRequestProgressTreeDataProvider
): readonly PullRequestProgressTreeCategoryNode[] =>
  provider.getChildren().map((node) => {
    assert.equal(node.kind, "category");
    return node as PullRequestProgressTreeCategoryNode;
  });

const files = (
  provider: PullRequestProgressTreeDataProvider,
  category: PullRequestProgressTreeCategoryNode
): readonly PullRequestProgressTreeFileNode[] =>
  provider.getChildren(category).map((node) => {
    assert.equal(node.kind, "file");
    return node as PullRequestProgressTreeFileNode;
  });

class RecordingContentSource implements RevisionTextContentSource {
  public readonly requests: ReviewDiffDocumentDescriptor[] = [];

  public async readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult> {
    this.requests.push({ ...descriptor });
    if (descriptor.filePath === "src/added.ts" && descriptor.side === "modified") {
      return { kind: "found", content: "added\n" };
    }
    if (descriptor.filePath === "src/deleted.ts" && descriptor.side === "original") {
      return { kind: "found", content: "deleted\n" };
    }
    throw new Error(`Unexpected non-empty content request: ${descriptor.side} ${descriptor.filePath}`);
  }
}

test("classifies every PR progress file and retains counts and reasons", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const changedFiles = [
    progressFile("pending", "src/pending.ts", { reviewedLineCount: 1, totalLineCount: 3, progress: 1 / 3 }),
    progressFile("done", "src/done.ts", { reviewedLineCount: 3, totalLineCount: 3, progress: 1 }),
    progressFile("excluded", "generated/a.ts", {
      reviewedLineCount: 0,
      totalLineCount: 0,
      progress: 1,
      excluded: true,
      exclusionReason: { kind: "user-glob", pattern: "generated/**" }
    }),
    progressFile("rename", "src/new-name.ts", {
      oldPath: "src/old-name.ts",
      newPath: "src/new-name.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      totalLineCount: 0,
      progress: 1
    }),
    progressFile("binary", "assets/logo.png", {
      status: "binary",
      additions: 0,
      deletions: 0,
      reviewedLineCount: 0,
      totalLineCount: 0,
      progress: 1,
      excluded: true,
      exclusionReason: { kind: "binary" }
    })
  ] as const;

  provider.replaceSnapshot(snapshot(changedFiles));

  const roots = categories(provider);
  assert.deepEqual(
    roots.map(({ category, label, fileCount }) => ({ category, label, fileCount })),
    [
      { category: "unreviewed", label: "未確認変更が残るファイル", fileCount: 1 },
      { category: "completed", label: "確認完了したファイル", fileCount: 1 },
      { category: "excluded", label: "除外されたファイル", fileCount: 1 },
      { category: "non-line-change", label: "行以外の変更", fileCount: 1 },
      { category: "line-review-unsupported", label: "行単位レビュー対象外", fileCount: 1 }
    ]
  );

  const pending = files(provider, roots[0]!)[0]!;
  assert.deepEqual(
    {
      path: pending.path,
      reviewed: pending.reviewedLineCount,
      total: pending.totalLineCount,
      progress: pending.progress,
      additions: pending.additions,
      deletions: pending.deletions,
      remaining: pending.unreviewedLineCount
    },
    {
      path: "src/pending.ts",
      reviewed: 1,
      total: 3,
      progress: 1 / 3,
      additions: 2,
      deletions: 1,
      remaining: 2
    }
  );

  assert.equal(files(provider, roots[2]!)[0]!.reason, "ユーザー除外: generated/**");
  assert.equal(files(provider, roots[4]!)[0]!.reason, "バイナリファイル");
});

test("projects nonzero encoding-unsupported changes out of the effective PR denominator", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const invalidUtf8 = progressFile("invalid", "data/invalid.txt", {
    additions: 2,
    deletions: 1,
    reviewedLineCount: 1,
    totalLineCount: 3,
    progress: 1 / 3
  });
  const reviewable = progressFile("reviewable", "src/reviewable.ts", {
    additions: 1,
    deletions: 1,
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5
  });

  provider.replaceSnapshot(snapshot([invalidUtf8, reviewable], {
    lineReviewabilityByFileId: {
      invalid: {
        kind: "unsupported",
        reason: { kind: "invalid-encoding", encoding: "UTF-8" }
      },
      reviewable: { kind: "reviewable" }
    }
  }));

  const unsupportedNode = files(provider, categories(provider)[4]!)[0]!;
  assert.deepEqual(
    {
      path: unsupportedNode.path,
      reason: unsupportedNode.reason,
      additions: unsupportedNode.additions,
      deletions: unsupportedNode.deletions,
      reviewed: unsupportedNode.reviewedLineCount,
      total: unsupportedNode.totalLineCount,
      progress: unsupportedNode.progress
    },
    {
      path: "data/invalid.txt",
      reason: "不正な文字エンコーディング: UTF-8",
      additions: 2,
      deletions: 1,
      reviewed: 0,
      total: 0,
      progress: 1
    }
  );
  assert.deepEqual(provider.getEffectiveProgress(), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
    files: [
      {
        raw: invalidUtf8,
        reviewability: {
          kind: "unsupported",
          reason: { kind: "invalid-encoding", encoding: "UTF-8" }
        },
        category: "line-review-unsupported",
        effectiveReason: "不正な文字エンコーディング: UTF-8",
        reviewedLineCount: 0,
        totalLineCount: 0,
        progress: 1
      },
      {
        raw: reviewable,
        reviewability: { kind: "reviewable" },
        category: "unreviewed",
        reviewedLineCount: 1,
        totalLineCount: 2,
        progress: 0.5
      }
    ]
  });
});

test("sorts files by remaining line count descending and path ascending", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const changedFiles = [
    progressFile("b", "src/b.ts", { reviewedLineCount: 1, totalLineCount: 5, progress: 0.2 }),
    progressFile("a", "src/a.ts", { reviewedLineCount: 0, totalLineCount: 4, progress: 0 }),
    progressFile("z", "src/z.ts", { reviewedLineCount: 1, totalLineCount: 6, progress: 1 / 6 })
  ];

  provider.replaceSnapshot(snapshot(changedFiles));

  const unreviewed = categories(provider)[0]!;
  assert.deepEqual(
    files(provider, unreviewed).map(({ path, unreviewedLineCount }) => ({ path, unreviewedLineCount })),
    [
      { path: "src/z.ts", unreviewedLineCount: 5 },
      { path: "src/a.ts", unreviewedLineCount: 4 },
      { path: "src/b.ts", unreviewedLineCount: 4 }
    ]
  );
});

test("selection carries immutable context and revision identity", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const renamed = progressFile("rename", "src/new.ts", {
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    status: "renamed"
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => {
      opened.push(target);
    },
    openFile: async () => undefined
  });
  provider.replaceSnapshot(snapshot([renamed], {
    snapshotId: "snapshot-renamed",
    contextId: "github.com/ssaattww/RevMem#38",
    fileSystemPathSemantics: "windows"
  }));

  const node = files(provider, categories(provider)[0]!)[0]!;
  await provider.select(node);

  assert.deepEqual(opened, [{
    snapshotId: "snapshot-renamed",
    contextId: "github.com/ssaattww/RevMem#38",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
    fileSystemPathSemantics: "windows",
    file: renamed,
    original: { kind: "present", filePath: "src/old.ts", revision: BASE_SHA },
    modified: { kind: "present", filePath: "src/new.ts", revision: HEAD_SHA }
  }]);
});

test("current tree nodes and detached host targets cannot mutate selection identity", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const mutationErrors: unknown[] = [];
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => {
      opened.push(target);
      assert.throws(() => {
        (target as unknown as Record<string, unknown>).contextId = "context-tampered";
      }, TypeError);
      mutationErrors.push("host target mutation rejected");
    },
    openFile: async () => undefined
  });
  const renamed = progressFile("rename", "src/new.ts", {
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    status: "renamed"
  });
  provider.replaceSnapshot(snapshot([renamed], {
    snapshotId: "snapshot-immutable",
    contextId: "context-original"
  }));

  const node = files(provider, categories(provider)[0]!)[0]!;
  const rejectMutation = (target: object, key: string, value: unknown): void => {
    assert.throws(() => {
      (target as Record<string, unknown>)[key] = value;
    }, TypeError);
  };
  for (const [target, key, value] of [
    [node, "category", "completed"],
    [node, "path", "src/tampered.ts"],
    [node.reviewability, "kind", "unsupported"],
    [node.source, "fileId", "tampered-file"],
    [node.source, "path", "src/tampered.ts"],
    [node.source, "oldPath", "src/tampered-old.ts"],
    [node.source, "newPath", "src/tampered-new.ts"],
    [node.source, "status", "added"],
    [node.source, "excluded", true],
    [node.openTarget, "snapshotId", "snapshot-tampered"],
    [node.openTarget, "contextId", "context-tampered"],
    [node.openTarget, "baseSha", "c".repeat(40)],
    [node.openTarget, "headSha", "d".repeat(40)],
    [node.openTarget, "originalDiffId", `${"c".repeat(40)}..${"d".repeat(40)}`],
    [node.openTarget, "fileSystemPathSemantics", "windows"],
    [node.openTarget.file, "fileId", "target-tampered-file"],
    [node.openTarget.file, "path", "src/target-tampered.ts"],
    [node.openTarget.file, "oldPath", "src/target-tampered-old.ts"],
    [node.openTarget.file, "newPath", "src/target-tampered-new.ts"],
    [node.openTarget.file, "status", "added"],
    [node.openTarget.file, "excluded", true],
    [node.openTarget.original, "kind", "absent"],
    [node.openTarget.original, "filePath", "src/tampered-old.ts"],
    [node.openTarget.original, "revision", "c".repeat(40)],
    [node.openTarget.modified, "kind", "absent"],
    [node.openTarget.modified, "filePath", "src/tampered-new.ts"],
    [node.openTarget.modified, "revision", "d".repeat(40)]
  ] as const) {
    rejectMutation(target, key, value);
  }

  const first = await provider.select(node);
  const second = await provider.select(node);

  assert.equal(mutationErrors.length, 2);
  assert.notEqual(opened[0], node.openTarget);
  assert.notEqual(opened[0], opened[1]);
  assert.deepEqual(opened, [
    {
      snapshotId: "snapshot-immutable",
      contextId: "context-original",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
      fileSystemPathSemantics: "posix",
      file: renamed,
      original: { kind: "present", filePath: "src/old.ts", revision: BASE_SHA },
      modified: { kind: "present", filePath: "src/new.ts", revision: HEAD_SHA }
    },
    {
      snapshotId: "snapshot-immutable",
      contextId: "context-original",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      originalDiffId: `${BASE_SHA}..${HEAD_SHA}`,
      fileSystemPathSemantics: "posix",
      file: renamed,
      original: { kind: "present", filePath: "src/old.ts", revision: BASE_SHA },
      modified: { kind: "present", filePath: "src/new.ts", revision: HEAD_SHA }
    }
  ]);
  assert.deepEqual(first, { kind: "opened-diff", target: opened[0] });
  assert.deepEqual(second, { kind: "opened-diff", target: opened[1] });
});

test("added and deleted selections open immutable empty missing sides through T303 and T302", async () => {
  const codec = new ReviewDiffUriCodec();
  const source = new RecordingContentSource();
  const contentProvider = new RevisionTextContentProvider(codec, source);
  const openedContents: Array<readonly [string, string]> = [];
  const editorController = new ReviewDiffEditorController(codec, {
    parseUri: (value) => value,
    openDiff: async (original, modified) => {
      openedContents.push([
        await contentProvider.provideTextDocumentContent(original),
        await contentProvider.provideTextDocumentContent(modified)
      ]);
    }
  });
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => editorController.openReviewDiff({
      contextId: target.contextId,
      fileSystemPathSemantics: target.fileSystemPathSemantics,
      original: target.original,
      modified: target.modified,
      title: target.file.path
    }),
    openFile: async () => undefined
  });
  const added = progressFile("added", "src/added.ts", {
    oldPath: undefined,
    newPath: "src/added.ts",
    status: "added"
  });
  const deleted = progressFile("deleted", "src/deleted.ts", {
    oldPath: "src/deleted.ts",
    newPath: undefined,
    status: "deleted"
  });
  provider.replaceSnapshot(snapshot([added, deleted]));

  const unreviewed = files(provider, categories(provider)[0]!);
  for (const node of unreviewed) await provider.select(node);

  assert.deepEqual(
    unreviewed.map(({ openTarget }) => ({
      fileId: openTarget.file.fileId,
      original: openTarget.original,
      modified: openTarget.modified
    })),
    [
      {
        fileId: "added",
        original: { kind: "absent", filePath: "src/added.ts", revision: BASE_SHA },
        modified: { kind: "present", filePath: "src/added.ts", revision: HEAD_SHA }
      },
      {
        fileId: "deleted",
        original: { kind: "present", filePath: "src/deleted.ts", revision: BASE_SHA },
        modified: { kind: "absent", filePath: "src/deleted.ts", revision: HEAD_SHA }
      }
    ]
  );
  assert.deepEqual(openedContents, [["", "added\n"], ["deleted\n", ""]]);
  assert.deepEqual(
    source.requests.map(({ revisionSource, side, filePath }) => ({ revisionSource, side, filePath })),
    [
      { revisionSource: "git-commit", side: "modified", filePath: "src/added.ts" },
      { revisionSource: "git-commit", side: "original", filePath: "src/deleted.ts" }
    ]
  );
});

test("rejects stale nodes after revision or context refresh", async () => {
  const opened: PullRequestProgressTreeDiffTarget[] = [];
  const source = progressFile("same", "src/same.ts");
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async (target) => {
      opened.push(target);
    },
    openFile: async () => undefined
  });

  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-head-1",
    contextId: "context-a"
  }));
  const staleByRevision = files(provider, categories(provider)[0]!)[0]!;

  const nextHead = "c".repeat(40);
  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-head-2",
    contextId: "context-a",
    headSha: nextHead,
    originalDiffId: `${BASE_SHA}..${nextHead}`
  }));
  await assert.rejects(provider.select(staleByRevision), /stale|current snapshot/i);

  const staleByContext = files(provider, categories(provider)[0]!)[0]!;
  provider.replaceSnapshot(snapshot([source], {
    snapshotId: "snapshot-context-b",
    contextId: "context-b",
    headSha: nextHead,
    originalDiffId: `${BASE_SHA}..${nextHead}`
  }));
  await assert.rejects(provider.select(staleByContext), /stale|current snapshot/i);
  assert.equal(opened.length, 0);
});

test("rejects missing or inconsistent line-review availability", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const source = progressFile("a", "src/a.ts");

  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], { lineReviewabilityByFileId: {} })),
    /line reviewability|missing/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], {
      lineReviewabilityByFileId: {
        a: {
          kind: "unsupported",
          reason: { kind: "unsupported-encoding", encoding: "" }
        }
      }
    })),
    /encoding|reason/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([source], {
      lineReviewabilityByFileId: {
        a: { kind: "reviewable" },
        foreign: { kind: "reviewable" }
      }
    })),
    /unknown|foreign/i
  );
});

test("rejects inconsistent snapshot and progress records before rendering", () => {
  const provider = new PullRequestProgressTreeDataProvider({ openDiff: async () => undefined, openFile: async () => undefined });
  const invalid = progressFile("invalid", "src/invalid.ts", {
    reviewedLineCount: 4,
    totalLineCount: 3,
    progress: 4 / 3
  });

  assert.throws(
    () => provider.replaceSnapshot(snapshot([invalid])),
    /reviewedLineCount|progress/i
  );
  assert.throws(
    () => provider.replaceSnapshot(snapshot([progressFile("a", "src/a.ts")], {
      originalDiffId: "other"
    })),
    /originalDiffId|snapshot/i
  );
});

test("keeps GitHub Viewed separate and hides candidates when the captured selection is stale", () => {
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined,
    openFile: async () => undefined
  });
  const completed = progressFile("done", "src/done.ts", {
    reviewedLineCount: 3,
    totalLineCount: 3,
    progress: 1
  });
  provider.replaceSnapshot(snapshot([completed]));
  const completedCategory = categories(provider).find(({ category }) => category === "completed")!;
  const node = files(provider, completedCategory)[0]!;

  assert.equal(provider.getGitHubViewedState(node), undefined);
  assert.equal(provider.replaceGitHubViewedCandidates([{
    fileId: "done",
    path: "src/done.ts",
    localCategory: "completed",
    viewedState: "UNVIEWED", synchronizationEligible: false
  }], () => true), true);
  assert.equal(provider.getGitHubViewedState(node), "UNVIEWED");
  assert.equal(provider.getEffectiveProgress().files[0]?.category, "completed");
  assert.equal(provider.getEffectiveProgress().files[0]?.reviewedLineCount, 3);

  assert.equal(provider.getGitHubViewedState(node), "UNVIEWED");
  assert.equal(provider.replaceGitHubViewedCandidates([{
    fileId: "done",
    path: "src/done.ts",
    localCategory: "completed",
    viewedState: "VIEWED", synchronizationEligible: false
  }], () => false), false);
  assert.equal(provider.getGitHubViewedState(node), "UNVIEWED");
  provider.replaceSnapshot(snapshot([completed]));
  assert.equal(provider.getGitHubViewedState(node), undefined);

  provider.clear();
  assert.equal(provider.getGitHubViewedState(node), undefined);
});

test("current Viewed failure is labeled unavailable without altering local progress", () => {
  const provider = new PullRequestProgressTreeDataProvider({
    openDiff: async () => undefined, openFile: async () => undefined
  });
  provider.replaceSnapshot(snapshot([progressFile("file", "src/file.ts", {
    reviewedLineCount: 3, totalLineCount: 3, progress: 1
  })]));
  const node = files(provider, categories(provider).find(({ category }) => category === "completed")!)[0]!;
  let current = true;
  assert.equal(provider.showGitHubViewedUnavailable(() => current), true);
  assert.equal(provider.getGitHubViewedState(node), "unavailable");
  assert.equal(provider.getEffectiveProgress().files[0]?.reviewedLineCount, 3);
  current = false;
  assert.equal(provider.getGitHubViewedState(node), undefined);
  assert.equal(provider.showGitHubViewedUnavailable(() => false), false);
});

for (const scenario of ["available", "session-denied", "http-denied", "graphql-error", "transport-error"] as const) {
  test(`Viewed authenticates and publishes through the PR progress tree (${scenario})`, async () => {
    const immutable = Object.freeze({ kind: "pull-request", pullRequest: Object.freeze({
      host: "github.com", owner: "fixture", repository: "reviewed", number: 38,
      state: "open", baseSha: BASE_SHA, headSha: HEAD_SHA
    }), files: Object.freeze({ local: "complete" }) });
    const beforeState = structuredClone(immutable);
    const history = Object.freeze(["local review saved"]);
    const store = {
      load: async () => ({ contextState: immutable }) as unknown as ReviewStateCommit,
      commit: () => assert.fail("read-only GitHub status cannot commit local state"),
      recordHistory: () => assert.fail("read-only GitHub status cannot append history"),
    };
    const provider = new PullRequestProgressTreeDataProvider({
      openDiff: async () => undefined, openFile: async () => undefined
    });
    const active = snapshot([progressFile("file", "src/file.ts", {
      reviewedLineCount: 3, totalLineCount: 3, progress: 1
    })]);
    provider.replaceSnapshot(active);
    const node = files(provider, categories(provider).find(({ category }) => category === "completed")!)[0]!;
    const beforeProgress = structuredClone(provider.getEffectiveProgress());
    const controller = new GitHubViewedDisplayController(() => provider.clearGitHubViewedCandidates());
    const auth = new VsCodeGitHubAuthenticationProvider({
      onDidChangeSessions: () => ({ dispose: () => undefined }),
      getSession: async (_provider, _scopes, options) => {
        assert.equal(options.silent, true);
        return scenario === "session-denied" ? undefined : {
          id: "mock-session", accessToken: "fixture-only-token", account: {id: "mock-account", label: "mock"}, scopes: ["repo"]
        };
      }
    });
    const requests: string[] = [];
    const checkedQueries: string[] = [];
    const read = createGitHubViewedSelectionReader({
      load: store.load, auth,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.host, "api.github.com");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-only-token");
        requests.push(url.pathname);
        if (url.pathname !== "/graphql") {
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(url.pathname, "/repos/fixture/reviewed/compare/" + "c".repeat(40) + "..." + HEAD_SHA);
          return Response.json({ merge_base_commit: { sha: BASE_SHA } });
        }
        const body = JSON.parse(String(init?.body)) as { query: string };
        assert.match(body.query.trim(), /^query\s/u);
        assert.doesNotMatch(body.query, /\bmutation\b/u);
        checkedQueries.push(url.pathname);
        if (scenario === "http-denied") return new Response(undefined,{status:403});
        if (scenario === "graphql-error" && /viewerViewedState/u.test(body.query)) {
          return Response.json({ errors: [{ message: "fixture response rejected" }] });
        }
        if (scenario === "transport-error" && /viewerViewedState/u.test(body.query)) throw new Error("mock network disconnected");
        const pullRequest = {
          id: "PR_mock", number: 38, state: "OPEN", baseRefOid: "c".repeat(40), headRefOid: HEAD_SHA,
          files: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ path: "src/file.ts", changeType: "MODIFIED", additions: 2, deletions: 1, viewerViewedState: "UNVIEWED" }] },
        };
        return Response.json({ data: { viewer: { id: "U_mock", login: "fixture-user" },
          repository: { nameWithOwner: "fixture/reviewed", pullRequest } } });
      },
    });
    try {
      const generation = controller.invalidate();
      await controller.read({
        epoch: generation, enabled: true, isSourceCurrent: () => true,
        run: ({ isCurrent, signal }) => read({ isCurrent, signal, generation, repositoryId: "github.com/fixture/reviewed",
          contextId: active.contextId, number: 38, headSha: active.headSha, baseSha: active.baseSha,
          originalDiffId: active.originalDiffId, configured: [{
            host: "github.com", owner: "fixture", repository: "reviewed", viewerId: "U_mock", login: "fixture-user"
          }] }),
        publish: (result, current) => {
          publishGitHubViewedSelection({ result, current, progress: provider, contextId: active.contextId, number: 38,
            headSha: active.headSha, baseSha: active.baseSha, originalDiffId: active.originalDiffId,
            generation, fileCount: 1 });
        }
      });
      assert.equal(provider.getGitHubViewedState(node), scenario === "available" ? "UNVIEWED" : "unavailable");
      assert.deepEqual(provider.getEffectiveProgress(), beforeProgress);
      assert.deepEqual(immutable, beforeState);
      assert.deepEqual(history, ["local review saved"]);
      const expectedCalls = scenario === "session-denied" ? 0 : scenario === "http-denied" ? 1 : scenario === "available" ? 3 : 2;
      assert.equal(requests.length, expectedCalls);
      assert.equal(checkedQueries.length, requests.filter((url) => url === "/graphql").length);
    } finally {
      auth.dispose();
    }
  });
}

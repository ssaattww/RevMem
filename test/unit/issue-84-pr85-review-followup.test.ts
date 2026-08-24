import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index.js";
import * as operationFeedbackModule from "../../src/application/operation-feedback/index.js";
import type { OperationLogEntry } from "../../src/application/operation-feedback/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
import { refreshCurrentContextDependents } from "../../src/t305-projection-refresh.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/t405-pull-request-review-runtime.js";

const runtimeRequire = createRequire(__filename);
const loadWithVscode = <T>(moduleName: string, vscode: object): T => {
  const loader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = (request, parent, isMain) => request === "vscode"
    ? vscode
    : Reflect.apply(originalLoad, Module, [request, parent, isMain]) as unknown;
  try {
    const modulePath = runtimeRequire.resolve(moduleName);
    delete runtimeRequire.cache[modulePath];
    return runtimeRequire(modulePath) as T;
  } finally {
    loader._load = originalLoad;
  }
};

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

const A = "a".repeat(40);
const B = "b".repeat(40);
const REPOSITORY_ID = "github.com/example/pr85-followup";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#85`;
const FILE_ID = "src/example.ts";
const DIFF_ID = `${A}..${B}`;

const contextState = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #85",
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "pr85-followup",
    number: 85,
    state: "open",
    baseSha: A,
    headSha: B,
  },
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: FILE_ID,
      previousPaths: [],
      revisionId: B,
      modifiedReviewed: [],
      originalReviewedByDiff: {},
      lineCount: 1,
      contentHash: "content-hash",
      updatedAt: "2026-08-24T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: B,
  files: {},
  updatedAt: "2026-08-24T00:00:00.000Z",
});

const diff: PullRequestDiffSnapshot = {
  contextId: CONTEXT_ID,
  baseSha: A,
  headSha: B,
  originalDiffId: DIFF_ID,
  files: [{
    fileId: FILE_ID,
    oldPath: FILE_ID,
    newPath: FILE_ID,
    status: "modified",
    additions: 1,
    deletions: 1,
    hunks: [{
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 1, text: "old" },
        { kind: "addition", newLine: 1, text: "new" },
      ],
    }],
  }],
};

class MemoryRepository implements PullRequestReviewRuntimeRepository {
  private current: ReviewStateCommit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(),
    globalState: globalState(),
  };

  public async load(_target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit> {
    void _target;
    return structuredClone(this.current);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    this.current = structuredClone(transaction.next) as ReviewStateCommit;
  }
}

const vscodeStub = {
  EventEmitter: class {
    public readonly event = () => undefined;
    public fire(): void {}
    public dispose(): void {}
  },
  TreeItem: class {
    public id: string | undefined;
    public description: string | undefined;
    public tooltip: string | undefined;
    public contextValue: string | undefined;
    public iconPath: unknown;
    public constructor(
      public readonly label: string,
      public readonly collapsibleState: number,
    ) {}
  },
  ThemeIcon: class {
    public constructor(public readonly id: string) {}
  },
  TreeItemCollapsibleState: { None: 0 },
};

test("PR85-NR-001 skips PR Progress when Review Contexts registration fails", async () => {
  let progressCalls = 0;
  let progressErrorCalls = 0;
  let decorationCalls = 0;
  let globalCalls = 0;
  const expected = new Error("review contexts failed");

  await assert.rejects(
    refreshCurrentContextDependents({
      refreshReviewContexts: async () => { throw expected; },
      refreshPullRequestProgress: async () => { progressCalls += 1; },
      refreshDecorations: async () => { decorationCalls += 1; },
      refreshGlobal: async () => { globalCalls += 1; },
      reportPullRequestProgressError: async () => { progressErrorCalls += 1; },
    }),
    expected,
  );

  assert.equal(progressCalls, 0, "failed PR runtime registration must block PR Progress bootstrap");
  assert.equal(progressErrorCalls, 0, "a skipped PR Progress refresh must not synthesize a second error");
  assert.equal(decorationCalls, 1, "decoration failure isolation remains independent");
  assert.equal(globalCalls, 1, "Global failure isolation remains independent");
});

test("PR85-NR-002 exposes Review Contexts stage progress before acquisition completes", async () => {
  const runtime = loadWithVscode<typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js")>(
    "../../src/ui/review-contexts/vscode-review-contexts-runtime.js",
    vscodeStub,
  );
  const entered = deferred<void>();
  const release = deferred<void>();
  const logs: OperationLogEntry[] = [];
  const feedback = new operationFeedbackModule.OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => { logs.push(entry); },
    revealLog: () => undefined,
  });
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async () => {
      entered.resolve();
      await release.promise;
      return [];
    },
  });

  operationFeedbackModule.setActiveOperationFeedback(feedback);
  try {
    const refresh = operationFeedbackModule.runWithActiveOperationFeedback(
      "Review Contextsを更新",
      (feedbackContext) => provider.refresh(feedbackContext),
    );
    await entered.promise;

    const beforeCompletion = logs.filter((entry) => entry.event === "progress");
    assert.ok(
      beforeCompletion.some((entry) => entry.progress?.stage === "repositories" && entry.progress.completed === 0),
      "repository acquisition stage must be observable while source.load is still pending",
    );
    assert.ok(
      beforeCompletion.some((entry) => entry.progress?.stage === "pull-request-contexts" && entry.progress.completed === 0),
      "PR-context acquisition stage must be observable while source.load is still pending",
    );

    release.resolve();
    await refresh;
  } finally {
    operationFeedbackModule.setActiveOperationFeedback(undefined);
    provider.dispose();
  }
});

test("PR85-NR-003 keeps PR-file progress owned by the PR Progress operation", async () => {
  const repository = new MemoryRepository();
  const readEntered = deferred<void>();
  const releaseRead = deferred<void>();
  let firstRead = true;
  const logs: OperationLogEntry[] = [];
  const feedback = new operationFeedbackModule.OperationFeedback({
    showBusy: () => undefined,
    clearBusy: () => undefined,
    appendLog: (entry) => { logs.push(entry); },
    revealLog: () => undefined,
  });
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repository",
    fileSystemPathSemantics: "posix",
    snapshot: diff,
    readTextContent: async (descriptor) => {
      if (firstRead) {
        firstRead = false;
        readEntered.resolve();
        await releaseRead.promise;
      }
      return {
        kind: "found",
        content: descriptor.revision === A ? "old\n" : "new\n",
      };
    },
  });

  operationFeedbackModule.setActiveOperationFeedback(feedback);
  try {
    const prRefresh = runtime.activateProgress(CONTEXT_ID);
    await readEntered.promise;

    const releaseGlobal = deferred<void>();
    const globalStarted = deferred<void>();
    const globalOperation = operationFeedbackModule.runWithActiveOperationFeedback(
      "Global理解率を再計算",
      async () => {
        globalStarted.resolve();
        await releaseGlobal.promise;
      },
    );
    await globalStarted.promise;

    releaseRead.resolve();
    await prRefresh;
    releaseGlobal.resolve();
    await globalOperation;

    const prFileProgress = logs.filter((entry) => entry.progress?.stage === "pull-request-files");
    assert.ok(prFileProgress.length > 0, "PR progress refresh must emit file-count progress");
    assert.equal(
      prFileProgress.some((entry) => entry.label === "Global理解率を再計算"),
      false,
      "overlapping Global work must never own PR-file progress",
    );
    assert.equal(
      prFileProgress.every((entry) => entry.label === "PR進捗を計算"),
      true,
      "all PR-file counts must remain bound to the PR Progress lifecycle",
    );
  } finally {
    operationFeedbackModule.setActiveOperationFeedback(undefined);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";

import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike,
} from "../../src/adapters/state-repository/index.js";
import * as operationFeedbackModule from "../../src/application/operation-feedback/index.js";
import type {
  OperationFeedbackContext,
  OperationLogEntry,
} from "../../src/application/operation-feedback/index.js";
import type { ReviewContextListItem } from "../../src/application/review-contexts/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";
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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const A = "a".repeat(40);
const B = "b".repeat(40);
const DIFF_ID = `${A}..${B}`;
const REPOSITORY_ID = "github.com/example/issue-84";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#25`;
const FILE_ID = "src/example.ts";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

const pullRequestContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #25",
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "issue-84",
    number: 25,
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
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 1,
      contentHash: "content-hash",
      updatedAt: "2026-08-24T00:00:00.000Z",
    },
  },
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
});

const pullRequestGlobal = (): RepositoryGlobalState => ({
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

class MemoryPullRequestRepository implements PullRequestReviewRuntimeRepository {
  public current: ReviewStateCommit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: pullRequestContext(),
    globalState: pullRequestGlobal(),
  };

  public loadCount = 0;

  public async load(_target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit> {
    void _target;
    this.loadCount += 1;
    return clone(this.current);
  }

  public async commit(transaction: Readonly<ReviewStateTransactionLike>): Promise<void> {
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

const reviewContextItem = (
  repositoryId: string,
  contextId: string,
): ReviewContextListItem => ({
  context: {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId,
    kind: "pull-request",
    repositoryId,
    displayName: "PR #25",
    pullRequest: {
      host: "github.com",
      owner: repositoryId,
      repository: "repository",
      number: 25,
      state: "open",
      baseSha: A,
      headSha: B,
    },
    files: {},
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  },
  current: false,
  group: "saved-open-pull-request",
  label: "PR #25",
  description: "open",
  layerEnabled: true,
});

test("Issue #84 Review Context rows with the same PR label have distinct stable VS Code identities", () => {
  const vscode = {
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
  const runtime = loadWithVscode<typeof import("../../src/ui/review-contexts/vscode-review-contexts-runtime.js")>(
    "../../src/ui/review-contexts/vscode-review-contexts-runtime.js",
    vscode,
  );
  const provider = new runtime.ReviewContextsTreeProvider({
    load: async () => [],
  });
  const first = reviewContextItem("repository-a", "github-pr:repository-a#25");
  const second = reviewContextItem("repository-b", "github-pr:repository-b#25");

  const firstTreeItem = provider.getTreeItem(first) as unknown as { readonly id?: string };
  const firstAgain = provider.getTreeItem(first) as unknown as { readonly id?: string };
  const secondTreeItem = provider.getTreeItem(second) as unknown as { readonly id?: string };

  assert.ok(firstTreeItem.id, "Review Context rows require an explicit VS Code TreeItem id");
  assert.equal(firstTreeItem.id, firstAgain.id, "the same immutable context must keep the same TreeItem id");
  assert.notEqual(firstTreeItem.id, secondTreeItem.id, "equal display labels from different repositories must not collide");
});

test("Issue #84 operation feedback publishes privacy-safe stage counts without a timeout", async () => {
  type Progress = {
    readonly stage: "pull-request-contexts";
    readonly completed: number;
    readonly total: number;
  };
  type ProgressApi = {
    reportActiveOperationProgress(progress: Progress, context?: OperationFeedbackContext): void;
  };
  const reportProgress = (operationFeedbackModule as unknown as Partial<ProgressApi>)
    .reportActiveOperationProgress;
  assert.equal(typeof reportProgress, "function", "operation progress reporting API must exist");
  if (reportProgress === undefined) return;

  const statuses: Array<{
    readonly label: string;
    readonly activeCount: number;
    readonly progress?: Progress;
  }> = [];
  const logs: OperationLogEntry[] = [];
  const feedback = new operationFeedbackModule.OperationFeedback({
    showBusy: (label, activeCount, progress?: Progress) => {
      statuses.push({ label, activeCount, ...(progress === undefined ? {} : { progress }) });
    },
    clearBusy: () => undefined,
    appendLog: (entry) => { logs.push(entry); },
    revealLog: () => undefined,
  });
  operationFeedbackModule.setActiveOperationFeedback(feedback);
  try {
    await operationFeedbackModule.runWithActiveOperationFeedback(
      "Review Contextsを更新",
      async (context) => {
        reportProgress({ stage: "pull-request-contexts", completed: 2, total: 5 }, context);
      },
    );
  } finally {
    operationFeedbackModule.setActiveOperationFeedback(undefined);
  }

  assert.deepEqual(statuses.at(-1)?.progress, {
    stage: "pull-request-contexts",
    completed: 2,
    total: 5,
  });
  const progressLog = logs.find((entry) => entry.event === "progress");
  assert.ok(progressLog, "a long-running operation must write its anonymous numeric progress to Output");
  const formatted = operationFeedbackModule.formatOperationLogEntry(progressLog);
  assert.match(formatted, /PROGRESS Review Contextsを更新.*pull-request-contexts.*2\/5/u);
  assert.doesNotMatch(formatted, /src\/|\.ts|PR #/u, "progress diagnostics must not contain file names, source, or PR titles");
});

test("PR85-IFR-003 three equivalent PR progress refreshes share one generation without cancelling each other", async () => {
  operationFeedbackModule.setActiveOperationFeedback(undefined);
  const repository = new MemoryPullRequestRepository();
  let blockYields = false;
  let entered = deferred<void>();
  let release = deferred<void>();
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    progressWork: {
      maxItems: 1,
      yieldControl: async () => {
        if (!blockYields) return;
        entered.resolve();
        await release.promise;
      },
    },
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repository",
    fileSystemPathSemantics: "posix",
    snapshot: diff,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old\n" : "new\n",
    }),
  });

  await runtime.activateProgress(CONTEXT_ID);
  assert.deepEqual(runtime.progress.getEffectiveProgress(), {
    reviewedLineCount: 1,
    totalLineCount: 2,
    progress: 0.5,
    files: runtime.progress.getEffectiveProgress().files,
  });

  blockYields = true;
  entered = deferred<void>();
  release = deferred<void>();
  const firstRefresh = runtime.activateProgress(CONTEXT_ID);
  await entered.promise;
  assert.equal(
    runtime.progress.getEffectiveProgress().reviewedLineCount,
    1,
    "same-identity recalculation must retain the last accepted PR Progress snapshot",
  );

  const persistedFile = repository.current.contextState.files[FILE_ID];
  assert.ok(persistedFile);
  persistedFile.originalReviewedByDiff[DIFF_ID] = [{ startLine: 0, endLineExclusive: 1 }];
  const secondRefresh = runtime.activateProgress(CONTEXT_ID);
  const thirdRefresh = runtime.activateProgress(CONTEXT_ID);
  blockYields = false;
  release.resolve();

  const outcomes = await Promise.allSettled([firstRefresh, secondRefresh, thirdRefresh]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["fulfilled", "fulfilled", "fulfilled"]);
  assert.equal(runtime.progress.getEffectiveProgress().reviewedLineCount, 1, "shared callers must observe one accepted generation");
  await runtime.activateProgress(CONTEXT_ID);
  assert.deepEqual(runtime.progress.getEffectiveProgress(), {
    reviewedLineCount: 2,
    totalLineCount: 2,
    progress: 1,
    files: runtime.progress.getEffectiveProgress().files,
  });
});

test("PR85-IFR-003 starts a fresh equivalent refresh after an exhausted retry fails", async () => {
  const repository = new MemoryPullRequestRepository();
  let failReads = true;
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
      if (failReads) throw new Error("retryable read failure");
      return { kind: "found", content: descriptor.revision === A ? "old\n" : "new\n" };
    },
  });

  await assert.rejects(runtime.activateProgress(CONTEXT_ID), /retryable read failure/u);
  failReads = false;
  await runtime.activateProgress(CONTEXT_ID);

  assert.equal(runtime.progress.getEffectiveProgress().totalLineCount, 2);
});

test("PR85-IFR-002 keeps an accepted Tree and in-flight generation when the same immutable snapshot is re-registered", async () => {
  const repository = new MemoryPullRequestRepository();
  const entered = deferred<void>();
  const release = deferred<void>();
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: async () => undefined,
    diffHost: { parseUri: (value) => value, openDiff: async () => undefined },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    progressWork: {
      maxItems: 1,
      yieldControl: async () => {
        entered.resolve();
        await release.promise;
      },
    },
  });
  const register = (): void => runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repository",
    fileSystemPathSemantics: "posix",
    snapshot: diff,
    readTextContent: async (descriptor) => ({
      kind: "found",
      content: descriptor.revision === A ? "old\n" : "new\n",
    }),
  });
  register();
  const inFlight = runtime.activateProgress(CONTEXT_ID);
  await entered.promise;

  register();
  release.resolve();
  await inFlight;

  assert.equal(
    runtime.progress.getEffectiveProgress().totalLineCount,
    2,
    "same-snapshot registration must not invalidate the accepted PR Progress Tree",
  );
});

test("Issue #84 production sources report anonymous repository, PR-context, and PR-file counts", async () => {
  const reviewContexts = await readFile("src/ui/review-contexts/vscode-review-contexts-runtime.ts", "utf8");
  const pullRequestProgress = await readFile("src/t405-pull-request-review-runtime.ts", "utf8");

  assert.match(reviewContexts, /reportActiveOperationProgress/u);
  assert.match(reviewContexts, /stage:\s*"repositories"/u);
  assert.match(reviewContexts, /stage:\s*"pull-request-contexts"/u);
  assert.match(pullRequestProgress, /reportActiveOperationProgress/u);
  assert.match(pullRequestProgress, /stage:\s*"pull-request-files"/u);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  type ReviewStateRepositoryTarget,
} from "../../src/adapters/state-repository/index.js";
import {
  createGitHubPullRequestContextIdFromRepositoryId,
  GitHubPullRequestContextStateService,
  type GitHubPullRequestContextRepositoryPort,
  type PullRequestReviewStateCommit,
  type UpdatePullRequestContextInput,
} from "../../src/application/github-pr-context/index.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type PullRequestReviewContext,
  type RepositoryGlobalState,
  type ReviewContextState,
} from "../../src/core/contracts/index.js";
import { synchronizePullRequestOwner } from "../../src/t405-owner-pull-request-synchronization.js";

const REPOSITORY_ID = "github.com/ssaattww/revmem";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const FILE_ID = "src/example.ts";
const TIMESTAMP = "2026-09-01T00:00:00.000Z";

const contextId = (number: number): string =>
  createGitHubPullRequestContextIdFromRepositoryId(REPOSITORY_ID, number);

const pullRequest = (number: number, baseSha: string, headSha: string): PullRequestReviewContext => ({
  host: "github.com",
  owner: "ssaattww",
  repository: "revmem",
  number,
  state: "open",
  title: `PR ${number}`,
  baseSha,
  headSha,
});

const contextState = (number: number, headSha = SHA_B): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: contextId(number),
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: `PR #${number}`,
  pullRequest: pullRequest(number, SHA_A, headSha),
  files: {
    [FILE_ID]: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: FILE_ID,
      currentPath: FILE_ID,
      previousPaths: [],
      revisionId: headSha,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
      originalReviewedByDiff: {},
      lineCount: 2,
      updatedAt: TIMESTAMP,
    },
  },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
});

const globalState = (revisionId = SHA_B): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revisionId,
  files: {
    [FILE_ID]: {
      fileId: FILE_ID,
      currentPath: FILE_ID,
      revisionId,
      reviewed: [{ startLine: 0, endLineExclusive: 1 }],
      updatedAt: TIMESTAMP,
    },
  },
  updatedAt: TIMESTAMP,
});

const target = (number: number): ReviewStateRepositoryTarget => ({
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  contextId: contextId(number),
});

const mappedCommit = (
  current: PullRequestReviewStateCommit,
  nextPullRequest: PullRequestReviewContext,
): PullRequestReviewStateCommit => ({
  contextState: {
    ...structuredClone(current.contextState),
    pullRequest: structuredClone(nextPullRequest),
    files: Object.fromEntries(Object.entries(current.contextState.files).map(([fileId, file]) => [fileId, {
      ...file,
      revisionId: nextPullRequest.headSha,
    }])),
    updatedAt: "2026-09-01T00:01:00.000Z",
  },
  globalState: {
    ...structuredClone(current.globalState),
    currentRevisionId: nextPullRequest.headSha,
    files: Object.fromEntries(Object.entries(current.globalState.files).map(([fileId, file]) => [fileId, {
      ...file,
      revisionId: nextPullRequest.headSha,
    }])),
    updatedAt: "2026-09-01T00:01:00.000Z",
  },
  mappingDisposition: "mapped",
});

class PrepareOnlyRepository implements GitHubPullRequestContextRepositoryPort {
  public async load(): Promise<undefined> { return undefined; }
  public async create(): Promise<void> { throw new Error("not used"); }
  public async commit(): Promise<void> { throw new Error("owner synchronization must not call per-context commit"); }
}

const createHarness = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-issue106-t405-"));
  const atomic = new FileSystemReviewStateRepository({
    storageUris: { globalStorageUri: { fsPath: root } },
  });
  await atomic.save(target(52), {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(52),
    globalState: globalState(),
  });
  await atomic.save(target(53), {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: contextState(53),
    globalState: globalState(),
  });
  let ownerCommits = 0;
  const commitRepository = atomic.commitRepository.bind(atomic);
  atomic.commitRepository = async (transaction) => {
    ownerCommits += 1;
    await commitRepository(transaction);
  };
  const repository = new DebouncedReviewStateRepository({
    delegate: atomic,
    debounceMilliseconds: 0,
  });
  const histories: string[] = [];
  const service = new GitHubPullRequestContextStateService(
    new PrepareOnlyRepository(),
    async ({ current, nextPullRequest }) => mappedCommit(current, nextPullRequest),
    {
      recordContextCreated: async () => undefined,
      recordRevisionMapping: async (_previous, next) => {
        histories.push(next.contextState.contextId);
      },
    },
  );
  return { root, atomic, repository, service, histories, ownerCommits: () => ownerCommits };
};

const updateInput = (
  context: ReviewContextState,
  targetHead: string,
): UpdatePullRequestContextInput => ({
  repositoryId: context.repositoryId,
  identity: {
    host: context.pullRequest!.host,
    owner: context.pullRequest!.owner,
    repository: context.pullRequest!.repository,
    pullRequestNumber: context.pullRequest!.number,
  },
  displayName: context.displayName,
  pullRequest: {
    ...context.pullRequest!,
    baseSha: context.pullRequest!.headSha,
    headSha: targetHead,
  },
});

test("Issue #106 same-target PR contexts publish through one owner CAS and only then record history", async () => {
  const harness = await createHarness();
  try {
    const historyCountAtCommit: number[] = [];
    const commitRepository = harness.atomic.commitRepository.bind(harness.atomic);
    harness.atomic.commitRepository = async (transaction) => {
      historyCountAtCommit.push(harness.histories.length);
      await commitRepository(transaction);
    };

    const result = await synchronizePullRequestOwner(
      { repositoryId: REPOSITORY_ID, headRevision: SHA_C },
      {
        repository: harness.repository,
        resolveUpdate: async (context) => updateInput(context, SHA_C),
        prepareUpdate: (input, current) => harness.service.prepareUpdate(input, current),
        recordPreparedUpdateHistory: (prepared) => harness.service.recordPreparedUpdateHistory(prepared),
      },
    );

    assert.equal(result.committed, true);
    assert.deepEqual(result.mappedContextIds, [contextId(52), contextId(53)]);
    assert.deepEqual(result.skippedRevisionContextIds, []);
    assert.equal(harness.ownerCommits(), 1);
    assert.deepEqual(historyCountAtCommit, [0]);
    assert.deepEqual(harness.histories, [contextId(52), contextId(53)]);
    const state52 = await harness.repository.load(target(52));
    const state53 = await harness.repository.load(target(53));
    assert.equal(state52?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(state53?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(state52?.globalState.currentRevisionId, SHA_C);
    assert.equal(state53?.globalState.currentRevisionId, SHA_C);
  } finally {
    await harness.repository.dispose();
    await rm(harness.root, { recursive: true, force: true });
  }
});

test("Issue #106 different remote HEAD stays dormant until that HEAD becomes the owner synchronization revision", async () => {
  const harness = await createHarness();
  try {
    const result = await synchronizePullRequestOwner(
      { repositoryId: REPOSITORY_ID, headRevision: SHA_C },
      {
        repository: harness.repository,
        resolveUpdate: async (context) => updateInput(context, context.pullRequest?.number === 52 ? SHA_C : SHA_D),
        prepareUpdate: (input, current) => harness.service.prepareUpdate(input, current),
        recordPreparedUpdateHistory: (prepared) => harness.service.recordPreparedUpdateHistory(prepared),
      },
    );

    assert.equal(result.committed, true);
    assert.deepEqual(result.mappedContextIds, [contextId(52)]);
    assert.deepEqual(result.skippedRevisionContextIds, [contextId(53)]);
    const state52 = await harness.repository.load(target(52));
    const state53 = await harness.repository.load(target(53));
    assert.equal(state52?.contextState.pullRequest?.headSha, SHA_C);
    assert.equal(state53?.contextState.pullRequest?.headSha, SHA_B);
    assert.equal(state52?.globalState.currentRevisionId, SHA_C);
    assert.equal(state53?.globalState.currentRevisionId, SHA_C);
  } finally {
    await harness.repository.dispose();
    await rm(harness.root, { recursive: true, force: true });
  }
});

test("Issue #106 cancellation before owner publication leaves state and history untouched", async () => {
  const harness = await createHarness();
  const controller = new AbortController();
  try {
    await assert.rejects(
      () => synchronizePullRequestOwner(
        { repositoryId: REPOSITORY_ID, headRevision: SHA_C },
        {
          repository: harness.repository,
          resolveUpdate: async (context) => {
            controller.abort();
            return updateInput(context, SHA_C);
          },
          prepareUpdate: (input, current) => harness.service.prepareUpdate(input, current),
          recordPreparedUpdateHistory: (prepared) => harness.service.recordPreparedUpdateHistory(prepared),
        },
        controller.signal,
      ),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.equal(harness.ownerCommits(), 0);
    assert.deepEqual(harness.histories, []);
    const state52 = await harness.repository.load(target(52));
    assert.equal(state52?.contextState.pullRequest?.headSha, SHA_B);
    assert.equal(state52?.globalState.currentRevisionId, SHA_B);
  } finally {
    await harness.repository.dispose();
    await rm(harness.root, { recursive: true, force: true });
  }
});

test("Issue #106 T405 production runtime delegates explicit PR synchronization to the owner synchronization boundary", async () => {
  const runtimeSource = await readFile(
    path.resolve(__dirname, "../../../src/t405-review-contexts-runtime.ts"),
    "utf8",
  );
  assert.match(runtimeSource, /synchronizePullRequestOwner/u);
  assert.match(runtimeSource, /commitRepository/u);
});

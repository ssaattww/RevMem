import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  DocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor,
  type DocumentGitInspector,
  type DocumentReviewStateRepository
} from "../../src/adapters/document-review-state/index";
import type {
  LocalGitRepositoryInspection
} from "../../src/adapters/local-git/index";
import type {
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import type {
  LineInterval,
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";
import {
  markReviewedRanges,
  unmarkReviewedRanges,
  type ReviewStateFileTarget
} from "../../src/core/review-state/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

type OpenSession = Awaited<ReturnType<DocumentReviewStateSessionProvider["open"]>>;

interface ReconciliationSnapshotView {
  readonly contentHash?: string;
  readonly reviewed: readonly LineInterval[];
}

interface ReconciledContextView extends ReviewContextState {
  readonly ownerReconciliation?: Readonly<Record<string, ReconciliationSnapshotView>>;
}

class RecordingRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();
  public commitAttempts = 0;
  public successfulCommits = 0;
  public failNextCommit = false;

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const current = this.commits.get(targetKey(target));
    return current === undefined ? undefined : clone(current);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.commits.set(targetKey(target), clone(commit));
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    this.commitAttempts += 1;
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("injected reconciliation commit failure");
    }

    const matching = [...this.commits.keys()].find((key) => {
      const current = this.commits.get(key)!;
      return current.contextState.repositoryId === transaction.repositoryId &&
        current.contextState.contextId === transaction.contextId;
    });
    assert.ok(matching, "transaction target must already be initialized");
    this.commits.set(matching, {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState
    });
    this.successfulCommits += 1;
  }

  public resetCommitCounters(): void {
    this.commitAttempts = 0;
    this.successfulCommits = 0;
  }

  public findByContextKind(kind: ReviewContextState["kind"]): ReviewStateCommit | undefined {
    const current = [...this.commits.values()].find(
      (commit) => commit.contextState.kind === kind
    );
    return current === undefined ? undefined : clone(current);
  }
}

class MutableGitInspector implements DocumentGitInspector {
  public constructor(public result: LocalGitRepositoryInspection) {}

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    return clone(this.result);
  }
}

const nonRepository = (): LocalGitRepositoryInspection => ({
  kind: "not-repository",
  gitVersion: "2.55.0"
});

const gitUnavailable = (): LocalGitRepositoryInspection => ({
  kind: "git-unavailable",
  executable: "git"
});

const repositoryInspection = (): LocalGitRepositoryInspection => ({
  kind: "repository",
  repository: {
    gitVersion: "2.55.0",
    rootPath: path.resolve("/repo"),
    repositoryId: "github.com/example/project",
    remote: {
      name: "origin",
      rawUrl: "https://github.com/example/project.git",
      normalizedUrl: "github.com/example/project"
    },
    branch: {
      kind: "branch",
      fullRef: "refs/heads/feature/issue-13"
    },
    head: "0123456789abcdef0123456789abcdef01234567"
  }
});

const descriptor = (
  relativePath = "src/example.ts",
  includeWorkspace = true
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: `/repo/${relativePath}`
  },
  documentFsPath: path.resolve(`/repo/${relativePath}`),
  fileSystemPathSemantics: "posix",
  ...(includeWorkspace
    ? {
        workspace: {
          workspaceFolderUri: {
            scheme: "file",
            authority: "",
            path: "/repo"
          },
          relativePath,
          displayName: "Project workspace"
        }
      }
    : {}),
  lineCount: 8,
  contentHash: "hash-current"
});

const createProvider = (
  repository: RecordingRepository,
  gitInspector: MutableGitInspector,
  now: () => Date
): DocumentReviewStateSessionProvider => {
  const stableHash = new NodeSha256StableHash();
  return new DocumentReviewStateSessionProvider({
    gitInspector,
    repository,
    workspaceProvider: new WorkspaceReviewStateSessionProvider({
      identityService: new WorkspaceIdentityService(stableHash),
      repository,
      now
    }),
    stableHash,
    now
  });
};

const changeReviewed = async (
  session: OpenSession,
  operation: "mark" | "unmark",
  target: ReviewStateFileTarget,
  startLine: number,
  endLineExclusive: number,
  occurredAt: string
): Promise<void> => {
  const input = {
    contextState: session.contextState,
    globalState: session.globalState,
    target,
    intervals: [{ startLine, endLineExclusive }],
    occurredAt
  };
  const transaction = operation === "mark"
    ? markReviewedRanges(input)
    : unmarkReviewedRanges(input);
  await session.committer.commit(transaction);
};

const reviewed = (session: OpenSession): readonly LineInterval[] =>
  session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [];

const baselineSnapshots = (
  contextState: ReviewContextState
): readonly ReconciliationSnapshotView[] =>
  Object.values(
    (contextState as ReconciledContextView).ownerReconciliation ?? {}
  );

/** Verifies that migration records an empty observed baseline before creating a missing target file, preventing old source ranges from becoming additions. */
test("an old workspace context records an empty baseline before the target file is first created", async () => {
  let currentTime = "2026-07-25T13:00:00.000Z";
  const repository = new RecordingRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector, () => new Date(currentTime));

  await provider.open(descriptor("src/other.ts"));

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T13:01:00.000Z";
  const initialGit = await provider.open(descriptor());
  assert.deepEqual(baselineSnapshots(initialGit.contextState).map((value) => value.reviewed), [[]]);

  await changeReviewed(
    initialGit,
    "mark",
    initialGit.target,
    0,
    2,
    "2026-07-25T13:02:00.000Z"
  );

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T13:03:00.000Z";
  const fallback = await provider.open(descriptor());
  await changeReviewed(
    fallback,
    "mark",
    fallback.target,
    4,
    6,
    "2026-07-25T13:04:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T13:05:00.000Z";
  const recovered = await provider.open(descriptor());
  assert.deepEqual(reviewed(recovered), [
    { startLine: 0, endLineExclusive: 2 },
    { startLine: 4, endLineExclusive: 6 }
  ]);

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T13:06:00.000Z";
  const removedFallback = await provider.open(descriptor());
  await changeReviewed(
    removedFallback,
    "unmark",
    removedFallback.target,
    4,
    6,
    "2026-07-25T13:07:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T13:08:00.000Z";
  const removedGit = await provider.open(descriptor());
  assert.deepEqual(reviewed(removedGit), [
    { startLine: 0, endLineExclusive: 2 }
  ]);

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T13:09:00.000Z";
  const readdedFallback = await provider.open(descriptor());
  await changeReviewed(
    readdedFallback,
    "mark",
    readdedFallback.target,
    4,
    6,
    "2026-07-25T13:10:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T13:11:00.000Z";
  const readdedGit = await provider.open(descriptor());
  assert.deepEqual(reviewed(readdedGit), [
    { startLine: 0, endLineExclusive: 2 },
    { startLine: 4, endLineExclusive: 6 }
  ]);
});

/** Verifies that initial workspace-to-Git promotion atomically stores both promoted ranges and their reconciliation baseline. */
test("initial workspace promotion persists ranges and baseline in one real CAS commit", async () => {
  let currentTime = "2026-07-25T14:00:00.000Z";
  const repository = new RecordingRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector, () => new Date(currentTime));

  const workspace = await provider.open(descriptor());
  await changeReviewed(
    workspace,
    "mark",
    workspace.target,
    1,
    3,
    "2026-07-25T14:01:00.000Z"
  );

  repository.resetCommitCounters();
  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T14:02:00.000Z";
  const git = await provider.open(descriptor());

  assert.equal(repository.commitAttempts, 1);
  assert.equal(repository.successfulCommits, 1);
  assert.deepEqual(reviewed(git), [
    { startLine: 1, endLineExclusive: 3 }
  ]);
  assert.equal(baselineSnapshots(git.contextState).length, 1);
});

/** Verifies that a failed initial reconciliation commit publishes neither promoted ranges nor a baseline to the Git owner. */
test("a failed initial promotion leaves the Git owner without promoted ranges or baseline", async () => {
  let currentTime = "2026-07-25T15:00:00.000Z";
  const repository = new RecordingRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector, () => new Date(currentTime));

  const workspace = await provider.open(descriptor());
  await changeReviewed(
    workspace,
    "mark",
    workspace.target,
    2,
    4,
    "2026-07-25T15:01:00.000Z"
  );

  repository.resetCommitCounters();
  repository.failNextCommit = true;
  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T15:02:00.000Z";

  await assert.rejects(
    provider.open(descriptor()),
    /injected reconciliation commit failure/
  );

  assert.equal(repository.commitAttempts, 1);
  assert.equal(repository.successfulCommits, 0);
  const persistedGit = repository.findByContextKind("branch");
  assert.ok(persistedGit);
  assert.equal(
    persistedGit.contextState.files[
      Object.keys(persistedGit.contextState.files)[0] ?? "missing"
    ],
    undefined
  );
  assert.equal(
    (persistedGit.contextState as ReconciledContextView).ownerReconciliation,
    undefined
  );
});

/** Verifies that all eligible lower-owner sources are combined into one compare-and-swap reconciliation commit. */
test("workspace and external sources are reconciled by one real CAS commit", async () => {
  let currentTime = "2026-07-25T16:00:00.000Z";
  const repository = new RecordingRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector, () => new Date(currentTime));

  const external = await provider.open(descriptor("src/example.ts", false));
  await changeReviewed(
    external,
    "mark",
    external.target,
    1,
    2,
    "2026-07-25T16:01:00.000Z"
  );

  currentTime = "2026-07-25T16:02:00.000Z";
  const workspace = await provider.open(descriptor());
  await changeReviewed(
    workspace,
    "mark",
    workspace.target,
    5,
    7,
    "2026-07-25T16:03:00.000Z"
  );

  repository.resetCommitCounters();
  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T16:04:00.000Z";
  const git = await provider.open(descriptor());

  assert.equal(repository.commitAttempts, 1);
  assert.equal(repository.successfulCommits, 1);
  assert.deepEqual(reviewed(git), [
    { startLine: 1, endLineExclusive: 2 },
    { startLine: 5, endLineExclusive: 7 }
  ]);
  assert.equal(baselineSnapshots(git.contextState).length, 2);
});

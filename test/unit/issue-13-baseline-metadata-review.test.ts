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
  type ReviewStateFileTarget
} from "../../src/core/review-state/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

type OpenSession = Awaited<ReturnType<DocumentReviewStateSessionProvider["open"]>>;

interface ReconciliationSnapshot {
  readonly contentHash?: string;
  readonly lineCount: number;
  readonly reviewed: readonly LineInterval[];
}

interface ReconciledContextState extends ReviewContextState {
  readonly ownerReconciliation?: Readonly<Record<string, ReconciliationSnapshot>>;
}

class MemoryRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();

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
  }
}

class MutableGitInspector implements DocumentGitInspector {
  public constructor(public result: LocalGitRepositoryInspection) {}

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    return clone(this.result);
  }
}

const gitUnavailable = (): LocalGitRepositoryInspection => ({
  kind: "git-unavailable",
  executable: "git"
});

const nonRepository = (): LocalGitRepositoryInspection => ({
  kind: "not-repository",
  gitVersion: "2.55.0"
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
  contentHash: string,
  includeWorkspace = true
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/example.ts"
  },
  documentFsPath: path.resolve("/repo/src/example.ts"),
  fileSystemPathSemantics: "posix",
  ...(includeWorkspace
    ? {
        workspace: {
          workspaceFolderUri: {
            scheme: "file",
            authority: "",
            path: "/repo"
          },
          relativePath: "src/example.ts",
          displayName: "Project workspace"
        }
      }
    : {}),
  lineCount: 8,
  contentHash
});

const createProvider = (
  repository: MemoryRepository,
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

const markReviewed = async (
  session: OpenSession,
  target: ReviewStateFileTarget,
  startLine: number,
  endLineExclusive: number,
  occurredAt: string
): Promise<void> => {
  await session.committer.commit(markReviewedRanges({
    contextState: session.contextState,
    globalState: session.globalState,
    target,
    intervals: [{ startLine, endLineExclusive }],
    occurredAt
  }));
};

const reviewed = (session: OpenSession): readonly LineInterval[] =>
  session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [];

const onlyBaseline = (session: OpenSession): ReconciliationSnapshot => {
  const snapshots = Object.values(
    (session.contextState as ReconciledContextState).ownerReconciliation ?? {}
  );
  assert.equal(snapshots.length, 1, "one workspace reconciliation baseline is expected");
  return snapshots[0]!;
};

test("content changes refresh the reconciliation baseline before later fallback additions", async () => {
  let currentTime = "2026-07-25T10:00:00.000Z";
  const repository = new MemoryRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(
    repository,
    gitInspector,
    () => new Date(currentTime)
  );

  const workspaceH1 = await provider.open(descriptor("hash-h1"));
  await markReviewed(
    workspaceH1,
    workspaceH1.target,
    0,
    2,
    "2026-07-25T10:01:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T10:02:00.000Z";
  const gitH1 = await provider.open(descriptor("hash-h1"));
  assert.deepEqual(reviewed(gitH1), [{ startLine: 0, endLineExclusive: 2 }]);
  assert.equal(onlyBaseline(gitH1).contentHash, "hash-h1");

  currentTime = "2026-07-25T10:03:00.000Z";
  const gitH2 = await provider.open(descriptor("hash-h2", false));
  assert.deepEqual(reviewed(gitH2), []);
  await markReviewed(
    gitH2,
    gitH2.target,
    0,
    2,
    "2026-07-25T10:04:00.000Z"
  );

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T10:05:00.000Z";
  const workspaceH2 = await provider.open(descriptor("hash-h2"));
  assert.deepEqual(reviewed(workspaceH2), []);
  await markReviewed(
    workspaceH2,
    workspaceH2.target,
    0,
    2,
    "2026-07-25T10:06:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T10:07:00.000Z";
  const sameIntervalsH2 = await provider.open(descriptor("hash-h2"));
  assert.deepEqual(reviewed(sameIntervalsH2), [
    { startLine: 0, endLineExclusive: 2 }
  ]);
  assert.equal(
    onlyBaseline(sameIntervalsH2).contentHash,
    "hash-h2",
    "matching intervals must still refresh baseline metadata"
  );

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T10:08:00.000Z";
  const fallbackWithAddition = await provider.open(descriptor("hash-h2"));
  await markReviewed(
    fallbackWithAddition,
    fallbackWithAddition.target,
    4,
    6,
    "2026-07-25T10:09:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T10:10:00.000Z";
  const recovered = await provider.open(descriptor("hash-h2"));
  assert.deepEqual(reviewed(recovered), [
    { startLine: 0, endLineExclusive: 2 },
    { startLine: 4, endLineExclusive: 6 }
  ]);
  assert.equal(onlyBaseline(recovered).contentHash, "hash-h2");
});

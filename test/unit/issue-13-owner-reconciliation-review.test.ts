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
import {
  markReviewedRanges,
  unmarkReviewedRanges,
  type ReviewStateFileTarget
} from "../../src/core/review-state/index";
import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

type OpenSession = Awaited<ReturnType<DocumentReviewStateSessionProvider["open"]>>;

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

const descriptor = (): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/example.ts"
  },
  documentFsPath: path.resolve("/repo/src/example.ts"),
  fileSystemPathSemantics: "posix",
  workspace: {
    workspaceFolderUri: {
      scheme: "file",
      authority: "",
      path: "/repo"
    },
    relativePath: "src/example.ts",
    displayName: "Project workspace"
  },
  lineCount: 8,
  contentHash: "hash-current"
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

const reviewed = (session: OpenSession) => ({
  context: session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [],
  global: session.globalState.files[session.target.fileId]?.reviewed ?? []
});

test("Git recovery adds newer fallback ranges even when the Git owner already has state", async () => {
  let currentTime = "2026-07-25T08:00:00.000Z";
  const repository = new MemoryRepository();
  const gitInspector = new MutableGitInspector(repositoryInspection());
  const provider = createProvider(
    repository,
    gitInspector,
    () => new Date(currentTime)
  );

  const gitBeforeFailure = await provider.open(descriptor());
  await changeReviewed(
    gitBeforeFailure,
    "mark",
    gitBeforeFailure.target,
    0,
    2,
    "2026-07-25T08:01:00.000Z"
  );

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T08:02:00.000Z";
  const fallback = await provider.open(descriptor());
  assert.equal(fallback.owner, "workspace");
  await changeReviewed(
    fallback,
    "mark",
    fallback.target,
    4,
    6,
    "2026-07-25T08:03:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T08:04:00.000Z";
  const recovered = await provider.open(descriptor());

  assert.equal(recovered.owner, "git");
  assert.deepEqual(reviewed(recovered), {
    context: [
      { startLine: 0, endLineExclusive: 2 },
      { startLine: 4, endLineExclusive: 6 }
    ],
    global: [
      { startLine: 0, endLineExclusive: 2 },
      { startLine: 4, endLineExclusive: 6 }
    ]
  });
});

test("fallback additions do not resurrect ranges removed from the higher owner", async () => {
  let currentTime = "2026-07-25T09:00:00.000Z";
  const repository = new MemoryRepository();
  const gitInspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(
    repository,
    gitInspector,
    () => new Date(currentTime)
  );

  const workspace = await provider.open(descriptor());
  await changeReviewed(
    workspace,
    "mark",
    workspace.target,
    0,
    2,
    "2026-07-25T09:01:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T09:02:00.000Z";
  const git = await provider.open(descriptor());
  assert.deepEqual(reviewed(git).context, [
    { startLine: 0, endLineExclusive: 2 }
  ]);

  await changeReviewed(
    git,
    "unmark",
    git.target,
    0,
    2,
    "2026-07-25T09:03:00.000Z"
  );

  gitInspector.result = gitUnavailable();
  currentTime = "2026-07-25T09:04:00.000Z";
  const fallback = await provider.open(descriptor());
  await changeReviewed(
    fallback,
    "mark",
    fallback.target,
    4,
    6,
    "2026-07-25T09:05:00.000Z"
  );

  gitInspector.result = repositoryInspection();
  currentTime = "2026-07-25T09:06:00.000Z";
  const recovered = await provider.open(descriptor());

  assert.deepEqual(reviewed(recovered), {
    context: [{ startLine: 4, endLineExclusive: 6 }],
    global: [{ startLine: 4, endLineExclusive: 6 }]
  });
});

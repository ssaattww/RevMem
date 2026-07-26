import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  DocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor,
  type DocumentGitInspector,
  type DocumentReviewStateRepository
} from "../../src/adapters/document-review-state/index";
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  resolveReviewStateStorageRoute,
  type RepositoryStateManifest,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type LineInterval,
  type ReconciledReviewContextState,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";
import {
  markReviewedRanges
} from "../../src/core/review-state/index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const intervalA: LineInterval = { startLine: 0, endLineExclusive: 2 };

type OpenSession = Awaited<ReturnType<DocumentReviewStateSessionProvider["open"]>>;

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

const repositoryInspection = (
  refName: string,
  head: string
): LocalGitRepositoryInspection => ({
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
      fullRef: refName
    },
    head
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
  repository: DocumentReviewStateRepository,
  inspector: MutableGitInspector,
  now: () => Date
): DocumentReviewStateSessionProvider => {
  const stableHash = new NodeSha256StableHash();
  return new DocumentReviewStateSessionProvider({
    gitInspector: inspector,
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
  interval: LineInterval,
  occurredAt: string
): Promise<void> => {
  await session.committer.commit(markReviewedRanges({
    contextState: session.contextState,
    globalState: session.globalState,
    target: session.target,
    intervals: [interval],
    occurredAt
  }));
};

const reviewed = (session: OpenSession): readonly LineInterval[] =>
  session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [];

const globalReviewed = (session: OpenSession): readonly LineInterval[] =>
  session.globalState.files[session.target.fileId]?.reviewed ?? [];

const createTemporaryStorage = async (): Promise<{
  root: string;
  storageUris: ReviewStateStorageUris;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-r6-"));
  return {
    root,
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") },
      storageUri: { fsPath: path.join(root, "workspace") }
    }
  };
};

test("a new Git context at the same revision inherits repository-wide Global state", async () => {
  const temporary = await createTemporaryStorage();
  const head = "0123456789abcdef0123456789abcdef01234567";
  const inspector = new MutableGitInspector(
    repositoryInspection("refs/heads/branch-a", head)
  );
  const repository = new FileSystemReviewStateRepository({
    storageUris: temporary.storageUris
  });
  const provider = createProvider(
    repository,
    inspector,
    () => new Date("2026-07-26T11:00:00.000Z")
  );

  try {
    const branchA = await provider.open(descriptor());
    await markReviewed(branchA, intervalA, "2026-07-26T11:01:00.000Z");

    inspector.result = repositoryInspection("refs/heads/branch-b", head);
    const branchB = await provider.open(descriptor());
    assert.deepEqual(globalReviewed(branchB), [intervalA]);
    assert.deepEqual(reviewed(branchB), []);

    inspector.result = repositoryInspection("refs/heads/branch-a", head);
    const reopenedA = await provider.open(descriptor());
    assert.deepEqual(globalReviewed(reopenedA), [intervalA]);
    assert.deepEqual(reviewed(reopenedA), [intervalA]);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("a new Git context at an unmapped revision does not replace repository-wide Global state", async () => {
  const temporary = await createTemporaryStorage();
  const headA = "0123456789abcdef0123456789abcdef01234567";
  const headB = "89abcdef0123456789abcdef0123456789abcdef";
  const inspector = new MutableGitInspector(
    repositoryInspection("refs/heads/branch-a", headA)
  );
  const repository = new FileSystemReviewStateRepository({
    storageUris: temporary.storageUris
  });
  const provider = createProvider(
    repository,
    inspector,
    () => new Date("2026-07-26T12:00:00.000Z")
  );

  try {
    const branchA = await provider.open(descriptor());
    await markReviewed(branchA, intervalA, "2026-07-26T12:01:00.000Z");

    inspector.result = repositoryInspection("refs/heads/branch-b", headB);
    await assert.rejects(
      provider.open(descriptor()),
      /requires revision mapping/
    );

    inspector.result = repositoryInspection("refs/heads/branch-a", headA);
    const reopenedA = await provider.open(descriptor());
    assert.deepEqual(globalReviewed(reopenedA), [intervalA]);
    assert.deepEqual(reviewed(reopenedA), [intervalA]);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class RecordingRepository implements DocumentReviewStateRepository {
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
    const matching = [...this.commits.entries()].find(([, current]) =>
      current.contextState.repositoryId === transaction.repositoryId &&
      current.contextState.contextId === transaction.contextId
    );
    assert.ok(matching, "transaction target must already be initialized");
    this.commits.set(matching[0], {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState
    });
  }

  public deleteByKind(kind: ReviewContextState["kind"]): void {
    const matching = [...this.commits.entries()].find(
      ([, current]) => current.contextState.kind === kind
    );
    assert.ok(matching, `expected ${kind} state`);
    this.commits.delete(matching[0]);
  }
}

test("recreated lower-owner context does not turn the old baseline into removals", async () => {
  let currentTime = "2026-07-26T13:00:00.000Z";
  const repository = new RecordingRepository();
  const inspector = new MutableGitInspector(nonRepository());
  const provider = createProvider(repository, inspector, () => new Date(currentTime));

  const workspace = await provider.open(descriptor());
  await markReviewed(workspace, intervalA, "2026-07-26T13:01:00.000Z");

  inspector.result = repositoryInspection(
    "refs/heads/feature/document-routing",
    "0123456789abcdef0123456789abcdef01234567"
  );
  currentTime = "2026-07-26T13:02:00.000Z";
  const initialGit = await provider.open(descriptor());
  assert.deepEqual(reviewed(initialGit), [intervalA]);

  repository.deleteByKind("workspace");
  inspector.result = nonRepository();
  currentTime = "2026-07-26T13:03:00.000Z";
  await provider.open(descriptor());

  inspector.result = repositoryInspection(
    "refs/heads/feature/document-routing",
    "0123456789abcdef0123456789abcdef01234567"
  );
  currentTime = "2026-07-26T13:04:00.000Z";
  const recovered = await provider.open(descriptor());
  assert.deepEqual(reviewed(recovered), [intervalA]);
});

const malformedCommit = (): ReviewStateCommit => {
  const contextState: ReconciledReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: "branch:main",
    kind: "branch",
    repositoryId: "github.com/example/project",
    displayName: "refs/heads/main",
    branch: {
      refName: "refs/heads/main",
      headRevision: "revision-a"
    },
    files: {},
    ownerReconciliation: {
      "owner-source:test": {
        sourceOwner: "workspace",
        sourceRepositoryId: "workspace:test",
        sourceContextId: "workspace-context:test",
        sourceFileId: "workspace-file:test",
        contentHash: "hash-current",
        lineCount: 8,
        reviewed: [{ startLine: 7, endLineExclusive: 9 }],
        sourceCreatedAt: "2026-07-26T14:00:00.000Z",
        sourceUpdatedAt: "2026-07-26T14:01:00.000Z"
      }
    },
    createdAt: "2026-07-26T14:00:00.000Z",
    updatedAt: "2026-07-26T14:01:00.000Z"
  };
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState,
    globalState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId: "github.com/example/project",
      currentRevisionId: "revision-a",
      files: {},
      updatedAt: "2026-07-26T14:01:00.000Z"
    }
  };
};

const validCommit = (): ReviewStateCommit => {
  const commit = malformedCommit();
  const contextState = clone(commit.contextState) as ReconciledReviewContextState;
  contextState.ownerReconciliation!["owner-source:test"]!.reviewed = [intervalA];
  return {
    ...commit,
    contextState
  };
};

const malformedTarget: ReviewStateRepositoryTarget = {
  kind: "git",
  repositoryId: "github.com/example/project",
  contextId: "branch:main"
};

test("save rejects reconciliation intervals outside source lineCount", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    await assert.rejects(
      repository.save(malformedTarget, malformedCommit()),
      /lineCount/
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("commit rejects reconciliation intervals outside source lineCount", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    const valid = validCommit();
    await repository.save(malformedTarget, valid);
    await assert.rejects(
      repository.commit({
        repositoryId: malformedTarget.repositoryId,
        contextId: malformedTarget.contextId,
        expected: {
          contextState: valid.contextState,
          globalState: valid.globalState
        },
        next: {
          contextState: malformedCommit().contextState,
          globalState: valid.globalState
        }
      }),
      /lineCount/
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

test("load rejects persisted reconciliation intervals outside source lineCount", async () => {
  const temporary = await createTemporaryStorage();
  try {
    const repository = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    await repository.save(malformedTarget, validCommit());

    const route = resolveReviewStateStorageRoute(
      temporary.storageUris,
      malformedTarget
    );
    const manifest = JSON.parse(
      await readFile(route.statePointerPath, "utf8")
    ) as RepositoryStateManifest;
    const contextReference = manifest.contexts.find(
      (context) => context.contextId === malformedTarget.contextId
    );
    assert.ok(contextReference);
    const contextPath = path.join(route.rootPath, contextReference.file);
    await writeFile(
      contextPath,
      `${JSON.stringify(malformedCommit().contextState, null, 2)}\n`,
      "utf8"
    );

    const reloaded = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    await assert.rejects(
      reloaded.load(malformedTarget),
      /lineCount/
    );
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

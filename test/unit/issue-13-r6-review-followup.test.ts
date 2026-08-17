import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  type ReviewStateStorageUris
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
  markReviewedRanges,
  type ReviewStateTransaction
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

const alternateDescriptor = (): DocumentEditorReviewDescriptor => ({
  ...descriptor(),
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/other.ts"
  },
  documentFsPath: path.resolve("/repo/src/other.ts"),
  workspace: {
    ...descriptor().workspace!,
    relativePath: "src/other.ts"
  },
  contentHash: "hash-other"
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

/** Verifies that a newly selected Git context at an existing revision receives the owner-wide reviewed ranges without inheriting the other context's local ranges. */
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

/** Verifies that opening a context for a different revision rejects before it can replace the owner-wide Global snapshot. */
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
    transaction: Readonly<ReviewStateTransaction>
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

/** Test persistence boundary that inserts one concurrent complete-snapshot commit immediately before a chosen target persists. */
class InterleavingRepository implements DocumentReviewStateRepository {
  private beforeTargetPersistence = true;

  /** Creates an interleaving boundary for one target and one deterministic concurrent operation. */
  public constructor(
    private readonly delegate: DocumentReviewStateRepository,
    private readonly target: ReviewStateRepositoryTarget,
    private readonly beforeSave: () => Promise<void>
  ) {}

  /** Delegates snapshot loading without changing the chosen persistence ordering. */
  public load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    return this.delegate.load(target);
  }

  /** Runs the deterministic interleaving before delegating the selected target's complete-snapshot save. */
  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    await this.interleave(target);
    await this.delegate.save(target, commit);
  }

  /** Runs the deterministic interleaving before delegating the selected target's compare-and-swap commit. */
  public commit(
    transaction: Readonly<ReviewStateTransaction>
  ): Promise<void> {
    return this.commitAfterInterleaving(transaction);
  }

  private async commitAfterInterleaving(
    transaction: Readonly<ReviewStateTransaction>
  ): Promise<void> {
    await this.interleave({
      kind: transaction.next.contextState.kind === "branch" ? "git" :
        transaction.next.contextState.kind,
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId
    });
    return this.delegate.commit(transaction);
  }

  private async interleave(target: ReviewStateRepositoryTarget): Promise<void> {
    if (
      this.beforeTargetPersistence &&
      targetKey(target) === targetKey(this.target)
    ) {
      this.beforeTargetPersistence = false;
      await this.beforeSave();
    }
  }
}

/** Verifies that recreating a lower-priority owner records a fresh baseline rather than treating its old ranges as removals. */
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

/** Verifies that stale-file cleanup replans against a later same-revision CAS commit so it preserves another context's owner-wide Global update. */
test("stale Git cleanup preserves another context's later owner-wide Global update", async () => {
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
    () => new Date("2026-07-26T15:00:00.000Z")
  );

  try {
    const branchA = await provider.open(descriptor());
    await markReviewed(branchA, intervalA, "2026-07-26T15:01:00.000Z");

    inspector.result = repositoryInspection("refs/heads/branch-b", head);
    const branchB = await provider.open(alternateDescriptor());

    inspector.result = repositoryInspection("refs/heads/branch-a", head);
    const staleDescriptor = { ...descriptor(), contentHash: "hash-stale" };
    const interleavingProvider = createProvider(
      new InterleavingRepository(
        repository,
        {
          kind: "git",
          repositoryId: branchA.contextState.repositoryId,
          contextId: branchA.contextState.contextId
        },
        () => markReviewed(branchB, intervalA, "2026-07-26T15:02:00.000Z")
      ),
      inspector,
      () => new Date("2026-07-26T15:03:00.000Z")
    );

    await interleavingProvider.open(staleDescriptor);

    inspector.result = repositoryInspection("refs/heads/branch-b", head);
    const reloadedB = await provider.open(alternateDescriptor());
    assert.deepEqual(globalReviewed(reloadedB), [intervalA]);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

/** Verifies that stale cleanup preserves a later same-context commit when it has already restored a current file state in both snapshots. */
test("stale Git cleanup preserves a later same-context current file state", async () => {
  const temporary = await createTemporaryStorage();
  const head = "0123456789abcdef0123456789abcdef01234567";
  const inspector = new MutableGitInspector(
    repositoryInspection("refs/heads/branch-a", head)
  );
  const repository = new FileSystemReviewStateRepository({
    storageUris: temporary.storageUris
  });
  const currentDescriptor = descriptor();
  const staleDescriptor = { ...currentDescriptor, contentHash: "hash-old" };
  const provider = createProvider(
    repository,
    inspector,
    () => new Date("2026-07-26T16:00:00.000Z")
  );

  try {
    const initial = await provider.open(staleDescriptor);
    await markReviewed(initial, intervalA, "2026-07-26T16:01:00.000Z");

    const interleavingProvider = createProvider(
      new InterleavingRepository(
        repository,
        {
          kind: "git",
          repositoryId: initial.contextState.repositoryId,
          contextId: initial.contextState.contextId
        },
        async () => {
          const current = await provider.open(currentDescriptor);
          await markReviewed(current, intervalA, "2026-07-26T16:02:00.000Z");
        }
      ),
      inspector,
      () => new Date("2026-07-26T16:03:00.000Z")
    );

    const retried = await interleavingProvider.open(currentDescriptor);
    assert.deepEqual(reviewed(retried), [intervalA]);
    assert.deepEqual(globalReviewed(retried), [intervalA]);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
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

/** Verifies that persistence rejects owner-reconciliation ranges that exceed their source file's declared line count. */
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

/** Verifies that compare-and-swap persistence validates the next owner-reconciliation ranges before writing either snapshot. */
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

/** Verifies that corrupted persisted owner-reconciliation ranges are quarantined and not exposed on reload. */
test("load quarantines persisted reconciliation intervals outside source lineCount", async () => {
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
    const malformedRaw = `${JSON.stringify(malformedCommit().contextState, null, 2)}\n`;
    await writeFile(contextPath, malformedRaw, "utf8");

    const reloaded = new FileSystemReviewStateRepository({
      storageUris: temporary.storageUris
    });
    assert.equal(await reloaded.load(malformedTarget), undefined);
    await assert.rejects(() => readFile(contextPath, "utf8"), /ENOENT/u);
    const quarantine = (await readdir(path.dirname(contextPath))).find((name) =>
      name.startsWith(`${path.basename(contextPath)}.corrupt-`) && name.endsWith(".quarantine")
    );
    assert.ok(quarantine);
    assert.equal(await readFile(path.join(path.dirname(contextPath), quarantine), "utf8"), malformedRaw);
  } finally {
    await rm(temporary.root, { recursive: true, force: true });
  }
});

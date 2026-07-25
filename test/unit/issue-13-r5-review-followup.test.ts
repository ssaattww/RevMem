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
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState
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

interface SnapshotView {
  readonly sourceOwner: "workspace" | "external-file";
  readonly reviewed: readonly LineInterval[];
}

interface ReconciledContextView extends ReviewContextState {
  readonly ownerReconciliation?: Readonly<Record<string, SnapshotView>>;
}

class RecordingRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();
  public workspaceLoadSequence: ReviewStateCommit[] = [];

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    if (target.kind === "workspace" && this.workspaceLoadSequence.length > 0) {
      return clone(this.workspaceLoadSequence.shift()!);
    }
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
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone(transaction.next.contextState) as ReviewContextState,
      globalState: clone(transaction.next.globalState) as RepositoryGlobalState
    });
  }

  public findByKind(kind: ReviewContextState["kind"]): ReviewStateCommit {
    const current = [...this.commits.values()].find(
      (commit) => commit.contextState.kind === kind
    );
    assert.ok(current, `expected persisted ${kind} context`);
    return clone(current);
  }

  public replaceByKind(
    kind: ReviewContextState["kind"],
    commit: ReviewStateCommit
  ): void {
    const matching = [...this.commits.entries()].find(
      ([, current]) => current.contextState.kind === kind
    );
    assert.ok(matching, `expected persisted ${kind} context`);
    this.commits.set(matching[0], clone(commit));
  }
}

class CountingGitInspector implements DocumentGitInspector {
  public invocationCount = 0;

  public constructor(public result: LocalGitRepositoryInspection) {}

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    this.invocationCount += 1;
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
      fullRef: "refs/heads/feature/document-routing"
    },
    head: "0123456789abcdef0123456789abcdef01234567"
  }
});

const descriptor = (includeWorkspace: boolean): DocumentEditorReviewDescriptor => ({
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
  contentHash: "hash-current"
});

const createProvider = (
  repository: RecordingRepository,
  gitInspector: CountingGitInspector,
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

const transactionFor = (
  commit: ReviewStateCommit,
  target: ReviewStateFileTarget,
  operation: "mark" | "unmark",
  interval: LineInterval,
  occurredAt: string
) => operation === "mark"
  ? markReviewedRanges({
      contextState: commit.contextState,
      globalState: commit.globalState,
      target,
      intervals: [interval],
      occurredAt
    })
  : unmarkReviewedRanges({
      contextState: commit.contextState,
      globalState: commit.globalState,
      target,
      intervals: [interval],
      occurredAt
    });

const mutateCommit = (
  commit: ReviewStateCommit,
  target: ReviewStateFileTarget,
  operation: "mark" | "unmark",
  interval: LineInterval,
  occurredAt: string
): ReviewStateCommit => {
  const transaction = transactionFor(commit, target, operation, interval, occurredAt);
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: clone(transaction.next.contextState) as ReviewContextState,
    globalState: clone(transaction.next.globalState) as RepositoryGlobalState
  };
};

const changeReviewed = async (
  session: OpenSession,
  operation: "mark" | "unmark",
  interval: LineInterval,
  occurredAt: string
): Promise<void> => {
  await session.committer.commit(transactionFor({
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: session.contextState,
    globalState: session.globalState
  }, session.target, operation, interval, occurredAt));
};

const reviewed = (session: OpenSession): readonly LineInterval[] =>
  session.contextState.files[session.target.fileId]?.modifiedReviewed ?? [];

const baselineFor = (
  contextState: ReviewContextState,
  owner: SnapshotView["sourceOwner"]
): SnapshotView | undefined => Object.values(
  (contextState as ReconciledContextView).ownerReconciliation ?? {}
).find((snapshot) => snapshot.sourceOwner === owner);

const intervalA: LineInterval = { startLine: 0, endLineExclusive: 2 };
const intervalB: LineInterval = { startLine: 4, endLineExclusive: 6 };

test("initial promotion and baseline use one lower-owner observation", async () => {
  let currentTime = "2026-07-25T17:00:00.000Z";
  const repository = new RecordingRepository();
  const inspector = new CountingGitInspector(nonRepository());
  const provider = createProvider(repository, inspector, () => new Date(currentTime));

  const workspace = await provider.open(descriptor(true));
  await changeReviewed(workspace, "mark", intervalA, "2026-07-25T17:01:00.000Z");
  const workspaceA = repository.findByKind("workspace");
  const workspaceWithoutA = mutateCommit(
    workspaceA,
    workspace.target,
    "unmark",
    intervalA,
    "2026-07-25T17:02:00.000Z"
  );
  const workspaceB = mutateCommit(
    workspaceWithoutA,
    workspace.target,
    "mark",
    intervalB,
    "2026-07-25T17:03:00.000Z"
  );
  repository.replaceByKind("workspace", workspaceB);
  repository.workspaceLoadSequence = [workspaceA, workspaceB];

  inspector.result = repositoryInspection();
  currentTime = "2026-07-25T17:04:00.000Z";
  const firstGit = await provider.open(descriptor(true));
  assert.deepEqual(baselineFor(firstGit.contextState, "workspace")?.reviewed, [intervalA]);
  assert.deepEqual(reviewed(firstGit), [intervalA]);

  currentTime = "2026-07-25T17:05:00.000Z";
  const secondGit = await provider.open(descriptor(true));
  assert.deepEqual(reviewed(secondGit), [intervalB]);
  assert.deepEqual(baselineFor(secondGit.contextState, "workspace")?.reviewed, [intervalB]);
});

test("workspace reviewed state wins over a conflicting external-file removal", async () => {
  let currentTime = "2026-07-25T18:00:00.000Z";
  const repository = new RecordingRepository();
  const inspector = new CountingGitInspector(nonRepository());
  const provider = createProvider(repository, inspector, () => new Date(currentTime));

  const external = await provider.open(descriptor(false));
  await changeReviewed(external, "mark", intervalA, "2026-07-25T18:01:00.000Z");
  const workspace = await provider.open(descriptor(true));

  inspector.result = repositoryInspection();
  currentTime = "2026-07-25T18:02:00.000Z";
  await provider.open(descriptor(true));

  const externalEmpty = mutateCommit(
    repository.findByKind("external-file"),
    external.target,
    "unmark",
    intervalA,
    "2026-07-25T18:03:00.000Z"
  );
  const workspaceAB = mutateCommit(
    repository.findByKind("workspace"),
    workspace.target,
    "mark",
    intervalB,
    "2026-07-25T18:04:00.000Z"
  );
  repository.replaceByKind("external-file", externalEmpty);
  repository.replaceByKind("workspace", workspaceAB);

  currentTime = "2026-07-25T18:05:00.000Z";
  const recovered = await provider.open(descriptor(true));
  assert.deepEqual(reviewed(recovered), [intervalA, intervalB]);
});

test("workspace removal wins over a conflicting external-file addition", async () => {
  let currentTime = "2026-07-25T19:00:00.000Z";
  const repository = new RecordingRepository();
  const inspector = new CountingGitInspector(nonRepository());
  const provider = createProvider(repository, inspector, () => new Date(currentTime));

  const external = await provider.open(descriptor(false));
  const workspace = await provider.open(descriptor(true));
  await changeReviewed(workspace, "mark", intervalA, "2026-07-25T19:01:00.000Z");

  inspector.result = repositoryInspection();
  currentTime = "2026-07-25T19:02:00.000Z";
  await provider.open(descriptor(true));

  const workspaceEmpty = mutateCommit(
    repository.findByKind("workspace"),
    workspace.target,
    "unmark",
    intervalA,
    "2026-07-25T19:03:00.000Z"
  );
  const externalA = mutateCommit(
    repository.findByKind("external-file"),
    external.target,
    "mark",
    intervalA,
    "2026-07-25T19:04:00.000Z"
  );
  repository.replaceByKind("workspace", workspaceEmpty);
  repository.replaceByKind("external-file", externalA);

  currentTime = "2026-07-25T19:05:00.000Z";
  const recovered = await provider.open(descriptor(true));
  assert.deepEqual(reviewed(recovered), []);
});

test("writable open performs one active-owner Git inspection", async () => {
  const repository = new RecordingRepository();
  const inspector = new CountingGitInspector(repositoryInspection());
  const provider = createProvider(
    repository,
    inspector,
    () => new Date("2026-07-25T20:00:00.000Z")
  );

  await provider.open(descriptor(true));
  assert.equal(inspector.invocationCount, 1);
});

const findContextFile = async (
  directory: string,
  contextId: string
): Promise<string | undefined> => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findContextFile(candidate, contextId);
      if (nested !== undefined) {
        return nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as Record<string, unknown>;
      if (parsed.contextId === contextId) {
        return candidate;
      }
    } catch {
      // Ignore non-state JSON while searching the generated storage tree.
    }
  }
  return undefined;
};

test("filesystem persistence round-trips and validates owner reconciliation metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-owner-reconciliation-"));
  const repositoryId = "github.com/example/project";
  const contextId = "branch-context:r5";
  const target: ReviewStateRepositoryTarget = {
    kind: "git",
    repositoryId,
    contextId
  };
  const snapshot = {
    sourceOwner: "workspace" as const,
    sourceRepositoryId: "workspace-repository:r5",
    sourceContextId: "workspace-context:r5",
    sourceFileId: "workspace-file:r5",
    contentHash: "hash-current",
    lineCount: 8,
    reviewed: [intervalA],
    sourceCreatedAt: "2026-07-25T21:00:00.000Z",
    sourceUpdatedAt: "2026-07-25T21:01:00.000Z"
  };
  const commit = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId,
      kind: "branch",
      repositoryId,
      displayName: "feature/document-routing",
      branch: {
        refName: "refs/heads/feature/document-routing",
        headRevision: "0123456789abcdef0123456789abcdef01234567"
      },
      files: {},
      ownerReconciliation: {
        "owner-source:test": snapshot
      },
      createdAt: "2026-07-25T21:00:00.000Z",
      updatedAt: "2026-07-25T21:01:00.000Z"
    },
    globalState: {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId,
      currentRevisionId: "0123456789abcdef0123456789abcdef01234567",
      files: {},
      updatedAt: "2026-07-25T21:01:00.000Z"
    }
  } as unknown as ReviewStateCommit;
  const options = {
    storageUris: {
      globalStorageUri: { fsPath: path.join(root, "global") }
    }
  };

  try {
    const writer = new FileSystemReviewStateRepository(options);
    await writer.save(target, commit);
    const reader = new FileSystemReviewStateRepository(options);
    assert.deepEqual(await reader.load(target), commit);

    const contextFile = await findContextFile(root, contextId);
    assert.ok(contextFile, "expected persisted context JSON");
    const malformed = JSON.parse(
      await readFile(contextFile, "utf8")
    ) as Record<string, unknown>;
    const reconciliation = malformed.ownerReconciliation as Record<
      string,
      Record<string, unknown>
    >;
    reconciliation["owner-source:test"]!.lineCount = -1;
    await writeFile(contextFile, `${JSON.stringify(malformed, null, 2)}\n`, "utf8");

    const malformedReader = new FileSystemReviewStateRepository(options);
    await assert.rejects(
      malformedReader.load(target),
      /ownerReconciliation.*lineCount|lineCount must/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

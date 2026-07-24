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
import {
  resolveReviewStateStorageRoute,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import {
  WorkspaceReviewStateSessionProvider
} from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

const occurredAt = "2026-07-24T12:30:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const targetKey = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class FakeRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();
  public readonly loads: ReviewStateRepositoryTarget[] = [];
  public readonly saves: Array<{
    readonly target: ReviewStateRepositoryTarget;
    readonly commit: ReviewStateCommit;
  }> = [];

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    this.loads.push({ ...target });
    const current = this.commits.get(targetKey(target));
    return current === undefined ? undefined : clone(current);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.saves.push({ target: { ...target }, commit: clone(commit) });
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
      contextState: clone(transaction.next.contextState),
      globalState: clone(transaction.next.globalState)
    } as ReviewStateCommit);
  }
}

class FakeGitInspector implements DocumentGitInspector {
  public constructor(public result: LocalGitRepositoryInspection) {}

  public readonly inspectedPaths: string[] = [];

  public async inspectRepository(
    startPath: string
  ): Promise<LocalGitRepositoryInspection> {
    this.inspectedPaths.push(startPath);
    return clone(this.result);
  }
}

const nonRepository = (): LocalGitRepositoryInspection => ({
  kind: "not-repository",
  gitVersion: "2.50.0"
});

const repositoryInspection = (
  overrides: Partial<Extract<LocalGitRepositoryInspection, { kind: "repository" }>["repository"]> = {}
): LocalGitRepositoryInspection => ({
  kind: "repository",
  repository: {
    gitVersion: "2.50.0",
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
    head: "0123456789abcdef0123456789abcdef01234567",
    ...overrides
  }
});

const descriptor = (
  overrides: Partial<DocumentEditorReviewDescriptor> = {}
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/example.ts"
  },
  documentFsPath: path.resolve("/repo/src/example.ts"),
  fileSystemPathSemantics: "posix",
  lineCount: 8,
  contentHash: "hash-current",
  ...overrides
});

const workspaceDescriptor = (): NonNullable<DocumentEditorReviewDescriptor["workspace"]> => ({
  workspaceFolderUri: {
    scheme: "file",
    authority: "",
    path: "/repo"
  },
  relativePath: "src/example.ts",
  displayName: "Project workspace"
});

const createProvider = (
  repository: FakeRepository,
  gitInspector: FakeGitInspector
): DocumentReviewStateSessionProvider => {
  const stableHash = new NodeSha256StableHash();
  const workspaceProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
    now: () => new Date(occurredAt)
  });

  return new DocumentReviewStateSessionProvider({
    gitInspector,
    repository,
    workspaceProvider,
    stableHash,
    now: () => new Date(occurredAt)
  });
};

const markReviewed = async (
  session: Awaited<ReturnType<DocumentReviewStateSessionProvider["open"]>>,
  startLine = 1,
  endLineExclusive = 4
): Promise<void> => {
  const transaction = markReviewedRanges({
    contextState: session.contextState,
    globalState: session.globalState,
    target: session.target,
    intervals: [{ startLine, endLineExclusive }],
    occurredAt
  });
  await session.committer.commit(transaction);
};

test("Git ownership routes a workspace-external file to the branch repository", async () => {
  const repository = new FakeRepository();
  const gitInspector = new FakeGitInspector(repositoryInspection());
  const provider = createProvider(repository, gitInspector);

  const session = await provider.open(descriptor());

  assert.equal(session.owner, "git");
  assert.equal(session.contextState.kind, "branch");
  assert.equal(session.contextState.repositoryId, "github.com/example/project");
  assert.equal(session.contextState.branch?.refName, "refs/heads/feature/issue-13");
  assert.equal(session.target.currentPath, "src/example.ts");
  assert.equal(repository.loads[0]?.kind, "git");
  assert.equal(gitInspector.inspectedPaths[0], path.dirname(path.resolve("/repo/src/example.ts")));
});

test("Git ownership wins even when the file belongs to the current workspace", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(
    repository,
    new FakeGitInspector(repositoryInspection())
  );

  const session = await provider.open(descriptor({ workspace: workspaceDescriptor() }));

  assert.equal(session.owner, "git");
  assert.equal(repository.loads.some((target) => target.kind === "git"), true);
  assert.equal(repository.loads.some((target) => target.kind === "workspace"), true);
});

test("a non-Git workspace file keeps workspace-local persistence", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository, new FakeGitInspector(nonRepository()));

  const session = await provider.open(descriptor({ workspace: workspaceDescriptor() }));

  assert.equal(session.owner, "workspace");
  assert.equal(session.contextState.kind, "workspace");
  assert.equal(repository.loads.at(-1)?.kind, "workspace");
});

test("an accessible non-Git external UNC file keeps its authority in global identity", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository, new FakeGitInspector(nonRepository()));

  const session = await provider.open(descriptor({
    documentUri: {
      scheme: "file",
      authority: "BuildServer",
      path: "/Share/Source/Example.ts"
    },
    documentFsPath: "//BuildServer/Share/Source/Example.ts",
    fileSystemPathSemantics: "windows"
  }));

  assert.equal(session.owner, "external-file");
  assert.equal(session.contextState.kind, "external-file");
  assert.equal(
    session.contextState.externalFile?.canonicalUri,
    "file://buildserver/share/source/example.ts"
  );
  assert.equal(session.target.currentPath, "file://buildserver/share/source/example.ts");
  assert.equal(repository.loads[0]?.kind, "external-file");
});

test("external reviewed ranges are promoted when the same non-Git file joins a workspace", async () => {
  const repository = new FakeRepository();
  const gitInspector = new FakeGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector);

  const external = await provider.open(descriptor());
  await markReviewed(external, 2, 5);

  const workspace = await provider.open(descriptor({ workspace: workspaceDescriptor() }));

  assert.equal(workspace.owner, "workspace");
  assert.deepEqual(
    workspace.contextState.files[workspace.target.fileId]?.modifiedReviewed,
    [{ startLine: 2, endLineExclusive: 5 }]
  );
  assert.deepEqual(
    workspace.globalState.files[workspace.target.fileId]?.reviewed,
    [{ startLine: 2, endLineExclusive: 5 }]
  );
});

test("workspace reviewed ranges are promoted when Git ownership is detected later", async () => {
  const repository = new FakeRepository();
  const gitInspector = new FakeGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector);

  const workspace = await provider.open(descriptor({ workspace: workspaceDescriptor() }));
  await markReviewed(workspace, 0, 3);

  gitInspector.result = repositoryInspection();
  const git = await provider.open(descriptor({ workspace: workspaceDescriptor() }));

  assert.equal(git.owner, "git");
  assert.deepEqual(
    git.contextState.files[git.target.fileId]?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
});

test("promotion does not copy ranges when current content differs", async () => {
  const repository = new FakeRepository();
  const gitInspector = new FakeGitInspector(nonRepository());
  const provider = createProvider(repository, gitInspector);

  const external = await provider.open(descriptor({ contentHash: "hash-old" }));
  await markReviewed(external, 1, 6);

  const workspace = await provider.open(descriptor({
    workspace: workspaceDescriptor(),
    contentHash: "hash-new"
  }));

  assert.equal(workspace.owner, "workspace");
  assert.equal(workspace.contextState.files[workspace.target.fileId], undefined);
  assert.equal(workspace.globalState.files[workspace.target.fileId], undefined);
});

test("decoration lookup for an unseen external file remains read-only", async () => {
  const repository = new FakeRepository();
  const provider = createProvider(repository, new FakeGitInspector(nonRepository()));

  const state = await provider.loadForDecoration(descriptor());

  assert.equal(state, undefined);
  assert.equal(repository.saves.length, 0);
});

test("external-file persistence uses a separate globalStorageUri subtree", () => {
  const route = resolveReviewStateStorageRoute(
    {
      globalStorageUri: { fsPath: path.resolve("/state/global") },
      storageUri: { fsPath: path.resolve("/state/workspace") }
    },
    {
      kind: "external-file",
      repositoryId: "external-file-repository:abc",
      contextId: "external-file-context:def"
    }
  );

  assert.equal(route.storageKind, "repository");
  assert.equal(path.basename(path.dirname(route.rootPath)), "external-files");
  assert.equal(route.statePointerPath, path.join(route.rootPath, "manifest.json"));
});

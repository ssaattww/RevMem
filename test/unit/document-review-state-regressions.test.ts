import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import type {
  LocalGitRepositoryInspection
} from "../../src/adapters/local-git/index";
import {
  FileSystemReviewStateRepository,
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import {
  WorkspaceReviewStateSessionProvider
} from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

const occurredAt = "2026-07-24T12:45:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemoryRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();

  private key(target: ReviewStateRepositoryTarget): string {
    return `${target.kind}\0${target.repositoryId}\0${target.contextId}`;
  }

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const commit = this.commits.get(this.key(target));
    return commit === undefined ? undefined : clone(commit);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.commits.set(this.key(target), clone(commit));
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    const entry = [...this.commits.entries()].find(([, commit]) =>
      commit.contextState.repositoryId === transaction.repositoryId &&
      commit.contextState.contextId === transaction.contextId
    );
    assert.ok(entry);
    this.commits.set(entry[0], {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone(transaction.next.contextState),
      globalState: clone(transaction.next.globalState)
    } as ReviewStateCommit);
  }
}

class FixedGitInspector implements DocumentGitInspector {
  public constructor(
    private readonly result: LocalGitRepositoryInspection | Error
  ) {}

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    if (this.result instanceof Error) {
      throw this.result;
    }
    return clone(this.result);
  }
}

const nonRepository = (): LocalGitRepositoryInspection => ({
  kind: "not-repository",
  gitVersion: "2.55.0"
});

const windowsRepository = (): LocalGitRepositoryInspection => ({
  kind: "repository",
  repository: {
    gitVersion: "2.55.0",
    rootPath: "C:\\Repo",
    repositoryId: "github.com/example/project",
    branch: {
      kind: "branch",
      fullRef: "refs/heads/main"
    },
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
});

const descriptor = (
  overrides: Partial<DocumentEditorReviewDescriptor> = {}
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/outside/example.ts"
  },
  documentFsPath: "/outside/example.ts",
  fileSystemPathSemantics: "posix",
  lineCount: 6,
  contentHash: "hash-current",
  ...overrides
});

const createProvider = (
  repository: DocumentReviewStateRepository,
  gitInspector: DocumentGitInspector
): DocumentReviewStateSessionProvider => {
  const stableHash = new NodeSha256StableHash();
  return new DocumentReviewStateSessionProvider({
    gitInspector,
    repository,
    workspaceProvider: new WorkspaceReviewStateSessionProvider({
      identityService: new WorkspaceIdentityService(stableHash),
      repository,
      now: () => new Date(occurredAt)
    }),
    stableHash,
    now: () => new Date(occurredAt)
  });
};

test("external-file context retains canonical URI and snapshot revision", async () => {
  const provider = createProvider(
    new MemoryRepository(),
    new FixedGitInspector(nonRepository())
  );

  const session = await provider.open(descriptor());

  assert.equal(session.contextState.kind, "external-file");
  assert.equal(
    session.contextState.externalFile?.canonicalUri,
    "file:///outside/example.ts"
  );
  assert.equal(
    session.contextState.workspace?.snapshotRevision,
    session.target.revisionId
  );
});

test("Windows Git file identity normalizes drive, case, and separator variations", async () => {
  const repository = new MemoryRepository();
  const provider = createProvider(
    repository,
    new FixedGitInspector(windowsRepository())
  );

  const first = await provider.open(descriptor({
    documentUri: {
      scheme: "file",
      authority: "",
      path: "/C:/Repo/Src/Example.ts"
    },
    documentFsPath: "C:\\Repo\\Src\\Example.ts",
    fileSystemPathSemantics: "windows"
  }));
  const second = await provider.open(descriptor({
    documentUri: {
      scheme: "file",
      authority: "",
      path: "/c:/repo/src/example.ts"
    },
    documentFsPath: "c:/repo/src/example.ts",
    fileSystemPathSemantics: "windows"
  }));

  assert.equal(first.target.currentPath, "src/example.ts");
  assert.equal(second.target.currentPath, "src/example.ts");
  assert.equal(first.target.fileId, second.target.fileId);
});

test("unexpected Git inspection failures do not fall back to a non-Git owner", async () => {
  const provider = createProvider(
    new MemoryRepository(),
    new FixedGitInspector(new Error("Git working tree is unreadable"))
  );

  await assert.rejects(
    provider.open(descriptor()),
    /Git working tree is unreadable/
  );
});

test("external-file reviewed ranges survive repository and provider restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-external-restart-"));
  const storageUris = {
    globalStorageUri: { fsPath: path.join(root, "global") }
  };

  try {
    const firstRepository = new FileSystemReviewStateRepository({ storageUris });
    const firstProvider = createProvider(
      firstRepository,
      new FixedGitInspector(nonRepository())
    );
    const first = await firstProvider.open(descriptor());
    await first.committer.commit(markReviewedRanges({
      contextState: first.contextState,
      globalState: first.globalState,
      target: first.target,
      intervals: [{ startLine: 1, endLineExclusive: 4 }],
      occurredAt
    }));

    const secondRepository = new FileSystemReviewStateRepository({ storageUris });
    const secondProvider = createProvider(
      secondRepository,
      new FixedGitInspector(nonRepository())
    );
    const restored = await secondProvider.open(descriptor());

    assert.deepEqual(
      restored.contextState.files[restored.target.fileId]?.modifiedReviewed,
      [{ startLine: 1, endLineExclusive: 4 }]
    );
    assert.deepEqual(
      restored.globalState.files[restored.target.fileId]?.reviewed,
      [{ startLine: 1, endLineExclusive: 4 }]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

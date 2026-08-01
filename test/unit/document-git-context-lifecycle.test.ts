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
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index";
import type { GitRevisionMappingSource } from "../../src/application/review-context/index";
import {
  type ReviewStateCommit,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

const oldRevision = "0123456789abcdef0123456789abcdef01234567";
const newRevision = "89abcdef0123456789abcdef0123456789abcdef";
const occurredAt = "2026-08-01T05:10:00.000Z";
const repositoryId = "github.com/example/review-range";
const clone = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const keyOf = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class MemoryRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const value = this.commits.get(keyOf(target));
    return value === undefined ? undefined : clone<ReviewStateCommit>(value);
  }

  public async loadGlobal(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit["globalState"] | undefined> {
    const value = [...this.commits.values()].find(
      (commit) => commit.globalState.repositoryId === target.repositoryId
    );
    return value === undefined
      ? undefined
      : clone<ReviewStateCommit["globalState"]>(value.globalState);
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    this.commits.set(keyOf(target), clone<ReviewStateCommit>(commit));
    for (const [key, current] of this.commits) {
      if (current.globalState.repositoryId === commit.globalState.repositoryId) {
        this.commits.set(key, {
          ...clone<ReviewStateCommit>(current),
          globalState: clone<ReviewStateCommit["globalState"]>(commit.globalState)
        });
      }
    }
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    const targetEntry = [...this.commits.entries()].find(([, commit]) =>
      commit.contextState.repositoryId === transaction.repositoryId &&
      commit.contextState.contextId === transaction.contextId
    );
    assert.ok(targetEntry);
    const [targetKey] = targetEntry;
    const next: ReviewStateCommit = {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone<ReviewStateCommit["contextState"]>(
        transaction.next.contextState
      ),
      globalState: clone<ReviewStateCommit["globalState"]>(
        transaction.next.globalState
      )
    };
    this.commits.set(targetKey, next);
    for (const [key, current] of this.commits) {
      if (current.globalState.repositoryId === transaction.repositoryId) {
        this.commits.set(key, {
          ...clone<ReviewStateCommit>(current),
          globalState: clone<ReviewStateCommit["globalState"]>(next.globalState)
        });
      }
    }
  }
}

class MutableGitInspector implements DocumentGitInspector {
  public branch: Extract<
    Extract<LocalGitRepositoryInspection, { kind: "repository" }>["repository"]["branch"],
    { kind: "branch" }
  > | { readonly kind: "detached" } = {
    kind: "branch",
    fullRef: "refs/heads/main"
  };
  public head = oldRevision;

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    return {
      kind: "repository",
      repository: {
        gitVersion: "2.55.0",
        rootPath: path.resolve("/repo"),
        repositoryId,
        branch: clone(this.branch),
        head: this.head
      }
    };
  }
}

class RevisionSource implements GitRevisionMappingSource {
  public diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -2 +2 @@",
    "-beta",
    "+BETA",
    ""
  ].join("\n");

  public readonly texts = new Map<string, string>([
    [`${oldRevision}\0src/example.ts`, "alpha\nbeta\ngamma"],
    [`${newRevision}\0src/example.ts`, "alpha\nBETA\ngamma"]
  ]);

  public async objectExists(): Promise<boolean> {
    return true;
  }

  public async diffRevisions(): Promise<string> {
    return this.diff;
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    const content = this.texts.get(`${revision}\0${repositoryRelativePath}`);
    return content === undefined
      ? { kind: "missing-file" }
      : { kind: "found", content };
  }
}

const descriptor = (
  repositoryRelativePath: string,
  contentHash: string,
  lineCount = 3
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: `/repo/${repositoryRelativePath}`
  },
  documentFsPath: path.resolve(`/repo/${repositoryRelativePath}`),
  fileSystemPathSemantics: "posix",
  lineCount,
  contentHash
});

const createProvider = (
  stableHash: NodeSha256StableHash,
  repository: MemoryRepository,
  inspector: MutableGitInspector,
  source: RevisionSource,
  gitStateObserver?: (rootPath: string, head: string | undefined) => void
): DocumentReviewStateSessionProvider => {
  const workspaceProvider = new WorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
    now: () => new Date(occurredAt)
  });
  return new DocumentReviewStateSessionProvider({
    gitInspector: inspector,
    gitRevisionSource: source,
    ...(gitStateObserver === undefined
      ? {}
      : {
          gitStateObserver: {
            observe: (rootPath, snapshot) => {
              gitStateObserver(rootPath, snapshot.head);
            }
          }
        }),
    repository,
    workspaceProvider,
    stableHash,
    now: () => new Date(occurredAt)
  });
};

/** Provider refreshes a moving branch, isolates branch state, and creates a detached-commit context keyed by immutable HEAD. */
test("document sessions map branch commits and isolate branch and detached contexts", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const observed: Array<{ readonly rootPath: string; readonly head?: string }> = [];
  const provider = createProvider(
    stableHash,
    repository,
    inspector,
    source,
    (rootPath, head) => {
      observed.push({ rootPath, ...(head === undefined ? {} : { head }) });
    }
  );

  const initial = await provider.open(
    descriptor(
      "src/example.ts",
      stableHash.digest("alpha\nbeta\ngamma")
    )
  );
  const initialContextId = initial.contextState.contextId;
  const reviewed = markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt
  });
  await initial.committer.commit(reviewed);

  inspector.head = newRevision;
  const refreshed = await provider.open(
    descriptor(
      "src/example.ts",
      stableHash.digest("alpha\nBETA\ngamma")
    )
  );
  assert.equal(refreshed.contextState.contextId, initialContextId);
  assert.equal(refreshed.contextState.branch?.headRevision, newRevision);
  assert.deepEqual(
    refreshed.contextState.files[refreshed.target.fileId]?.modifiedReviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );

  inspector.branch = {
    kind: "branch",
    fullRef: "refs/heads/feature/t205"
  };
  const feature = await provider.open(
    descriptor(
      "src/example.ts",
      stableHash.digest("alpha\nBETA\ngamma")
    )
  );
  assert.notEqual(feature.contextState.contextId, initialContextId);
  assert.equal(feature.contextState.branch?.refName, "refs/heads/feature/t205");
  assert.equal(feature.contextState.files[feature.target.fileId], undefined);
  assert.deepEqual(
    feature.globalState.files[feature.target.fileId]?.reviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );

  inspector.branch = { kind: "detached" };
  const detached = await provider.open(
    descriptor(
      "src/example.ts",
      stableHash.digest("alpha\nBETA\ngamma")
    )
  );
  assert.equal(detached.contextState.kind, "branch");
  assert.equal(detached.contextState.branch?.refName, `HEAD@${newRevision}`);
  assert.equal(detached.contextState.branch?.headRevision, newRevision);
  assert.notEqual(detached.contextState.contextId, feature.contextState.contextId);
  assert.equal(detached.contextState.files[detached.target.fileId], undefined);

  assert.equal(observed.length, 4);
  assert.equal(observed.at(-1)?.head, newRevision);
  provider.dispose();
});

/** A unique Git rename keeps one stable file identity through document routing. */
test("document routing follows the stable file ID after a rename", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 100%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    ""
  ].join("\n");
  source.texts.clear();
  source.texts.set(`${oldRevision}\0src/old.ts`, "alpha\nbeta");
  source.texts.set(`${newRevision}\0src/new.ts`, "alpha\nbeta");
  const provider = createProvider(stableHash, repository, inspector, source);

  const initial = await provider.open(
    descriptor("src/old.ts", stableHash.digest("alpha\nbeta"), 2)
  );
  const reviewed = markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 2 }],
    occurredAt
  });
  await initial.committer.commit(reviewed);

  inspector.head = newRevision;
  const renamed = await provider.open(
    descriptor("src/new.ts", stableHash.digest("alpha\nbeta"), 2)
  );

  assert.equal(renamed.target.fileId, initial.target.fileId);
  assert.equal(renamed.target.currentPath, "src/new.ts");
  assert.equal(
    renamed.contextState.files[initial.target.fileId]?.currentPath,
    "src/new.ts"
  );
  assert.deepEqual(
    renamed.contextState.files[initial.target.fileId]?.previousPaths,
    ["src/old.ts"]
  );
  assert.deepEqual(
    renamed.contextState.files[initial.target.fileId]?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 2 }]
  );
  assert.deepEqual(
    renamed.globalState.files[initial.target.fileId]?.reviewed,
    [{ startLine: 0, endLineExclusive: 2 }]
  );
  provider.dispose();
});

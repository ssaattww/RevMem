import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  DocumentReviewStateSessionProvider,
  type DocumentEditorReviewDescriptor,
  type DocumentGitInspector,
  type DocumentReviewStateRepository
} from "../../src/adapters/document-review-state/index";
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index";
import { NodeNonGitSnapshotCodec } from "../../src/adapters/non-git-snapshots/index";
import type {
  ReviewStateCommit,
  ReviewStateCreateTransactionLike,
  ReviewStateRepositoryTarget,
  ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { SnapshotTrackingWorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import {
  InMemoryNonGitSnapshotStorage,
  NonGitSnapshotTracker,
  type NonGitTrackedFileState,
  type SavedNonGitSnapshot
} from "../../src/application/non-git-snapshots/index";
import type { GitRevisionMappingSource } from "../../src/application/review-context/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import {
  markReviewedRanges,
  unmarkReviewedRanges
} from "../../src/core/review-state/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";
const NOW = "2026-08-06T11:40:00.000Z";
const REPOSITORY_ID = "github.com/example/runtime-rewrite";
const CONTENT = "alpha\nbeta\ngamma";
const clone = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

const keyOf = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class MemoryRepository implements DocumentReviewStateRepository {
  private readonly commits = new Map<string, ReviewStateCommit>();

  public async load(target: ReviewStateRepositoryTarget): Promise<ReviewStateCommit | undefined> {
    const value = this.commits.get(keyOf(target));
    return value === undefined ? undefined : clone(value);
  }

  public async loadGlobal(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit["globalState"] | undefined> {
    const value = [...this.commits.values()].find(
      (commit) => commit.globalState.repositoryId === target.repositoryId
    );
    return value === undefined ? undefined : clone(value.globalState);
  }

  public async save(target: ReviewStateRepositoryTarget, commit: ReviewStateCommit): Promise<void> {
    this.commits.set(keyOf(target), clone(commit));
    this.replaceGlobal(commit);
  }

  public async create(
    transaction: Readonly<ReviewStateCreateTransactionLike>
  ): Promise<void> {
    await this.save({
      kind: "git",
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId
    }, {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone<ReviewStateCommit["contextState"]>(transaction.next.contextState),
      globalState: clone<ReviewStateCommit["globalState"]>(transaction.next.globalState)
    });
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    const entry = [...this.commits.entries()].find(([, commit]) =>
      commit.contextState.repositoryId === transaction.repositoryId &&
      commit.contextState.contextId === transaction.contextId
    );
    assert.ok(entry);
    const next: ReviewStateCommit = {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone<ReviewStateCommit["contextState"]>(transaction.next.contextState),
      globalState: clone<ReviewStateCommit["globalState"]>(transaction.next.globalState)
    };
    this.commits.set(entry[0], next);
    this.replaceGlobal(next);
  }

  private replaceGlobal(commit: ReviewStateCommit): void {
    for (const [key, current] of this.commits) {
      if (current.globalState.repositoryId === commit.globalState.repositoryId) {
        this.commits.set(key, {
          ...clone<ReviewStateCommit>(current),
          globalState: clone<ReviewStateCommit["globalState"]>(commit.globalState)
        });
      }
    }
  }
}

class MutableInspector implements DocumentGitInspector {
  public head = OLD_SHA;

  public async inspectRepository(): Promise<LocalGitRepositoryInspection> {
    return {
      kind: "repository",
      repository: {
        gitVersion: "2.55.0",
        rootPath: "/repo",
        repositoryId: REPOSITORY_ID,
        branch: { kind: "branch", fullRef: "refs/heads/main" },
        head: this.head
      }
    };
  }
}

class RuntimeSource implements GitRevisionMappingSource {
  public oldObjectExists = true;
  public readonly texts = new Map<string, string>([
    [`${OLD_SHA}\0src/example.ts`, CONTENT],
    [`${NEW_SHA}\0src/example.ts`, CONTENT]
  ]);

  public async objectExists(_root: string, objectName: string): Promise<boolean> {
    return objectName === OLD_SHA ? this.oldObjectExists : true;
  }

  public async diffRevisions(): Promise<string> {
    return "";
  }

  public async listFilePathsAtRevision(): Promise<readonly string[]> {
    return ["src/example.ts"];
  }

  public async readTextFileAtRevision(
    _root: string,
    revision: string,
    path: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    const content = this.texts.get(`${revision}\0${path}`);
    return content === undefined
      ? { kind: "missing-file" }
      : { kind: "found", content };
  }
}

class DelayedSnapshotTracker extends NonGitSnapshotTracker {
  private gate:
    | {
        started: () => void;
        wait: Promise<void>;
      }
    | undefined;

  public armNextSave(): { readonly started: Promise<void>; release(): void } {
    let startedResolve!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.gate = { started: startedResolve, wait };
    return { started, release };
  }

  public override async saveLatest(
    state: NonGitTrackedFileState,
    now: number
  ): Promise<SavedNonGitSnapshot> {
    const gate = this.gate;
    if (gate !== undefined) {
      this.gate = undefined;
      gate.started();
      await gate.wait;
    }
    return super.saveLatest(state, now);
  }
}

const descriptor = (hash: string): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: "/repo/src/example.ts"
  },
  documentFsPath: "/repo/src/example.ts",
  fileSystemPathSemantics: "posix",
  lineCount: 3,
  contentHash: hash
});

const setup = (tracker?: NonGitSnapshotTracker) => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableInspector();
  const source = new RuntimeSource();
  const actualTracker = tracker ?? new NonGitSnapshotTracker(
    new InMemoryNonGitSnapshotStorage(),
    new NodeNonGitSnapshotCodec(),
    {
      maxSnapshots: 32,
      maxCompressedBytes: 1024 * 1024,
      retentionMs: 24 * 60 * 60 * 1_000
    }
  );
  const workspaceProvider = new SnapshotTrackingWorkspaceReviewStateSessionProvider({
    identityService: new WorkspaceIdentityService(stableHash),
    repository,
    snapshotTracker: actualTracker,
    resolveContent: () => CONTENT,
    now: () => new Date(NOW)
  });
  const provider = new DocumentReviewStateSessionProvider({
    gitInspector: inspector,
    gitRevisionSource: source,
    repository,
    workspaceProvider,
    stableHash,
    now: () => new Date(NOW)
  });
  return { stableHash, inspector, source, provider, tracker: actualTracker };
};

test("production Git provider publishes snapshots and restores reviewed ranges after the old object disappears", async () => {
  const { stableHash, inspector, source, provider } = setup();

  const initial = await provider.open(descriptor(stableHash.digest(CONTENT)));
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  }));

  source.oldObjectExists = false;
  inspector.head = NEW_SHA;
  const recovered = await provider.open(descriptor(stableHash.digest(CONTENT)));

  assert.deepEqual(
    recovered.contextState.files[recovered.target.fileId]?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
  assert.deepEqual(
    recovered.globalState.files[recovered.target.fileId]?.reviewed,
    [{ startLine: 0, endLineExclusive: 3 }]
  );
  assert.equal(recovered.target.revisionId, NEW_SHA);
  provider.dispose();
});

test("a delayed stale open cannot republish reviewed ranges after a newer unreview commit", async () => {
  const tracker = new DelayedSnapshotTracker(
    new InMemoryNonGitSnapshotStorage(),
    new NodeNonGitSnapshotCodec(),
    {
      maxSnapshots: 64,
      maxCompressedBytes: 1024 * 1024,
      retentionMs: 24 * 60 * 60 * 1_000
    }
  );
  const { stableHash, inspector, source, provider } = setup(tracker);
  const initial = await provider.open(descriptor(stableHash.digest(CONTENT)));
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  }));

  const gate = tracker.armNextSave();
  const staleOpen = provider.open(descriptor(stableHash.digest(CONTENT)));
  await gate.started;

  const newerCommit = initial.committer.commit(unmarkReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  gate.release();
  await Promise.all([newerCommit, staleOpen]);

  source.oldObjectExists = false;
  inspector.head = NEW_SHA;
  const recovered = await provider.open(descriptor(stableHash.digest(CONTENT)));
  assert.deepEqual(
    recovered.contextState.files[recovered.target.fileId]?.modifiedReviewed,
    []
  );
  assert.deepEqual(
    recovered.globalState.files[recovered.target.fileId]?.reviewed,
    []
  );
  provider.dispose();
});

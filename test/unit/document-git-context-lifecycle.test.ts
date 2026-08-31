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
import type { LocalGitRepositoryInspection } from "../../src/adapters/local-git/index";
import type { GitRevisionMappingSource } from "../../src/application/review-context/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  DebouncedReviewStateRepository,
  FileSystemReviewStateRepository,
  StaleReviewStateError,
  type ReviewStateCommit,
  type ReviewStateCreateTransactionLike,
  type ReviewStateRepositoryTarget,
  type ReviewStateTransactionLike
} from "../../src/adapters/state-repository/index";
import { WorkspaceReviewStateSessionProvider } from "../../src/adapters/workspace-review-state/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import { markReviewedRanges } from "../../src/core/review-state/index";

const oldRevision = "0123456789abcdef0123456789abcdef01234567";
const newRevision = "89abcdef0123456789abcdef0123456789abcdef";
const pollRevision = "fedcba9876543210fedcba9876543210fedcba98";
const foregroundRevision = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const occurredAt = "2026-08-01T05:10:00.000Z";
const repositoryId = "github.com/example/review-range";
const clone = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type RepositoryInspection = Extract<
  LocalGitRepositoryInspection,
  { readonly kind: "repository" }
>;
type RepositorySnapshot = RepositoryInspection["repository"];
const keyOf = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class MemoryRepository implements DocumentReviewStateRepository {
  public readonly commits = new Map<string, ReviewStateCommit>();
  public commitCalls = 0;
  public rejectCommits = false;

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

  public async create(
    transaction: Readonly<ReviewStateCreateTransactionLike>
  ): Promise<void> {
    const target: ReviewStateRepositoryTarget = {
      kind: "git",
      repositoryId: transaction.repositoryId,
      contextId: transaction.contextId
    };
    const current = this.commits.get(keyOf(target));
    const currentGlobal = [...this.commits.values()].find(
      (commit) => commit.globalState.repositoryId === transaction.repositoryId
    )?.globalState;
    if (
      current !== undefined ||
      JSON.stringify(currentGlobal) !== JSON.stringify(transaction.expected.globalState)
    ) {
      throw new Error("Memory create expectation is stale.");
    }
    await this.save(target, {
      schemaVersion: transaction.next.contextState.schemaVersion,
      contextState: clone<ReviewStateCommit["contextState"]>(
        transaction.next.contextState
      ),
      globalState: clone<ReviewStateCommit["globalState"]>(
        transaction.next.globalState
      )
    });
  }

  public async commit(
    transaction: Readonly<ReviewStateTransactionLike>
  ): Promise<void> {
    this.commitCalls += 1;
    if (this.rejectCommits) {
      throw new StaleReviewStateError({
        kind: "git",
        repositoryId: transaction.repositoryId,
        contextId: transaction.contextId
      });
    }
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

  public async inspectRepository(
    _startPath = ""
  ): Promise<LocalGitRepositoryInspection> {
    void _startPath;
    return {
      kind: "repository",
      repository: {
        gitVersion: "2.55.0",
        rootPath: "/repo",
        repositoryId,
        branch: clone(this.branch),
        head: this.head
      }
    };
  }
}

class RevisionSource implements GitRevisionMappingSource {
  public objectsExist = true;
  public diffCalls = 0;
  public rejectSecondDiff = false;
  public readonly encodingHints: Array<readonly [string, string | undefined]> = [];
  public readonly invalidTextPaths = new Set<string>();
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
    return this.objectsExist;
  }

  public async diffRevisions(
    _repositoryRoot: string,
    _leftRevision: string,
    _rightRevision: string
  ): Promise<string> {
    void _repositoryRoot;
    void _leftRevision;
    void _rightRevision;
    this.diffCalls += 1;
    if (this.rejectSecondDiff && this.diffCalls > 1) {
      throw new Error("The hit layer must not invoke diff mapping.");
    }
    return this.diff;
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string,
    _fileSystemPathSemantics?: "posix" | "windows",
    _feedbackContext?: unknown,
    _signal?: AbortSignal,
    encodingHint?: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    this.encodingHints.push([repositoryRelativePath, encodingHint]);
    if (this.invalidTextPaths.has(repositoryRelativePath)) {
      return { kind: "invalid-encoding" as const, encoding: "utf-8" as const };
    }
    const content = this.texts.get(`${revision}\0${repositoryRelativePath}`);
    return content === undefined
      ? { kind: "missing-file" }
      : { kind: "found", content };
  }
}

class PollingRaceGitInspector extends MutableGitInspector {
  public pollSnapshot: RepositorySnapshot | undefined;
  public foregroundSnapshot: RepositorySnapshot | undefined;

  public override async inspectRepository(
    startPath = ""
  ): Promise<LocalGitRepositoryInspection> {
    const polled = startPath === "/repo" ? this.pollSnapshot : undefined;
    if (polled !== undefined) {
      this.pollSnapshot = undefined;
      return { kind: "repository", repository: clone(polled) };
    }
    if (this.foregroundSnapshot !== undefined) {
      return { kind: "repository", repository: clone(this.foregroundSnapshot) };
    }
    return super.inspectRepository();
  }
}

class BlockingRevisionSource extends RevisionSource {
  public readonly mappingStarted = createDeferred();
  public readonly releaseMapping = createDeferred();
  public blockMapping = false;

  public override async diffRevisions(
    repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string> {
    if (this.blockMapping) {
      this.mappingStarted.resolve();
      await this.releaseMapping.promise;
    }
    return super.diffRevisions(repositoryRoot, leftRevision, rightRevision);
  }
}

class PollingRaceRevisionSource extends RevisionSource {
  public readonly mappingStarted = createDeferred();
  public readonly releaseMapping = createDeferred();
  public blockRevision: string | undefined;

  public override async diffRevisions(
    _repositoryRoot: string,
    _leftRevision: string,
    rightRevision: string
  ): Promise<string> {
    if (rightRevision === this.blockRevision) {
      this.mappingStarted.resolve();
      await this.releaseMapping.promise;
    }
    return this.diff;
  }
}

const createDeferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const descriptor = (
  repositoryRelativePath: string,
  contentHash: string,
  lineCount = 3,
  encodingHint?: string
): DocumentEditorReviewDescriptor => ({
  documentUri: {
    scheme: "file",
    authority: "",
    path: `/repo/${repositoryRelativePath}`
  },
  documentFsPath: `/repo/${repositoryRelativePath}`,
  fileSystemPathSemantics: "posix",
  lineCount,
  contentHash,
  ...(encodingHint === undefined ? {} : { encodingHint })
});

const createProvider = (
  stableHash: NodeSha256StableHash,
  repository: DocumentReviewStateRepository,
  inspector: MutableGitInspector,
  source: RevisionSource,
  gitStateObserver?: (rootPath: string, head: string | undefined) => void,
  historyRecorder?: ReviewHistoryRecorder
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
    now: () => new Date(occurredAt),
    ...(historyRecorder === undefined ? {} : { historyRecorder })
  });
};

const withOneTargetSnapshotLayer = (
  commit: ReviewStateCommit,
  fileId: string,
  layer: "context" | "global",
  stableHash: NodeSha256StableHash
): ReviewStateCommit => {
  const targetHash = stableHash.digest("alpha\nBETA\ngamma");
  const contextTargetFile = {
    ...commit.contextState.files[fileId]!,
    revisionId: newRevision,
    contentHash: targetHash,
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }]
  };
  const globalTargetFile = {
    ...commit.globalState.files[fileId]!,
    revisionId: newRevision,
    contentHash: targetHash,
    reviewed: [{ startLine: 0, endLineExclusive: 3 }]
  };
  return {
    schemaVersion: commit.schemaVersion,
    contextState: layer === "context"
      ? {
          ...commit.contextState,
          revisionSnapshots: {
            ...commit.contextState.revisionSnapshots,
            [newRevision]: {
              schemaVersion: commit.contextState.schemaVersion,
              revisionId: newRevision,
              files: { [fileId]: contextTargetFile },
              updatedAt: occurredAt
            }
          }
        }
      : clone<ReviewStateCommit["contextState"]>(commit.contextState),
    globalState: layer === "global"
      ? {
          ...commit.globalState,
          revisionSnapshots: {
            ...commit.globalState.revisionSnapshots,
            [newRevision]: {
              schemaVersion: commit.globalState.schemaVersion,
              revisionId: newRevision,
              files: { [fileId]: globalTargetFile },
              updatedAt: occurredAt
            }
          }
        }
      : clone<ReviewStateCommit["globalState"]>(commit.globalState)
  };
};

/** Mixed immutable snapshot layers compose into one local-Git CAS and publish an explicit history disposition. */
test("Git provider restores each mixed target snapshot layer in one CAS", async () => {
  for (const scenario of [
    {
      layer: "context" as const,
      expectedContext: [{ startLine: 0, endLineExclusive: 3 }],
      expectedGlobal: [
        { startLine: 0, endLineExclusive: 1 },
        { startLine: 2, endLineExclusive: 3 }
      ]
    },
    {
      layer: "global" as const,
      expectedContext: [
        { startLine: 0, endLineExclusive: 1 },
        { startLine: 2, endLineExclusive: 3 }
      ],
      expectedGlobal: [{ startLine: 0, endLineExclusive: 3 }]
    }
  ] as const) {
    const stableHash = new NodeSha256StableHash();
    const repository = new MemoryRepository();
    const inspector = new MutableGitInspector();
    const source = new RevisionSource();
    const events: Array<{ readonly type: string; readonly reason: string }> = [];
    const provider = createProvider(stableHash, repository, inspector, source, undefined,
      new ReviewHistoryRecorder({
        sessionId: "session",
        createEventId: () => `event-${events.length}`,
        appender: { append: async (_target, event) => { events.push(event); } }
      }));
    const initial = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
    );
    await initial.committer.commit(markReviewedRanges({
      contextState: initial.contextState,
      globalState: initial.globalState,
      target: initial.target,
      intervals: [{ startLine: 0, endLineExclusive: 3 }],
      occurredAt
    }));
    const persisted = await repository.load({
      kind: "git", repositoryId, contextId: initial.contextState.contextId
    });
    assert.ok(persisted);
    await repository.save(
      { kind: "git", repositoryId, contextId: initial.contextState.contextId },
      withOneTargetSnapshotLayer(persisted, initial.target.fileId, scenario.layer, stableHash)
    );
    const commitCallsBeforeTransition = repository.commitCalls;
    events.length = 0;
    source.diffCalls = 0;
    source.rejectSecondDiff = true;
    inspector.head = newRevision;

    const opened = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))
    );

    assert.deepEqual(opened.contextState.files[opened.target.fileId]?.modifiedReviewed, scenario.expectedContext);
    assert.deepEqual(opened.globalState.files[opened.target.fileId]?.reviewed, scenario.expectedGlobal);
    assert.equal(repository.commitCalls, commitCallsBeforeTransition + 1, scenario.layer);
    assert.equal(source.diffCalls, 1, scenario.layer);
    assert.ok(events.some((event) =>
      event.type === "context-revision-changed" && event.reason === "exact-revision-snapshot-mixed"
    ));
    assert.deepEqual(
      opened.contextState.revisionSnapshots?.[newRevision]?.files,
      opened.contextState.files
    );
    assert.deepEqual(
      opened.globalState.revisionSnapshots?.[newRevision]?.files,
      opened.globalState.files
    );
    provider.dispose();
  }
});

/** A present target snapshot with mismatched immutable evidence rejects before any local-Git state publication. */
test("Git provider rejects an invalid present target snapshot without fallback CAS or history", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const events: Array<{ readonly type: string; readonly reason: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt
  }));
  const target = { kind: "git" as const, repositoryId, contextId: initial.contextState.contextId };
  const persisted = await repository.load(target);
  assert.ok(persisted);
  const withTargetSnapshot = withOneTargetSnapshotLayer(
    persisted,
    initial.target.fileId,
    "context",
    stableHash,
  );
  const corrupted = {
    ...withTargetSnapshot,
    contextState: {
      ...withTargetSnapshot.contextState,
      revisionSnapshots: {
        ...withTargetSnapshot.contextState.revisionSnapshots,
        [newRevision]: {
          ...withTargetSnapshot.contextState.revisionSnapshots![newRevision]!,
          files: {
            [initial.target.fileId]: {
              ...withTargetSnapshot.contextState.revisionSnapshots![newRevision]!.files[initial.target.fileId]!,
              contentHash: "mismatched-immutable-content",
            },
          },
        },
      },
    },
  };
  await repository.save(target, corrupted);
  const before = await repository.load(target);
  const commitCallsBefore = repository.commitCalls;
  events.length = 0;
  inspector.head = newRevision;

  await assert.rejects(
    () => provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))),
    /snapshot|immutable evidence|content hash/i,
  );
  assert.equal(repository.commitCalls, commitCallsBefore);
  assert.deepEqual(await repository.load(target), before);
  assert.deepEqual(events, []);
  provider.dispose();
});

/** A present snapshot whose authoritative target text cannot be read must not fall back to mapping. */
test("Git provider rejects an unreadable present target snapshot without fallback CAS or history", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const events: Array<{ readonly type: string; readonly reason: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt
  }));
  const target = { kind: "git" as const, repositoryId, contextId: initial.contextState.contextId };
  const persisted = await repository.load(target);
  assert.ok(persisted);
  await repository.save(
    target,
    withOneTargetSnapshotLayer(persisted, initial.target.fileId, "context", stableHash)
  );
  const before = await repository.load(target);
  const commitCallsBefore = repository.commitCalls;
  events.length = 0;
  source.invalidTextPaths.add("src/example.ts");
  inspector.head = newRevision;

  await assert.rejects(
    () => provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))),
    /snapshot|immutable evidence|unavailable/i,
  );
  assert.equal(repository.commitCalls, commitCallsBefore);
  assert.deepEqual(await repository.load(target), before);
  assert.deepEqual(events, []);
  provider.dispose();
});

/** A stale CAS rejects a local-Git revision transition before state or history becomes observable. */
test("Git provider does not publish mixed snapshot state or history after a CAS conflict", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const events: Array<{ readonly type: string; readonly reason: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt
  }));
  const persisted = await repository.load({
    kind: "git", repositoryId, contextId: initial.contextState.contextId
  });
  assert.ok(persisted);
  await repository.save(
    { kind: "git", repositoryId, contextId: initial.contextState.contextId },
    withOneTargetSnapshotLayer(persisted, initial.target.fileId, "context", stableHash)
  );
  const beforeConflict = await repository.load({
    kind: "git", repositoryId, contextId: initial.contextState.contextId
  });
  const commitCallsBeforeConflict = repository.commitCalls;
  events.length = 0;
  repository.rejectCommits = true;
  inspector.head = newRevision;

  await assert.rejects(
    provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))),
    (error: unknown) => error instanceof StaleReviewStateError
  );

  assert.equal(repository.commitCalls, commitCallsBeforeConflict + 3);
  assert.deepEqual(
    await repository.load({ kind: "git", repositoryId, contextId: initial.contextState.contextId }),
    beforeConflict
  );
  assert.deepEqual(events, []);
  provider.dispose();
});

test("Git provider records an unresolved mapping event after a conservative missing-object clear", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const events: Array<{ readonly type: string; readonly reason: string }> = [];
  const recorder = new ReviewHistoryRecorder({
    sessionId: "session",
    createEventId: () => `event-${events.length}`,
    appender: { append: async (_target, event) => { events.push(event); } }
  });
  const provider = createProvider(stableHash, repository, inspector, source, undefined, recorder);
  const initial = await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma")));
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  const persistedInitial = await repository.load({
    kind: "git",
    repositoryId,
    contextId: initial.contextState.contextId
  });
  assert.deepEqual(
    persistedInitial?.contextState.revisionSnapshots?.[oldRevision]?.files,
    persistedInitial?.contextState.files
  );
  assert.deepEqual(
    persistedInitial?.globalState.revisionSnapshots?.[oldRevision]?.files,
    persistedInitial?.globalState.files
  );
  inspector.head = newRevision;
  source.objectsExist = false;

  await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma")));

  assert.ok(events.some((event) => event.type === "mapping-unresolved" && event.reason === "mapping-unresolved"));
  provider.dispose();
});

test("Git provider records binary mapping as unresolved instead of a successful remap", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "Binary files a/src/example.ts and b/src/example.ts differ",
    ""
  ].join("\n");
  const events: Array<{ readonly type: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));
  const initial = await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma")));
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  inspector.head = newRevision;
  await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma")));
  assert.ok(events.some((event) => event.type === "mapping-unresolved"));
  assert.equal(events.some((event) => event.type === "remapped-by-diff"), false);
  provider.dispose();
});

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

test("T609-NR-005 records a generic unresolved history reason for a failed current-revision text refresh", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const events: Array<{ readonly type: string; readonly reason: string; readonly filePath?: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"), 3, "utf8")
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  source.invalidTextPaths.add("src/example.ts");
  events.length = 0;

  await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"), 3, "shift_jis")
  );

  assert.ok(events.some((event) =>
    event.type === "mapping-unresolved" && event.reason === "immutable-text-unavailable"
  ));
  assert.equal(events.some((event) => event.type === "remapped-by-diff"), false);
  assert.doesNotMatch(JSON.stringify(events), /shift_jis|src\\example\.ts/u);
  provider.dispose();
});

/** An opened document changing encoding must re-read its immutable revision without reopening the host. */
test("document routing recalculates the current Git snapshot when an opened encoding hint changes", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const provider = createProvider(stableHash, repository, inspector, source);
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"), 3, "utf8")
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  inspector.head = newRevision;
  await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "utf8")
  );
  source.encodingHints.length = 0;

  await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "shift_jis")
  );

  assert.ok(source.encodingHints.some(([path, hint]) => path === "src/example.ts" && hint === "shift_jis"));
  provider.dispose();
});

/** The production session provider must invalidate only the stable file whose VS Code decoding changed. */
test("T609 production Git document session clears a same-revision encoding transition without changing an unrelated BOM file", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.texts.set(`${oldRevision}\0src/shifted.txt`, "UTF-8 view\n");
  source.texts.set(`${oldRevision}\0src/utf8-bom.txt`, "BOM text\n");
  const originalRead = source.readTextFileAtRevision.bind(source);
  source.readTextFileAtRevision = async (...args) => {
    const [,,,,,, encodingHint] = args;
    if (args[2] === "src/shifted.txt") {
      source.encodingHints.push([args[2], encodingHint]);
      return {
        kind: "found" as const,
        content: encodingHint === "shift_jis"
          ? "Shift-JIS view\nwith another line\n"
          : "UTF-8 view\n"
      };
    }
    return originalRead(...args);
  };
  const provider = createProvider(stableHash, repository, inspector, source);
  const shiftedInitial = await provider.open(
    descriptor("src/shifted.txt", stableHash.digest("Shift-JIS view\nwith another line\n"), 3, "shift_jis")
  );
  await shiftedInitial.committer.commit(markReviewedRanges({
    contextState: shiftedInitial.contextState,
    globalState: shiftedInitial.globalState,
    target: shiftedInitial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  const bomInitial = await provider.open(
    descriptor("src/utf8-bom.txt", stableHash.digest("BOM text\n"), 2, "utf8")
  );
  await bomInitial.committer.commit(markReviewedRanges({
    contextState: bomInitial.contextState,
    globalState: bomInitial.globalState,
    target: bomInitial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  const before = await provider.loadForDecoration(
    descriptor("src/shifted.txt", stableHash.digest("Shift-JIS view\nwith another line\n"), 3, "shift_jis")
  );
  assert.ok(before);
  const beforeBomContext = structuredClone(before.contextState.files[bomInitial.target.fileId]);
  const beforeBomGlobal = structuredClone(before.globalState.files[bomInitial.target.fileId]);
  source.encodingHints.length = 0;

  const [transitioned] = await Promise.all([
    provider.loadForDecoration(
      descriptor("src/shifted.txt", stableHash.digest("UTF-8 view\n"), 2, "utf8")
    ),
    provider.loadForDecoration(
      descriptor("src/utf8-bom.txt", stableHash.digest("BOM text\n"), 2, "utf8")
    )
  ]);

  assert.ok(transitioned);
  assert.deepEqual(transitioned.contextState.files[shiftedInitial.target.fileId]?.modifiedReviewed, []);
  assert.equal(transitioned.contextState.files[shiftedInitial.target.fileId]?.lineCount, 2);
  assert.equal(transitioned.contextState.files[shiftedInitial.target.fileId]?.contentHash, stableHash.digest("UTF-8 view\n"));
  assert.deepEqual(transitioned.globalState.files[shiftedInitial.target.fileId]?.reviewed, []);
  assert.equal(transitioned.globalState.files[shiftedInitial.target.fileId]?.contentHash, stableHash.digest("UTF-8 view\n"));
  assert.deepEqual(transitioned.contextState.files[bomInitial.target.fileId], beforeBomContext);
  assert.deepEqual(transitioned.globalState.files[bomInitial.target.fileId], beforeBomGlobal);
  assert.deepEqual(source.encodingHints, [
    ["src/shifted.txt", "utf8"],
    ["src/shifted.txt", "utf8"]
  ]);
  provider.dispose();
});

test("T609-NR-002 aggregates all reopened document hints across mapping and an encoding change", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "@@ -2 +2 @@",
    "-beta",
    "+BETA",
    "diff --git a/src/shifted.ts b/src/shifted.ts",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    ""
  ].join("\n");
  source.texts.set(`${oldRevision}\0src/shifted.ts`, "before");
  source.texts.set(`${newRevision}\0src/shifted.ts`, "after");
  let provider = createProvider(stableHash, repository, inspector, source);
  const initial = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"), 3, "utf8")
  );
  await initial.committer.commit(markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));
  const initialCommit = await repository.load({
    kind: "git", repositoryId, contextId: initial.contextState.contextId
  });
  assert.ok(initialCommit);
  const existingContextFile = initialCommit.contextState.files[initial.target.fileId];
  const existingGlobalFile = initialCommit.globalState.files[initial.target.fileId];
  assert.ok(existingContextFile);
  assert.ok(existingGlobalFile);
  const shiftedId = "shifted-stable-file";
  const shiftedContext = {
    ...clone<typeof existingContextFile>(existingContextFile),
    fileId: shiftedId,
    currentPath: "src/shifted.ts",
    revisionId: oldRevision,
    lineCount: 1,
    contentHash: stableHash.digest("before")
  };
  const shiftedGlobal = {
    ...clone<typeof existingGlobalFile>(existingGlobalFile),
    fileId: shiftedId,
    currentPath: "src/shifted.ts",
    revisionId: oldRevision,
    contentHash: stableHash.digest("before")
  };
  await repository.save(
    { kind: "git", repositoryId, contextId: initial.contextState.contextId },
    {
      schemaVersion: initialCommit.schemaVersion,
      contextState: {
        ...initialCommit.contextState,
        files: { ...initialCommit.contextState.files, [shiftedId]: shiftedContext }
      },
      globalState: {
        ...initialCommit.globalState,
        files: { ...initialCommit.globalState.files, [shiftedId]: shiftedGlobal }
      }
    }
  );
  await provider.open(descriptor("src/shifted.ts", stableHash.digest("before"), 1, "shift_jis"));
  inspector.head = newRevision;
  source.encodingHints.length = 0;
  await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "utf8"));
  assert.ok(source.encodingHints.some(([filePath, hint]) => filePath === "src/example.ts" && hint === "utf8"));
  assert.ok(source.encodingHints.some(([filePath, hint]) => filePath === "src/shifted.ts" && hint === "shift_jis"));

  source.encodingHints.length = 0;
  await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "utf16le"));
  assert.equal(
    source.encodingHints.some(([filePath]) => filePath === "src/shifted.ts"),
    false,
    "a same-revision encoding change must not re-read an unaffected stable identity"
  );
  provider.dispose();

  provider = createProvider(stableHash, repository, inspector, source);
  await provider.open(descriptor("src/shifted.ts", stableHash.digest("after"), 1, "shift_jis"));
  await provider.open(descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "utf16le"));
  source.texts.set(`${pollRevision}\0src/example.ts`, "alpha\nBETA\ngamma");
  source.texts.set(`${pollRevision}\0src/shifted.ts`, "after");
  source.diff = "";
  inspector.head = pollRevision;
  source.encodingHints.length = 0;
  const reopened = await provider.open(
    descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"), 3, "utf16le")
  );
  assert.ok(source.encodingHints.some(([filePath, hint]) => filePath === "src/shifted.ts" && hint === "shift_jis"));
  assert.ok(reopened.contextState.files[shiftedId]);
  assert.ok(reopened.globalState.files[shiftedId]);
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
  const events: Array<{ readonly type: string; readonly filePath?: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));

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
  assert.ok(events.some((event) => event.type === "file-renamed"));
  provider.dispose();
});

/** A production persistence composition maps owner-wide Global state before opening a new branch context. */
test("new branch initialization maps owner-wide Global state through the debounced repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t205-global-"));
  const stableHash = new NodeSha256StableHash();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  const repository = new DebouncedReviewStateRepository({
    delegate: new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: path.join(root, "global") } }
    }),
    debounceMilliseconds: 0
  });
  const provider = createProvider(stableHash, repository, inspector, source);

  try {
    const main = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
    );
    await main.committer.commit(markReviewedRanges({
      contextState: main.contextState,
      globalState: main.globalState,
      target: main.target,
      intervals: [{ startLine: 0, endLineExclusive: 3 }],
      occurredAt
    }));

    inspector.branch = { kind: "branch", fullRef: "refs/heads/feature/t205" };
    inspector.head = newRevision;
    const feature = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))
    );

    assert.equal(feature.globalState.currentRevisionId, newRevision);
    assert.deepEqual(
      feature.globalState.files[main.target.fileId]?.reviewed,
      [
        { startLine: 0, endLineExclusive: 1 },
        { startLine: 2, endLineExclusive: 3 }
      ]
    );
  } finally {
    provider.dispose();
    await repository.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

/** New-context mapping retries from the latest owner-wide Global snapshot after a concurrent command commit. */
test("new branch initialization preserves a concurrent Global update while mapping", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t205-global-cas-"));
  const stableHash = new NodeSha256StableHash();
  const inspector = new MutableGitInspector();
  const source = new BlockingRevisionSource();
  const repository = new DebouncedReviewStateRepository({
    delegate: new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: path.join(root, "global") } }
    }),
    debounceMilliseconds: 0
  });
  const provider = createProvider(stableHash, repository, inspector, source);

  try {
    const main = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
    );
    const initialReview = markReviewedRanges({
      contextState: main.contextState,
      globalState: main.globalState,
      target: main.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt
    });
    await main.committer.commit(initialReview);

    inspector.branch = { kind: "branch", fullRef: "refs/heads/feature/t205-cas" };
    inspector.head = newRevision;
    source.blockMapping = true;
    const openingFeature = provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))
    );
    await source.mappingStarted.promise;

    await main.committer.commit(markReviewedRanges({
      contextState: initialReview.next.contextState,
      globalState: initialReview.next.globalState,
      target: main.target,
      intervals: [{ startLine: 2, endLineExclusive: 3 }],
      occurredAt
    }));
    source.releaseMapping.resolve();

    const feature = await openingFeature;
    const expectedIntervals = [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ];
    assert.deepEqual(
      feature.globalState.files[main.target.fileId]?.reviewed,
      expectedIntervals
    );
    const persisted = await repository.load({
      kind: "git",
      repositoryId,
      contextId: feature.contextState.contextId
    });
    assert.deepEqual(
      persisted?.globalState.files[main.target.fileId]?.reviewed,
      expectedIntervals
    );
  } finally {
    provider.dispose();
    await repository.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

/** A stale poll target cannot remap a foreground-opened context back to an older Git revision. */
test("a poll started at B preserves foreground revision C after its mapping completes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t205-poll-generation-"));
  const stableHash = new NodeSha256StableHash();
  const inspector = new PollingRaceGitInspector();
  const source = new PollingRaceRevisionSource();
  source.texts.set(`${pollRevision}\0src/example.ts`, "alpha\nBETA\ngamma");
  source.texts.set(`${foregroundRevision}\0src/example.ts`, "alpha\nBETA\ngamma");
  const repository = new DebouncedReviewStateRepository({
    delegate: new FileSystemReviewStateRepository({
      storageUris: { globalStorageUri: { fsPath: path.join(root, "global") } }
    }),
    debounceMilliseconds: 0
  });
  const provider = createProvider(stableHash, repository, inspector, source);

  try {
    await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nbeta\ngamma"))
    );
    inspector.pollSnapshot = {
      gitVersion: "2.55.0",
      rootPath: "/repo",
      repositoryId,
      branch: { kind: "branch", fullRef: "refs/heads/main" },
      head: pollRevision
    };
    inspector.foregroundSnapshot = {
      gitVersion: "2.55.0",
      rootPath: "/repo",
      repositoryId,
      branch: { kind: "branch", fullRef: "refs/heads/main" },
      head: foregroundRevision
    };
    source.blockRevision = pollRevision;

    const polling = (
      provider as unknown as {
        readonly delegate: { readonly monitor: { pollNow(): Promise<void> } };
      }
    ).delegate.monitor.pollNow();
    await source.mappingStarted.promise;

    const foreground = await provider.open(
      descriptor("src/example.ts", stableHash.digest("alpha\nBETA\ngamma"))
    );
    assert.equal(
      foreground.globalState.currentRevisionId,
      foregroundRevision
    );

    source.releaseMapping.resolve();
    await polling;
    const persisted = await repository.load({
      kind: "git",
      repositoryId,
      contextId: foreground.contextState.contextId
    });
    assert.equal(
      persisted?.contextState.branch?.headRevision,
      foregroundRevision
    );
    assert.equal(
      persisted?.globalState.currentRevisionId,
      foregroundRevision
    );
  } finally {
    provider.dispose();
    await repository.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

/** A renamed file retains its stable ID while a new file at the old path receives a distinct routed identity. */
test("document routing distinguishes a renamed file from a new file at its old path", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/a.ts b/src/b.ts",
    "similarity index 100%",
    "rename from src/a.ts",
    "rename to src/b.ts",
    "diff --git a/src/a.ts b/src/a.ts",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/src/a.ts",
    "@@ -0,0 +1 @@",
    "+replacement",
    ""
  ].join("\n");
  source.texts.clear();
  source.texts.set(`${oldRevision}\0src/a.ts`, "original");
  source.texts.set(`${newRevision}\0src/b.ts`, "original");
  source.texts.set(`${newRevision}\0src/a.ts`, "replacement");
  const provider = createProvider(stableHash, repository, inspector, source);

  const original = await provider.open(
    descriptor("src/a.ts", stableHash.digest("original"), 1)
  );
  await original.committer.commit(markReviewedRanges({
    contextState: original.contextState,
    globalState: original.globalState,
    target: original.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));

  inspector.head = newRevision;
  const renamed = await provider.open(
    descriptor("src/b.ts", stableHash.digest("original"), 1)
  );
  const replacement = await provider.open(
    descriptor("src/a.ts", stableHash.digest("replacement"), 1)
  );

  assert.equal(renamed.target.fileId, original.target.fileId);
  assert.notEqual(replacement.target.fileId, original.target.fileId);
  assert.equal(replacement.target.currentPath, "src/a.ts");
  assert.equal(
    replacement.contextState.files[replacement.target.fileId]?.currentPath,
    "src/a.ts"
  );
  assert.deepEqual(
    replacement.contextState.files[replacement.target.fileId]?.modifiedReviewed,
    []
  );
  provider.dispose();
});

/** A binary rename still changes file identity even though its destination is not line-reviewable. */
test("document routing excludes a binary rename while routing a new text file at its old path", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/x b/y b/z.bin",
    "similarity index 100%",
    "rename from src/x b/y",
    "rename to z.bin",
    "GIT binary patch",
    "literal 10",
    "diff --git a/src/a.ts b/src/a.ts",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/src/a.ts",
    "@@ -0,0 +1 @@",
    "+replacement",
    ""
  ].join("\n");
  source.texts.clear();
  source.texts.set(`${oldRevision}\0src/x b/y`, "original");
  source.texts.set(`${newRevision}\0z.bin`, "binary\0data");
  source.texts.set(`${newRevision}\0src/a.ts`, "replacement");
  const events: Array<{ readonly type: string; readonly filePath?: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));

  const original = await provider.open(
    descriptor("src/x b/y", stableHash.digest("original"), 1)
  );
  await original.committer.commit(markReviewedRanges({
    contextState: original.contextState,
    globalState: original.globalState,
    target: original.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));

  inspector.head = newRevision;
  const replacement = await provider.open(
    descriptor("src/a.ts", stableHash.digest("replacement"), 1)
  );

  assert.notEqual(replacement.target.fileId, original.target.fileId);
  assert.deepEqual(
    replacement.contextState.files[replacement.target.fileId]?.modifiedReviewed,
    []
  );
  assert.equal(
    Object.values(replacement.contextState.files).some(
      (file) => file.currentPath === "z.bin"
    ),
    false
  );
  assert.equal(
    Object.values(replacement.globalState.files).some(
      (file) => file.currentPath === "z.bin"
    ),
    false
  );
  assert.ok(events.some((event) => event.type === "mapping-unresolved"));
  assert.equal(events.some((event) => event.type === "file-deleted" && event.filePath === "src/x b/y"), false);
  provider.dispose();
});

/** Ambiguous rename and copy destinations become separately routed unreviewed files. */
test("document routing maps an ambiguous rename and copy graph without reusing its source ID", async () => {
  const stableHash = new NodeSha256StableHash();
  const repository = new MemoryRepository();
  const inspector = new MutableGitInspector();
  const source = new RevisionSource();
  source.diff = [
    "diff --git a/src/a.ts b/src/b.ts",
    "similarity index 100%",
    "rename from src/a.ts",
    "rename to src/b.ts",
    "diff --git a/src/a.ts b/src/c.ts",
    "similarity index 100%",
    "copy from src/a.ts",
    "copy to src/c.ts",
    ""
  ].join("\n");
  source.texts.clear();
  source.texts.set(`${oldRevision}\0src/a.ts`, "original");
  source.texts.set(`${newRevision}\0src/b.ts`, "original");
  source.texts.set(`${newRevision}\0src/c.ts`, "original");
  const events: Array<{ readonly type: string }> = [];
  const provider = createProvider(stableHash, repository, inspector, source, undefined,
    new ReviewHistoryRecorder({
      sessionId: "session",
      createEventId: () => `event-${events.length}`,
      appender: { append: async (_target, event) => { events.push(event); } }
    }));

  const original = await provider.open(
    descriptor("src/a.ts", stableHash.digest("original"), 1)
  );
  await original.committer.commit(markReviewedRanges({
    contextState: original.contextState,
    globalState: original.globalState,
    target: original.target,
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt
  }));

  inspector.head = newRevision;
  const renamed = await provider.open(
    descriptor("src/b.ts", stableHash.digest("original"), 1)
  );
  const copied = await provider.open(
    descriptor("src/c.ts", stableHash.digest("original"), 1)
  );

  assert.notEqual(renamed.target.fileId, original.target.fileId);
  assert.notEqual(copied.target.fileId, original.target.fileId);
  assert.notEqual(renamed.target.fileId, copied.target.fileId);
  assert.deepEqual(
    renamed.contextState.files[renamed.target.fileId]?.modifiedReviewed,
    []
  );
  assert.deepEqual(
    copied.contextState.files[copied.target.fileId]?.modifiedReviewed,
    []
  );
  assert.ok(events.some((event) => event.type === "mapping-unresolved"));
  provider.dispose();
});

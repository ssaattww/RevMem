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
import {
  formatOperationLogEntry,
  OperationFeedback,
  setActiveOperationFeedback,
  type OperationLogEntry
} from "../../src/application/operation-feedback/index";
import type { GitRevisionMappingSource } from "../../src/application/review-context/index";
import { WorkspaceIdentityService } from "../../src/application/workspace-identity/index";
import {
  markReviewedRanges,
  unmarkReviewedRanges
} from "../../src/core/review-state/index";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";
const LATEST_SHA = "3333333333333333333333333333333333333333";
const NOW = "2026-08-06T11:40:00.000Z";
const REPOSITORY_ID = "github.com/example/runtime-rewrite";
const CONTENT = "alpha\nbeta\ngamma";
const NEW_CONTENT = "delta\nepsilon\nzeta";
const clone = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

const keyOf = (target: ReviewStateRepositoryTarget): string =>
  `${target.kind}\0${target.repositoryId}\0${target.contextId}`;

class MemoryRepository implements DocumentReviewStateRepository {
  private readonly commits = new Map<string, ReviewStateCommit>();
  public commitCalls = 0;

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
    this.commitCalls += 1;
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
  public readonly unavailableObjectIds = new Set<string>();
  public diff = "";
  public readonly texts = new Map<string, string>([
    [`${OLD_SHA}\0src/example.ts`, CONTENT],
    [`${NEW_SHA}\0src/example.ts`, CONTENT]
  ]);
  public nextReadError: unknown;
  private readGate:
    | {
        started: () => void;
        wait: Promise<void>;
        revision: string;
      }
    | undefined;

  public armNextRead(
    revision: string = OLD_SHA
  ): { readonly started: Promise<void>; release(): void } {
    let startedResolve!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.readGate = { started: startedResolve, wait, revision };
    return { started, release };
  }

  public async objectExists(_root: string, objectName: string): Promise<boolean> {
    return objectName === OLD_SHA
      ? this.oldObjectExists
      : !this.unavailableObjectIds.has(objectName);
  }

  public async diffRevisions(): Promise<string> {
    return this.diff;
  }

  public async listFilePathsAtRevision(): Promise<readonly string[]> {
    return ["src/example.ts"];
  }

  public async readTextFileAtRevision(
    root: string,
    revision: string,
    path: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    if (this.nextReadError !== undefined) {
      const error = this.nextReadError;
      this.nextReadError = undefined;
      throw error;
    }
    const gate = this.readGate;
    if (gate !== undefined && root === "/repo/src" && revision === gate.revision) {
      this.readGate = undefined;
      gate.started();
      await gate.wait;
    }
    const content = this.texts.get(`${revision}\0${path}`);
    return content === undefined
      ? { kind: "missing-file" }
      : { kind: "found", content };
  }
}

class DelayedSnapshotTracker extends NonGitSnapshotTracker {
  public nextSaveError: unknown;
  public nextInvalidationError: unknown;
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
    if (this.nextSaveError !== undefined) {
      const error = this.nextSaveError;
      this.nextSaveError = undefined;
      throw error;
    }
    const gate = this.gate;
    if (gate !== undefined) {
      this.gate = undefined;
      gate.started();
      await gate.wait;
    }
    return super.saveLatest(state, now);
  }

  public override async invalidateLatest(workspaceContextId: string, fileId: string): Promise<void> {
    if (this.nextInvalidationError !== undefined) {
      const error = this.nextInvalidationError;
      this.nextInvalidationError = undefined;
      throw error;
    }
    await super.invalidateLatest(workspaceContextId, fileId);
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
    resolveContent: (value) => value.contentHash === stableHash.digest(NEW_CONTENT)
      ? NEW_CONTENT
      : CONTENT,
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
  return { stableHash, repository, inspector, source, provider, tracker: actualTracker };
};

test("production Git provider publishes snapshots and restores reviewed ranges after the old object disappears", async () => {
  const { stableHash, inspector, source, provider } = setup();

  const initial = await provider.open(descriptor(stableHash.digest(CONTENT)));
  const marked = markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  });
  await initial.committer.commit(marked);

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

test("post-commit source-read and invalidation failures keep the original diagnostics while commit succeeds", async () => {
  const tracker = new DelayedSnapshotTracker(
    new InMemoryNonGitSnapshotStorage(),
    new NodeNonGitSnapshotCodec(),
    { maxSnapshots: 32, maxCompressedBytes: 1024 * 1024, retentionMs: 24 * 60 * 60 * 1_000 }
  );
  const { stableHash, source, provider, repository } = setup(tracker);
  const feedbackLogs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog(entry) { feedbackLogs.push(entry); }, revealLog() {},
  }, () => 1_000);
  setActiveOperationFeedback(feedback);
  try {
    const session = await provider.open(descriptor(stableHash.digest(CONTENT)));
    const transaction = markReviewedRanges({
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt: NOW
    });
    const readCause = Object.assign(new Error("post-commit revision read failed"), { code: "EIO" });
    const readError = Object.assign(new Error("could not verify committed document", { cause: readCause }), { code: "EACCES" });
    const invalidationError = Object.assign(new Error("snapshot pointer invalidation failed"), { code: "EPERM" });
    source.nextReadError = readError;
    tracker.nextInvalidationError = invalidationError;

    const result = await feedback.run("Review state save", async () => {
      await session.committer.commit(transaction);
      return "saved";
    });

    assert.equal(result, "saved", "post-commit diagnostics do not alter the successful save result");
    assert.equal(repository.commitCalls, 1, "the delegate review-state commit completed exactly once");
    const diagnostic = feedbackLogs.find((entry) => entry.event === "failed" && entry.label === "Document review snapshot refresh");
    assert.ok(diagnostic);
    assert.equal(diagnostic.errorDetails?.message, "Post-commit snapshot refresh and invalidation failed.");
    assert.equal(diagnostic.errorDetails?.cause?.message, "could not verify committed document");
    assert.match(diagnostic.errorDetails?.cause?.stack ?? "", /could not verify committed document/u);
    assert.match(diagnostic.errorDetails?.cause?.cause?.stack ?? "", /post-commit revision read failed/u);
    assert.equal(diagnostic.errorDetails?.causes?.[0]?.message, "snapshot pointer invalidation failed");
    assert.match(diagnostic.errorDetails?.causes?.[0]?.stack ?? "", /snapshot pointer invalidation failed/u);
    const formatted = formatOperationLogEntry(diagnostic);
    assert.match(formatted, /could not verify committed document/u);
    assert.match(formatted, /post-commit revision read failed/u);
    assert.match(formatted, /snapshot pointer invalidation failed/u);
    assert.equal(feedbackLogs.at(-1)?.event, "succeeded", "the owning save remains successful");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("post-commit snapshot-save and invalidation failures keep both stacks while commit succeeds", async () => {
  const tracker = new DelayedSnapshotTracker(
    new InMemoryNonGitSnapshotStorage(),
    new NodeNonGitSnapshotCodec(),
    { maxSnapshots: 32, maxCompressedBytes: 1024 * 1024, retentionMs: 24 * 60 * 60 * 1_000 }
  );
  const { stableHash, provider, repository } = setup(tracker);
  const feedbackLogs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog(entry) { feedbackLogs.push(entry); }, revealLog() {},
  }, () => 2_000);
  setActiveOperationFeedback(feedback);
  try {
    const session = await provider.open(descriptor(stableHash.digest(CONTENT)));
    const transaction = markReviewedRanges({
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt: NOW
    });
    const saveError = Object.assign(new Error("latest snapshot write failed"), { code: "EIO" });
    const invalidationError = Object.assign(new Error("snapshot invalidation failed"), { code: "EPERM" });
    tracker.nextSaveError = saveError;
    tracker.nextInvalidationError = invalidationError;

    const result = await feedback.run("Review state save", async () => {
      await session.committer.commit(transaction);
      return "saved";
    });

    assert.equal(result, "saved", "snapshot persistence failure does not undo the saved review state");
    assert.equal(repository.commitCalls, 1, "the delegate review-state commit completed exactly once");
    const diagnostic = feedbackLogs.find((entry) => entry.event === "failed" && entry.label === "Document review snapshot refresh");
    assert.ok(diagnostic);
    assert.equal(diagnostic.errorDetails?.cause?.message, "snapshot invalidation failed");
    assert.match(diagnostic.errorDetails?.cause?.stack ?? "", /snapshot invalidation failed/u);
    assert.equal(diagnostic.errorDetails?.causes?.[0]?.message, "latest snapshot write failed");
    assert.match(diagnostic.errorDetails?.causes?.[0]?.stack ?? "", /latest snapshot write failed/u);
    const formatted = formatOperationLogEntry(diagnostic);
    assert.match(formatted, /latest snapshot write failed/u);
    assert.match(formatted, /snapshot invalidation failed/u);
    assert.equal(feedbackLogs.at(-1)?.event, "succeeded", "the owning save remains successful");
  } finally {
    setActiveOperationFeedback(undefined);
  }
});

test("post-commit content mismatch is diagnosed while the saved review state remains successful", async () => {
  const { stableHash, source, provider, repository } = setup();
  const feedbackLogs: OperationLogEntry[] = [];
  const feedback = new OperationFeedback({
    showBusy() {}, clearBusy() {}, appendLog(entry) { feedbackLogs.push(entry); }, revealLog() {},
  }, () => 3_000);
  setActiveOperationFeedback(feedback);
  try {
    const session = await provider.open(descriptor(stableHash.digest(CONTENT)));
    const transaction = markReviewedRanges({
      contextState: session.contextState,
      globalState: session.globalState,
      target: session.target,
      intervals: [{ startLine: 0, endLineExclusive: 1 }],
      occurredAt: NOW
    });
    source.texts.set(`${OLD_SHA}\0src/example.ts`, "changed content no longer matches the target hash");

    const result = await feedback.run("Review state save", async () => {
      await session.committer.commit(transaction);
      return "saved";
    });

    assert.equal(result, "saved");
    assert.equal(repository.commitCalls, 1, "the delegate review-state commit completed exactly once");
    const diagnostic = feedbackLogs.find((entry) => entry.event === "failed" && entry.label === "Document review snapshot refresh");
    assert.ok(diagnostic);
    assert.match(diagnostic.errorDetails?.message ?? "", /could not prove content and state consistency/u);
    assert.match(diagnostic.errorDetails?.stack ?? "", /could not prove content and state consistency/u);
    assert.match(formatOperationLogEntry(diagnostic), /could not prove content and state consistency/u);
    assert.equal(feedbackLogs.at(-1)?.event, "succeeded", "a consistency diagnostic does not change save success");
  } finally {
    setActiveOperationFeedback(undefined);
  }
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
  const marked = markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  });
  await initial.committer.commit(marked);

  const gate = tracker.armNextSave();
  const staleOpen = provider.open(descriptor(stableHash.digest(CONTENT)));
  await gate.started;

  const newerCommit = initial.committer.commit(unmarkReviewedRanges({
    contextState: marked.next.contextState,
    globalState: marked.next.globalState,
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

test("a stale open delayed before enqueue cannot overwrite a newer unreview commit", async () => {
  const { stableHash, inspector, source, provider } = setup();
  const initial = await provider.open(descriptor(stableHash.digest(CONTENT)));
  const marked = markReviewedRanges({
    contextState: initial.contextState,
    globalState: initial.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  });
  await initial.committer.commit(marked);

  const gate = source.armNextRead();
  const staleOpen = provider.open(descriptor(stableHash.digest(CONTENT)));
  await gate.started;

  await initial.committer.commit(unmarkReviewedRanges({
    contextState: marked.next.contextState,
    globalState: marked.next.globalState,
    target: initial.target,
    intervals: [{ startLine: 0, endLineExclusive: 3 }],
    occurredAt: NOW
  }));

  gate.release();
  await staleOpen;

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

test("an older Git open completing after a newer revision open cannot revive ranges during a later history rewrite", async () => {
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

  const gate = source.armNextRead(OLD_SHA);
  const staleOpen = provider.open(descriptor(stableHash.digest(CONTENT)));
  await gate.started;
  inspector.head = NEW_SHA;
  source.texts.set(`${NEW_SHA}\0src/example.ts`, NEW_CONTENT);
  source.diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,3 +1,3 @@",
    "-alpha",
    "-beta",
    "-gamma",
    "+delta",
    "+epsilon",
    "+zeta",
    ""
  ].join("\n");
  await provider.open(descriptor(stableHash.digest(NEW_CONTENT)));
  gate.release();
  await staleOpen;

  source.unavailableObjectIds.add(NEW_SHA);
  source.texts.set(`${LATEST_SHA}\0src/example.ts`, CONTENT);
  inspector.head = LATEST_SHA;
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

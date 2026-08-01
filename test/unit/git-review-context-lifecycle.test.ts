import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  PollingGitStateMonitor,
  type GitReviewContextRepositorySnapshot,
  type GitRevisionMappingSource,
  type GitStateInspectionPort,
  type GitStateMonitorScheduler
} from "../../src/application/review-context/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";

const oldRevision = "0123456789abcdef0123456789abcdef01234567";
const newRevision = "89abcdef0123456789abcdef0123456789abcdef";
const thirdRevision = "fedcba9876543210fedcba9876543210fedcba98";
const occurredAt = "2026-08-01T04:50:00.000Z";
const repositoryId = "github.com/example/review-range";
const repositoryRoot = "/repo";
const stableHash = new NodeSha256StableHash();

const attached = (
  fullRef: string,
  head: string | undefined
): GitReviewContextRepositorySnapshot => ({
  repositoryId,
  rootPath: repositoryRoot,
  branch: { kind: "branch", fullRef },
  ...(head === undefined ? {} : { head })
});

const detached = (head: string): GitReviewContextRepositorySnapshot => ({
  repositoryId,
  rootPath: repositoryRoot,
  branch: { kind: "detached" },
  head
});

/** Branch identity is stable across commits, while branch names and detached commits remain isolated contexts. */
test("resolver separates branch and detached contexts without putting moving HEAD into branch identity", () => {
  const resolver = new GitReviewContextResolver({
    stableHash,
    now: () => new Date(occurredAt)
  });

  const mainOld = resolver.resolve(attached("refs/heads/main", oldRevision));
  const mainNew = resolver.resolve(attached("refs/heads/main", newRevision));
  const feature = resolver.resolve(attached("refs/heads/feature/t205", newRevision));
  const detachedOld = resolver.resolve(detached(oldRevision));
  const detachedOldAgain = resolver.resolve(detached(oldRevision));
  const detachedNew = resolver.resolve(detached(newRevision));

  assert.equal(mainOld.contextId, mainNew.contextId);
  assert.notEqual(mainNew.contextId, feature.contextId);
  assert.equal(mainOld.kind, "branch");
  assert.equal(mainOld.contextState.kind, "branch");
  assert.equal(mainOld.contextState.branch?.refName, "refs/heads/main");
  assert.equal(mainNew.contextState.branch?.headRevision, newRevision);

  assert.equal(detachedOld.contextId, detachedOldAgain.contextId);
  assert.notEqual(detachedOld.contextId, detachedNew.contextId);
  assert.notEqual(detachedOld.contextId, mainOld.contextId);
  assert.equal(detachedOld.kind, "detached-commit");
  assert.equal(detachedOld.contextState.kind, "branch");
  assert.equal(detachedOld.contextState.branch?.refName, `HEAD@${oldRevision}`);
  assert.equal(detachedOld.contextState.branch?.headRevision, oldRevision);
});

/** A detached context without an immutable commit cannot be assigned a stable context identity. */
test("resolver rejects detached HEAD without a commit object ID", () => {
  const resolver = new GitReviewContextResolver({ stableHash });
  assert.throws(
    () => resolver.resolve({
      repositoryId,
      rootPath: repositoryRoot,
      branch: { kind: "detached" }
    }),
    /detached HEAD requires a full commit object ID/u
  );
});

class FakeRevisionSource implements GitRevisionMappingSource {
  public readonly texts = new Map<string, string>();
  public diff = "";
  public oldRevisionExists = true;

  public async objectExists(
    _repositoryRoot: string,
    objectName: string
  ): Promise<boolean> {
    return objectName === oldRevision ? this.oldRevisionExists : true;
  }

  public async diffRevisions(
    _repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string> {
    assert.equal(leftRevision, oldRevision);
    assert.equal(rightRevision, newRevision);
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

const branchState = (contextId: string): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: "refs/heads/main",
  branch: {
    refName: "refs/heads/main",
    headRevision: oldRevision
  },
  files: {
    "file-1": {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      fileId: "file-1",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: oldRevision,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
      originalReviewedByDiff: {},
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      lineCount: 3,
      updatedAt: occurredAt
    }
  },
  createdAt: occurredAt,
  updatedAt: occurredAt
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId: oldRevision,
  files: {
    "file-1": {
      fileId: "file-1",
      currentPath: "src/example.ts",
      revisionId: oldRevision,
      reviewed: [{ startLine: 0, endLineExclusive: 3 }],
      contentHash: stableHash.digest("alpha\nbeta\ngamma"),
      updatedAt: occurredAt
    }
  },
  updatedAt: occurredAt
});

/** Commit refresh maps both context and Global ranges and advances every surviving file to the new immutable revision. */
test("revision mapper preserves only unchanged reviewed lines after a commit", async () => {
  const source = new FakeRevisionSource();
  source.diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -2 +2 @@",
    "-beta",
    "+BETA",
    "@@ -3,0 +4 @@",
    "+delta",
    ""
  ].join("\n");
  source.texts.set(`${oldRevision}\0src/example.ts`, "alpha\nbeta\ngamma");
  source.texts.set(`${newRevision}\0src/example.ts`, "alpha\nBETA\ngamma\ndelta");

  const resolver = new GitReviewContextResolver({ stableHash });
  const current = resolver.resolve(attached("refs/heads/main", newRevision));
  const mapper = new GitContextRevisionMapper({
    source,
    stableHash,
    now: () => new Date(occurredAt)
  });

  const result = await mapper.map({
    current,
    contextState: branchState(current.contextId),
    globalState: globalState(),
    fileSystemPathSemantics: "posix",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  assert.equal(result.contextState.contextId, current.contextId);
  assert.equal(result.contextState.branch?.headRevision, newRevision);
  assert.equal(result.globalState.currentRevisionId, newRevision);
  assert.deepEqual(
    result.contextState.files["file-1"]?.modifiedReviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.deepEqual(
    result.globalState.files["file-1"]?.reviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.equal(result.contextState.files["file-1"]?.revisionId, newRevision);
  assert.equal(result.globalState.files["file-1"]?.revisionId, newRevision);
  assert.equal(result.contextState.files["file-1"]?.lineCount, 4);
});

/** Added files must use the same repository-scoped identity as normal document routing. */
test("revision mapper assigns document-routing identity to an added file", async () => {
  const source = new FakeRevisionSource();
  source.diff = [
    "diff --git a/src/new.ts b/src/new.ts",
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1 @@",
    "+value",
    ""
  ].join("\n");
  source.texts.set(`${newRevision}\0src/new.ts`, "value");

  const resolver = new GitReviewContextResolver({ stableHash });
  const current = resolver.resolve(attached("refs/heads/main", newRevision));
  const mapper = new GitContextRevisionMapper({
    source,
    stableHash,
    now: () => new Date(occurredAt)
  });
  const emptyContext: ReviewContextState = {
    ...branchState(current.contextId),
    files: {}
  };
  const emptyGlobal: RepositoryGlobalState = {
    ...globalState(),
    files: {}
  };

  const result = await mapper.map({
    current,
    contextState: emptyContext,
    globalState: emptyGlobal,
    fileSystemPathSemantics: "posix",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  const expectedFileId = `repository-file:${stableHash.digest(
    ["repository-file", repositoryId, "src/new.ts"].join("\0")
  )}`;
  assert.deepEqual(Object.keys(result.contextState.files), [expectedFileId]);
  assert.deepEqual(Object.keys(result.globalState.files), [expectedFileId]);
  assert.equal(
    result.contextState.files[expectedFileId]?.currentPath,
    "src/new.ts"
  );
  assert.deepEqual(
    result.contextState.files[expectedFileId]?.modifiedReviewed,
    []
  );
});

/** Missing old objects must not cause stale reviewed ranges to be guessed as current. */
test("revision mapper advances conservatively with empty reviewed ranges when old revision is unavailable", async () => {
  const source = new FakeRevisionSource();
  source.oldRevisionExists = false;
  source.texts.set(`${newRevision}\0src/example.ts`, "alpha\nbeta\ngamma");
  const resolver = new GitReviewContextResolver({ stableHash });
  const current = resolver.resolve(attached("refs/heads/main", newRevision));
  const mapper = new GitContextRevisionMapper({
    source,
    stableHash,
    now: () => new Date(occurredAt)
  });

  const result = await mapper.map({
    current,
    contextState: branchState(current.contextId),
    globalState: globalState(),
    fileSystemPathSemantics: "posix",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  assert.deepEqual(result.contextState.files["file-1"]?.modifiedReviewed, []);
  assert.deepEqual(result.globalState.files["file-1"]?.reviewed, []);
  assert.equal(result.contextState.files["file-1"]?.revisionId, newRevision);
  assert.equal(result.globalState.currentRevisionId, newRevision);
});

class ManualScheduler implements GitStateMonitorScheduler {
  public callback: (() => void) | undefined;
  public disposed = false;

  public scheduleRepeating(callback: () => void): { dispose(): void } {
    this.callback = callback;
    return {
      dispose: () => {
        this.disposed = true;
      }
    };
  }
}

class MutableInspector implements GitStateInspectionPort {
  public current: GitReviewContextRepositorySnapshot = attached(
    "refs/heads/main",
    oldRevision
  );

  public async inspectRepository(): Promise<{
    readonly kind: "repository";
    readonly repository: GitReviewContextRepositorySnapshot;
  }> {
    return { kind: "repository", repository: this.current };
  }
}

/** Polling detects commit, branch, and detached transitions exactly once and ignores identical snapshots. */
test("Git state monitor emits only when repository context state changes", async () => {
  const scheduler = new ManualScheduler();
  const inspector = new MutableInspector();
  const changes: Array<{
    readonly previous: GitReviewContextRepositorySnapshot;
    readonly current: GitReviewContextRepositorySnapshot;
  }> = [];
  const monitor = new PollingGitStateMonitor({
    inspector,
    scheduler,
    intervalMs: 100,
    onDidChange: (change) => {
      assert.ok(change.previous);
      assert.ok(change.current);
      changes.push({
        previous: change.previous,
        current: change.current
      });
    }
  });

  monitor.observe(repositoryRoot, inspector.current);
  monitor.start();
  await monitor.pollNow();
  assert.equal(changes.length, 0);

  inspector.current = attached("refs/heads/main", newRevision);
  await monitor.pollNow();
  await monitor.pollNow();
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.previous.head, oldRevision);
  assert.equal(changes[0]?.current.head, newRevision);

  inspector.current = attached("refs/heads/feature/t205", thirdRevision);
  await monitor.pollNow();
  inspector.current = detached(thirdRevision);
  await monitor.pollNow();

  assert.equal(changes.length, 3);
  assert.equal(changes[1]?.current.branch.kind, "branch");
  assert.equal(changes[2]?.current.branch.kind, "detached");

  monitor.dispose();
  assert.equal(scheduler.disposed, true);
});

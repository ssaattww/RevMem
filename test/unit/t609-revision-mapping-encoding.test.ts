import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type GitRevisionMappingSource,
  type GitRevisionMappingTextReadResult
} from "../../src/application/review-context/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../src/core/contracts/index";

const oldRevision = "1111111111111111111111111111111111111111";
const newRevision = "2222222222222222222222222222222222222222";
const hash = new NodeSha256StableHash();
const repositoryId = "github.com/example/t609";
const occurredAt = "2026-08-22T01:30:00.000Z";

const file = (fileId: string, currentPath: string, revisionId = oldRevision) => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  fileId,
  currentPath,
  previousPaths: [],
  revisionId,
  modifiedReviewed: [{ startLine: 0, endLineExclusive: 1 }],
  originalReviewedByDiff: {},
  contentHash: hash.digest("before"),
  lineCount: 1,
  updatedAt: occurredAt
});

const contextState = (contextId: string, files: ReviewContextState["files"]): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId,
  kind: "branch",
  repositoryId,
  displayName: "refs/heads/main",
  branch: { refName: "refs/heads/main", headRevision: oldRevision },
  files,
  createdAt: occurredAt,
  updatedAt: occurredAt
});

const globalState = (files: ReviewContextState["files"]): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId,
  currentRevisionId: oldRevision,
  files: Object.fromEntries(Object.values(files).map((entry) => [entry.fileId, {
    fileId: entry.fileId,
    currentPath: entry.currentPath,
    revisionId: oldRevision,
    reviewed: entry.modifiedReviewed,
    contentHash: entry.contentHash,
    updatedAt: occurredAt
  }])),
  updatedAt: occurredAt
});

class EncodingSource implements GitRevisionMappingSource {
  public readonly reads: Array<readonly [string, string | undefined]> = [];

  public constructor(private readonly diff: string) {}

  public async objectExists(): Promise<boolean> { return true; }

  public async diffRevisions(): Promise<string> { return this.diff; }

  public async readTextFileAtRevision(
    _root: string,
    _revision: string,
    path: string,
    _semantics: "posix" | "windows",
    _feedback?: unknown,
    _signal?: AbortSignal,
    encodingHint?: string
  ): Promise<GitRevisionMappingTextReadResult> {
    this.reads.push([path, encodingHint]);
    if (path === "src/unsupported.txt") {
      return { kind: "invalid-encoding" as const, encoding: "utf-8" as const };
    }
    return { kind: "found" as const, content: path === "src/good.txt" ? "after" : "same" };
  }
}

const mapperFor = (source: EncodingSource) => new GitContextRevisionMapper({
  source,
  stableHash: hash,
  now: () => new Date(occurredAt)
});

test("T609 isolates one unsupported encoded file while Context and Global map the other file", async () => {
  const source = new EncodingSource([
    "diff --git a/src/good.txt b/src/good.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "diff --git a/src/unsupported.txt b/src/unsupported.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    ""
  ].join("\n"));
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const files = {
    good: file("good", "src/good.txt"),
    unsupported: file("unsupported", "src/unsupported.txt")
  };

  const result = await mapperFor(source).map({
    current,
    contextState: contextState(current.contextId, files),
    globalState: globalState(files),
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    encodingHintsByPath: { "src/good.txt": "utf8", "src/unsupported.txt": "shift_jis" }
  });

  assert.deepEqual(Object.keys(result.contextState.files), ["good"]);
  assert.deepEqual(Object.keys(result.globalState.files), ["good"]);
  assert.equal(result.contextState.files.good?.revisionId, newRevision);
  assert.equal(result.globalState.files.good?.revisionId, newRevision);
  assert.ok(source.reads.some(([path, hint]) => path === "src/good.txt" && hint === "utf8"));
  assert.ok(source.reads.some(([path, hint]) => path === "src/unsupported.txt" && hint === "shift_jis"));
});

test("T609-NR-005 retains a privacy-safe unresolved reason when a current-revision text refresh fails", async () => {
  const source = new EncodingSource("");
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const files = { unsupported: file("unsupported", "src/unsupported.txt", newRevision) };
  const currentState = contextState(current.contextId, files);
  currentState.branch = { refName: "refs/heads/main", headRevision: newRevision };
  const currentGlobal = globalState(files);
  currentGlobal.currentRevisionId = newRevision;
  currentGlobal.files.unsupported!.revisionId = newRevision;

  const result = await mapperFor(source).map({
    current,
    contextState: currentState,
    globalState: currentGlobal,
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    encodingHintsByPath: { "src/unsupported.txt": "shift_jis" },
    encodingChangedPaths: ["src/unsupported.txt"]
  });

  assert.deepEqual(result.unresolvedFileIds, ["unsupported"]);
  const reasoned = result as typeof result & {
    readonly unresolvedReasonsByFileId?: Readonly<Record<string, string>>;
  };
  assert.deepEqual(reasoned.unresolvedReasonsByFileId, {
    unsupported: "immutable-text-unavailable"
  });
  assert.deepEqual(
    Object.keys(result.contextState.files),
    ["unsupported"],
    "a failed same-revision re-decode must retain the stable Context file identity"
  );
  assert.deepEqual(result.contextState.files.unsupported?.modifiedReviewed, []);
  assert.deepEqual(
    Object.keys(result.globalState.files),
    ["unsupported"],
    "a failed same-revision re-decode must retain the stable Global file identity"
  );
  assert.deepEqual(result.globalState.files.unsupported?.reviewed, []);
  assert.doesNotMatch(
    JSON.stringify(Object.values(reasoned.unresolvedReasonsByFileId ?? {})),
    /unsupported|shift_jis|src\//u
  );
});

test("T609 preserves a restart-unopened encoded identity only when the new immutable blob exists but cannot be decoded", async () => {
  const source = new EncodingSource([
    "diff --git a/src/new.txt b/src/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/new.txt",
    "@@ -0,0 +1 @@",
    "+new",
    "diff --git a/src/deleted.txt b/src/deleted.txt",
    "deleted file mode 100644",
    "--- a/src/deleted.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-before",
    ""
  ].join("\n"));
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const files = {
    shifted: file("shifted", "src/shift-jis.txt"),
    bom: file("bom", "src/utf8-bom.txt"),
    deleted: file("deleted", "src/deleted.txt")
  };
  const originalRead = source.readTextFileAtRevision.bind(source);
  source.readTextFileAtRevision = async (...args) => {
    const [,,,,,, encodingHint] = args;
    const repositoryPath = args[2];
    source.reads.push([repositoryPath, encodingHint]);
    if (repositoryPath === "src/shift-jis.txt" && encodingHint === undefined) {
      return { kind: "invalid-encoding" as const, encoding: "utf-8" as const };
    }
    if (repositoryPath === "src/deleted.txt" && args[1] === newRevision) {
      return { kind: "missing-file" as const };
    }
    return originalRead(...args);
  };

  const result = await mapperFor(source).map({
    current,
    contextState: contextState(current.contextId, files),
    globalState: globalState(files),
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    encodingHintsByPath: { "src/utf8-bom.txt": "utf8" }
  });

  assert.deepEqual(result.unresolvedFileIds, ["shifted"]);
  assert.deepEqual(result.unresolvedReasonsByFileId, {
    shifted: "immutable-text-unavailable"
  });
  assert.deepEqual(result.contextState.files.shifted?.modifiedReviewed, []);
  assert.deepEqual(result.globalState.files.shifted?.reviewed, []);
  assert.equal(result.contextState.files.shifted?.revisionId, newRevision);
  assert.equal(result.globalState.files.shifted?.revisionId, newRevision);
  assert.ok(result.contextState.files.bom, "the reopened UTF-8 BOM identity must remain mapped");
  assert.ok(result.globalState.files.bom, "the reopened UTF-8 BOM Global identity must remain mapped");
  assert.equal(result.contextState.files.deleted, undefined, "a deleted file must not be retained as an unavailable immutable blob");
  assert.equal(result.globalState.files.deleted, undefined, "a deleted Global file must not be retained as an unavailable immutable blob");
  assert.ok(
    Object.values(result.contextState.files).some((entry) => entry.currentPath === "src/new.txt" && entry.modifiedReviewed.length === 0),
    "a newly added file must receive a new unreviewed identity"
  );
  assert.ok(source.reads.some(([path, hint]) => path === "src/shift-jis.txt" && hint === undefined), "restart mapping must not reuse a stale Shift-JIS hint");
});

test("T609 clears only the changed same-revision encoding intervals while preserving unrelated Context and Global state", async () => {
  const source = new EncodingSource("");
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const changed = file("changed", "src/encoding.txt", newRevision);
  changed.lineCount = 2;
  changed.contentHash = hash.digest("same bytes decoded as UTF-8\n");
  const unaffected = file("unaffected", "src/unaffected.txt", newRevision);
  const currentState = contextState(current.contextId, { changed, unaffected });
  currentState.branch = { refName: "refs/heads/main", headRevision: newRevision };
  const currentGlobal = globalState({ changed, unaffected });
  currentGlobal.currentRevisionId = newRevision;
  currentGlobal.files.changed!.revisionId = newRevision;
  currentGlobal.files.unaffected!.revisionId = newRevision;
  const originalUnaffected = structuredClone(unaffected);
  const originalGlobalUnaffected = structuredClone(currentGlobal.files.unaffected!);
  const originalRead = source.readTextFileAtRevision.bind(source);
  source.readTextFileAtRevision = async (...args) => {
    const [,,,,,, encodingHint] = args;
    const repositoryPath = args[2];
    source.reads.push([repositoryPath, encodingHint]);
    if (repositoryPath === "src/encoding.txt") {
      return {
        kind: "found" as const,
        content: encodingHint === "shift_jis"
          ? "same bytes decoded as Shift-JIS\nwith another line\n"
          : "same bytes decoded as UTF-8\n"
      };
    }
    return originalRead(...args);
  };

  const result = await mapperFor(source).map({
    current,
    contextState: currentState,
    globalState: currentGlobal,
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false },
    encodingHintsByPath: { "src/encoding.txt": "shift_jis" },
    encodingChangedPaths: ["src/encoding.txt"]
  });

  assert.deepEqual(result.unresolvedFileIds, []);
  assert.deepEqual(result.contextState.files.changed?.modifiedReviewed, []);
  assert.equal(result.contextState.files.changed?.lineCount, 3);
  assert.equal(result.contextState.files.changed?.contentHash, hash.digest("same bytes decoded as Shift-JIS\nwith another line\n"));
  assert.deepEqual(result.globalState.files.changed?.reviewed, []);
  assert.equal(result.globalState.files.changed?.contentHash, hash.digest("same bytes decoded as Shift-JIS\nwith another line\n"));
  assert.deepEqual(result.contextState.files.unaffected, originalUnaffected);
  assert.deepEqual(result.globalState.files.unaffected, originalGlobalUnaffected);
  assert.deepEqual(source.reads, [
    ["src/encoding.txt", "shift_jis"],
    ["src/encoding.txt", "shift_jis"]
  ], "Context and Global re-read only the affected stable path with the new hint");
});

test("T609 inherits an opened encoding hint only for a unique rename", async () => {
  const source = new EncodingSource([
    "diff --git a/src/old.txt b/src/renamed.txt",
    "similarity index 100%",
    "rename from src/old.txt",
    "rename to src/renamed.txt",
    ""
  ].join("\n"));
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const files = { old: file("old", "src/old.txt") };

  await mapperFor(source).map({
    current,
    contextState: contextState(current.contextId, files),
    globalState: globalState(files),
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    encodingHintsByPath: { "src/renamed.txt": "shift_jis" }
  });

  assert.ok(source.reads.some(([path, hint]) => path === "src/old.txt" && hint === "shift_jis"));
  assert.ok(source.reads.some(([path, hint]) => path === "src/renamed.txt" && hint === "shift_jis"));
});

test("T609 does not carry an opened hint from a copy or a new file back to its source", async () => {
  const source = new EncodingSource([
    "diff --git a/src/old.txt b/src/copied.txt",
    "similarity index 100%",
    "copy from src/old.txt",
    "copy to src/copied.txt",
    "diff --git a/src/added.txt b/src/added.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/added.txt",
    "@@ -0,0 +1 @@",
    "+new",
    ""
  ].join("\n"));
  const resolver = new GitReviewContextResolver({ stableHash: hash });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const files = { old: file("old", "src/old.txt") };

  await mapperFor(source).map({
    current,
    contextState: contextState(current.contextId, files),
    globalState: globalState(files),
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: true, ignoreEolChanges: true },
    encodingHintsByPath: { "src/copied.txt": "shift_jis", "src/added.txt": "utf8" }
  });

  assert.ok(source.reads.some(([path, hint]) => path === "src/old.txt" && hint === undefined));
});

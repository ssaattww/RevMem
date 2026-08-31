import assert from "node:assert/strict";
import test from "node:test";

import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";
import {
  captureImmutableRevisionSnapshots,
  restoreImmutableRevisionSnapshots,
  validateImmutableRevisionSnapshots,
  type ImmutableRevisionSnapshotEvidence
} from "../../src/core/review-state/index";
import {
  createImmutablePullRequestRevisionMapper,
  type PullRequestReviewContextVisibility
} from "../../src/application/github-pr-context/index";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccccccccccc";
const BASE = "1111111111111111111111111111111111111111";
const PAIR = `${BASE}..${A}`;
const timestamp = "2026-08-31T00:00:00.000Z";

const contextState = (): ReviewContextState => ({
  schemaVersion: 1,
  contextId: "github-pr:github.com/example/repository#92",
  kind: "pull-request",
  repositoryId: "github.com/example/repository",
  displayName: "PR #92",
  pullRequest: {
    host: "github.com",
    owner: "example",
    repository: "repository",
    number: 92,
    state: "open",
    baseSha: BASE,
    headSha: A
  },
  files: {
    file: {
      schemaVersion: 1,
      fileId: "file",
      currentPath: "src/example.ts",
      previousPaths: [],
      revisionId: A,
      modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
      originalReviewedByDiff: { [PAIR]: [{ startLine: 1, endLineExclusive: 2 }] },
      contentHash: "content-a",
      lineCount: 3,
      updatedAt: timestamp
    }
  },
  createdAt: timestamp,
  updatedAt: timestamp
});

const globalState = (): RepositoryGlobalState => ({
  schemaVersion: 1,
  repositoryId: "github.com/example/repository",
  currentRevisionId: A,
  files: {
    file: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      reviewed: [{ startLine: 0, endLineExclusive: 2 }],
      contentHash: "content-a",
      updatedAt: timestamp
    }
  },
  updatedAt: timestamp
});

const evidence: ImmutableRevisionSnapshotEvidence = {
  revisionId: A,
  contextFiles: {
    file: { fileId: "file", currentPath: "src/example.ts", lineCount: 3, contentHash: "content-a" }
  },
  globalFiles: {
    file: { fileId: "file", currentPath: "src/example.ts", lineCount: 3, contentHash: "content-a" }
  }
};

test("captures a legacy current revision as non-recursive immutable snapshots without aliasing input", () => {
  const context = contextState();
  const global = globalState();
  const captured = captureImmutableRevisionSnapshots({ contextState: context, globalState: global, revisionId: A, updatedAt: timestamp });

  assert.deepEqual(Object.keys(captured.contextState.revisionSnapshots ?? {}), [A]);
  assert.deepEqual(Object.keys(captured.globalState.revisionSnapshots ?? {}), [A]);
  assert.equal("revisionSnapshots" in captured.contextState.revisionSnapshots![A]!.files.file!, false);
  context.files.file!.modifiedReviewed[0]!.endLineExclusive = 1;
  assert.deepEqual(captured.contextState.revisionSnapshots![A]!.files.file!.modifiedReviewed, [{ startLine: 0, endLineExclusive: 2 }]);
});

test("restores Context and Global snapshot hits independently after exact evidence validation", () => {
  const captured = captureImmutableRevisionSnapshots({ contextState: contextState(), globalState: globalState(), revisionId: A, updatedAt: timestamp });
  const result = restoreImmutableRevisionSnapshots({
    contextState: captured.contextState,
    globalState: { ...captured.globalState, revisionSnapshots: {} },
    evidence
  });

  assert.equal(result.context.kind, "hit");
  assert.equal(result.global.kind, "miss");
  if (result.context.kind === "hit") {
    assert.deepEqual(result.context.files.file?.originalReviewedByDiff[PAIR], [{ startLine: 1, endLineExclusive: 2 }]);
  }
});

/** Global-only immutable snapshots require authoritative line bounds before their reviewed state is adopted. */
test("rejects Global-only snapshot ranges without valid immutable line-count evidence", () => {
  const context = { ...contextState(), files: {} };
  const global = globalState();
  global.files["global-only"] = {
    fileId: "global-only",
    currentPath: "src/global-only.ts",
    revisionId: A,
    reviewed: [{ startLine: 0, endLineExclusive: 99 }],
    contentHash: "global-only-content",
    updatedAt: timestamp
  };
  delete global.files.file;
  const captured = captureImmutableRevisionSnapshots({
    contextState: context,
    globalState: global,
    revisionId: A,
    updatedAt: timestamp
  });
  const globalOnlyEvidence = (lineCount: unknown): ImmutableRevisionSnapshotEvidence => ({
    revisionId: A,
    contextFiles: {},
    globalFiles: {
      "global-only": {
        fileId: "global-only",
        currentPath: "src/global-only.ts",
        lineCount,
        contentHash: "global-only-content"
      } as unknown as ImmutableRevisionSnapshotEvidence["globalFiles"][string]
    }
  });

  for (const lineCount of [3, undefined, -1]) {
    assert.throws(() => restoreImmutableRevisionSnapshots({
      contextState: { ...captured.contextState, revisionSnapshots: {} },
      globalState: captured.globalState,
      evidence: globalOnlyEvidence(lineCount)
    }));
  }
});

test("rejects corrupt revision snapshot key, revision, file identity, path, hash, line, interval, and pair data", () => {
  const captured = captureImmutableRevisionSnapshots({ contextState: contextState(), globalState: globalState(), revisionId: A, updatedAt: timestamp });
  const corruptions: readonly ReviewContextState[] = [
    { ...captured.contextState, revisionSnapshots: { [B]: captured.contextState.revisionSnapshots![A]! } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, revisionId: B } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, fileId: "other" } } } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, currentPath: "../escape.ts" } } } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, contentHash: "" } } } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, lineCount: 1 } } } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, modifiedReviewed: [{ startLine: 2, endLineExclusive: 1 }] } } } } },
    { ...captured.contextState, revisionSnapshots: { [A]: { ...captured.contextState.revisionSnapshots![A]!, files: { file: { ...captured.contextState.revisionSnapshots![A]!.files.file!, originalReviewedByDiff: { invalid: [{ startLine: 1, endLineExclusive: 2 }] } } } } } }
  ];

  for (const context of corruptions) {
    assert.throws(() => validateImmutableRevisionSnapshots({ contextState: context, globalState: captured.globalState }));
  }
});

test("exact PR Context and Global hits validate once but restore saved A instead of mapping evidence", async () => {
  const atRevision = (revisionId: string, reviewed: readonly { startLine: number; endLineExclusive: number }[]) => {
    const context = contextState();
    const global = globalState();
    context.pullRequest = { ...context.pullRequest!, headSha: revisionId };
    context.files.file = { ...context.files.file!, revisionId, modifiedReviewed: [...reviewed] };
    global.currentRevisionId = revisionId;
    global.files.file = { ...global.files.file!, revisionId, reviewed: [...reviewed] };
    return captureImmutableRevisionSnapshots({ contextState: context, globalState: global, revisionId, updatedAt: timestamp });
  };
  const a = atRevision(A, [{ startLine: 0, endLineExclusive: 3 }]);
  const c = atRevision(C, [{ startLine: 0, endLineExclusive: 1 }]);
  const current = {
    contextState: {
      ...c.contextState,
      revisionSnapshots: { ...a.contextState.revisionSnapshots, ...c.contextState.revisionSnapshots }
    },
    globalState: {
      ...c.globalState,
      revisionSnapshots: { ...a.globalState.revisionSnapshots, ...c.globalState.revisionSnapshots }
    }
  };
  let loaderCalls = 0;
  const mapper = createImmutablePullRequestRevisionMapper(async (mapping) => {
    loaderCalls += 1;
    return {
      sourceBaseSha: mapping.sourceBaseSha,
      sourceHeadSha: mapping.sourceHeadSha,
      targetBaseSha: mapping.targetBaseSha,
      targetHeadSha: mapping.targetHeadSha,
      diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -1 +1 @@", "-changed", "+mapped", ""].join("\n"),
      oldTexts: { "src/example.ts": "changed\nkeep\nkeep\n" },
      newFiles: { "src/example.ts": { fileId: "file", newText: "mapped\nkeep\nkeep\n", lineCount: 3, contentHash: "content-a" } }
    };
  });
  const nextPullRequest: PullRequestReviewContextVisibility = { ...current.contextState.pullRequest!, headSha: A };

  const mapped = await mapper({
    current,
    nextPullRequest,
    evidence: {
      repositoryId: current.contextState.repositoryId,
      contextId: current.contextState.contextId,
      sourceBaseSha: BASE,
      sourceHeadSha: C,
      targetBaseSha: BASE,
      targetHeadSha: A
    }
  });

  assert.equal(loaderCalls, 1);
  assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 3 }]);
  assert.deepEqual(mapped.globalState.files.file?.reviewed, [{ startLine: 0, endLineExclusive: 3 }]);
});

test("maps only the missed immutable layer after one authoritative evidence load", async () => {
  const atRevision = (revisionId: string, reviewed: readonly { startLine: number; endLineExclusive: number }[]) => {
    const context = contextState();
    const global = globalState();
    context.pullRequest = { ...context.pullRequest!, headSha: revisionId };
    context.files.file = { ...context.files.file!, revisionId, lineCount: 4, modifiedReviewed: [...reviewed] };
    global.currentRevisionId = revisionId;
    global.files.file = { ...global.files.file!, revisionId, reviewed: [...reviewed] };
    return captureImmutableRevisionSnapshots({ contextState: context, globalState: global, revisionId, updatedAt: timestamp });
  };
  const a = atRevision(A, [{ startLine: 0, endLineExclusive: 3 }]);
  const c = atRevision(C, [{ startLine: 0, endLineExclusive: 1 }]);
  const mixedCases = [
    {
      name: "Context hit and Global miss",
      current: {
        contextState: { ...c.contextState, revisionSnapshots: { ...a.contextState.revisionSnapshots, ...c.contextState.revisionSnapshots } },
        globalState: { ...c.globalState, revisionSnapshots: { ...c.globalState.revisionSnapshots } }
      },
      contextReviewed: [{ startLine: 0, endLineExclusive: 3 }],
      globalReviewed: []
    },
    {
      name: "Context miss and Global hit",
      current: {
        contextState: { ...c.contextState, revisionSnapshots: { ...c.contextState.revisionSnapshots } },
        globalState: { ...c.globalState, revisionSnapshots: { ...a.globalState.revisionSnapshots, ...c.globalState.revisionSnapshots } }
      },
      contextReviewed: [],
      globalReviewed: [{ startLine: 0, endLineExclusive: 3 }]
    }
  ] as const;

  for (const scenario of mixedCases) {
    let loaderCalls = 0;
    const mapper = createImmutablePullRequestRevisionMapper(async (mapping) => {
      loaderCalls += 1;
      return {
        sourceBaseSha: mapping.sourceBaseSha,
        sourceHeadSha: mapping.sourceHeadSha,
        targetBaseSha: mapping.targetBaseSha,
        targetHeadSha: mapping.targetHeadSha,
        diff: ["diff --git a/src/example.ts b/src/example.ts", "--- a/src/example.ts", "+++ b/src/example.ts", "@@ -1 +1 @@", "-changed", "+mapped", ""].join("\n"),
        oldTexts: { "src/example.ts": "changed\nkeep\nkeep\n" },
        newFiles: { "src/example.ts": { fileId: "file", newText: "mapped\nkeep\nkeep\n", lineCount: 4, contentHash: "content-a" } }
      };
    });
    const mapped = await mapper({
      current: scenario.current,
      nextPullRequest: { ...scenario.current.contextState.pullRequest!, headSha: A },
      evidence: {
        repositoryId: scenario.current.contextState.repositoryId,
        contextId: scenario.current.contextState.contextId,
        sourceBaseSha: BASE,
        sourceHeadSha: C,
        targetBaseSha: BASE,
        targetHeadSha: A
      }
    });

    assert.equal(loaderCalls, 1, scenario.name);
    assert.equal(mapped.mappingDisposition, "mixed", scenario.name);
    assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, scenario.contextReviewed, scenario.name);
    assert.deepEqual(mapped.globalState.files.file?.reviewed, scenario.globalReviewed, scenario.name);
    assert.ok(mapped.contextState.revisionSnapshots?.[A], scenario.name);
    assert.ok(mapped.globalState.revisionSnapshots?.[A], scenario.name);
  }
});

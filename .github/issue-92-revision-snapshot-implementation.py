from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TEST_CONTENT = r'''import assert from "node:assert/strict";
import test from "node:test";

import {
  markReviewedRanges,
  restoreContextRevisionSnapshotFiles,
  restoreGlobalRevisionSnapshotFiles,
  synchronizeCurrentRevisionSnapshots,
  unmarkReviewedRanges
} from "../../src/core/review-state/index";
import {
  createImmutablePullRequestRevisionMapper,
  type ImmutablePullRequestRevisionEvidence
} from "../../src/application/github-pr-context/index";
import type {
  FileReviewState,
  GlobalFileReviewState,
  PullRequestReviewContext,
  RepositoryGlobalState,
  ReviewContextState
} from "../../src/core/contracts/index";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccccccccccc";
const BASE_A = "1111111111111111111111111111111111111111";
const BASE_B = "2222222222222222222222222222222222222222";
const CONTEXT_ID = "github-pr:github.com/ssaattww/RevMem#92";
const REPOSITORY_ID = "github.com/ssaattww/RevMem";

const full = [{ startLine: 0, endLineExclusive: 3 }];

const contextFile = (
  revisionId: string,
  reviewed = full,
  originalReviewedByDiff: FileReviewState["originalReviewedByDiff"] = {}
): FileReviewState => ({
  schemaVersion: 1,
  fileId: "file",
  currentPath: "src/example.ts",
  previousPaths: [],
  revisionId,
  modifiedReviewed: reviewed.map((range) => ({ ...range })),
  originalReviewedByDiff: Object.fromEntries(
    Object.entries(originalReviewedByDiff).map(([key, ranges]) => [
      key,
      ranges.map((range) => ({ ...range }))
    ])
  ),
  lineCount: 3,
  updatedAt: "2026-08-31T00:00:00.000Z"
});

const globalFile = (revisionId: string, reviewed = full): GlobalFileReviewState => ({
  fileId: "file",
  currentPath: "src/example.ts",
  revisionId,
  reviewed: reviewed.map((range) => ({ ...range })),
  updatedAt: "2026-08-31T00:00:00.000Z"
});

const pullRequest = (baseSha: string, headSha: string): PullRequestReviewContext => ({
  host: "github.com",
  owner: "ssaattww",
  repository: "RevMem",
  number: 92,
  state: "open",
  baseSha,
  headSha
});

const contextState = (revisionId: string): ReviewContextState => ({
  schemaVersion: 1,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #92",
  pullRequest: pullRequest(BASE_A, revisionId),
  files: { file: contextFile(revisionId) },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
});

const globalState = (revisionId: string): RepositoryGlobalState => ({
  schemaVersion: 1,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: revisionId,
  files: { file: globalFile(revisionId) },
  updatedAt: "2026-08-31T00:00:00.000Z"
});

const snapshotAt = (
  context: ReviewContextState,
  global: RepositoryGlobalState,
  revisionId: string,
  timestamp: string
) => synchronizeCurrentRevisionSnapshots({
  contextState: context,
  globalState: global,
  revisionId,
  updatedAt: timestamp
});

test("legacy state seeds only the current immutable revision snapshot", () => {
  const seeded = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");

  assert.deepEqual(Object.keys(seeded.contextState.revisionSnapshots ?? {}), [A]);
  assert.deepEqual(Object.keys(seeded.globalState.revisionSnapshots ?? {}), [A]);
  assert.deepEqual(
    restoreContextRevisionSnapshotFiles(seeded.contextState, A)?.file?.modifiedReviewed,
    full
  );
  assert.deepEqual(
    restoreGlobalRevisionSnapshotFiles(seeded.globalState, A)?.file?.reviewed,
    full
  );
  assert.equal(restoreContextRevisionSnapshotFiles(seeded.contextState, B), undefined);
});

test("review operations update the active revision snapshot without changing other revisions", () => {
  let states = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");

  const bContext = { ...contextState(B), files: { file: contextFile(B, [{ startLine: 0, endLineExclusive: 1 }]) } };
  const bGlobal = { ...globalState(B), files: { file: globalFile(B, [{ startLine: 0, endLineExclusive: 1 }]) } };
  const bStates = snapshotAt(bContext, bGlobal, B, "2026-08-31T00:02:00.000Z");
  states = {
    contextState: {
      ...states.contextState,
      revisionSnapshots: {
        ...states.contextState.revisionSnapshots,
        ...bStates.contextState.revisionSnapshots
      }
    },
    globalState: {
      ...states.globalState,
      revisionSnapshots: {
        ...states.globalState.revisionSnapshots,
        ...bStates.globalState.revisionSnapshots
      }
    }
  };

  const transaction = unmarkReviewedRanges({
    contextState: states.contextState,
    globalState: states.globalState,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 1, endLineExclusive: 2 }],
    occurredAt: "2026-08-31T00:03:00.000Z"
  });

  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.deepEqual(
    transaction.next.globalState.revisionSnapshots?.[A]?.files.file?.reviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[B]?.files.file?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 1 }]
  );
});

test("C to exact A restores A review snapshots without loading a reverse diff", async () => {
  const a = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");
  const b = snapshotAt(contextState(B), globalState(B), B, "2026-08-31T00:02:00.000Z");
  const c = snapshotAt(contextState(C), globalState(C), C, "2026-08-31T00:03:00.000Z");
  const current = {
    contextState: {
      ...c.contextState,
      revisionSnapshots: {
        ...a.contextState.revisionSnapshots,
        ...b.contextState.revisionSnapshots,
        ...c.contextState.revisionSnapshots
      }
    },
    globalState: {
      ...c.globalState,
      revisionSnapshots: {
        ...a.globalState.revisionSnapshots,
        ...b.globalState.revisionSnapshots,
        ...c.globalState.revisionSnapshots
      }
    }
  };
  let evidenceLoads = 0;
  const mapper = createImmutablePullRequestRevisionMapper(async () => {
    evidenceLoads += 1;
    throw new Error("exact snapshot restoration must not request reverse diff evidence");
  });

  const mapped = await mapper({
    current,
    nextPullRequest: pullRequest(BASE_A, A),
    evidence: {
      repositoryId: REPOSITORY_ID,
      contextId: CONTEXT_ID,
      sourceBaseSha: BASE_A,
      sourceHeadSha: C,
      targetBaseSha: BASE_A,
      targetHeadSha: A
    }
  });

  assert.equal(evidenceLoads, 0);
  assert.equal(mapped.mappingDisposition, "restored");
  assert.equal(mapped.contextState.pullRequest?.headSha, A);
  assert.equal(mapped.globalState.currentRevisionId, A);
  assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, full);
  assert.deepEqual(mapped.globalState.files.file?.reviewed, full);
});

test("a Context snapshot hit can be combined atomically with a mapped Global miss", async () => {
  const a = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");
  const c = snapshotAt(contextState(C), globalState(C), C, "2026-08-31T00:03:00.000Z");
  const current = {
    contextState: {
      ...c.contextState,
      revisionSnapshots: {
        ...a.contextState.revisionSnapshots,
        ...c.contextState.revisionSnapshots
      }
    },
    globalState: {
      ...c.globalState,
      revisionSnapshots: { ...c.globalState.revisionSnapshots }
    }
  };
  const immutable = {
    sourceBaseSha: BASE_A,
    sourceHeadSha: C,
    targetBaseSha: BASE_A,
    targetHeadSha: A,
    diff: [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -2 +2 @@",
      "-BBB2",
      "+BBB",
      "@@ -3 +3 @@",
      "-CCC3",
      "+CCC",
      ""
    ].join("\n"),
    oldTexts: { "src/example.ts": "AAA\nBBB2\nCCC3\n" },
    newFiles: {
      "src/example.ts": {
        newText: "AAA\nBBB\nCCC\n",
        lineCount: 3
      }
    },
    updatedAt: "2026-08-31T00:04:00.000Z"
  } as unknown as ImmutablePullRequestRevisionEvidence;
  const mapper = createImmutablePullRequestRevisionMapper(async () => immutable);

  const mapped = await mapper({
    current,
    nextPullRequest: pullRequest(BASE_A, A),
    evidence: {
      repositoryId: REPOSITORY_ID,
      contextId: CONTEXT_ID,
      sourceBaseSha: BASE_A,
      sourceHeadSha: C,
      targetBaseSha: BASE_A,
      targetHeadSha: A
    }
  });

  assert.equal(mapped.mappingDisposition, "mixed");
  assert.deepEqual(mapped.contextState.files.file?.modifiedReviewed, full);
  assert.deepEqual(
    mapped.globalState.files.file?.reviewed,
    [{ startLine: 0, endLineExclusive: 1 }]
  );
  assert.ok(mapped.contextState.revisionSnapshots?.[A]);
  assert.ok(mapped.globalState.revisionSnapshots?.[A]);
});

test("base-only PR update retains historical original comparison ranges", async () => {
  const oldPair = `${BASE_A}..${C}`;
  const context = {
    ...contextState(C),
    files: {
      file: contextFile(C, full, {
        [oldPair]: [{ startLine: 1, endLineExclusive: 2 }]
      })
    }
  };
  const current = snapshotAt(context, globalState(C), C, "2026-08-31T00:03:00.000Z");
  const mapper = createImmutablePullRequestRevisionMapper(async () => {
    throw new Error("base-only update must not load revision diff evidence");
  });

  const mapped = await mapper({
    current,
    nextPullRequest: pullRequest(BASE_B, C),
    evidence: {
      repositoryId: REPOSITORY_ID,
      contextId: CONTEXT_ID,
      sourceBaseSha: BASE_A,
      sourceHeadSha: C,
      targetBaseSha: BASE_B,
      targetHeadSha: C
    }
  });

  assert.deepEqual(
    mapped.contextState.files.file?.originalReviewedByDiff[oldPair],
    [{ startLine: 1, endLineExclusive: 2 }]
  );
  assert.equal(mapped.contextState.pullRequest?.baseSha, BASE_B);
});

test("corrupt exact revision snapshot is rejected instead of being partially restored", () => {
  const state = snapshotAt(contextState(A), globalState(A), A, "2026-08-31T00:01:00.000Z");
  const corrupt: ReviewContextState = {
    ...state.contextState,
    revisionSnapshots: {
      ...state.contextState.revisionSnapshots,
      [A]: {
        ...state.contextState.revisionSnapshots?.[A],
        schemaVersion: 1,
        revisionId: B,
        files: { file: contextFile(A) },
        updatedAt: "2026-08-31T00:01:00.000Z"
      }
    }
  };

  assert.throws(
    () => restoreContextRevisionSnapshotFiles(corrupt, A),
    /revision key/i
  );
});

test("mark after restoring A changes A snapshot and leaves C snapshot untouched", () => {
  const aContext = { ...contextState(A), files: { file: contextFile(A, []) } };
  const aGlobal = { ...globalState(A), files: { file: globalFile(A, []) } };
  const a = snapshotAt(aContext, aGlobal, A, "2026-08-31T00:01:00.000Z");
  const c = snapshotAt(contextState(C), globalState(C), C, "2026-08-31T00:03:00.000Z");
  const context: ReviewContextState = {
    ...a.contextState,
    revisionSnapshots: {
      ...a.contextState.revisionSnapshots,
      ...c.contextState.revisionSnapshots
    }
  };
  const global: RepositoryGlobalState = {
    ...a.globalState,
    revisionSnapshots: {
      ...a.globalState.revisionSnapshots,
      ...c.globalState.revisionSnapshots
    }
  };

  const transaction = markReviewedRanges({
    contextState: context,
    globalState: global,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: A,
      lineCount: 3
    },
    intervals: [{ startLine: 0, endLineExclusive: 1 }],
    occurredAt: "2026-08-31T00:05:00.000Z"
  });

  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[A]?.files.file?.modifiedReviewed,
    [{ startLine: 0, endLineExclusive: 1 }]
  );
  assert.deepEqual(
    transaction.next.contextState.revisionSnapshots?.[C]?.files.file?.modifiedReviewed,
    full
  );
});
'''

REVISION_SNAPSHOT_SERVICE = r'''import type {
  FileReviewState,
  GlobalFileReviewState,
  RepositoryGlobalRevisionSnapshot,
  RepositoryGlobalState,
  ReviewContextRevisionSnapshot,
  ReviewContextState
} from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIFF_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\.\.(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const requireObjectId = (value: string, name: string): void => {
  if (!FULL_OBJECT_ID.test(value)) throw new Error(`${name} must be a lowercase full Git object ID.`);
};

const requireTimestamp = (value: string, name: string): void => {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO 8601 timestamp.`);
  }
};

const requireCanonicalIntervals = (
  intervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
  lineCount: number | undefined,
  name: string
): void => {
  const normalized = normalizeLineIntervals(intervals);
  if (JSON.stringify(normalized) !== JSON.stringify(intervals)) {
    throw new Error(`${name} must contain canonical normalized intervals.`);
  }
  if (lineCount !== undefined && normalized.some((range) => range.endLineExclusive > lineCount)) {
    throw new Error(`${name} exceeds the snapshot file line count.`);
  }
};

const validateContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId) throw new Error(`${name} file key and fileId must match.`);
    if (file.currentPath.trim().length === 0 || paths.has(file.currentPath)) {
      throw new Error(`${name} file paths must be non-empty and unique.`);
    }
    paths.add(file.currentPath);
    if (file.revisionId !== revisionId) throw new Error(`${name} file revision must match the snapshot revision.`);
    if (!Number.isSafeInteger(file.lineCount) || file.lineCount < 0) {
      throw new Error(`${name} file lineCount must be a non-negative safe integer.`);
    }
    requireCanonicalIntervals(file.modifiedReviewed, file.lineCount, `${name}.modifiedReviewed`);
    for (const [diffId, ranges] of Object.entries(file.originalReviewedByDiff)) {
      if (!DIFF_ID.test(diffId)) throw new Error(`${name} original diff ID must be a canonical revision pair.`);
      requireCanonicalIntervals(ranges, undefined, `${name}.originalReviewedByDiff`);
    }
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name} contentHash must not be empty.`);
    }
    requireTimestamp(file.updatedAt, `${name}.updatedAt`);
  }
};

const validateGlobalFiles = (
  files: Readonly<Record<string, Readonly<GlobalFileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId) throw new Error(`${name} file key and fileId must match.`);
    if (file.currentPath.trim().length === 0 || paths.has(file.currentPath)) {
      throw new Error(`${name} file paths must be non-empty and unique.`);
    }
    paths.add(file.currentPath);
    if (file.revisionId !== revisionId) throw new Error(`${name} file revision must match the snapshot revision.`);
    requireCanonicalIntervals(file.reviewed, undefined, `${name}.reviewed`);
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name} contentHash must not be empty.`);
    }
    requireTimestamp(file.updatedAt, `${name}.updatedAt`);
  }
};

const contextRevision = (state: Readonly<ReviewContextState>): string | undefined => {
  if (state.kind === "pull-request") return state.pullRequest?.headSha;
  if (state.kind === "branch") return state.branch?.headRevision;
  return undefined;
};

/** Synchronizes the authoritative current Git state into revision-keyed Context and Global snapshots. */
export const synchronizeCurrentRevisionSnapshots = (input: {
  readonly contextState: Readonly<ReviewContextState>;
  readonly globalState: Readonly<RepositoryGlobalState>;
  readonly revisionId: string;
  readonly updatedAt: string;
}): { readonly contextState: ReviewContextState; readonly globalState: RepositoryGlobalState } => {
  const descriptorRevision = contextRevision(input.contextState);
  if (descriptorRevision === undefined) {
    return {
      contextState: clone(input.contextState),
      globalState: clone(input.globalState)
    };
  }
  requireObjectId(input.revisionId, "revisionId");
  if (descriptorRevision !== input.revisionId) {
    throw new Error("Context descriptor revision must match the snapshot revision.");
  }
  if (input.globalState.currentRevisionId !== input.revisionId) {
    throw new Error("Global current revision must match the snapshot revision.");
  }
  requireTimestamp(input.updatedAt, "updatedAt");
  validateContextFiles(input.contextState.files, input.revisionId, "Context current files");
  validateGlobalFiles(input.globalState.files, input.revisionId, "Global current files");

  const contextSnapshot: ReviewContextRevisionSnapshot = {
    schemaVersion: input.contextState.schemaVersion,
    revisionId: input.revisionId,
    files: clone(input.contextState.files),
    updatedAt: input.updatedAt
  };
  const globalSnapshot: RepositoryGlobalRevisionSnapshot = {
    schemaVersion: input.globalState.schemaVersion,
    revisionId: input.revisionId,
    files: clone(input.globalState.files),
    updatedAt: input.updatedAt
  };

  return {
    contextState: {
      ...clone(input.contextState),
      revisionSnapshots: {
        ...clone(input.contextState.revisionSnapshots ?? {}),
        [input.revisionId]: contextSnapshot
      }
    },
    globalState: {
      ...clone(input.globalState),
      revisionSnapshots: {
        ...clone(input.globalState.revisionSnapshots ?? {}),
        [input.revisionId]: globalSnapshot
      }
    }
  };
};

const validateContextSnapshot = (
  state: Readonly<ReviewContextState>,
  revisionId: string,
  snapshot: Readonly<ReviewContextRevisionSnapshot>
): void => {
  if (snapshot.schemaVersion !== state.schemaVersion) throw new Error("Context revision snapshot schema must match current state.");
  if (snapshot.revisionId !== revisionId) throw new Error("Context revision snapshot revision key does not match its payload.");
  requireTimestamp(snapshot.updatedAt, "Context revision snapshot updatedAt");
  validateContextFiles(snapshot.files, revisionId, "Context revision snapshot");
};

const validateGlobalSnapshot = (
  state: Readonly<RepositoryGlobalState>,
  revisionId: string,
  snapshot: Readonly<RepositoryGlobalRevisionSnapshot>
): void => {
  if (snapshot.schemaVersion !== state.schemaVersion) throw new Error("Global revision snapshot schema must match current state.");
  if (snapshot.revisionId !== revisionId) throw new Error("Global revision snapshot revision key does not match its payload.");
  requireTimestamp(snapshot.updatedAt, "Global revision snapshot updatedAt");
  validateGlobalFiles(snapshot.files, revisionId, "Global revision snapshot");
};

/** Returns a validated clone of an exact Context revision snapshot, or undefined on a true miss. */
export const restoreContextRevisionSnapshotFiles = (
  state: Readonly<ReviewContextState>,
  revisionId: string
): Record<string, FileReviewState> | undefined => {
  requireObjectId(revisionId, "revisionId");
  const snapshot = state.revisionSnapshots?.[revisionId];
  if (snapshot === undefined) return undefined;
  validateContextSnapshot(state, revisionId, snapshot);
  return clone(snapshot.files);
};

/** Returns a validated clone of an exact Global revision snapshot, or undefined on a true miss. */
export const restoreGlobalRevisionSnapshotFiles = (
  state: Readonly<RepositoryGlobalState>,
  revisionId: string
): Record<string, GlobalFileReviewState> | undefined => {
  requireObjectId(revisionId, "revisionId");
  const snapshot = state.revisionSnapshots?.[revisionId];
  if (snapshot === undefined) return undefined;
  validateGlobalSnapshot(state, revisionId, snapshot);
  return clone(snapshot.files);
};
'''

MAPPER_CONTENT = r'''import { mapRepositoryGlobalStateThroughGitDiff } from "../global-review-mapping/index";
import {
  applyGitFileStateTransitions,
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
  type GitFileStateTransitionInput,
  type GitNewFileStateInput,
} from "../../core/git-diff/index";
import {
  restoreContextRevisionSnapshotFiles,
  restoreGlobalRevisionSnapshotFiles,
  synchronizeCurrentRevisionSnapshots,
} from "../../core/review-state/index";
import type {
  FileReviewState,
  GlobalFileReviewState,
  RepositoryGlobalState,
} from "../../core/contracts/index";
import type {
  PullRequestRevisionMapper,
  PullRequestRevisionMappingDisposition,
  PullRequestRevisionMappingEvidence,
  PullRequestReviewStateCommit,
} from "./github-pull-request-context-layer-store";

export interface ImmutablePullRequestRevisionEvidence {
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly targetBaseSha: string;
  readonly targetHeadSha: string;
  readonly diff: string;
  readonly oldTexts: Readonly<Record<string, string>>;
  readonly newFiles: Readonly<Record<string, Readonly<GitNewFileStateInput>>>;
  readonly updatedAt?: string;
}

export type ImmutablePullRequestRevisionEvidenceLoader = (
  evidence: Readonly<PullRequestRevisionMappingEvidence>
) => Promise<ImmutablePullRequestRevisionEvidence>;

const DEFAULT_MAPPING_OPTIONS: GitFileStateTransitionInput["options"] = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false,
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const withDisposition = (
  commit: PullRequestReviewStateCommit,
  disposition: PullRequestRevisionMappingDisposition
): PullRequestReviewStateCommit => {
  Object.defineProperty(commit, "mappingDisposition", {
    value: disposition,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return commit;
};

const requireMatchingEvidence = (
  expected: Readonly<PullRequestRevisionMappingEvidence>,
  actual: Readonly<ImmutablePullRequestRevisionEvidence>,
  contextFiles: Readonly<Record<string, Readonly<FileReviewState>>>,
  globalFiles: Readonly<Record<string, Readonly<GlobalFileReviewState>>>
): void => {
  if (
    actual.sourceBaseSha !== expected.sourceBaseSha ||
    actual.sourceHeadSha !== expected.sourceHeadSha ||
    actual.targetBaseSha !== expected.targetBaseSha ||
    actual.targetHeadSha !== expected.targetHeadSha
  ) {
    throw new Error("Immutable PR revision evidence does not match the requested revision transition");
  }
  if (actual.diff.length === 0) throw new Error("Immutable PR revision evidence requires a complete diff");

  const trackedPaths = new Set([
    ...Object.values(contextFiles).map((file) => file.currentPath),
    ...Object.values(globalFiles).map((file) => file.currentPath),
  ]);
  for (const changed of parseZeroContextGitDiff(actual.diff).files) {
    const touchesTracked =
      (changed.oldPath !== undefined && trackedPaths.has(changed.oldPath)) ||
      (changed.newPath !== undefined && trackedPaths.has(changed.newPath));
    if (!touchesTracked) continue;
    if (changed.oldPath !== undefined && actual.oldTexts[changed.oldPath] === undefined) {
      throw new Error(`Immutable PR revision evidence is missing old blob text for ${changed.oldPath}`);
    }
    if (changed.newPath !== undefined) {
      const destination = actual.newFiles[changed.newPath];
      if (destination === undefined || destination.newText === undefined) {
        throw new Error(`Immutable PR revision evidence is missing new blob text for ${changed.newPath}`);
      }
    }
  }
};

const advanceRetainedContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string
): Record<string, FileReviewState> => Object.fromEntries(
  Object.entries(files).map(([fileId, file]) => [
    fileId,
    {
      ...file,
      revisionId,
      modifiedReviewed: file.modifiedReviewed.map((interval) => ({ ...interval })),
      originalReviewedByDiff: Object.fromEntries(
        Object.entries(file.originalReviewedByDiff).map(([diffId, intervals]) => [
          diffId,
          intervals.map((interval) => ({ ...interval })),
        ])
      ),
    },
  ])
);

const mapContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  immutable: Readonly<ImmutablePullRequestRevisionEvidence>,
  revisionId: string,
  updatedAt: string,
  options: GitFileStateTransitionInput["options"]
): Record<string, FileReviewState> => {
  const parsed = parseZeroContextGitDiff(immutable.diff);
  const transition = applyGitFileStateTransitions({
    files,
    diff: immutable.diff,
    newRevisionId: revisionId,
    updatedAt,
    options,
    oldTexts: immutable.oldTexts,
    newFiles: immutable.newFiles,
  });
  if (transition.unresolved.length > 0) {
    throw new Error(`Immutable PR revision mapping is unresolved: ${transition.unresolved.map((item) => item.reason).join(", ")}`);
  }

  const contextFiles = advanceRetainedContextFiles(transition.files, revisionId);
  const originalByPath = new Map(Object.values(files).map((file) => [file.currentPath, file]));
  for (const diffFile of parsed.files) {
    if (
      diffFile.isRename ||
      diffFile.oldPath === undefined ||
      diffFile.newPath === undefined ||
      diffFile.oldPath !== diffFile.newPath
    ) {
      continue;
    }
    const original = originalByPath.get(diffFile.oldPath);
    if (original === undefined) continue;
    const transitioned = contextFiles[original.fileId];
    const destination = immutable.newFiles[diffFile.newPath];
    if (transitioned === undefined || destination === undefined) continue;
    const mapped = mapReviewedIntervalsAcrossDiff({
      reviewed: original.modifiedReviewed,
      diff: immutable.diff,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      oldText: immutable.oldTexts[diffFile.oldPath],
      newText: destination.newText,
      options,
    });
    contextFiles[original.fileId] = {
      ...transitioned,
      revisionId,
      modifiedReviewed: mapped.reviewed,
      lineCount: destination.lineCount,
      ...(destination.contentHash === undefined
        ? { contentHash: undefined }
        : { contentHash: destination.contentHash }),
      updatedAt,
    };
  }
  return contextFiles;
};

const mapGlobalFiles = (
  globalState: Readonly<RepositoryGlobalState>,
  immutable: Readonly<ImmutablePullRequestRevisionEvidence>,
  revisionId: string,
  updatedAt: string,
  options: GitFileStateTransitionInput["options"]
): Record<string, GlobalFileReviewState> => mapRepositoryGlobalStateThroughGitDiff({
  globalState,
  diff: immutable.diff,
  newRevisionId: revisionId,
  updatedAt,
  options,
  oldTexts: immutable.oldTexts,
  newFiles: immutable.newFiles,
}).files;

export function createImmutablePullRequestRevisionMapper(
  loadEvidence: ImmutablePullRequestRevisionEvidenceLoader,
  options: GitFileStateTransitionInput["options"] = DEFAULT_MAPPING_OPTIONS
): PullRequestRevisionMapper {
  return async ({ current, nextPullRequest, evidence }) => {
    const sourceUpdatedAt = current.contextState.updatedAt;
    const source = synchronizeCurrentRevisionSnapshots({
      contextState: current.contextState,
      globalState: current.globalState,
      revisionId: evidence.sourceHeadSha,
      updatedAt: sourceUpdatedAt,
    });

    const baseOnlyTransition =
      evidence.sourceHeadSha === evidence.targetHeadSha &&
      evidence.sourceBaseSha !== evidence.targetBaseSha;
    if (baseOnlyTransition) {
      const updatedAt = new Date().toISOString();
      const synchronized = synchronizeCurrentRevisionSnapshots({
        contextState: {
          ...source.contextState,
          pullRequest: { ...nextPullRequest },
          files: clone(source.contextState.files),
          updatedAt,
        },
        globalState: {
          ...source.globalState,
          currentRevisionId: evidence.targetHeadSha,
          files: clone(source.globalState.files),
          updatedAt,
        },
        revisionId: evidence.targetHeadSha,
        updatedAt,
      });
      return withDisposition(synchronized, "restored");
    }

    const restoredContextFiles = restoreContextRevisionSnapshotFiles(
      source.contextState,
      evidence.targetHeadSha
    );
    const restoredGlobalFiles = restoreGlobalRevisionSnapshotFiles(
      source.globalState,
      evidence.targetHeadSha
    );

    let immutable: ImmutablePullRequestRevisionEvidence | undefined;
    if (restoredContextFiles === undefined || restoredGlobalFiles === undefined) {
      immutable = await loadEvidence(Object.freeze({ ...evidence }));
      requireMatchingEvidence(
        evidence,
        immutable,
        restoredContextFiles === undefined ? source.contextState.files : {},
        restoredGlobalFiles === undefined ? source.globalState.files : {}
      );
    }
    const updatedAt = immutable?.updatedAt ?? new Date().toISOString();

    const contextFiles = restoredContextFiles ?? mapContextFiles(
      source.contextState.files,
      immutable!,
      evidence.targetHeadSha,
      updatedAt,
      options
    );
    const globalFiles = restoredGlobalFiles ?? mapGlobalFiles(
      source.globalState,
      immutable!,
      evidence.targetHeadSha,
      updatedAt,
      options
    );

    const synchronized = synchronizeCurrentRevisionSnapshots({
      contextState: {
        ...source.contextState,
        pullRequest: { ...nextPullRequest },
        files: contextFiles,
        updatedAt,
      },
      globalState: {
        ...source.globalState,
        currentRevisionId: evidence.targetHeadSha,
        files: globalFiles,
        updatedAt,
      },
      revisionId: evidence.targetHeadSha,
      updatedAt,
    });

    const disposition: PullRequestRevisionMappingDisposition =
      restoredContextFiles !== undefined && restoredGlobalFiles !== undefined
        ? "restored"
        : restoredContextFiles !== undefined || restoredGlobalFiles !== undefined
          ? "mixed"
          : "mapped";
    return withDisposition(synchronized, disposition);
  };
}
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")
    return text.replace(old, new, 1)


def write_tests() -> None:
    path = ROOT / "test/unit/immutable-revision-review-snapshot.test.ts"
    path.write_text(TEST_CONTENT, encoding="utf-8")
    package = ROOT / "package.json"
    text = package.read_text(encoding="utf-8")
    test_entry = "test-dist/test/unit/immutable-revision-review-snapshot.test.js"
    if test_entry not in text:
        anchor = "test-dist/test/unit/github-pr-context-layer-store.test.js"
        if anchor not in text:
            raise RuntimeError("package test anchor was not found")
        text = text.replace(anchor, f"{anchor} {test_entry}")
    package.write_text(text, encoding="utf-8")


def update_contracts() -> None:
    path = ROOT / "src/core/contracts/review-state.ts"
    text = path.read_text(encoding="utf-8")
    if "export interface ReviewContextRevisionSnapshot" not in text:
        anchor = "/**\n * The unit that isolates review state for a pull request, branch, workspace, or external file.\n */"
        addition = '''/** Immutable Context review state retained for one exact Git revision. */
export interface ReviewContextRevisionSnapshot {
  /** Persisted-document version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Lowercase full immutable Git commit object ID. */
  revisionId: string;
  /** Complete Context file state at this exact revision. */
  files: Record<string, FileReviewState>;
  /** ISO 8601 timestamp of the last successful update to this revision snapshot. */
  updatedAt: string;
}

'''
        text = replace_once(text, anchor, addition + anchor, "Context snapshot contract insertion")
    context_files = """  /** File state keyed by stable file ID. */
  files: Record<string, FileReviewState>;
"""
    context_replacement = context_files + """  /** Exact immutable Git revision snapshots keyed by full commit object ID. */
  revisionSnapshots?: Record<string, ReviewContextRevisionSnapshot>;
"""
    if "revisionSnapshots?: Record<string, ReviewContextRevisionSnapshot>" not in text:
        text = replace_once(text, context_files, context_replacement, "Context revisionSnapshots field")

    if "export interface RepositoryGlobalRevisionSnapshot" not in text:
        anchor = "/**\n * Persisted owner-wide Global layer; it contains only currently valid ranges.\n */"
        addition = '''/** Immutable owner-wide Global review state retained for one exact Git revision. */
export interface RepositoryGlobalRevisionSnapshot {
  /** Persisted-document version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Lowercase full immutable Git commit object ID. */
  revisionId: string;
  /** Complete Global file state at this exact revision. */
  files: Record<string, GlobalFileReviewState>;
  /** ISO 8601 timestamp of the last successful update to this revision snapshot. */
  updatedAt: string;
}

'''
        text = replace_once(text, anchor, addition + anchor, "Global snapshot contract insertion")
    global_files = """  /** Global file state keyed by stable file ID. */
  files: Record<string, GlobalFileReviewState>;
"""
    global_replacement = global_files + """  /** Exact immutable Git revision snapshots keyed by full commit object ID. */
  revisionSnapshots?: Record<string, RepositoryGlobalRevisionSnapshot>;
"""
    if "revisionSnapshots?: Record<string, RepositoryGlobalRevisionSnapshot>" not in text:
        text = replace_once(text, global_files, global_replacement, "Global revisionSnapshots field")
    path.write_text(text, encoding="utf-8")


def update_review_state_service() -> None:
    service_path = ROOT / "src/core/review-state/review-state-service.ts"
    text = service_path.read_text(encoding="utf-8")
    import_anchor = 'import { normalizeLineIntervals, subtractLineIntervals } from "../intervals/index";\n'
    import_line = 'import { synchronizeCurrentRevisionSnapshots } from "./revision-snapshot-service";\n'
    if import_line not in text:
        text = replace_once(text, import_anchor, import_anchor + import_line, "review state snapshot import")

    start = text.index("function createTransaction(")
    end = text.index("function currentContextRanges", start)
    replacement = r'''function createTransaction(operation: ModifiedReviewStateTransaction["operation"], input: ReviewStateMutationInput, modifiedReviewed: readonly LineInterval[], globalReviewed: readonly LineInterval[], originalReviewedByDiff?: Readonly<Record<string, readonly LineInterval[]>>): ModifiedReviewStateTransaction {
  validateMappedCurrentInput(input);
  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const nextInput: ReviewStateMutationInput = { ...input, contextState: cloneValue(input.contextState), globalState: cloneValue(input.globalState), target: cloneValue(input.target) };
  const contextFile = createContextFileState(nextInput, modifiedReviewed, originalReviewedByDiff);
  const globalFile = createGlobalFileState(nextInput, globalReviewed);
  const synchronized = synchronizeCurrentRevisionSnapshots({
    contextState: {
      ...nextInput.contextState,
      files: { ...nextInput.contextState.files, [nextInput.target.fileId]: contextFile },
      updatedAt: nextInput.occurredAt
    },
    globalState: {
      ...nextInput.globalState,
      currentRevisionId: nextInput.target.revisionId,
      files: { ...nextInput.globalState.files, [nextInput.target.fileId]: globalFile },
      updatedAt: nextInput.occurredAt
    },
    revisionId: nextInput.target.revisionId,
    updatedAt: nextInput.occurredAt
  });
  return {
    operation,
    repositoryId: nextInput.contextState.repositoryId,
    contextId: nextInput.contextState.contextId,
    fileId: nextInput.target.fileId,
    expected: { contextState: expectedContextState, globalState: expectedGlobalState },
    next: synchronized
  };
}
'''
    text = text[:start] + replacement + text[end:]

    start = text.index("function createOriginalTransaction(")
    end = text.index("/** Marks immutable original-side deletion intervals", start)
    replacement = r'''function createOriginalTransaction(operation: OriginalReviewStateTransaction["operation"], input: OriginalReviewRangeMutationInput, reviewed: readonly LineInterval[]): OriginalReviewStateTransaction {
  const expectedContextState = cloneValue(input.contextState);
  const expectedGlobalState = cloneValue(input.globalState);
  const previous = input.contextState.files[input.target.fileId];
  const originalReviewedByDiff = normalizeOriginalReviewedByDiff(previous?.originalReviewedByDiff);
  originalReviewedByDiff[input.diffId] = normalizeWithinFile(reviewed, input.originalLineCount, "originalReviewedByDiff");
  const nextInput: ReviewStateMutationInput = { ...input, contextState: cloneValue(input.contextState), globalState: cloneValue(input.globalState), target: cloneValue(input.target) };
  const contextFile = createContextFileState(nextInput, currentContextRanges(input), originalReviewedByDiff);
  const synchronized = synchronizeCurrentRevisionSnapshots({
    contextState: {
      ...nextInput.contextState,
      files: { ...nextInput.contextState.files, [input.target.fileId]: contextFile },
      updatedAt: input.occurredAt
    },
    globalState: cloneValue(nextInput.globalState),
    revisionId: nextInput.target.revisionId,
    updatedAt: input.occurredAt
  });
  return {
    operation,
    repositoryId: input.contextState.repositoryId,
    contextId: input.contextState.contextId,
    fileId: input.target.fileId,
    side: "original",
    diffId: input.diffId,
    expected: { contextState: expectedContextState, globalState: expectedGlobalState },
    next: synchronized
  };
}
'''
    text = text[:start] + replacement + text[end:]
    service_path.write_text(text, encoding="utf-8")


def update_review_state_index() -> None:
    path = ROOT / "src/core/review-state/index.ts"
    text = path.read_text(encoding="utf-8")
    export = 'export * from "./revision-snapshot-service";\n'
    if export not in text:
        if not text.endswith("\n"):
            text += "\n"
        text += export
    path.write_text(text, encoding="utf-8")


def update_whole_file_review() -> None:
    path = ROOT / "src/application/review-commands/diff-editor-review-command-service.ts"
    text = path.read_text(encoding="utf-8")
    start = text.index("const markDiffFileReviewed = (")
    end = text.index("/** Applies selection and whole-file review commands", start)
    replacement = r'''const markDiffFileReviewed = (
  input: ReviewStateMutationInput,
  diffId: string,
  originalLineCount: number,
  originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[]
): ReviewStateTransaction => {
  if (diffId.trim().length === 0) throw new TypeError("diffId must be a non-empty string.");
  if (!Number.isSafeInteger(originalLineCount) || originalLineCount < 0) {
    throw new RangeError("originalLineCount must be a non-negative safe integer.");
  }
  const deletions = normalizeLineIntervals(originalDeletionIntervals);
  if (deletions.some((range) => range.endLineExclusive > originalLineCount)) {
    throw new RangeError("original deletion intervals must stay within the original file.");
  }
  const modified = markFileReviewed(input);
  if (deletions.length === 0) return modified;
  const original = markOriginalReviewedRanges({
    contextState: modified.next.contextState,
    globalState: modified.next.globalState,
    target: input.target,
    occurredAt: input.occurredAt,
    side: "original",
    diffId,
    originalLineCount,
    intervals: deletions
  });
  return {
    ...modified,
    next: original.next
  };
};

'''
    text = text[:start] + replacement + text[end:]
    path.write_text(text, encoding="utf-8")


def update_context_store() -> None:
    path = ROOT / "src/application/github-pr-context/github-pull-request-context-layer-store.ts"
    text = path.read_text(encoding="utf-8")
    interface_old = '''export interface PullRequestReviewStateCommit {
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
}
'''
    interface_new = '''export type PullRequestRevisionMappingDisposition = "mapped" | "restored" | "mixed";

export interface PullRequestReviewStateCommit {
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
  /** Non-persisted mapper result used only to select the history reason. */
  readonly mappingDisposition?: PullRequestRevisionMappingDisposition;
}
'''
    if "PullRequestRevisionMappingDisposition" not in text:
        text = replace_once(text, interface_old, interface_new, "mapping disposition contract")

    text = replace_once(
        text,
        "    let next: PullRequestReviewStateCommit;\n",
        "    let next: PullRequestReviewStateCommit;\n    let mappingDisposition: PullRequestRevisionMappingDisposition = \"mapped\";\n",
        "mapping disposition local",
    )
    old_map = '''      next = await this.mapRevision({ current: cloneCommit(current), nextPullRequest: cloneValue(nextPullRequest), evidence });
      requireMappedCommit(next, current, nextPullRequest, evidence);
'''
    new_map = '''      const mapped = await this.mapRevision({ current: cloneCommit(current), nextPullRequest: cloneValue(nextPullRequest), evidence });
      requireMappedCommit(mapped, current, nextPullRequest, evidence);
      mappingDisposition = mapped.mappingDisposition ?? "mapped";
      next = {
        contextState: cloneValue(mapped.contextState),
        globalState: cloneValue(mapped.globalState)
      };
'''
    text = replace_once(text, old_map, new_map, "mapped commit normalization")
    old_history = '''    if (revisionChanged) await this.historyRecorder?.recordRevisionMapping(cloneCommit(current), cloneCommit(next));
'''
    new_history = '''    if (revisionChanged) {
      await this.historyRecorder?.recordRevisionMapping(
        cloneCommit(current),
        cloneCommit(next),
        revisionMappingReason(mappingDisposition)
      );
    }
'''
    text = replace_once(text, old_history, new_history, "revision history reason")
    helper_anchor = "function preserveVisibilityOverride("
    helper = '''function revisionMappingReason(disposition: PullRequestRevisionMappingDisposition): string {
  if (disposition === "restored") return "exact-revision-snapshot-restored";
  if (disposition === "mixed") return "exact-revision-snapshot-partially-restored";
  return "git-revision-mapped";
}

'''
    if helper not in text:
        text = replace_once(text, helper_anchor, helper + helper_anchor, "revision reason helper")
    path.write_text(text, encoding="utf-8")


def update_mapper() -> None:
    path = ROOT / "src/application/github-pr-context/immutable-pull-request-revision-mapper.ts"
    path.write_text(MAPPER_CONTENT, encoding="utf-8")


def update_design_contract_tests() -> None:
    path = ROOT / "test/unit/design-document-structure.test.ts"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    text = text.replace("設計書 rev8", "設計書 rev9")
    path.write_text(text, encoding="utf-8")


def implement() -> None:
    update_contracts()
    module = ROOT / "src/core/review-state/revision-snapshot-service.ts"
    module.write_text(REVISION_SNAPSHOT_SERVICE, encoding="utf-8")
    update_review_state_index()
    update_review_state_service()
    update_whole_file_review()
    update_context_store()
    update_mapper()
    update_design_contract_tests()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["tests", "implementation"])
    args = parser.parse_args()
    if args.mode == "tests":
        write_tests()
    else:
        implement()


if __name__ == "__main__":
    main()

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  toDefaultVisualState,
  type DiffHunk,
  type DiffLine,
  type FileReviewState,
  type FileReviewHistoryEvent,
  type GlobalFileReviewState,
  type InternalReviewState,
  type LineInterval,
  type PullRequestFileChange,
  type PullRequestFileChangeStatus,
  type RepositoryGlobalState,
  type ReviewContextKind,
  type ReviewContextState,
  type ReviewHistoryEvent,
  type ReviewHistoryEventType,
  type SchemaVersion
} from "../../src/core/contracts";
import {
  type DiffEditorReviewCommandDependencies,
  type DiffEditorReviewStateSession
} from "../../src/application/review-commands";
import { type ReviewHistoryRecorderOptions } from "../../src/application/review-history";
import {
  type ModifiedReviewStateTransaction,
  type OriginalReviewStateTransaction,
  type ReviewStateTransaction
} from "../../src/core/review-state";
import {
  type OpenReviewDiffInput,
  type ReviewDiffEditorHost,
  type ReviewDiffEditorSideInput
} from "../../src/ui/diff-editor";
import {
  DEFAULT_REVIEW_RANGE_CONFIGURATION,
  REVIEW_RANGE_CONFIGURATION_KEYS,
  type ReviewRangeConfiguration
} from "../../src/application/configuration";

const schemaVersion: SchemaVersion = REVIEW_RANGE_SCHEMA_VERSION;
const lineInterval = {
  startLine: 0,
  endLineExclusive: 2
} satisfies LineInterval;
const diffLines = [
  { kind: "context", oldLine: 1, newLine: 1, text: "unchanged" },
  { kind: "addition", newLine: 2, text: "added" },
  { kind: "deletion", oldLine: 2, text: "deleted" }
] satisfies DiffLine[];
const diffHunk = {
  oldStart: 1,
  oldCount: 2,
  newStart: 1,
  newCount: 2,
  lines: diffLines
} satisfies DiffHunk;
const pullRequestFileChange = {
  fileId: "file-1",
  oldPath: "src/old.ts",
  newPath: "src/new.ts",
  status: "renamed",
  additions: 1,
  deletions: 1,
  hunks: [diffHunk]
} satisfies PullRequestFileChange;
const fileState = {
  schemaVersion,
  fileId: "file-1",
  currentPath: "src/new.ts",
  previousPaths: ["src/old.ts"],
  revisionId: "revision-1",
  modifiedReviewed: [lineInterval],
  originalReviewedByDiff: { "base..head": [lineInterval] },
  contentHash: "hash-1",
  lineCount: 2,
  updatedAt: "2026-07-23T00:00:00.000Z"
} satisfies FileReviewState;
const globalFileState = {
  fileId: "file-1",
  currentPath: "src/new.ts",
  revisionId: "revision-1",
  reviewed: [lineInterval],
  contentHash: "hash-1",
  updatedAt: "2026-07-23T00:00:00.000Z"
} satisfies GlobalFileReviewState;
const contextState = {
  schemaVersion,
  contextId: "context-1",
  kind: "pull-request",
  repositoryId: "repository-1",
  displayName: "PR #1",
  pullRequest: {
    host: "github.com",
    owner: "owner",
    repository: "repository",
    number: 1,
    state: "open",
    title: "Fixture",
    baseSha: "base",
    headSha: "head",
    url: "https://github.com/owner/repository/pull/1"
  },
  files: { "file-1": fileState },
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
} satisfies ReviewContextState;
const repositoryGlobalState = {
  schemaVersion,
  repositoryId: "repository-1",
  currentRevisionId: "revision-1",
  files: { "file-1": globalFileState },
  updatedAt: "2026-07-23T00:00:00.000Z"
} satisfies RepositoryGlobalState;
const fileHistoryEvent = {
  schemaVersion,
  type: "marked-reviewed",
  eventId: "event-1",
  occurredAt: "2026-07-23T00:00:00.000Z",
  sessionId: "session-1",
  repositoryId: "repository-1",
  contextId: "context-1",
  revisionId: "revision-1",
  filePath: "src/new.ts",
  diffSide: "modified",
  previousRanges: [],
  nextRanges: [lineInterval],
  reason: "user-selection"
} satisfies ReviewHistoryEvent;
const originalFileHistoryEvent = {
  ...fileHistoryEvent,
  eventId: "event-original",
  diffSide: "original",
  diffId: "base..head"
} satisfies FileReviewHistoryEvent;
// @ts-expect-error Original-side history must include a canonical diff identity.
const invalidOriginalFileHistoryEvent: FileReviewHistoryEvent = {
  ...fileHistoryEvent,
  eventId: "event-invalid-original",
  diffSide: "original"
};
// @ts-expect-error Modified-side history must not include an original diff identity.
const invalidModifiedFileHistoryEvent: FileReviewHistoryEvent = {
  ...fileHistoryEvent,
  eventId: "event-invalid-modified",
  diffId: "base..head"
};
const contextHistoryEvent = {
  schemaVersion,
  type: "context-created",
  eventId: "event-2",
  occurredAt: "2026-07-23T00:00:00.000Z",
  sessionId: "session-1",
  repositoryId: "repository-1",
  contextId: "context-1",
  revisionId: "revision-1",
  reason: "resolver-created"
} satisfies ReviewHistoryEvent;
const configuration = {
  showGlobalReviewed: true,
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false,
  showGutterIcon: true,
  showOverviewRuler: false,
  exclude: ["**/generated/**"],
  maxSnapshotFileSizeBytes: 1,
  historyRetentionDays: 0,
  closedPullRequestLayerDefault: false,
  decorations: {
    changed: { enabled: false },
    unresolved: { enabled: false }
  }
} satisfies ReviewRangeConfiguration;
const originalTransaction = {
  operation: "mark-original-ranges-reviewed",
  repositoryId: "repository-1",
  contextId: "context-1",
  fileId: "file-1",
  side: "original",
  diffId: "base..head",
  expected: { contextState, globalState: repositoryGlobalState },
  next: { contextState, globalState: repositoryGlobalState }
} satisfies OriginalReviewStateTransaction;
const modifiedTransaction = {
  operation: "mark-file-reviewed",
  repositoryId: "repository-1",
  contextId: "context-1",
  fileId: "file-1",
  expected: { contextState, globalState: repositoryGlobalState },
  next: { contextState, globalState: repositoryGlobalState }
} satisfies ModifiedReviewStateTransaction;
// @ts-expect-error Original-side transactions must include their canonical diff identity.
const invalidOriginalTransaction: ReviewStateTransaction = {
  operation: "mark-original-ranges-reviewed",
  repositoryId: "repository-1",
  contextId: "context-1",
  fileId: "file-1",
  side: "original",
  expected: { contextState, globalState: repositoryGlobalState },
  next: { contextState, globalState: repositoryGlobalState }
};
// @ts-expect-error Modified and whole-file transactions must not include a diff identity.
const invalidModifiedTransaction: ReviewStateTransaction = {
  operation: "mark-file-reviewed",
  repositoryId: "repository-1",
  contextId: "context-1",
  fileId: "file-1",
  diffId: "base..head",
  expected: { contextState, globalState: repositoryGlobalState },
  next: { contextState, globalState: repositoryGlobalState }
};
type T303PublicBarrels = [
  DiffEditorReviewCommandDependencies<unknown>,
  DiffEditorReviewStateSession,
  ReviewHistoryRecorderOptions,
  OpenReviewDiffInput,
  ReviewDiffEditorHost<string>,
  ReviewDiffEditorSideInput
];

const internalStates = [
  "reviewed",
  "unreviewed",
  "changed",
  "deleted",
  "unresolved"
] as const satisfies readonly InternalReviewState[];
const visualStates = {
  reviewed: toDefaultVisualState("reviewed"),
  unreviewed: toDefaultVisualState("unreviewed"),
  changed: toDefaultVisualState("changed"),
  deleted: toDefaultVisualState("deleted"),
  unresolved: toDefaultVisualState("unresolved")
} satisfies {
  reviewed: "reviewed";
  unreviewed: "normal";
  changed: "normal";
  deleted: "normal";
  unresolved: "normal";
};
const changeStatuses = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "binary"
] as const satisfies readonly PullRequestFileChangeStatus[];
const contextKinds = ["pull-request", "branch", "workspace"] as const satisfies readonly ReviewContextKind[];
const historyEventTypes = [
  "marked-reviewed",
  "unmarked-reviewed",
  "marked-file-reviewed",
  "unmarked-file-reviewed",
  "invalidated-by-edit",
  "remapped-by-diff",
  "file-renamed",
  "file-deleted",
  "context-created",
  "context-revision-changed",
  "mapping-unresolved"
] as const satisfies readonly ReviewHistoryEventType[];

void [
  lineInterval.startLine,
  fileState.originalReviewedByDiff["base..head"]?.[0]?.endLineExclusive,
  contextState.pullRequest?.headSha,
  repositoryGlobalState.files["file-1"]?.reviewed,
  pullRequestFileChange.hunks[0]?.lines[0]?.text,
  fileHistoryEvent.nextRanges[0]?.startLine,
  originalFileHistoryEvent.diffId,
  originalTransaction.diffId,
  modifiedTransaction.operation,
  invalidOriginalFileHistoryEvent,
  invalidModifiedFileHistoryEvent,
  invalidOriginalTransaction,
  invalidModifiedTransaction,
  contextHistoryEvent.reason,
  configuration.decorations.changed.enabled,
  DEFAULT_REVIEW_RANGE_CONFIGURATION.historyRetentionDays,
  REVIEW_RANGE_CONFIGURATION_KEYS.exclude,
  internalStates,
  visualStates,
  changeStatuses,
  contextKinds,
  historyEventTypes
];
void (undefined as unknown as T303PublicBarrels);

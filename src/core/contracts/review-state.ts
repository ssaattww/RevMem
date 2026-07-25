import type { SchemaVersion } from "./schema-version";

/** A detailed internal state retained for review-range tracking. */
export type InternalReviewState =
  | "reviewed"
  | "unreviewed"
  | "changed"
  | "deleted"
  | "unresolved";

/** The two visual states shown by the default decoration policy. */
export type DefaultVisualState = "reviewed" | "normal";

export function toDefaultVisualState(state: "reviewed"): "reviewed";
export function toDefaultVisualState(
  state: Exclude<InternalReviewState, "reviewed">
): "normal";
export function toDefaultVisualState(state: InternalReviewState): DefaultVisualState;
export function toDefaultVisualState(state: InternalReviewState): DefaultVisualState {
  return state === "reviewed" ? "reviewed" : "normal";
}

/** A zero-based, half-open line interval: `[startLine, endLineExclusive)`. */
export interface LineInterval {
  startLine: number;
  endLineExclusive: number;
}

export type ReviewDiffSide = "original" | "modified";

export interface FileReviewState {
  schemaVersion: SchemaVersion;
  fileId: string;
  currentPath: string;
  previousPaths: string[];
  revisionId: string;
  modifiedReviewed: LineInterval[];
  originalReviewedByDiff: Record<string, LineInterval[]>;
  contentHash?: string;
  lineCount: number;
  updatedAt: string;
}

export type ReviewContextKind =
  | "pull-request"
  | "branch"
  | "workspace"
  | "external-file";

export interface PullRequestReviewContext {
  host: string;
  owner: string;
  repository: string;
  number: number;
  state: "open" | "closed" | "merged";
  title?: string;
  baseSha: string;
  headSha: string;
  url?: string;
}

export interface BranchReviewContext {
  refName: string;
  baseRevision?: string;
  headRevision: string;
}

export interface WorkspaceReviewContext {
  workspaceId: string;
  snapshotRevision: string;
}

export interface ExternalFileReviewContext {
  canonicalUri: string;
  snapshotRevision: string;
}

/** Lower-owner kinds that may contribute review ranges during owner reconciliation. */
export type OwnerReconciliationSourceOwner = "workspace" | "external-file";

/** Persisted certain snapshot used to calculate later lower-owner deltas. */
export interface OwnerReconciliationSourceSnapshot {
  sourceOwner: OwnerReconciliationSourceOwner;
  sourceRepositoryId: string;
  sourceContextId: string;
  sourceFileId: string;
  contentHash?: string;
  lineCount: number;
  reviewed: LineInterval[];
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
}

/** Persisted review state shared by every context kind. */
export interface ReviewContextState {
  schemaVersion: SchemaVersion;
  contextId: string;
  kind: ReviewContextKind;
  repositoryId: string;
  displayName: string;
  pullRequest?: PullRequestReviewContext;
  branch?: BranchReviewContext;
  workspace?: WorkspaceReviewContext;
  externalFile?: ExternalFileReviewContext;
  files: Record<string, FileReviewState>;
  createdAt: string;
  updatedAt: string;
}

/** Context state extended with persisted lower-owner reconciliation snapshots. */
export interface ReconciledReviewContextState extends ReviewContextState {
  ownerReconciliation?: Record<string, OwnerReconciliationSourceSnapshot>;
}

export interface GlobalFileReviewState {
  fileId: string;
  currentPath: string;
  revisionId: string;
  reviewed: LineInterval[];
  contentHash?: string;
  updatedAt: string;
}

export interface RepositoryGlobalState {
  schemaVersion: SchemaVersion;
  repositoryId: string;
  currentRevisionId: string;
  files: Record<string, GlobalFileReviewState>;
  updatedAt: string;
}

export type PullRequestFileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "binary";

export interface PullRequestFileChange {
  fileId: string;
  oldPath?: string;
  newPath?: string;
  status: PullRequestFileChangeStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  text: string;
}

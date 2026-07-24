import type { SchemaVersion } from "./schema-version";

/**
 * A detailed internal state retained for review-range tracking.
 */
export type InternalReviewState =
  | "reviewed"
  | "unreviewed"
  | "changed"
  | "deleted"
  | "unresolved";

/**
 * The two visual states shown by the default decoration policy.
 */
export type DefaultVisualState = "reviewed" | "normal";

/**
 * Maps a certainly reviewed range to the reviewed default visual state.
 *
 * @param state Detailed state known to be reviewed.
 * @returns `"reviewed"`.
 */
export function toDefaultVisualState(state: "reviewed"): "reviewed";

/**
 * Maps every non-reviewed detailed state to the normal default visual state.
 *
 * @param state Detailed state that is not certainly reviewed.
 * @returns `"normal"`.
 */
export function toDefaultVisualState(
  state: Exclude<InternalReviewState, "reviewed">
): "normal";

/**
 * Collapses detailed internal state into the binary default visual state.
 *
 * @param state Detailed review state to display.
 * @returns `"reviewed"` only for a certainly reviewed range; otherwise `"normal"`.
 */
export function toDefaultVisualState(state: InternalReviewState): DefaultVisualState;

/**
 * Implements the default visual-state collapse without exposing detailed states.
 */
export function toDefaultVisualState(state: InternalReviewState): DefaultVisualState {
  return state === "reviewed" ? "reviewed" : "normal";
}

/**
 * A zero-based, half-open line interval: `[startLine, endLineExclusive)`.
 */
export interface LineInterval {
  /** Zero-based first line included in the interval. */
  startLine: number;
  /** Zero-based first line excluded from the interval. */
  endLineExclusive: number;
}

/**
 * The side of a diff to which a reviewed range belongs.
 */
export type ReviewDiffSide = "original" | "modified";

/**
 * Current reviewed state for one file within a review context.
 */
export interface FileReviewState {
  /** Persisted-document version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Stable file identity that survives an unambiguous rename. */
  fileId: string;
  /** Current repository-relative path, or canonical URI for an external file. */
  currentPath: string;
  /** Former repository-relative paths retained for rename tracking. */
  previousPaths: string[];
  /** Revision against which the reviewed ranges are currently valid. */
  revisionId: string;
  /** Reviewed intervals on the modified/current side of the file. */
  modifiedReviewed: LineInterval[];
  /** Reviewed original-side intervals keyed by PR revision or comparison-pair ID. */
  originalReviewedByDiff: Record<string, LineInterval[]>;
  /** Content hash when it is available for certainty checks. */
  contentHash?: string;
  /** Current number of lines in the modified/current file. */
  lineCount: number;
  /** ISO 8601 timestamp of the last state update. */
  updatedAt: string;
}

/**
 * The unit that isolates review state for a pull request, branch, workspace, or external file.
 */
export type ReviewContextKind =
  | "pull-request"
  | "branch"
  | "workspace"
  | "external-file";

/**
 * Pull-request metadata that identifies a pull-request review context.
 */
export interface PullRequestReviewContext {
  /** GitHub-compatible host name that owns the pull request. */
  host: string;
  /** Repository owner on the host. */
  owner: string;
  /** Repository name on the host. */
  repository: string;
  /** Pull-request number unique within the repository. */
  number: number;
  /** Current lifecycle state reported for the pull request. */
  state: "open" | "closed" | "merged";
  /** Optional title for display only. */
  title?: string;
  /** Base commit SHA used for the reviewed comparison. */
  baseSha: string;
  /** Head commit SHA used for the reviewed comparison. */
  headSha: string;
  /** Optional canonical URL for opening the pull request. */
  url?: string;
}

/**
 * Branch metadata that identifies a branch review context.
 */
export interface BranchReviewContext {
  /** Fully qualified branch ref name. */
  refName: string;
  /** Optional merge-base or configured base revision. */
  baseRevision?: string;
  /** Head revision currently represented by the branch context. */
  headRevision: string;
}

/**
 * Snapshot metadata that identifies a non-Git workspace review context.
 */
export interface WorkspaceReviewContext {
  /** Stable identity for the non-Git workspace or external-file snapshot owner. */
  workspaceId: string;
  /** Snapshot revision used to compare workspace or external-file content. */
  snapshotRevision: string;
}

/**
 * Canonical resource metadata for one non-Git file outside every workspace.
 */
export interface ExternalFileReviewContext {
  /** Canonical URI including a UNC or remote authority when present. */
  canonicalUri: string;
}

/**
 * Persisted review state for a single pull-request, branch, workspace, or external-file context.
 */
export interface ReviewContextState {
  /** Persisted-document version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Stable identity of this isolated review context. */
  contextId: string;
  /** Determines which optional context descriptor is applicable. */
  kind: ReviewContextKind;
  /** Stable identity of the repository or standalone resource that owns this context. */
  repositoryId: string;
  /** User-facing name for context selection and display. */
  displayName: string;
  /** Pull-request descriptor when `kind` is `"pull-request"`. */
  pullRequest?: PullRequestReviewContext;
  /** Branch descriptor when `kind` is `"branch"`. */
  branch?: BranchReviewContext;
  /** Snapshot descriptor when `kind` is `"workspace"` or `"external-file"`. */
  workspace?: WorkspaceReviewContext;
  /** Canonical external resource when `kind` is `"external-file"`. */
  externalFile?: ExternalFileReviewContext;
  /** File state keyed by stable file ID. */
  files: Record<string, FileReviewState>;
  /** ISO 8601 timestamp at which the context was first persisted. */
  createdAt: string;
  /** ISO 8601 timestamp of the last context update. */
  updatedAt: string;
}

/**
 * Current reviewed state for one file in the repository-wide Global layer.
 */
export interface GlobalFileReviewState {
  /** Stable file identity shared with context-specific state. */
  fileId: string;
  /** Current repository-relative path, or canonical URI for an external file. */
  currentPath: string;
  /** Revision against which the Global ranges are valid. */
  revisionId: string;
  /** Currently valid Global reviewed intervals for the file. */
  reviewed: LineInterval[];
  /** Content hash when available to confirm range validity. */
  contentHash?: string;
  /** ISO 8601 timestamp of the last Global file-state update. */
  updatedAt: string;
}

/**
 * Current reviewed state for one file in the repository-wide Global layer.
 */
export interface RepositoryGlobalState {
  /** Persisted-document version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Stable identity of the repository or standalone resource that owns the Global layer. */
  repositoryId: string;
  /** Revision at which the Global layer was last validated. */
  currentRevisionId: string;
  /** Global file state keyed by stable file ID. */
  files: Record<string, GlobalFileReviewState>;
  /** ISO 8601 timestamp of the last Global-layer update. */
  updatedAt: string;
}

/**
 * The change classification supplied by Git or GitHub for a pull-request file.
 */
export type PullRequestFileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "binary";

/**
 * One changed file and its parsed diff hunks in a pull request.
 */
export interface PullRequestFileChange {
  /** Stable identity of the changed file. */
  fileId: string;
  /** Path before the change when a prior path exists. */
  oldPath?: string;
  /** Path after the change when a resulting path exists. */
  newPath?: string;
  /** Git or GitHub classification of the file change. */
  status: PullRequestFileChangeStatus;
  /** Number of added lines reported for the file. */
  additions: number;
  /** Number of deleted lines reported for the file. */
  deletions: number;
  /** Parsed hunks used to identify reviewable changed lines. */
  hunks: DiffHunk[];
}

/**
 * A contiguous changed region in a unified diff.
 */
export interface DiffHunk {
  /** One-based starting line on the original side. */
  oldStart: number;
  /** Number of original-side lines covered by the hunk. */
  oldCount: number;
  /** One-based starting line on the modified side. */
  newStart: number;
  /** Number of modified-side lines covered by the hunk. */
  newCount: number;
  /** Parsed lines in source order within the hunk. */
  lines: DiffLine[];
}

/**
 * The kind of one line in a parsed unified diff.
 */
export type DiffLineKind = "context" | "addition" | "deletion";

/**
 * One line in a parsed unified diff, with source line numbers when applicable.
 */
export interface DiffLine {
  /** Whether the line is unchanged context, an addition, or a deletion. */
  kind: DiffLineKind;
  /** One-based original-side line number; absent for additions. */
  oldLine?: number;
  /** One-based modified-side line number; absent for deletions. */
  newLine?: number;
  /** Raw line text excluding the unified-diff prefix. */
  text: string;
}

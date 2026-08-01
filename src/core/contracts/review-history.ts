import type { SchemaVersion } from "./schema-version";
import type { LineInterval, ReviewDiffSide } from "./review-state";

/** Runtime discriminator for every persisted review-history record. */
export type ReviewHistoryEventType =
  | "marked-reviewed"
  | "unmarked-reviewed"
  | "marked-file-reviewed"
  | "unmarked-file-reviewed"
  | "invalidated-by-edit"
  | "remapped-by-diff"
  | "file-renamed"
  | "file-deleted"
  | "context-created"
  | "context-revision-changed"
  | "mapping-unresolved";

/** Event kinds that describe one file-side range transition. */
export type FileReviewHistoryEventType = Exclude<
  ReviewHistoryEventType,
  "context-created" | "context-revision-changed"
>;
/** Event kinds that describe context lifecycle rather than a file range. */
export type ContextReviewHistoryEventType = "context-created" | "context-revision-changed";

/** Fields shared by all canonical review-history events. */
export interface ReviewHistoryEventBase {
  /** Persisted schema revision. */
  schemaVersion: SchemaVersion;
  /** Stable append-only event identity. */
  eventId: string;
  /** Canonical UTC timestamp at which the transition occurred. */
  occurredAt: string;
  /** Runtime session that created the event. */
  sessionId: string;
  /** Repository owning the review context. */
  repositoryId: string;
  /** Context owning the reviewed ranges. */
  contextId: string;
  /** Immutable revision described by the event. */
  revisionId: string;
  /** Caller-visible reason for the transition. */
  reason: string;
}

/** File-range fields shared by original and modified history events. */
interface FileReviewHistoryEventBase extends ReviewHistoryEventBase {
  /** File-transition event kind. */
  type: FileReviewHistoryEventType;
  /** Canonical file path at the recorded revision. */
  filePath: string;
  /** Ranges before this event. */
  previousRanges: LineInterval[];
  /** Ranges after this event. */
  nextRanges: LineInterval[];
}

/** History event for mutable modified-side ranges, which intentionally has no original diff identity. */
export interface ModifiedFileReviewHistoryEvent extends FileReviewHistoryEventBase {
  /** Identifies the modified-side range set. */
  diffSide: Extract<ReviewDiffSide, "modified">;
  /** Forbidden because modified ranges are not keyed by an immutable comparison. */
  diffId?: never;
}

/** History event for immutable original-side deletion ranges. */
export interface OriginalFileReviewHistoryEvent extends FileReviewHistoryEventBase {
  /** Identifies the immutable original-side range set. */
  diffSide: Extract<ReviewDiffSide, "original">;
  /** Canonical non-empty `${baseSha}..${headSha}` comparison identity. */
  diffId: string;
}

/** Discriminated file history event with side-specific diff identity requirements. */
export type FileReviewHistoryEvent = ModifiedFileReviewHistoryEvent | OriginalFileReviewHistoryEvent;

/** Append-only lifecycle event that does not describe a file range. */
export interface ContextReviewHistoryEvent extends ReviewHistoryEventBase {
  /** Context lifecycle discriminator. */
  type: ContextReviewHistoryEventType;
}

/** Canonical review-history record. */
export type ReviewHistoryEvent = FileReviewHistoryEvent | ContextReviewHistoryEvent;

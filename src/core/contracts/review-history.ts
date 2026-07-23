import type { SchemaVersion } from "./schema-version";
import type { LineInterval, ReviewDiffSide } from "./review-state";

/**
 * Append-only event categories retained as review-history evidence.
 */
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

/**
 * Event categories that describe a transition affecting one file and diff side.
 */
export type FileReviewHistoryEventType = Exclude<
  ReviewHistoryEventType,
  "context-created" | "context-revision-changed"
>;

/**
 * Event categories that describe a context-wide transition without one file.
 */
export type ContextReviewHistoryEventType =
  | "context-created"
  | "context-revision-changed";

/**
 * Identification and audit fields required for every append-only history event.
 */
export interface ReviewHistoryEventBase {
  /** Persisted-event schema version used by migration readers. */
  schemaVersion: SchemaVersion;
  /** Unique event identifier for idempotent history processing. */
  eventId: string;
  /** ISO 8601 timestamp at which the event occurred. */
  occurredAt: string;
  /** Identifier for the extension session that emitted the event. */
  sessionId: string;
  /** Stable identity of the repository affected by the event. */
  repositoryId: string;
  /** Stable identity of the review context affected by the event. */
  contextId: string;
  /** Revision against which the event was evaluated. */
  revisionId: string;
  /** Machine-readable or user-action reason for the transition. */
  reason: string;
}

/**
 * A file-scoped history event with the complete before-and-after range evidence.
 */
export interface FileReviewHistoryEvent extends ReviewHistoryEventBase {
  /** Discriminates file-scoped event payloads from context-wide payloads. */
  type: FileReviewHistoryEventType;
  /** Repository-relative path of the affected file. */
  filePath: string;
  /** Diff side to which the before-and-after ranges apply. */
  diffSide: ReviewDiffSide;
  /** Reviewed ranges before the transition; empty when none existed. */
  previousRanges: LineInterval[];
  /** Reviewed ranges after the transition; empty when all were removed. */
  nextRanges: LineInterval[];
}

/**
 * A context-wide history event; file and range evidence is inapplicable by type.
 */
export interface ContextReviewHistoryEvent extends ReviewHistoryEventBase {
  /** Discriminates context-wide event payloads from file-scoped payloads. */
  type: ContextReviewHistoryEventType;
}

/**
 * One append-only review-history record. File-scoped events require file, side,
 * and range evidence; context-wide events cannot omit their common audit fields.
 */
export type ReviewHistoryEvent =
  | FileReviewHistoryEvent
  | ContextReviewHistoryEvent;

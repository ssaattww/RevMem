import type { SchemaVersion } from "./schema-version";
import type { LineInterval, ReviewDiffSide } from "./review-state";

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

export type FileReviewHistoryEventType = Exclude<
  ReviewHistoryEventType,
  "context-created" | "context-revision-changed"
>;
export type ContextReviewHistoryEventType = "context-created" | "context-revision-changed";

export interface ReviewHistoryEventBase {
  schemaVersion: SchemaVersion;
  eventId: string;
  occurredAt: string;
  sessionId: string;
  repositoryId: string;
  contextId: string;
  revisionId: string;
  reason: string;
}

export interface FileReviewHistoryEvent extends ReviewHistoryEventBase {
  type: FileReviewHistoryEventType;
  filePath: string;
  diffSide: ReviewDiffSide;
  diffId?: string;
  previousRanges: LineInterval[];
  nextRanges: LineInterval[];
}

export interface ContextReviewHistoryEvent extends ReviewHistoryEventBase {
  type: ContextReviewHistoryEventType;
}

export type ReviewHistoryEvent = FileReviewHistoryEvent | ContextReviewHistoryEvent;

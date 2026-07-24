/** Public state-model contracts shared by the application, adapters, and UI layers. */
export type {
  BranchReviewContext,
  DefaultVisualState,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  ExternalFileReviewContext,
  FileReviewState,
  GlobalFileReviewState,
  InternalReviewState,
  LineInterval,
  PullRequestFileChange,
  PullRequestFileChangeStatus,
  PullRequestReviewContext,
  RepositoryGlobalState,
  ReviewContextKind,
  ReviewContextState,
  ReviewDiffSide,
  WorkspaceReviewContext
} from "./review-state";

/** Public default visual-state mapper for detailed review state. */
export { toDefaultVisualState } from "./review-state";

/** Public append-only review-history contracts. */
export type {
  ContextReviewHistoryEvent,
  ContextReviewHistoryEventType,
  FileReviewHistoryEvent,
  FileReviewHistoryEventType,
  ReviewHistoryEvent,
  ReviewHistoryEventBase,
  ReviewHistoryEventType
} from "./review-history";

/** Public schema-version contract for persisted review documents. */
export {
  REVIEW_RANGE_SCHEMA_VERSION,
  type SchemaVersion
} from "./schema-version";

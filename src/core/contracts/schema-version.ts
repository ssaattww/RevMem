/**
 * Version value persisted with every review-state document so future migrations
 * can select the correct decoder.
 */
export type SchemaVersion = number;

/**
 * Current schema version for the review-state contracts introduced in T002.
 */
export const REVIEW_RANGE_SCHEMA_VERSION: SchemaVersion = 1;

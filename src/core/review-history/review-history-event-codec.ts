import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type LineInterval,
  type ReviewHistoryEvent,
  type ReviewHistoryEventType
} from "../contracts/index";

const FILE_EVENT_TYPES = new Set<ReviewHistoryEventType>([
  "marked-reviewed", "unmarked-reviewed", "marked-file-reviewed",
  "unmarked-file-reviewed", "invalidated-by-edit", "remapped-by-diff",
  "file-renamed", "file-deleted", "mapping-unresolved"
]);
const CONTEXT_EVENT_TYPES = new Set<ReviewHistoryEventType>(["context-created", "context-revision-changed"]);
const COMMON_FIELDS = ["schemaVersion", "eventId", "occurredAt", "sessionId", "repositoryId", "contextId", "revisionId", "type", "reason"] as const;
const MODIFIED_FILE_FIELDS = [...COMMON_FIELDS, "filePath", "diffSide", "previousRanges", "nextRanges"];
const ORIGINAL_FILE_FIELDS = [...COMMON_FIELDS, "filePath", "diffSide", "diffId", "previousRanges", "nextRanges"];

const assertPlainObject = (value: unknown, name: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value as Record<string, unknown>;
};
const assertExactFields = (value: Record<string, unknown>, fields: readonly string[]): void => {
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((key) => !fields.includes(key))) throw new TypeError("Review history event fields do not match its discriminator.");
};
const assertNonEmptyString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\n") || value.includes("\r")) throw new TypeError(`${name} must be a non-empty single-line string.`);
  return value;
};
const assertOccurredAt = (value: unknown): string => {
  const occurredAt = assertNonEmptyString(value, "occurredAt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(occurredAt) || new Date(occurredAt).toISOString() !== occurredAt) throw new TypeError("occurredAt must be a canonical UTC ISO 8601 timestamp.");
  return occurredAt;
};
const validateRanges = (value: unknown, name: string): LineInterval[] => {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  let previousEnd = -1;
  return value.map((item, index) => {
    const range = assertPlainObject(item, `${name}[${index}]`);
    assertExactFields(range, ["startLine", "endLineExclusive"]);
    const startLine = range.startLine;
    const endLineExclusive = range.endLineExclusive;
    if (typeof startLine !== "number" || typeof endLineExclusive !== "number" || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLineExclusive) || startLine < 0 || endLineExclusive <= startLine || startLine <= previousEnd) throw new RangeError(`${name} must contain canonical non-overlapping half-open intervals.`);
    previousEnd = endLineExclusive;
    return { startLine, endLineExclusive };
  });
};

export const validateReviewHistoryEvent = (value: unknown): ReviewHistoryEvent => {
  const event = assertPlainObject(value, "Review history event");
  if (event.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) throw new RangeError("Review history event schemaVersion is unsupported.");
  if (typeof event.type !== "string" || (!FILE_EVENT_TYPES.has(event.type as ReviewHistoryEventType) && !CONTEXT_EVENT_TYPES.has(event.type as ReviewHistoryEventType))) throw new TypeError("Review history event type is unsupported.");
  const type = event.type as ReviewHistoryEventType;
  const common = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    eventId: assertNonEmptyString(event.eventId, "eventId"),
    occurredAt: assertOccurredAt(event.occurredAt),
    sessionId: assertNonEmptyString(event.sessionId, "sessionId"),
    repositoryId: assertNonEmptyString(event.repositoryId, "repositoryId"),
    contextId: assertNonEmptyString(event.contextId, "contextId"),
    revisionId: assertNonEmptyString(event.revisionId, "revisionId"),
    type,
    reason: assertNonEmptyString(event.reason, "reason")
  };
  if (CONTEXT_EVENT_TYPES.has(type)) {
    assertExactFields(event, COMMON_FIELDS);
    return common as ReviewHistoryEvent;
  }
  if (event.diffSide !== "modified" && event.diffSide !== "original") throw new TypeError("diffSide must be modified or original.");
  const diffSide: "modified" | "original" = event.diffSide;
  assertExactFields(event, diffSide === "original" ? ORIGINAL_FILE_FIELDS : MODIFIED_FILE_FIELDS);
  const fileEvent = {
    ...common,
    type: type as Exclude<ReviewHistoryEventType, "context-created" | "context-revision-changed">,
    filePath: assertNonEmptyString(event.filePath, "filePath"),
    diffSide,
    previousRanges: validateRanges(event.previousRanges, "previousRanges"),
    nextRanges: validateRanges(event.nextRanges, "nextRanges")
  };
  return diffSide === "original" ? { ...fileEvent, diffId: assertNonEmptyString(event.diffId, "diffId") } : fileEvent;
};
export const serializeReviewHistoryEvent = (value: unknown): string => JSON.stringify(validateReviewHistoryEvent(value));
export const parseReviewHistoryEventLine = (line: string): ReviewHistoryEvent => {
  if (line.length === 0 || line.includes("\n") || line.includes("\r")) throw new SyntaxError("Review history record must be one non-empty JSON line.");
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch (error) {
    throw new SyntaxError(`Review history JSON is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const event = validateReviewHistoryEvent(parsed);
  if (serializeReviewHistoryEvent(event) !== line) throw new SyntaxError("Review history record is not canonically serialized.");
  return event;
};

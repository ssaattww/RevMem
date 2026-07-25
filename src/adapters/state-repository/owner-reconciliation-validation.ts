import type {
  LineInterval,
  OwnerReconciliationSourceSnapshot,
  ReviewContextState
} from "../../core/contracts/index";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const requireNonNegativeSafeInteger = (
  value: unknown,
  name: string
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requireIsoTimestamp = (value: unknown, name: string): string => {
  const timestamp = requireString(value, name);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`${name} must be an ISO 8601 timestamp`);
  }
  return timestamp;
};

const validateInterval = (value: unknown, name: string): LineInterval => {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const startLine = requireNonNegativeSafeInteger(
    value.startLine,
    `${name}.startLine`
  );
  const endLineExclusive = requireNonNegativeSafeInteger(
    value.endLineExclusive,
    `${name}.endLineExclusive`
  );
  if (endLineExclusive <= startLine) {
    throw new TypeError(`${name}.endLineExclusive must be greater than startLine`);
  }
  return { startLine, endLineExclusive };
};

const validateSnapshot = (
  value: unknown,
  name: string
): OwnerReconciliationSourceSnapshot => {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  if (value.sourceOwner !== "workspace" && value.sourceOwner !== "external-file") {
    throw new TypeError(`${name}.sourceOwner must be workspace or external-file`);
  }
  if (!Array.isArray(value.reviewed)) {
    throw new TypeError(`${name}.reviewed must be an array`);
  }
  const contentHash = value.contentHash === undefined
    ? undefined
    : requireString(value.contentHash, `${name}.contentHash`);
  return {
    sourceOwner: value.sourceOwner,
    sourceRepositoryId: requireString(
      value.sourceRepositoryId,
      `${name}.sourceRepositoryId`
    ),
    sourceContextId: requireString(
      value.sourceContextId,
      `${name}.sourceContextId`
    ),
    sourceFileId: requireString(value.sourceFileId, `${name}.sourceFileId`),
    ...(contentHash === undefined ? {} : { contentHash }),
    lineCount: requireNonNegativeSafeInteger(value.lineCount, `${name}.lineCount`),
    reviewed: value.reviewed.map((interval, index) =>
      validateInterval(interval, `${name}.reviewed[${index}]`)
    ),
    sourceCreatedAt: requireIsoTimestamp(
      value.sourceCreatedAt,
      `${name}.sourceCreatedAt`
    ),
    sourceUpdatedAt: requireIsoTimestamp(
      value.sourceUpdatedAt,
      `${name}.sourceUpdatedAt`
    )
  };
};

/** Validates the optional additive owner-reconciliation section of schema version 1. */
export const validateOwnerReconciliation = (
  contextState: Readonly<ReviewContextState>
): void => {
  const value: unknown = contextState.ownerReconciliation;
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new TypeError("contextState.ownerReconciliation must be an object");
  }
  for (const [key, snapshot] of Object.entries(value)) {
    requireString(key, "contextState.ownerReconciliation key");
    validateSnapshot(
      snapshot,
      `contextState.ownerReconciliation[${JSON.stringify(key)}]`
    );
  }
};

import type {
  PullRequestDiffAcquisitionAttempt,
  PullRequestDiffAcquisitionSource,
  PullRequestDiffUnavailableReason,
} from "../github-pr-diff/contracts";
import { formatPullRequestRefreshAliases, validatePullRequestRefreshAliases, type PullRequestRefreshAliases } from "./pull-request-refresh-aliases";

/** Privacy-safe, count-only stages accepted by the shared operation feedback boundary. */
export type OperationProgressStage =
  | "repositories"
  | "pull-request-contexts"
  | "pull-request-files";

/** One anonymous numeric progress observation for a long-running operation. */
export interface OperationProgress {
  readonly stage: OperationProgressStage;
  readonly completed: number;
  readonly total?: number;
}

/** Lifecycle event written to the Review Range diagnostic output. */
export type OperationLogEvent = "started" | "progress" | "retry" | "acquisition" | "refresh" | "succeeded" | "failed" | "cancelled" | "no-result" | "degraded";

export interface OperationAcquisitionAttempt {
  readonly source: PullRequestDiffAcquisitionSource;
  readonly status: "started" | "succeeded" | "failed" | "skipped" | "cancelled";
  readonly reason?: PullRequestDiffUnavailableReason;
  readonly error?: OperationErrorDiagnostic;
}

export type OperationStageDiagnosticStatus = "started" | "succeeded" | "failed" | "cancelled" | "no-result" | "degraded";

/** Local-only, secret-redacted failure evidence. Paths and stack locations remain useful locally. */
export interface OperationErrorDiagnostic {
  readonly kind: "error" | "non-error";
  readonly name?: string;
  readonly message: string;
  readonly code?: string;
  readonly status?: string;
  readonly stack?: string;
  readonly cause?: OperationErrorDiagnostic;
  readonly causes?: readonly OperationErrorDiagnostic[];
  readonly omittedCauseCount?: number;
}

export interface OperationStageDiagnostic {
  readonly stage: "cache-read" | "cache-persistence" | "repository-context-catalog" | "repository-root-resolution";
  readonly status: OperationStageDiagnosticStatus;
  readonly category?: OperationFailureCategory;
  readonly code?: string;
  readonly error?: OperationErrorDiagnostic;
}

export type PullRequestRefreshTrigger =
  | "current-context-refresh"
  | "review-contexts-refresh"
  | "current-context-selection"
  | "startup"
  | "active-editor-change"
  | "review-state-change"
  | "retry"
  | "pr-redetection";

export type PullRequestRefreshStage =
  | "current-context"
  | "pr-acquisition"
  | "repository-identity"
  | "review-contexts-list"
  | "diff-registration"
  | "pr-selection"
  | "pr-progress"
  | "tree-publication"
  | "refresh-request"
  | "repository-inspection"
  | "repository-sync"
  | "authentication"
  | "pr-search-page"
  | "merge-base"
  | "candidate-selection"
  | "context-save"
  | "global-state-preparation";

export type PullRequestRefreshStatus = "started" | "progress" | "succeeded" | "failed" | "cancelled" | "superseded" | "coalesced" | "no-result";

export type PullRequestRefreshReasonCode =
  | "explicit-selection-kept"
  | "unique-pr-match"
  | "ambiguous-pr-match"
  | "no-matching-pr"
  | "no-selected-pr"
  | "snapshot-unavailable"
  | "no-pr-files"
  | "identity-changed"
  | "verified-branch-preserved"
  | "refresh-failed"
  | "superseded"
  | "duplicate-trigger-coalesced"
  | "superseded-by-newer-generation"
  | "request-timeout"
  | "network-failure"
  | "api-failure"
  | "authentication-required"
  | "rate-limited"
  | "quick-pick-cancelled";

export interface PullRequestRefreshCounts {
  readonly repositories?: number;
  readonly pullRequestCandidates?: number;
  readonly registeredPullRequests?: number;
  readonly snapshotFiles?: number;
  readonly processedFiles?: number;
  readonly treeItems?: number;
  /** Selection/snapshot presence counts retained for compatibility; identities use aliases. */
  readonly selectedContextOrdinal?: number;
  readonly snapshotOrdinal?: number;
}

/** Allowlisted lifecycle detail for PR Progress refresh. It accepts no free-form text. */
export interface PullRequestRefreshDiagnostic {
  readonly generation: number;
  readonly trigger: PullRequestRefreshTrigger;
  readonly stage: PullRequestRefreshStage;
  readonly status: PullRequestRefreshStatus;
  readonly durationMs?: number;
  readonly counts?: PullRequestRefreshCounts;
  readonly aliases?: PullRequestRefreshAliases;
  readonly reasonCode?: PullRequestRefreshReasonCode;
  /** Numeric-only causal links between refresh owners; never an identity value. */
  readonly relatedOperationId?: number;
  readonly relatedGeneration?: number;
  readonly supersededByGeneration?: number;
  readonly causedByOperationId?: number;
  /** One-based request/page ordinal within the owning operation. */
  readonly ordinal?: number;
}

/** One source-content-free diagnostic entry for an extension operation. */
export interface OperationLogEntry {
  /** UTC timestamp for the lifecycle event. */
  readonly timestamp: string;
  /** Generic operation label suitable for status and diagnostic output. */
  readonly label: string;
  /** Lifecycle stage. */
  readonly event: OperationLogEvent;
  /** Anonymous numeric progress for a progress event. */
  readonly progress?: OperationProgress;
  /** Safe retry classification and one-based backoff attempt. */
  readonly retryAttempt?: Readonly<{ readonly attempt: number; readonly category: OperationFailureCategory; readonly code?: string; readonly delayMs: number; readonly error?: OperationErrorDiagnostic }>;
  readonly acquisitionAttempt?: OperationAcquisitionAttempt;
  /** Elapsed milliseconds for completed operations. */
  readonly durationMs?: number;
  /** Error class when the operation failed with an Error instance. */
  readonly errorName?: string;
  /** Local failure evidence with secret values masked. */
  readonly message?: string;
  /** Detailed local-only error evidence after secret-value redaction. */
  readonly errorDetails?: OperationErrorDiagnostic;
  /** Safe classifier outcome for a failed operation; never includes dependency text. */
  readonly failureCategory?: OperationFailureCategory;
  /** Reason retained when an operation ends without a selected result or is degraded/cancelled. */
  readonly outcomeReason?: PullRequestRefreshReasonCode;
  /** Fixed-stage operation diagnostic containing only an allowlisted error code. */
  readonly operationDiagnostic?: OperationStageDiagnostic;
  /** Numeric correlation to the owning operation, present on PR refresh detail. */
  readonly operationId?: number;
  readonly pullRequestRefresh?: PullRequestRefreshDiagnostic;
}

/** Runtime-neutral UI boundary for operation status and diagnostic output. */
export interface OperationFeedbackHost {
  /** Shows the most recently started active operation and total active count. */
  showBusy(label: string, activeCount: number, progress?: OperationProgress): void;
  /** Clears the operation activity status when no operation remains active. */
  clearBusy(): void;
  /** Appends one structured lifecycle entry to the diagnostic output. */
  appendLog(entry: OperationLogEntry): void;
  /** Reveals the diagnostic output after a failure. */
  revealLog(): void;
}

/** Safe structured diagnostic variants accepted by the Output boundary. */
export type GlobalUnderstandingFailureStage = "path-discovery" | "owner-capture" | "scope-processing" | "content-read" | "calculation";

export interface GlobalUnderstandingFailureDiagnostic {
  readonly code: "GLOBAL_UNDERSTANDING_FAILURE";
  readonly stage: GlobalUnderstandingFailureStage;
  readonly operation: "folder-scope-refresh";
  readonly scope: "repository-root" | "folder";
  readonly errorName: string;
  readonly errorCode?: string;
  readonly category: OperationFailureCategory;
  readonly discoveredFileCount: number;
  readonly processedFileCount: number;
}

export type OperationDiagnostic = {
  readonly code: "PR_PROGRESS_UNAVAILABLE";
  readonly attempts: readonly PullRequestDiffAcquisitionAttempt[];
} | {
  readonly code: "GITHUB_PR_DETECTION_UNAVAILABLE";
  readonly reason: "rate-limit" | "network" | "api" | "authentication" | "timeout";
};

/** Stable disposition used by the shared retry and UI failure boundary. */
export type OperationFailureCategory =
  | "retryable"
  | "permanent"
  | "stale"
  | "authentication"
  | "validation";

/** Source-content-free classification of one operation failure. */
export interface OperationFailureClassification {
  readonly kind: OperationFailureCategory;
  readonly code?: string;
}

/** One retry that occurred before the terminal operation result. */
export interface OperationRetryAttempt {
  readonly category: OperationFailureCategory;
  readonly code?: string;
}

/** Bounded retry controls for idempotent read or refresh operations only. */
export interface BoundedRetryOptions {
  readonly maxAttempts?: number;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly feedbackContext?: OperationFeedbackContext;
}

/** Successful value plus the safe retry sequence that preceded it. */
export interface BoundedRetryResult<T> {
  readonly value: T;
  readonly attempts: readonly OperationRetryAttempt[];
}

/** Explicit owner-scoped identity used to join a child to its parent lifecycle. */
export interface OperationFeedbackContext {
  readonly owner: OperationFeedback;
  readonly id: number;
}

/** Explicit stale/cancelled terminal state; it is never retried. */
export class OperationCancelledError extends Error {
  public constructor(cause?: unknown) {
    super("Operation was cancelled or superseded.", cause === undefined ? undefined : { cause });
    this.name = "OperationCancelledError";
  }
}

interface ActiveOperation {
  readonly id: number;
  readonly label: string;
  readonly startedAt: number;
  progress?: OperationProgress;
  /** A handled child failure makes the enclosing lifecycle terminally failed. */
  boundaryFailure?: unknown;
  /** A superseded refresh makes the enclosing operation finish as cancelled. */
  boundaryCancelled?: boolean;
  boundaryNoResult?: boolean;
  boundaryDegraded?: boolean;
  outcomeReason?: PullRequestRefreshReasonCode;
}

const MAX_OPERATION_LABEL_LENGTH = 96;
const MAX_DIAGNOSTIC_LINE_LENGTH = 512;
const SAFE_OPERATION_PROGRESS_STAGES = new Set<OperationProgressStage>([
  "repositories",
  "pull-request-contexts",
  "pull-request-files",
]);

const requireLabel = (label: string): string => {
  const normalized = label.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_OPERATION_LABEL_LENGTH ||
    normalized.includes("\0") ||
    /[\r\n\u2028\u2029]/u.test(normalized)
  ) {
    throw new TypeError("operation label must be a bounded non-empty single line without null characters");
  }
  return normalized;
};

const singleLine = (value: string): string =>
  value.replace(/[\r\n\u2028\u2029]+/gu, " ").trim();

const boundedSingleLine = (value: string, maximum = MAX_DIAGNOSTIC_LINE_LENGTH): string => {
  const normalized = singleLine(value);
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(0, maximum - 1))}…`;
};

const validateOperationProgressCount = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value as number;
};

const validateOperationProgress = (progress: OperationProgress): OperationProgress => {
  if (!SAFE_OPERATION_PROGRESS_STAGES.has(progress.stage)) {
    throw new TypeError("operation progress stage is not allowlisted");
  }
  const completed = validateOperationProgressCount(progress.completed, "operation progress completed");
  const total = progress.total === undefined
    ? undefined
    : validateOperationProgressCount(progress.total, "operation progress total");
  if (total !== undefined && completed > total) {
    throw new RangeError("operation progress completed exceeds total");
  }
  return Object.freeze({
    stage: progress.stage,
    completed,
    ...(total === undefined ? {} : { total }),
  });
};

const sameOperationProgress = (
  left: OperationProgress | undefined,
  right: OperationProgress,
): boolean => left?.stage === right.stage &&
  left.completed === right.completed &&
  left.total === right.total;

/** Formats one fixed-label anonymous progress value for status and diagnostic surfaces. */
export const formatOperationProgress = (progress: OperationProgress): string => {
  const validated = validateOperationProgress(progress);
  const count = validated.total === undefined
    ? String(validated.completed)
    : `${validated.completed}/${validated.total}`;
  return `${validated.stage} ${count}`;
};

const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "AggregateError",
  "GitCommandFailedError",
  "GitExecutableNotFoundError",
  "OperationDiagnosticError",
  "OperationCancelledError"
]);

const SAFE_ERROR_CODES = new Set([
  "EACCES",
  "EBUSY",
  "ECONNREFUSED",
  "ECONNRESET",
  "EEXIST",
  "EIO",
  "EISDIR",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "EROFS",
  "ETIMEDOUT",
  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  "PR_PROGRESS_UNAVAILABLE",
  "GITHUB_PR_DETECTION_UNAVAILABLE"
]);

const SAFE_PR_PROGRESS_SOURCES = new Set([
  "local-git",
  "github-patch",
  "github-content"
]);

const SAFE_PR_PROGRESS_REASONS = new Set([
  "git-unavailable",
  "git-timeout",
  "missing-revision",
  "git-failure",
  "rate-limit",
  "network",
  "api",
  "authentication",
  "missing-file",
  "invalid-encoding",
  "missing-patch",
  "incomplete-patch",
  "identity-mismatch",
  "invalid-data",
  "diff-too-large"
]);

const SAFE_GITHUB_PR_DETECTION_REASONS = new Set(["rate-limit", "network", "api", "authentication", "timeout"]);
const SAFE_GLOBAL_UNDERSTANDING_STAGES = new Set<GlobalUnderstandingFailureStage>(["path-discovery", "owner-capture", "scope-processing", "content-read", "calculation"]);
const SAFE_GLOBAL_UNDERSTANDING_SCOPES = new Set(["repository-root", "folder"]);
const SAFE_OPERATION_FAILURE_CATEGORIES = new Set<OperationFailureCategory>(["retryable", "permanent", "stale", "authentication", "validation"]);
const SAFE_ACQUISITION_SOURCES = new Set<PullRequestDiffAcquisitionSource>(["local-git", "github-patch", "github-content"]);
const SAFE_ACQUISITION_REASONS = new Set<PullRequestDiffUnavailableReason>([
  "git-unavailable", "git-timeout", "missing-revision", "git-failure", "rate-limit", "authentication", "network", "timeout", "api",
  "missing-file", "invalid-encoding", "missing-patch", "incomplete-patch", "identity-mismatch", "invalid-data", "diff-too-large",
]);
const SAFE_PULL_REQUEST_REFRESH_TRIGGERS = new Set<PullRequestRefreshTrigger>([
  "current-context-refresh", "review-contexts-refresh", "current-context-selection",
  "startup", "active-editor-change", "review-state-change", "retry", "pr-redetection",
]);
const SAFE_PULL_REQUEST_REFRESH_STAGES = new Set<PullRequestRefreshStage>([
  "current-context", "pr-acquisition", "repository-identity", "review-contexts-list", "diff-registration",
  "pr-selection", "pr-progress", "tree-publication", "refresh-request", "repository-inspection",
  "repository-sync", "authentication", "pr-search-page", "merge-base", "candidate-selection",
  "context-save", "global-state-preparation",
]);
const SAFE_PULL_REQUEST_REFRESH_STATUSES = new Set<PullRequestRefreshStatus>([
  "started", "progress", "succeeded", "failed", "cancelled", "superseded", "coalesced", "no-result",
]);
const SAFE_PULL_REQUEST_REFRESH_REASONS = new Set<PullRequestRefreshReasonCode>([
  "explicit-selection-kept", "unique-pr-match", "ambiguous-pr-match", "no-matching-pr",
  "no-selected-pr", "snapshot-unavailable", "no-pr-files", "identity-changed",
  "verified-branch-preserved", "refresh-failed", "superseded", "duplicate-trigger-coalesced",
  "superseded-by-newer-generation", "request-timeout", "network-failure", "api-failure",
  "authentication-required", "rate-limited", "quick-pick-cancelled",
]);
const SAFE_PULL_REQUEST_REFRESH_COUNT_KEYS = new Set<keyof PullRequestRefreshCounts>([
  "repositories", "pullRequestCandidates", "registeredPullRequests", "snapshotFiles",
  "processedFiles", "treeItems", "selectedContextOrdinal", "snapshotOrdinal",
]);

const validatePullRequestRefreshDiagnostic = (
  value: PullRequestRefreshDiagnostic,
): PullRequestRefreshDiagnostic => {
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    throw new RangeError("PR Progress refresh generation must be a positive safe integer");
  }
  if (!SAFE_PULL_REQUEST_REFRESH_TRIGGERS.has(value.trigger)) throw new TypeError("PR Progress refresh trigger is not allowlisted");
  if (!SAFE_PULL_REQUEST_REFRESH_STAGES.has(value.stage)) throw new TypeError("PR Progress refresh stage is not allowlisted");
  if (!SAFE_PULL_REQUEST_REFRESH_STATUSES.has(value.status)) throw new TypeError("PR Progress refresh status is not allowlisted");
  if (value.reasonCode !== undefined && !SAFE_PULL_REQUEST_REFRESH_REASONS.has(value.reasonCode)) {
    throw new TypeError("PR Progress refresh reason is not allowlisted");
  }
  if (value.durationMs !== undefined && (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0)) {
    throw new RangeError("PR Progress refresh duration must be a non-negative safe integer");
  }
  for (const [name, number] of [
    ["relatedOperationId", value.relatedOperationId], ["relatedGeneration", value.relatedGeneration],
    ["supersededByGeneration", value.supersededByGeneration], ["causedByOperationId", value.causedByOperationId],
    ["ordinal", value.ordinal],
  ] as const) {
    if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) {
      throw new RangeError(`PR Progress refresh ${name} must be a positive safe integer`);
    }
  }
  const counts: Partial<Record<keyof PullRequestRefreshCounts, number>> = {};
  const aliases = validatePullRequestRefreshAliases(value.aliases, value.generation);
  for (const [rawKey, rawValue] of Object.entries(value.counts ?? {})) {
    const key = rawKey as keyof PullRequestRefreshCounts;
    if (!SAFE_PULL_REQUEST_REFRESH_COUNT_KEYS.has(key)) throw new TypeError("PR Progress refresh count is not allowlisted");
    counts[key] = validateOperationProgressCount(rawValue, `PR Progress refresh ${key}`);
  }
  return Object.freeze({
    generation: value.generation,
    trigger: value.trigger,
    stage: value.stage,
    status: value.status,
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
    ...(Object.keys(counts).length === 0 ? {} : { counts: Object.freeze(counts) }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(value.reasonCode === undefined ? {} : { reasonCode: value.reasonCode }),
    ...(value.relatedOperationId === undefined ? {} : { relatedOperationId: value.relatedOperationId }),
    ...(value.relatedGeneration === undefined ? {} : { relatedGeneration: value.relatedGeneration }),
    ...(value.supersededByGeneration === undefined ? {} : { supersededByGeneration: value.supersededByGeneration }),
    ...(value.causedByOperationId === undefined ? {} : { causedByOperationId: value.causedByOperationId }),
    ...(value.ordinal === undefined ? {} : { ordinal: value.ordinal }),
  });
};

const validatePrProgressAttempts = (
  attempts: readonly PullRequestDiffAcquisitionAttempt[]
): readonly PullRequestDiffAcquisitionAttempt[] => Object.freeze(
  attempts.map((attempt) => {
    if (
      !SAFE_PR_PROGRESS_SOURCES.has(attempt.source) ||
      !SAFE_PR_PROGRESS_REASONS.has(attempt.reason)
    ) {
      throw new TypeError("PR progress diagnostic attempt contains a non-allowlisted source or reason");
    }
    return Object.freeze({ source: attempt.source, reason: attempt.reason });
  })
);

const validateGitHubPullRequestDetectionReason = (
  reason: unknown
): "rate-limit" | "network" | "api" | "authentication" | "timeout" => {
  if (typeof reason !== "string" || !SAFE_GITHUB_PR_DETECTION_REASONS.has(reason)) {
    throw new TypeError("GitHub PR detection diagnostic reason is not allowlisted");
  }
  return reason as "rate-limit" | "network" | "api" | "authentication" | "timeout";
};

/**
 * Error carrying only an explicitly allowlisted structured diagnostic.
 *
 * Raw dependency messages are deliberately excluded. Constructor validation and
 * detached immutable copies prevent path/title/source data from being smuggled
 * into the Output projection through this boundary.
 */
export class OperationDiagnosticError extends Error {
  public readonly code: OperationDiagnostic["code"];
  public readonly diagnostic: OperationDiagnostic;

  public constructor(diagnostic: OperationDiagnostic) {
    super("Operation diagnostic is available.");
    this.name = "OperationDiagnosticError";
    this.code = diagnostic.code;
    this.diagnostic = diagnostic.code === "PR_PROGRESS_UNAVAILABLE"
      ? Object.freeze({ code: diagnostic.code, attempts: validatePrProgressAttempts(diagnostic.attempts) })
      : Object.freeze({
        code: diagnostic.code,
        reason: validateGitHubPullRequestDetectionReason(diagnostic.reason),
      });

  }
}

const safeErrorName = (error: Error): string =>
  SAFE_ERROR_NAMES.has(error.name) ? error.name : "Error";

const safeErrorCode = (error: unknown): string | undefined => {
  const code = safeReadErrorField(error, "code");
  return typeof code === "string" && SAFE_ERROR_CODES.has(code) ? code : undefined;
};

const errorField = (error: unknown, field: "code" | "status" | "name"): unknown =>
  safeReadErrorField(error, field);

const isTimedOutGitCommand = (error: unknown): boolean => {
  if (errorField(error, "name") !== "GitCommandFailedError") return false;
  const result = safeReadErrorField(error, "result");
  return safeReadErrorField(result, "exitCode") === -1;
};

/**
 * Classifies dependency failures without copying their text, path, token, or
 * source content. Authentication, validation, stale, and permanent failures
 * deliberately never enter the retry loop.
 */
export const classifyOperationFailure = (error: unknown): OperationFailureClassification => {
  if (
    safeInstanceOf(error, (candidate) => candidate instanceof OperationCancelledError) ||
    errorField(error, "name") === "AbortError" ||
    errorField(error, "name") === "StaleReviewStateError"
  ) {
    return { kind: "stale" };
  }
  if (isOperationDiagnosticError(error)) {

    if (error.diagnostic.code === "GITHUB_PR_DETECTION_UNAVAILABLE") {
      switch (error.diagnostic.reason) {
        case "authentication": return { kind: "authentication" };
        case "rate-limit":
        case "network":
        case "timeout": return { kind: "retryable" };
        case "api": return { kind: "validation" };
      }
    }
    const finalReason = error.diagnostic.attempts.at(-1)?.reason;
    if (finalReason === "authentication") return { kind: "authentication" };
    if (finalReason === "rate-limit" || finalReason === "network" || finalReason === "git-timeout") return { kind: "retryable" };
    if (finalReason === "git-failure" || finalReason === "git-unavailable") return { kind: "permanent" };
    return { kind: "validation" };
  }
  const status = errorField(error, "status");
  if (status === 401 || status === 403) return { kind: "authentication" };
  if (status === 429) return { kind: "retryable" };
  if (safeInstanceOf(error, (candidate) => candidate instanceof TypeError) || errorField(error, "name") === "ValidationError") {
    return { kind: "validation" };
  }
  const code = safeErrorCode(error);
  if (isTimedOutGitCommand(error) || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ECONNRESET") {
    return { kind: "retryable", code };
  }
  return code === undefined ? { kind: "permanent" } : { kind: "permanent", code };
};

const globalUnderstandingFailureDiagnostics = new WeakMap<object, GlobalUnderstandingFailureDiagnostic>();

/** Attaches one bounded source-content-free Global Understanding diagnostic without replacing the original error. */
export const attachGlobalUnderstandingFailureDiagnostic = (
  error: unknown,
  context: Readonly<{
    stage: GlobalUnderstandingFailureStage;
    operation: "folder-scope-refresh";
    scope: "repository-root" | "folder";
    discoveredFileCount: number;
    processedFileCount: number;
  }>
): unknown => {
  const identity = (typeof error === "object" && error !== null) || typeof error === "function" ? error as object : undefined;
  if (identity === undefined) return error;
  if (!SAFE_GLOBAL_UNDERSTANDING_STAGES.has(context.stage)) throw new TypeError("Global Understanding diagnostic stage is not allowlisted");
  if (context.operation !== "folder-scope-refresh") throw new TypeError("Global Understanding diagnostic operation is not allowlisted");
  if (!SAFE_GLOBAL_UNDERSTANDING_SCOPES.has(context.scope)) throw new TypeError("Global Understanding diagnostic scope is not allowlisted");
  const classification = classifyOperationFailure(error);
  if (!SAFE_OPERATION_FAILURE_CATEGORIES.has(classification.kind)) throw new TypeError("Global Understanding diagnostic failure category is not allowlisted");
  const diagnostic: GlobalUnderstandingFailureDiagnostic = Object.freeze({
    code: "GLOBAL_UNDERSTANDING_FAILURE",
    stage: context.stage,
    operation: context.operation,
    scope: context.scope,
    errorName: error instanceof Error ? safeErrorName(error) : "Error",
    ...(classification.code === undefined ? {} : { errorCode: classification.code }),
    category: classification.kind,
    discoveredFileCount: validateOperationProgressCount(context.discoveredFileCount, "Global Understanding discovered file count"),
    processedFileCount: validateOperationProgressCount(context.processedFileCount, "Global Understanding processed file count"),
  });
  globalUnderstandingFailureDiagnostics.set(identity, diagnostic);
  return error;
};

const retryAttemptsByError = new WeakMap<object, readonly OperationRetryAttempt[]>();

const rememberRetryAttempts = (error: unknown, attempts: readonly OperationRetryAttempt[]): void => {
  const identity = errorIdentity(error);
  if (identity !== undefined && attempts.length > 0) retryAttemptsByError.set(identity, attempts);
};

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted === true) {
    reject(new OperationCancelledError());
    return;
  }
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new OperationCancelledError());
  }, { once: true });
});

/** Runs an idempotent operation with at most three attempts and exponential backoff. */
export const runWithBoundedRetry = async <T>(
  operation: () => Promise<T>,
  options: BoundedRetryOptions = {}
): Promise<BoundedRetryResult<T>> => {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new RangeError("maxAttempts must be an integer from 1 through 3");
  }
  const attempts: OperationRetryAttempt[] = [];
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted === true) throw new OperationCancelledError();
    try {
      return { value: await operation(), attempts: Object.freeze([...attempts]) };
    } catch (error) {
      const classification = classifyOperationFailure(error);
      if (classification.kind !== "retryable" || attempt === maxAttempts) {
        rememberRetryAttempts(error, attempts);
        throw error;
      }
      const retryAttempt = Object.freeze({
        category: classification.kind,
        ...(classification.code === undefined ? {} : { code: classification.code })
      });
      attempts.push(retryAttempt);
      options.feedbackContext?.owner.reportRetryAttempt(retryAttempt, attempt, 25 * (2 ** (attempt - 1)), options.feedbackContext, error);
      await sleep(25 * (2 ** (attempt - 1)), options.signal);
    }
  }
  throw new Error("unreachable retry state");
};

const formatGlobalUnderstandingFailureDiagnostic = (diagnostic: GlobalUnderstandingFailureDiagnostic): string =>
  diagnostic.code +
  " stage=" + diagnostic.stage +
  "; operation=" + diagnostic.operation +
  "; scope=" + diagnostic.scope +
  "; error=" + diagnostic.errorName +
  "; code=" + (diagnostic.errorCode ?? "none") +
  "; category=" + diagnostic.category +
  "; discovered=" + String(diagnostic.discoveredFileCount) +
  "; processed=" + String(diagnostic.processedFileCount);

const formatOperationDiagnostic = (diagnostic: OperationDiagnostic): string => {
  if (diagnostic.code === "GITHUB_PR_DETECTION_UNAVAILABLE") {
    return `${diagnostic.code} reason=${diagnostic.reason}`;
  }
  const attempts = diagnostic.attempts.slice(0, 3)
    .map((attempt) => `${attempt.source}:${attempt.reason}`);
  const finalAttempt = attempts.at(-1) ?? "none";
  const omitted = diagnostic.attempts.length > attempts.length ? "; attempts-truncated" : "";
  return `${diagnostic.code} attempts=${attempts.length === 0 ? "none" : attempts.join(" -> ")}; final=${finalAttempt}${omitted}`;
};

const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MAX_ERROR_STACK_LENGTH = 12_000;
const MAX_ERROR_STACK_LINES = 48;
const MAX_ERROR_CAUSE_DEPTH = 4;

const redactDiagnosticSecrets = (value: string): string => value
  .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu, "[REDACTED PRIVATE KEY]")
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/giu, "[REDACTED TOKEN]")
  .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[^\s,;]+/giu, "$1: [REDACTED]")
  .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, "$1 [REDACTED]")
  .replace(/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/giu, "$1: [REDACTED]")
  .replace(/\b(access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|passphrase|client[_-]?secret|api[_-]?key|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, "$1=[REDACTED]")
  .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/giu, "$1[REDACTED]@");

const normalizedDiagnosticText = (value: string, maximum: number): string => {
  const redacted = redactDiagnosticSecrets(value.replace(/\0/gu, "\\0"));
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 32)} … [truncated ${redacted.length - maximum + 32} chars]`;
};

const safeReadErrorField = (error: unknown, field: string): unknown => {
  try {
    if ((typeof error !== "object" || error === null) && typeof error !== "function") return undefined;
    return (error as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
};

const safeInstanceOf = (value: unknown, check: (value: unknown) => boolean): boolean => {
  try {
    return check(value);
  } catch {
    return false;
  }
};

const isOperationDiagnosticError = (value: unknown): value is OperationDiagnosticError =>
  safeInstanceOf(value, (candidate) => candidate instanceof OperationDiagnosticError);

const MAX_DIAGNOSTIC_CAUSES = 16;
const unreadableErrorCause = Object.freeze({
  name: "UnreadableErrorCause",
  message: "An error cause could not be read safely.",
});

interface SafeErrorArrayRead {
  readonly values: readonly unknown[];
  readonly omittedCount: number;
}

const safeReadErrorArray = (value: unknown): SafeErrorArrayRead | undefined => {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    if (length <= MAX_DIAGNOSTIC_CAUSES) {
      const values: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        try {
          values.push(value[index]);
        } catch {
          values.push(unreadableErrorCause);
        }
      }
      return { values, omittedCount: 0 };
    }

    const values: unknown[] = [];
    for (let index = 0; index < MAX_DIAGNOSTIC_CAUSES - 1; index += 1) {
      try {
        values.push(value[index]);
      } catch {
        values.push(unreadableErrorCause);
      }
    }
    const omittedCount = length - MAX_DIAGNOSTIC_CAUSES;
    values.push({
      name: "OmittedErrorCauses",
      message: `${omittedCount} additional error cause${omittedCount === 1 ? "" : "s"} omitted from the diagnostic sample.`,
    });
    try {
      values.push(value[length - 1]);
    } catch {
      values.push(unreadableErrorCause);
    }
    return { values, omittedCount };
  } catch {
    return undefined;
  }
};

const safeDiagnosticScalar = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return undefined;
};

const createErrorDiagnostic = (
  error: unknown,
  seen: Set<object> = new Set(),
  depth = 0,
): OperationErrorDiagnostic => {
  const identity = ((typeof error === "object" && error !== null) || typeof error === "function") ? error as object : undefined;
  if (identity !== undefined && seen.has(identity)) {
    return { kind: "non-error", message: "Circular error cause omitted." };
  }
  if (identity !== undefined) seen.add(identity);
  const isError = safeInstanceOf(error, (candidate) => candidate instanceof Error);
  const rawName = safeDiagnosticScalar(safeReadErrorField(error, "name"));
  const rawMessage = safeDiagnosticScalar(safeReadErrorField(error, "message"));
  const globalDiagnostic = identity === undefined ? undefined : globalUnderstandingFailureDiagnostics.get(identity);
  const structuredMessage = globalDiagnostic !== undefined
    ? formatGlobalUnderstandingFailureDiagnostic(globalDiagnostic)
    : isOperationDiagnosticError(error)
      ? formatOperationDiagnostic(error.diagnostic)
      : undefined;
  const primitiveMessage = typeof error === "string" ? error :
    error === null || error === undefined || typeof error === "number" || typeof error === "boolean" || typeof error === "bigint"
      ? String(error)
      : undefined;
  const message = normalizedDiagnosticText(
    structuredMessage ?? rawMessage ?? primitiveMessage ?? (isError ? "Error has no readable message." : "Thrown non-Error value has no readable message."),
    MAX_ERROR_MESSAGE_LENGTH,
  );
  const rawCode = safeDiagnosticScalar(safeReadErrorField(error, "code"));
  const rawStatus = safeDiagnosticScalar(safeReadErrorField(error, "status"));
  const rawStack = safeDiagnosticScalar(safeReadErrorField(error, "stack"));
  let stack: string | undefined;
  if (rawStack !== undefined) {
    const redactedStack = redactDiagnosticSecrets(rawStack.replace(/\0/gu, "\\0"));
    const stackLines = redactedStack.split(/\r?\n/u);
    const lines = stackLines.slice(0, MAX_ERROR_STACK_LINES)
      .map((line) => normalizedDiagnosticText(line, 1_000));
    if (stackLines.length > MAX_ERROR_STACK_LINES) lines.push("… [stack lines truncated]");
    stack = normalizedDiagnosticText(lines.join("\n"), MAX_ERROR_STACK_LENGTH);
  }
  let cause: OperationErrorDiagnostic | undefined;
  const rawCause = safeReadErrorField(error, "cause");
  if (rawCause !== undefined) {
    cause = depth >= MAX_ERROR_CAUSE_DEPTH
      ? { kind: "non-error", message: "Further error causes omitted after depth limit." }
      : createErrorDiagnostic(rawCause, seen, depth + 1);
  }
  const rawCauses = safeReadErrorArray(safeReadErrorField(error, "errors"));
  const causeValues = rawCauses?.values.filter((causeValue) => causeValue !== rawCause);
  const causes = causeValues?.map((causeValue) => depth >= MAX_ERROR_CAUSE_DEPTH
      ? { kind: "non-error" as const, message: "Further error causes omitted after depth limit." }
      : createErrorDiagnostic(causeValue, seen, depth + 1));
  if (identity !== undefined) seen.delete(identity);
  return {
    kind: isError ? "error" : "non-error",
    ...(rawName === undefined ? {} : { name: normalizedDiagnosticText(rawName, 120) }),
    message,
    ...(rawCode === undefined ? {} : { code: normalizedDiagnosticText(rawCode, 256) }),
    ...(rawStatus === undefined ? {} : { status: normalizedDiagnosticText(rawStatus, 128) }),
    ...(stack === undefined ? {} : { stack }),
    ...(cause === undefined ? {} : { cause }),
    ...(causes === undefined || causes.length === 0 ? {} : { causes }),
    ...(rawCauses === undefined || rawCauses.omittedCount === 0 ? {} : { omittedCauseCount: rawCauses.omittedCount }),
  };
};

const sanitizedFailureMessage = (error: unknown): string => {
  const identity = errorIdentity(error);
  const globalDiagnostic = identity === undefined ? undefined : globalUnderstandingFailureDiagnostics.get(identity);
  if (globalDiagnostic !== undefined) return formatGlobalUnderstandingFailureDiagnostic(globalDiagnostic);
  if (isOperationDiagnosticError(error)) {
    return formatOperationDiagnostic(error.diagnostic);
  }
  const details = createErrorDiagnostic(error);
  const attempts = errorIdentity(error) === undefined ? undefined : retryAttemptsByError.get(errorIdentity(error)!);
  if (attempts === undefined || attempts.length === 0) return details.message;
  const retrySequence = attempts.map((attempt) => attempt.code ?? attempt.category).join(" -> ");
  return `${details.message} retries=${retrySequence}; final=${classifyOperationFailure(error).kind}.`;
};

/** Projects a failure to a generic user-facing message. */
export const formatOperationFailureForUser = (error: unknown): string => {
  switch (classifyOperationFailure(error).kind) {
    case "authentication": return "認証を確認してから再試行してください。";
    case "stale": return "操作結果が古くなったため、最新状態を再計算してください。";
    case "validation": return "操作を実行できませんでした。入力または現在の状態を確認してください。";
    case "retryable": return "一時的な障害のため操作を完了できませんでした。再試行してください。";
    case "permanent": return "操作を完了できませんでした。詳細は Review Range Output を確認してください。";
  }
};

const failureDetails = (error: unknown): Pick<OperationLogEntry, "errorName" | "message" | "errorDetails" | "failureCategory"> => {
  const errorDetails = createErrorDiagnostic(error);
  return {
    ...(errorDetails.name === undefined ? {} : { errorName: errorDetails.name }),
    message: sanitizedFailureMessage(error),
    errorDetails,
    failureCategory: classifyOperationFailure(error).kind,
  };
};

const errorIdentity = (error: unknown): object | undefined =>
  (typeof error === "object" && error !== null) || typeof error === "function"
    ? error as object
    : undefined;

const failureComponents = (error: unknown, seen = new Set<unknown>()): unknown[] => {
  if (seen.has(error)) return [];
  seen.add(error);
  const errors = safeReadErrorArray(safeReadErrorField(error, "errors"));
  return errors === undefined ? [error] : errors.values.flatMap((item) => failureComponents(item, seen));
};

const mergeOperationFailures = (...errors: readonly unknown[]): unknown => {
  const seen = new Set<unknown>();
  const components = errors.flatMap((error) => failureComponents(error, seen));
  if (components.length <= 1) return components[0];
  return new AggregateError(components, "Multiple related operation failures occurred.");
};

const containsOperationFailure = (outer: unknown, sought: unknown, seen = new Set<unknown>()): boolean => {
  if (outer === sought) return true;
  if (seen.has(outer)) return false;
  seen.add(outer);
  const errors = safeReadErrorArray(safeReadErrorField(outer, "errors"));
  if (errors?.values.some((item) => containsOperationFailure(item, sought, seen)) === true) return true;
  return containsOperationFailure(safeReadErrorField(outer, "cause"), sought, seen);
};

/**
 * Coordinates operation lifecycle logging with one shared activity status.
 *
 * Operation output is local diagnostics. Error evidence is retained after
 * secret-value redaction; callers must keep private environment data out of
 * public comments and artifacts.
 */
export class OperationFeedback {
  private readonly active: ActiveOperation[] = [];
  private readonly pendingBoundaryDuplicates = new WeakSet<object>();
  private readonly operationFinishedListeners = new Map<number, Set<() => void>>();
  protected nextId = 0;
  private readonly reportedStorageLockScopes = new Set<string>();

  public constructor(
    private readonly host: OperationFeedbackHost,
    private readonly now: () => number = () => Date.now(),
    private readonly fallbackWriter: (line: string) => void = (line) => console.error(line),
  ) {}

  /** Runs one operation while publishing start, success/failure, and busy status. */
  public async run<T>(label: string, operation: (context: OperationFeedbackContext) => Promise<T>): Promise<T> {
    const normalizedLabel = requireLabel(label);
    const active: ActiveOperation = {
      id: ++this.nextId,
      label: normalizedLabel,
      startedAt: this.now()
    };
    this.active.push(active);
    this.appendHostLog({
      timestamp: new Date(active.startedAt).toISOString(),
      label: active.label,
      event: "started",
      operationId: active.id
    });
    this.publishStatus();

    try {
      const result = await operation({ owner: this, id: active.id });
      const finishedAt = this.now();
      if (active.boundaryFailure !== undefined) {
        this.recordRunFailure(active.label, active.boundaryFailure, finishedAt, Math.max(0, finishedAt - active.startedAt), active.id);
      } else if (active.boundaryCancelled === true) {
        this.appendHostLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "cancelled",
          operationId: active.id,
          durationMs: Math.max(0, finishedAt - active.startedAt),
          ...(active.outcomeReason === undefined ? {} : { outcomeReason: active.outcomeReason }),
        });
      } else if (active.boundaryNoResult === true) {
        this.appendHostLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "no-result",
          operationId: active.id,
          durationMs: Math.max(0, finishedAt - active.startedAt),
          ...(active.outcomeReason === undefined ? {} : { outcomeReason: active.outcomeReason }),
        });
      } else if (active.boundaryDegraded === true) {
        this.appendHostLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "degraded",
          operationId: active.id,
          durationMs: Math.max(0, finishedAt - active.startedAt),
          ...(active.outcomeReason === undefined ? {} : { outcomeReason: active.outcomeReason }),
        });
      } else {
        this.appendHostLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "succeeded",
          operationId: active.id,
          durationMs: Math.max(0, finishedAt - active.startedAt)
        });
      }
      return result;
    } catch (error) {
      const finishedAt = this.now();
      const durationMs = Math.max(0, finishedAt - active.startedAt);
      if (active.boundaryFailure !== undefined) {
        const terminalError = containsOperationFailure(error, active.boundaryFailure)
          ? error
          : mergeOperationFailures(active.boundaryFailure, error);
        this.recordRunFailure(active.label, terminalError, finishedAt, durationMs, active.id);
      } else if (classifyOperationFailure(error).kind === "stale") {
        this.appendHostLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "cancelled",
          operationId: active.id,
          durationMs,
          ...failureDetails(error),
          outcomeReason: active.outcomeReason ?? "superseded-by-newer-generation",
        });
      } else {
        this.recordRunFailure(active.label, error, finishedAt, durationMs, active.id);
      }
      throw error;
    } finally {
      const index = this.active.findIndex((candidate) => candidate.id === active.id);
      if (index >= 0) this.active.splice(index, 1);
      const listeners = this.operationFinishedListeners.get(active.id);
      this.operationFinishedListeners.delete(active.id);
      for (const listener of listeners ?? []) {
        try {
          listener();
        } catch (error) {
          this.reportLoggerFailure("operation-finish-listener", error);
        }
      }
      this.publishStatus();
    }
  }

  /** Registers operation-local cleanup that runs after success, failure, or cancellation. */
  public onOperationFinished(context: OperationFeedbackContext, listener: () => void): void {
    if (context.owner !== this || !this.active.some((operation) => operation.id === context.id)) {
      listener();
      return;
    }
    const listeners = this.operationFinishedListeners.get(context.id) ?? new Set<() => void>();
    listeners.add(listener);
    this.operationFinishedListeners.set(context.id, listeners);
  }

  /** Updates one active operation with an anonymous count-only stage. */
  public reportProgress(progress: OperationProgress, context?: OperationFeedbackContext): void {
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : context === undefined
        ? this.active.at(-1)
        : undefined;
    if (active === undefined || active.boundaryFailure !== undefined) return;
    const validated = validateOperationProgress(progress);
    if (sameOperationProgress(active.progress, validated)) return;
    active.progress = validated;
    this.appendHostLog({
      timestamp: new Date(this.now()).toISOString(),
      label: active.label,
      event: "progress",
      operationId: active.id,
      progress: validated,
    });
    this.publishStatus();
  }

  /** Records a retry before backoff so a cancellation during sleep keeps its preceding cause. */
  public reportRetryAttempt(
    attempt: OperationRetryAttempt,
    attemptNumber: number,
    delayMs: number,
    context: OperationFeedbackContext,
    error?: unknown,
  ): void {
    if (context.owner !== this || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1 ||
      !Number.isSafeInteger(delayMs) || delayMs < 0 || !SAFE_OPERATION_FAILURE_CATEGORIES.has(attempt.category)) return;
    const active = this.active.find((candidate) => candidate.id === context.id);
    if (active === undefined) return;
    this.appendHostLog({
      timestamp: new Date(this.now()).toISOString(),
      label: active.label,
      event: "retry",
      operationId: active.id,
      retryAttempt: {
        attempt: attemptNumber,
        category: attempt.category,
        ...(attempt.code === undefined ? {} : { code: attempt.code }),
        delayMs,
        ...(error === undefined ? {} : { error: createErrorDiagnostic(error) }),
      },
    });
  }

  /** Records one route in the PR diff fallback chain, preserving its local error evidence. */
  public reportAcquisitionAttempt(
    attempt: Omit<OperationAcquisitionAttempt, "error"> & { readonly error?: unknown },
    context?: OperationFeedbackContext,
  ): void {
    if (!SAFE_ACQUISITION_SOURCES.has(attempt.source) ||
      (attempt.reason !== undefined && !SAFE_ACQUISITION_REASONS.has(attempt.reason))) return;
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : context === undefined
        ? this.active.at(-1)
        : undefined;
    if (active === undefined) return;
    const error = attempt.error === undefined ? undefined : createErrorDiagnostic(attempt.error);
    this.appendHostLog({
      timestamp: new Date(this.now()).toISOString(),
      label: active.label,
      event: "acquisition",
      operationId: active.id,
      acquisitionAttempt: {
        source: attempt.source,
        status: attempt.status,
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
        ...(error === undefined ? {} : { error }),
      },
    });
  }

  /** Appends one validated PR Progress refresh event to its owning operation. */
  public reportPullRequestRefresh(
    context: OperationFeedbackContext | undefined,
    diagnostic: PullRequestRefreshDiagnostic,
  ): void {
    const validated = validatePullRequestRefreshDiagnostic(diagnostic);
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : context === undefined
        ? this.active.at(-1)
        : undefined;
    if (active === undefined) return;
    validatePullRequestRefreshAliases(validated.aliases, validated.generation, { owner: this, id: active.id });
    if (validated.status === "cancelled" || validated.status === "superseded") {
      active.boundaryCancelled = true;
      active.outcomeReason = validated.reasonCode ?? "superseded";
    } else if (validated.status === "no-result") {
      active.boundaryNoResult = true;
      active.outcomeReason = validated.reasonCode ?? "no-matching-pr";
    }
    const event: OperationLogEvent = "refresh";
    this.appendHostLog({
      timestamp: new Date(this.now()).toISOString(),
      label: "PR Progress refresh",
      event,
      operationId: active.id,
      pullRequestRefresh: validated,
    });
  }

  /** Records an error intentionally handled by a fail-closed or UI boundary. */
  public reportFailure(label: string, error: unknown, context?: OperationFeedbackContext): void {
    const identity = errorIdentity(error);
    if (identity !== undefined && this.pendingBoundaryDuplicates.has(identity)) {
      this.pendingBoundaryDuplicates.delete(identity);
      return;
    }
    const components = failureComponents(error);
    const alreadyReported = new Set<object>();
    for (const component of components) {
      const componentIdentity = errorIdentity(component);
      if (componentIdentity !== undefined && this.pendingBoundaryDuplicates.has(componentIdentity)) {
        this.pendingBoundaryDuplicates.delete(componentIdentity);
        alreadyReported.add(componentIdentity);
      }
    }
    const unreportedComponents = components.filter((component) => {
      const componentIdentity = errorIdentity(component);
      return componentIdentity === undefined || !alreadyReported.has(componentIdentity);
    });
    if (components.length > 0 && unreportedComponents.length === 0) return;
    const reportableError = unreportedComponents.length === components.length
      ? error
      : mergeOperationFailures(...unreportedComponents);
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : undefined;
    if (active !== undefined) {
      active.boundaryFailure = active.boundaryFailure === undefined
        ? reportableError
        : mergeOperationFailures(active.boundaryFailure, reportableError);
      return;
    }
    const timestamp = this.now();
    const normalizedLabel = requireLabel(label);
    const id = ++this.nextId;
    this.appendHostLog({ timestamp: new Date(timestamp).toISOString(), label: normalizedLabel, event: "started", operationId: id });
    this.appendFailure(normalizedLabel, reportableError, timestamp, undefined, id);
  }

  /** Records an optional cache persistence failure without failing the owning operation. */
  public reportStageDiagnostic(
    stage: OperationStageDiagnostic["stage"],
    error: unknown,
    context?: OperationFeedbackContext,
    status: OperationStageDiagnosticStatus = "failed",
  ): void {
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : context === undefined
        ? this.active.at(-1)
        : undefined;
    if (active === undefined) return;
    const errorDetails = error === undefined ? undefined : createErrorDiagnostic(error);
    const code = errorDetails?.code;
    if (status === "cancelled" && stage !== "cache-read") {
      active.boundaryCancelled = true;
      active.outcomeReason = "superseded-by-newer-generation";
    } else if (status === "no-result" && stage !== "cache-read") {
      active.boundaryNoResult = true;
      active.outcomeReason = "no-matching-pr";
    } else if (status === "degraded") {
      active.boundaryDegraded = true;
      active.outcomeReason = "refresh-failed";
    }
    this.appendHostLog({
      timestamp: new Date(this.now()).toISOString(),
      label: active.label,
      event: "refresh",
      operationId: active.id,
      operationDiagnostic: {
        stage,
        status,
        ...(error === undefined || stage === "cache-persistence" ? {} : { category: classifyOperationFailure(error).kind }),
        ...(code === undefined ? {} : { code }),
        ...(errorDetails === undefined ? {} : { error: errorDetails }),
      },
    });
  }

  /** Returns whether an explicit parent operation already has a terminal handled failure. */
  public hasBoundaryFailure(context: OperationFeedbackContext | undefined): boolean {
    if (context?.owner !== this) return false;
    return this.active.some((candidate) => candidate.id === context.id && candidate.boundaryFailure !== undefined);
  }

  /** Emits a single source-content-free storage-lock observation to the shared Output lifecycle. */
  public reportStorageLock(
    kind: "timeout" | "failure" | "stale-recovered",
    operationId: string,
    context?: OperationFeedbackContext,
  ): void {
    const scope = `${operationId}\0${kind}`;
    if (this.reportedStorageLockScopes.has(scope)) return;
    this.reportedStorageLockScopes.add(scope);
    const active = context?.owner === this
      ? this.active.find((candidate) => candidate.id === context.id)
      : undefined;
    if (active !== undefined) {
      if (kind !== "stale-recovered") {
        active.boundaryFailure ??= Object.assign(new Error("Storage lock operation failed."), { code: "EBUSY" });
      }
      return;
    }
    const timestamp = new Date(this.now()).toISOString();
    this.appendHostLog({ timestamp, label: "Storage lock", event: "started" });
    this.appendHostLog({
      timestamp,
      label: "Storage lock",
      event: kind === "stale-recovered" ? "succeeded" : "failed",
      message: `Storage lock ${kind}.`
    });
    if (kind !== "stale-recovered") this.revealHostLog();
  }

  private recordRunFailure(
    label: string,
    error: unknown,
    timestamp: number,
    durationMs: number,
    operationId: number,
  ): void {
    const identity = errorIdentity(error);
    if (identity !== undefined) {
      this.pendingBoundaryDuplicates.delete(identity);
    }
    this.appendFailure(label, error, timestamp, durationMs, operationId);
    if (identity !== undefined) this.pendingBoundaryDuplicates.add(identity);
  }

  private appendFailure(
    label: string,
    error: unknown,
    timestamp: number,
    durationMs?: number,
    operationId?: number,
  ): void {
    this.appendHostLog({
      timestamp: new Date(timestamp).toISOString(),
      label,
      event: "failed",
      ...(operationId === undefined ? {} : { operationId }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...failureDetails(error)
    });
    this.revealHostLog();
  }

  private publishStatus(): void {
    const latest = this.active.at(-1);
    if (latest === undefined) {
      try { this.host.clearBusy(); } catch (error) { this.reportLoggerFailure("clear-busy", error); }
      return;
    }
    try { this.host.showBusy(latest.label, this.active.length, latest.progress); }
    catch (error) { this.reportLoggerFailure("show-busy", error); }
  }

  private appendHostLog(entry: OperationLogEntry): void {
    try { this.host.appendLog(entry); }
    catch (error) {
      let line = "Review Range Output logger failed while writing an operation record.";
      try { line += ` record=${formatOperationLogEntry(entry)}`; } catch { /* keep fallback safe */ }
      this.reportLoggerFailure(line, error);
    }
  }

  private revealHostLog(): void {
    try { this.host.revealLog(); }
    catch (error) { this.reportLoggerFailure("reveal-output", error); }
  }

  protected reportLoggerFailure(action: string, error: unknown): void {
    try {
      const details = createErrorDiagnostic(error);
      const line = `[Review Range local fallback] ${action}: ${details.name ?? details.kind}: ${details.message}` +
        (details.code === undefined ? "" : ` code=${details.code}`) +
        (details.stack === undefined ? "" : `\n${details.stack}`);
      this.fallbackWriter(line);
    } catch {
      // The fallback sink is best-effort and must never replace application outcomes.
    }
  }
}

const MAX_FORMATTED_ERROR_SUMMARIES = 64;
const collectErrorEvidence = (
  roots: readonly { readonly details: OperationErrorDiagnostic; readonly prefix: string }[],
): { readonly summaryLines: readonly string[]; readonly stackLines: readonly string[] } => {
  const pending = [...roots];
  const summaryLines: string[] = [];
  const stackLines: string[] = [];
  while (pending.length > 0 && summaryLines.length < MAX_FORMATTED_ERROR_SUMMARIES) {
    const current = pending.shift()!;
    const identity = normalizedDiagnosticText(current.details.name ?? current.details.kind, 64);
    const code = current.details.code === undefined ? "" : ` code=${normalizedDiagnosticText(current.details.code, 32)}`;
    const status = current.details.status === undefined ? "" : ` status=${normalizedDiagnosticText(current.details.status, 16)}`;
    const message = normalizedDiagnosticText(current.details.message, 80);
    summaryLines.push(`${current.prefix}${identity}${code}${status}: ${message}`);
    if (current.details.stack !== undefined) {
      stackLines.push(`${current.prefix}stack:`);
      for (const stackLine of current.details.stack.split("\n")) stackLines.push(`${current.prefix}  ${stackLine}`);
    }
    if (current.details.cause !== undefined) {
      pending.push({ details: current.details.cause, prefix: `${current.prefix}caused by ` });
    }
    for (const cause of current.details.causes ?? []) {
      pending.push({ details: cause, prefix: `${current.prefix}also caused by ` });
    }
  }
  if (pending.length > 0) summaryLines.push("Further nested error summaries omitted at formatter limit.");
  return { summaryLines, stackLines };
};

/** Formats local Output diagnostics, preserving error evidence after masking secret values. */
export const formatOperationLogEntry = (entry: OperationLogEntry): string => {
  const stage = entry.event === "started"
    ? "START"
    : entry.event === "progress"
      ? "PROGRESS"
      : entry.event === "retry"
        ? "RETRY"
      : entry.event === "acquisition"
        ? "ACQUIRE"
      : entry.event === "refresh"
        ? "REFRESH"
      : entry.event === "succeeded"
        ? "OK"
        : entry.event === "cancelled"
          ? "CANCEL"
          : entry.event === "no-result"
            ? "NO-RESULT"
            : entry.event === "degraded"
              ? "DEGRADED"
              : "ERROR";
  const progress = entry.event === "progress" && entry.progress !== undefined
    ? ` stage=${entry.progress.stage} progress=${entry.progress.completed}${entry.progress.total === undefined ? "" : `/${entry.progress.total}`}`
    : "";
  const retry = entry.retryAttempt === undefined ? "" :
    ` attempt=${entry.retryAttempt.attempt} category=${entry.retryAttempt.category}${entry.retryAttempt.code === undefined ? "" : ` code=${entry.retryAttempt.code}`} backoff=${entry.retryAttempt.delayMs}ms`;
  const acquisition = entry.acquisitionAttempt === undefined ? "" :
    ` route=${entry.acquisitionAttempt.source} status=${entry.acquisitionAttempt.status}${entry.acquisitionAttempt.reason === undefined ? "" : ` reason=${entry.acquisitionAttempt.reason}`}`;
  const operation = entry.operationId === undefined ? "" : ` op=${entry.operationId}`;
  const duration = entry.durationMs === undefined ? "" : ` (${entry.durationMs} ms)`;
  const error = entry.errorDetails === undefined
    ? (entry.message === undefined ? "" : `: ${normalizedDiagnosticText(entry.message, MAX_ERROR_MESSAGE_LENGTH)}`)
    : `: ${entry.errorDetails.name ?? entry.errorDetails.kind}: ${entry.errorDetails.message}`;
  const failureCategory = entry.failureCategory !== undefined
    ? ` category=${entry.failureCategory}`
    : "";
  const outcomeReason = entry.outcomeReason === undefined ? "" : ` reason=${entry.outcomeReason}`;
  const refresh = entry.pullRequestRefresh;
  const refreshDetails = refresh === undefined
    ? ""
    : ` generation=${refresh.generation}` +
      ` trigger=${refresh.trigger} stage=${refresh.stage} status=${refresh.status}` +
      formatPullRequestRefreshAliases(refresh.aliases, refresh.generation) +
      (refresh.ordinal === undefined ? "" : ` ordinal=${refresh.ordinal}`) +
      (refresh.relatedOperationId === undefined ? "" : ` relatedOp=${refresh.relatedOperationId}`) +
      (refresh.relatedGeneration === undefined ? "" : ` relatedGeneration=${refresh.relatedGeneration}`) +
      (refresh.supersededByGeneration === undefined ? "" : ` supersededByGeneration=${refresh.supersededByGeneration}`) +
      (refresh.causedByOperationId === undefined ? "" : ` causedByOp=${refresh.causedByOperationId}`) +
      (refresh.durationMs === undefined ? "" : ` duration=${refresh.durationMs}ms`) +
      Object.entries(refresh.counts ?? {}).map(([key, value]) => ` ${key}=${value}`).join("") +
      (refresh.reasonCode === undefined ? "" : ` reason=${refresh.reasonCode}`);
  const operationDetails = entry.operationDiagnostic === undefined
    ? ""
    : ` stage=${entry.operationDiagnostic.stage} status=${entry.operationDiagnostic.status}` +
      (entry.operationDiagnostic.category === undefined ? "" : ` category=${entry.operationDiagnostic.category}`) +
      (entry.operationDiagnostic.code === undefined ? "" : ` code=${entry.operationDiagnostic.code}`);
  const lines = [
    `[${entry.timestamp}] ${stage}${operation} ${boundedSingleLine(entry.label, MAX_OPERATION_LABEL_LENGTH)}` +
    `${progress}${retry}${acquisition}${duration}${refreshDetails}${operationDetails}${error}${failureCategory}${outcomeReason}`,
  ];
  const errorEvidence = collectErrorEvidence([
    ...(entry.errorDetails === undefined ? [] : [{ details: entry.errorDetails, prefix: "  " }]),
    ...(entry.operationDiagnostic?.error === undefined ? [] : [{ details: entry.operationDiagnostic.error, prefix: "  " }]),
    ...(entry.acquisitionAttempt?.error === undefined ? [] : [{ details: entry.acquisitionAttempt.error, prefix: "  " }]),
    ...(entry.retryAttempt?.error === undefined ? [] : [{ details: entry.retryAttempt.error, prefix: "  " }]),
  ]);
  lines.push(...errorEvidence.summaryLines, ...errorEvidence.stackLines);
  const formatted = lines.join("\n");
  const truncationMarker = "\n… [diagnostic output truncated after 24,000 chars]";
  return formatted.length <= 24_000
    ? formatted
    : `${formatted.slice(0, 24_000 - truncationMarker.length)}${truncationMarker}`;
};

let activeOperationFeedback: OperationFeedback | undefined;
const pendingStorageLockDiagnostics: Array<{ readonly kind: "timeout" | "failure" | "stale-recovered"; readonly operationId: string }> = [];

/** Sets the process-wide operation feedback used by UI/application integration points. */
export const setActiveOperationFeedback = (feedback: OperationFeedback | undefined): void => {
  activeOperationFeedback = feedback;
  if (feedback !== undefined) {
    for (const diagnostic of pendingStorageLockDiagnostics.splice(0)) feedback.reportStorageLock(diagnostic.kind, diagnostic.operationId);
  }
};

/** Runs through the active UI feedback when available, otherwise executes directly. */
export const runWithActiveOperationFeedback = <T>(
  label: string,
  operation: (context: OperationFeedbackContext | undefined) => Promise<T>,
  retry?: BoundedRetryOptions,
  parentContext?: OperationFeedbackContext,
): Promise<T> => {
  const execute = (context: OperationFeedbackContext | undefined): Promise<T> => retry === undefined
    ? operation(context)
    : runWithBoundedRetry(() => operation(context), { ...retry, feedbackContext: retry.feedbackContext ?? context }).then((result) => result.value);
  const feedback = activeOperationFeedback;
  if (parentContext !== undefined) return execute(parentContext);
  if (feedback === undefined) return execute(undefined);
  return feedback.run(label, execute);
};

/** Reports anonymous count-only progress to the current or explicitly owned operation. */
export const reportActiveOperationProgress = (
  progress: OperationProgress,
  context?: OperationFeedbackContext,
): void => {
  (context?.owner ?? activeOperationFeedback)?.reportProgress(progress, context);
};

/** Records a safe attempt in the active GitHub/local PR diff acquisition fallback chain. */
export const reportActiveOperationAcquisitionAttempt = (
  attempt: Omit<OperationAcquisitionAttempt, "error"> & { readonly error?: unknown },
  context?: OperationFeedbackContext,
): void => {
  (context?.owner ?? activeOperationFeedback)?.reportAcquisitionAttempt(attempt, context);
};

/** Reports one validated PR Progress lifecycle stage through the shared Output boundary. */
export const reportActivePullRequestRefresh = (
  context: OperationFeedbackContext | undefined,
  diagnostic: PullRequestRefreshDiagnostic,
): void => {
  const feedback = context === undefined
    ? activeOperationFeedback
    : context.owner instanceof OperationFeedback
      ? context.owner
      : undefined;
  feedback?.reportPullRequestRefresh(context, diagnostic);
};

/** Reports a handled failure to active diagnostics when the UI host is installed. */
export const reportActiveOperationFailure = (
  label: string,
  error: unknown,
  context?: OperationFeedbackContext,
): void => {
  (context?.owner ?? activeOperationFeedback)?.reportFailure(label, error, context);
};

/** Records a fixed-stage diagnostic without changing operation success or failure. */
export const reportActiveOperationStageDiagnostic = (
  stage: OperationStageDiagnostic["stage"],
  error: unknown,
  context?: OperationFeedbackContext,
  status: OperationStageDiagnosticStatus = "failed",
): void => {
  (context?.owner ?? activeOperationFeedback)?.reportStageDiagnostic(stage, error, context, status);
};

/** Returns whether activation has already installed the shared Output lifecycle. */
export const hasActiveOperationFeedback = (): boolean => activeOperationFeedback !== undefined;

/** Tests an explicit operation context without consulting the process-wide active owner. */
export const hasOperationFeedbackFailure = (context: OperationFeedbackContext | undefined): boolean =>
  context?.owner.hasBoundaryFailure(context) ?? false;

/** Records a privacy-safe storage-lock lifecycle event when the Output host is active. */
export const reportActiveStorageLockDiagnostic = (
  diagnostic: { readonly kind: "timeout" | "failure" | "stale-recovered"; readonly operationId: string },
  context?: OperationFeedbackContext,
): void => {
  if (activeOperationFeedback === undefined && context === undefined) {
    pendingStorageLockDiagnostics.push(diagnostic);
    return;
  }
  (context?.owner ?? activeOperationFeedback)?.reportStorageLock(
    diagnostic.kind,
    diagnostic.operationId,
    context,
  );
};

import type { PullRequestDiffAcquisitionAttempt } from "../github-pr-diff/contracts";

/** Lifecycle event written to the Review Range diagnostic output. */
export type OperationLogEvent = "started" | "succeeded" | "failed";

/** One source-content-free diagnostic entry for an extension operation. */
export interface OperationLogEntry {
  /** UTC timestamp for the lifecycle event. */
  readonly timestamp: string;
  /** Generic operation label suitable for status and diagnostic output. */
  readonly label: string;
  /** Lifecycle stage. */
  readonly event: OperationLogEvent;
  /** Elapsed milliseconds for completed operations. */
  readonly durationMs?: number;
  /** Error class when the operation failed with an Error instance. */
  readonly errorName?: string;
  /** Failure message sanitized for source-content-free Output diagnostics. */
  readonly message?: string;
}

/** Runtime-neutral UI boundary for operation status and diagnostic output. */
export interface OperationFeedbackHost {
  /** Shows the most recently started active operation and total active count. */
  showBusy(label: string, activeCount: number): void;
  /** Clears the operation activity status when no operation remains active. */
  clearBusy(): void;
  /** Appends one structured lifecycle entry to the diagnostic output. */
  appendLog(entry: OperationLogEntry): void;
  /** Reveals the diagnostic output after a failure. */
  revealLog(): void;
}

/** Safe structured diagnostic variants accepted by the Output boundary. */
export type OperationDiagnostic = {
  readonly code: "PR_PROGRESS_UNAVAILABLE";
  readonly attempts: readonly PullRequestDiffAcquisitionAttempt[];
} | {
  readonly code: "GITHUB_PR_DETECTION_UNAVAILABLE";
  readonly reason: "rate-limit" | "network" | "api" | "authentication";
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
}

/** Successful value plus the safe retry sequence that preceded it. */
export interface BoundedRetryResult<T> {
  readonly value: T;
  readonly attempts: readonly OperationRetryAttempt[];
}

/** Explicit stale/cancelled terminal state; it is never retried. */
export class OperationCancelledError extends Error {
  public constructor() {
    super("Operation was cancelled or superseded.");
    this.name = "OperationCancelledError";
  }
}

interface ActiveOperation {
  readonly id: number;
  readonly label: string;
  readonly startedAt: number;
  /** A handled child failure makes the enclosing lifecycle terminally failed. */
  boundaryFailure?: unknown;
}

const MAX_OPERATION_LABEL_LENGTH = 96;
const MAX_DIAGNOSTIC_LINE_LENGTH = 512;

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

const SAFE_GITHUB_PR_DETECTION_REASONS = new Set(["rate-limit", "network", "api", "authentication"]);

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
): "rate-limit" | "network" | "api" | "authentication" => {
  if (typeof reason !== "string" || !SAFE_GITHUB_PR_DETECTION_REASONS.has(reason)) {
    throw new TypeError("GitHub PR detection diagnostic reason is not allowlisted");
  }
  return reason as "rate-limit" | "network" | "api" | "authentication";
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
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && SAFE_ERROR_CODES.has(code) ? code : undefined;
};

const errorField = (error: unknown, field: "code" | "status" | "name"): unknown =>
  typeof error === "object" && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;

const isTimedOutGitCommand = (error: unknown): boolean => {
  if (errorField(error, "name") !== "GitCommandFailedError") return false;
  if (typeof error !== "object" || error === null || !("result" in error)) return false;
  const result = (error as { readonly result?: unknown }).result;
  return typeof result === "object" && result !== null &&
    (result as { readonly exitCode?: unknown }).exitCode === -1;
};

/**
 * Classifies dependency failures without copying their text, path, token, or
 * source content. Authentication, validation, stale, and permanent failures
 * deliberately never enter the retry loop.
 */
export const classifyOperationFailure = (error: unknown): OperationFailureClassification => {
  if (
    error instanceof OperationCancelledError ||
    errorField(error, "name") === "AbortError" ||
    errorField(error, "name") === "StaleReviewStateError"
  ) {
    return { kind: "stale" };
  }
  if (error instanceof OperationDiagnosticError) {
    if (error.diagnostic.code === "GITHUB_PR_DETECTION_UNAVAILABLE") {
      switch (error.diagnostic.reason) {
        case "authentication": return { kind: "authentication" };
        case "rate-limit":
        case "network": return { kind: "retryable" };
        case "api": return { kind: "validation" };
      }
    }
    const finalReason = error.diagnostic.attempts.at(-1)?.reason;
    if (finalReason === "authentication") return { kind: "authentication" };
    if (finalReason === "rate-limit" || finalReason === "network" || finalReason === "git-failure") return { kind: "retryable" };
    return { kind: "validation" };
  }
  const status = errorField(error, "status");
  if (status === 401 || status === 403) return { kind: "authentication" };
  if (status === 429) return { kind: "retryable" };
  if (error instanceof TypeError || errorField(error, "name") === "ValidationError") {
    return { kind: "validation" };
  }
  const code = safeErrorCode(error);
  if (isTimedOutGitCommand(error) || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ECONNRESET") {
    return { kind: "retryable", code };
  }
  return code === undefined ? { kind: "permanent" } : { kind: "permanent", code };
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
      attempts.push(Object.freeze({
        category: classification.kind,
        ...(classification.code === undefined ? {} : { code: classification.code })
      }));
      await sleep(25 * (2 ** (attempt - 1)), options.signal);
    }
  }
  throw new Error("unreachable retry state");
};

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

const sanitizedFailureMessage = (error: unknown): string => {
  if (error instanceof OperationDiagnosticError) {
    return formatOperationDiagnostic(error.diagnostic);
  }

  const errorName = error instanceof Error ? safeErrorName(error) : undefined;
  if (errorName === "GitCommandFailedError") return "Git command failed.";
  if (errorName === "GitExecutableNotFoundError") return "Git executable was not found.";

  const code = safeErrorCode(error);
  const base = code === undefined
    ? "Operation failed; details were redacted."
    : `Operation failed (code ${code}); details were redacted.`;
  const attempts = errorIdentity(error) === undefined ? undefined : retryAttemptsByError.get(errorIdentity(error)!);
  if (attempts === undefined || attempts.length === 0) return base;
  const retrySequence = attempts.map((attempt) => attempt.code ?? attempt.category).join(" -> ");
  return `${base} retries=${retrySequence}; final=${classifyOperationFailure(error).kind}.`;
};

/** Projects a failure to a generic UI message without exposing dependency text. */
export const formatOperationFailureForUser = (error: unknown): string => {
  switch (classifyOperationFailure(error).kind) {
    case "authentication": return "認証を確認してから再試行してください。";
    case "stale": return "操作結果が古くなったため、最新状態を再計算してください。";
    case "validation": return "操作を実行できませんでした。入力または現在の状態を確認してください。";
    case "retryable": return "一時的な障害のため操作を完了できませんでした。再試行してください。";
    case "permanent": return "操作を完了できませんでした。詳細は Review Range Output を確認してください。";
  }
};

const failureDetails = (error: unknown): Pick<OperationLogEntry, "errorName" | "message"> =>
  error instanceof Error
    ? { errorName: safeErrorName(error), message: sanitizedFailureMessage(error) }
    : { message: sanitizedFailureMessage(error) };

const errorIdentity = (error: unknown): object | undefined =>
  (typeof error === "object" && error !== null) || typeof error === "function"
    ? error as object
    : undefined;

/**
 * Coordinates operation lifecycle logging with one shared activity status.
 *
 * Labels are deliberately generic. Arbitrary dependency error messages are
 * never copied into Output. Only fixed messages, explicitly allowlisted stable
 * error names/codes, and validated structured diagnostics are projected.
 */
export class OperationFeedback {
  private readonly active: ActiveOperation[] = [];
  private readonly pendingBoundaryDuplicates = new WeakSet<object>();
  private nextId = 0;
  private readonly reportedStorageLockScopes = new Set<string>();

  public constructor(
    private readonly host: OperationFeedbackHost,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Whether a shared outer operation already owns this Output lifecycle. */
  public get hasActiveOperation(): boolean {
    return this.active.length > 0;
  }

  /** Runs one operation while publishing start, success/failure, and busy status. */
  public async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const normalizedLabel = requireLabel(label);
    const active: ActiveOperation = {
      id: ++this.nextId,
      label: normalizedLabel,
      startedAt: this.now()
    };
    this.active.push(active);
    this.host.appendLog({
      timestamp: new Date(active.startedAt).toISOString(),
      label: active.label,
      event: "started"
    });
    this.publishStatus();

    try {
      const result = await operation();
      const finishedAt = this.now();
      if (active.boundaryFailure === undefined) {
        this.host.appendLog({
          timestamp: new Date(finishedAt).toISOString(),
          label: active.label,
          event: "succeeded",
          durationMs: Math.max(0, finishedAt - active.startedAt)
        });
      } else {
        this.recordRunFailure(
          active.label,
          active.boundaryFailure,
          finishedAt,
          Math.max(0, finishedAt - active.startedAt)
        );
      }
      return result;
    } catch (error) {
      const finishedAt = this.now();
      this.recordRunFailure(
        active.label,
        error,
        finishedAt,
        Math.max(0, finishedAt - active.startedAt)
      );
      throw error;
    } finally {
      const index = this.active.findIndex((candidate) => candidate.id === active.id);
      if (index >= 0) this.active.splice(index, 1);
      this.publishStatus();
    }
  }

  /** Records an error intentionally handled by a fail-closed or UI boundary. */
  public reportFailure(label: string, error: unknown): void {
    const identity = errorIdentity(error);
    if (identity !== undefined && this.pendingBoundaryDuplicates.has(identity)) {
      this.pendingBoundaryDuplicates.delete(identity);
      return;
    }
    const active = this.active.at(-1);
    if (active !== undefined) {
      active.boundaryFailure ??= error;
      return;
    }
    const timestamp = this.now();
    const normalizedLabel = requireLabel(label);
    this.host.appendLog({ timestamp: new Date(timestamp).toISOString(), label: normalizedLabel, event: "started" });
    this.appendFailure(normalizedLabel, error, timestamp);
  }

  /** Emits a single source-content-free storage-lock observation to the shared Output lifecycle. */
  public reportStorageLock(kind: "timeout" | "failure" | "stale-recovered", operationId: string): void {
    const scope = `${operationId}\0${kind}`;
    if (this.reportedStorageLockScopes.has(scope)) return;
    this.reportedStorageLockScopes.add(scope);
    const timestamp = new Date(this.now()).toISOString();
    this.host.appendLog({ timestamp, label: "Storage lock", event: "started" });
    this.host.appendLog({
      timestamp,
      label: "Storage lock",
      event: kind === "stale-recovered" ? "succeeded" : "failed",
      message: `Storage lock ${kind}.`
    });
    if (kind !== "stale-recovered") this.host.revealLog();
  }

  private recordRunFailure(
    label: string,
    error: unknown,
    timestamp: number,
    durationMs: number
  ): void {
    const identity = errorIdentity(error);
    if (identity !== undefined) {
      this.pendingBoundaryDuplicates.delete(identity);
    }
    this.appendFailure(label, error, timestamp, durationMs);
    if (identity !== undefined) this.pendingBoundaryDuplicates.add(identity);
  }

  private appendFailure(
    label: string,
    error: unknown,
    timestamp: number,
    durationMs?: number
  ): void {
    this.host.appendLog({
      timestamp: new Date(timestamp).toISOString(),
      label,
      event: "failed",
      ...(durationMs === undefined ? {} : { durationMs }),
      ...failureDetails(error)
    });
    this.host.revealLog();
  }

  private publishStatus(): void {
    const latest = this.active.at(-1);
    if (latest === undefined) {
      this.host.clearBusy();
      return;
    }
    this.host.showBusy(latest.label, this.active.length);
  }
}

/** Formats one compact, source-content-free line for the VS Code Output channel. */
export const formatOperationLogEntry = (entry: OperationLogEntry): string => {
  const stage = entry.event === "started"
    ? "START"
    : entry.event === "succeeded"
      ? "OK"
      : "ERROR";
  const duration = entry.durationMs === undefined ? "" : ` (${entry.durationMs} ms)`;
  const error = entry.event !== "failed" || entry.message === undefined
    ? ""
    : `: ${entry.errorName === undefined ? "" : `${boundedSingleLine(entry.errorName, 80)}: `}${boundedSingleLine(entry.message, 320)}`;
  return boundedSingleLine(`[${entry.timestamp}] ${stage} ${boundedSingleLine(entry.label, MAX_OPERATION_LABEL_LENGTH)}${duration}${error}`);
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
  operation: () => Promise<T>,
  retry?: BoundedRetryOptions
): Promise<T> => {
  const execute = retry === undefined ? operation : () => runWithBoundedRetry(operation, retry).then((result) => result.value);
  const feedback = activeOperationFeedback;
  if (feedback === undefined || feedback.hasActiveOperation) return execute();
  return feedback.run(label, execute);
};

/** Reports a handled failure to active diagnostics when the UI host is installed. */
export const reportActiveOperationFailure = (label: string, error: unknown): void => {
  activeOperationFeedback?.reportFailure(label, error);
};

/** Returns whether activation has already installed the shared Output lifecycle. */
export const hasActiveOperationFeedback = (): boolean => activeOperationFeedback !== undefined;

/** Records a privacy-safe storage-lock lifecycle event when the Output host is active. */
export const reportActiveStorageLockDiagnostic = (
  diagnostic: { readonly kind: "timeout" | "failure" | "stale-recovered"; readonly operationId: string }
): void => {
  if (activeOperationFeedback === undefined) {
    pendingStorageLockDiagnostics.push(diagnostic);
    return;
  }
  activeOperationFeedback.reportStorageLock(diagnostic.kind, diagnostic.operationId);
};

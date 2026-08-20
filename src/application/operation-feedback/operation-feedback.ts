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
  readonly reason: "rate-limit" | "network" | "api";
};

interface ActiveOperation {
  readonly id: number;
  readonly label: string;
  readonly startedAt: number;
}

const requireLabel = (label: string): string => {
  const normalized = label.trim();
  if (normalized.length === 0 || normalized.includes("\0")) {
    throw new TypeError("operation label must be a non-empty string without null characters");
  }
  return normalized;
};

const singleLine = (value: string): string =>
  value.replace(/[\r\n\u2028\u2029]+/gu, " ").trim();

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
  "OperationDiagnosticError"
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
  "missing-file",
  "invalid-encoding",
  "missing-patch",
  "incomplete-patch",
  "identity-mismatch",
  "invalid-data",
  "diff-too-large"
]);

const SAFE_GITHUB_PR_DETECTION_REASONS = new Set(["rate-limit", "network", "api"]);

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
): "rate-limit" | "network" | "api" => {
  if (typeof reason !== "string" || !SAFE_GITHUB_PR_DETECTION_REASONS.has(reason)) {
    throw new TypeError("GitHub PR detection diagnostic reason is not allowlisted");
  }
  return reason as "rate-limit" | "network" | "api";
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

const formatOperationDiagnostic = (diagnostic: OperationDiagnostic): string => {
  if (diagnostic.code === "GITHUB_PR_DETECTION_UNAVAILABLE") {
    return `${diagnostic.code} reason=${diagnostic.reason}`;
  }
  const attempts = diagnostic.attempts
    .map((attempt) => `${attempt.source}:${attempt.reason}`);
  const finalAttempt = attempts.at(-1) ?? "none";
  return `${diagnostic.code} attempts=${attempts.length === 0 ? "none" : attempts.join(" -> ")}; final=${finalAttempt}`;
};

const sanitizedFailureMessage = (error: unknown): string => {
  if (error instanceof OperationDiagnosticError) {
    return formatOperationDiagnostic(error.diagnostic);
  }

  const errorName = error instanceof Error ? safeErrorName(error) : undefined;
  if (errorName === "GitCommandFailedError") return "Git command failed.";
  if (errorName === "GitExecutableNotFoundError") return "Git executable was not found.";

  const code = safeErrorCode(error);
  return code === undefined
    ? "Operation failed; details were redacted."
    : `Operation failed (code ${code}); details were redacted.`;
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
      this.host.appendLog({
        timestamp: new Date(finishedAt).toISOString(),
        label: active.label,
        event: "succeeded",
        durationMs: Math.max(0, finishedAt - active.startedAt)
      });
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
    this.appendFailure(requireLabel(label), error, this.now());
  }

  /** Emits a single source-content-free storage-lock observation to the shared Output lifecycle. */
  public reportStorageLock(kind: "timeout" | "failure" | "stale-recovered", operationId: string): void {
    const scope = `${operationId}\0${kind}`;
    if (this.reportedStorageLockScopes.has(scope)) return;
    this.reportedStorageLockScopes.add(scope);
    this.host.appendLog({
      timestamp: new Date(this.now()).toISOString(),
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
    : `: ${entry.errorName === undefined ? "" : `${singleLine(entry.errorName)}: `}${singleLine(entry.message)}`;
  return `[${entry.timestamp}] ${stage} ${singleLine(entry.label)}${duration}${error}`;
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
  operation: () => Promise<T>
): Promise<T> =>
  activeOperationFeedback === undefined
    ? operation()
    : activeOperationFeedback.run(label, operation);

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

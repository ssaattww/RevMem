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
  /** Failure message without source content or credentials added by this service. */
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

const failureDetails = (error: unknown): Pick<OperationLogEntry, "errorName" | "message"> =>
  error instanceof Error
    ? { errorName: error.name, message: error.message }
    : { message: String(error) };

/**
 * Coordinates operation lifecycle logging with one shared activity status.
 *
 * Labels are deliberately generic. Callers must not include source text,
 * credentials, repository paths, or private PR titles in labels or errors they
 * synthesize for this boundary.
 */
export class OperationFeedback {
  private readonly active: ActiveOperation[] = [];
  private readonly reportedErrors = new WeakSet<object>();
  private nextId = 0;

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
      this.recordFailure(
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

  /** Records an error intentionally handled by a fail-closed fallback. */
  public reportFailure(label: string, error: unknown): void {
    this.recordFailure(requireLabel(label), error, this.now());
  }

  private recordFailure(
    label: string,
    error: unknown,
    timestamp: number,
    durationMs?: number
  ): void {
    const identity = (typeof error === "object" && error !== null) || typeof error === "function"
      ? error as object
      : undefined;
    if (identity !== undefined) {
      if (this.reportedErrors.has(identity)) return;
      this.reportedErrors.add(identity);
    }
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

const singleLine = (value: string): string =>
  value.replace(/[\r\n\u2028\u2029]+/gu, " ").trim();

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

import { AsyncLocalStorage } from "node:async_hooks";

import {
  OperationFeedback as BaseOperationFeedback,
  formatOperationLogEntry as formatBaseOperationLogEntry,
  type OperationFeedbackContext,
  type OperationFeedbackHost,
  type OperationLogEntry as BaseOperationLogEntry,
  type OperationProgress,
} from "./operation-feedback";

export interface OperationDiagnosticDetail {
  readonly reason: string;
  readonly target?: string;
  readonly phase?: string;
}

export interface OperationActivity {
  readonly id: number;
  readonly label: string;
  readonly progress?: OperationProgress;
  readonly detail?: OperationDiagnosticDetail;
}

export type OperationLogEntry = Omit<BaseOperationLogEntry, "event"> & {
  readonly event: BaseOperationLogEntry["event"] | "detail" | "cancelled";
  readonly operationId?: number;
  readonly detail?: OperationDiagnosticDetail;
};

type DetailedOperationFeedbackHost = OperationFeedbackHost & {
  readonly isDetailedDiagnosticsEnabled?: () => boolean;
  readonly showBusy: (label: string, activeCount: number, progress?: OperationProgress, activities?: readonly OperationActivity[]) => void;
  readonly takeOperationStartDetail?: (label: string) => OperationDiagnosticDetail | undefined;
};

interface ActivityState {
  readonly id: number;
  readonly label: string;
  progress?: OperationProgress;
  detail?: OperationDiagnosticDetail;
}

const bounded = (value: string, max: number): string => {
  const normalized = value.replace(/[\r\n\u2028\u2029]+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
};

const PR_PROGRESS_LABEL = "PR進捗を計算";
const SAFE_PR_DETAIL_REASONS = new Set([
  "missing-pr-snapshot", "selected-pull-request", "included", "zero-changed-lines", "zero-denominator", "calculated", "pull-request-file",
]);
const SAFE_PR_DETAIL_PHASES = new Set(["read-content", "progress-input", "progress-summary"]);

const validateDetail = (detail: OperationDiagnosticDetail, pullRequest = false): OperationDiagnosticDetail => {
  const candidateReason = bounded(detail.reason, 120);
  const reason = pullRequest
    ? SAFE_PR_DETAIL_REASONS.has(candidateReason)
      ? candidateReason
      : candidateReason.startsWith("excluded:")
        ? "excluded"
        : "pr-refresh-detail"
    : candidateReason;
  if (reason.length === 0) throw new TypeError("operation diagnostic reason must not be empty");
  // Target values can contain private repository-relative paths. Keep the API
  // field compatible while excluding the value from every diagnostic surface.
  const candidatePhase = detail.phase === undefined ? undefined : bounded(detail.phase, 120);
  const phase = pullRequest && candidatePhase !== undefined
    ? candidatePhase.startsWith("progress-file ")
      ? "progress-file"
      : SAFE_PR_DETAIL_PHASES.has(candidatePhase)
        ? candidatePhase
        : "pr-refresh-detail"
    : candidatePhase;
  return Object.freeze({ reason, ...(phase === undefined ? {} : { phase }) });
};

const detailedEntries = new WeakSet<object>();
const queuedStartDetails = new Map<string, readonly OperationDiagnosticDetail[]>();

/** Queues opt-in details for the next operation with this label. */
export const queueOperationStartDetails = (
  label: string,
  details: readonly OperationDiagnosticDetail[],
): void => {
  queuedStartDetails.set(label, details.map((detail) => validateDetail(detail, label === PR_PROGRESS_LABEL)));
};

/** Adds opt-in operation identities/path details while preserving default Output formatting. */
export class OperationFeedback extends BaseOperationFeedback {
  private readonly activities: ActivityState[];
  private readonly operationScope: AsyncLocalStorage<number>;
  private readonly detailedHost: DetailedOperationFeedbackHost;
  private readonly nowDetailed: () => number;

  public constructor(host: OperationFeedbackHost, now: () => number = () => Date.now()) {
    const detailedHost = host as DetailedOperationFeedbackHost;
    const activities: ActivityState[] = [];
    const operationScope = new AsyncLocalStorage<number>();
    let suppressReveal = false;
    const wrappedHost: OperationFeedbackHost = {
      showBusy: (label, activeCount, progress) => {
        const detailed = detailedHost.isDetailedDiagnosticsEnabled?.() === true;
        const projected = activities.map((activity) => Object.freeze({
          id: activity.id,
          label: activity.label,
          ...(activity.progress === undefined ? {} : { progress: activity.progress }),
          ...(detailed && activity.detail !== undefined ? { detail: activity.detail } : {}),
        }));
        detailedHost.showBusy(label, activeCount, progress, projected);
      },
      clearBusy: () => host.clearBusy(),
      appendLog: (entry) => {
        const detailed = detailedHost.isDetailedDiagnosticsEnabled?.() === true;
        const operationId = entry.operationId ?? (detailed ? operationScope.getStore() : undefined);
        const cancelled = entry.event === "failed" && entry.errorName === "OperationCancelledError";
        const mapped: OperationLogEntry = {
          ...entry,
          ...(cancelled ? { event: "cancelled" as const } : {}),
          ...(operationId === undefined ? {} : { operationId }),
        };
        if (cancelled) suppressReveal = true;
        if (detailed && operationId !== undefined) detailedEntries.add(mapped);
        host.appendLog(mapped as BaseOperationLogEntry);
      },
      revealLog: () => {
        if (suppressReveal) {
          suppressReveal = false;
          return;
        }
        host.revealLog();
      },
    };
    super(wrappedHost, now);
    this.activities = activities;
    this.operationScope = operationScope;
    this.detailedHost = detailedHost;
    latestDetailedFeedback = new WeakRef(this);
    this.nowDetailed = now;
  }

  public override run<T>(
    label: string,
    operation: (context: OperationFeedbackContext) => Promise<T>,
    detail?: OperationDiagnosticDetail,
  ): Promise<T> {
    const detailed = this.detailedHost.isDetailedDiagnosticsEnabled?.() === true;
    const startDetail = detail ?? (detailed ? this.detailedHost.takeOperationStartDetail?.(label) : undefined);
    const queued = detailed ? queuedStartDetails.get(label) ?? [] : [];
    queuedStartDetails.delete(label);
    const id = this.nextId + 1;
    const activity: ActivityState = {
      id,
      label,
      ...(detailed && startDetail !== undefined ? { detail: validateDetail(startDetail, label === PR_PROGRESS_LABEL) } : {}),
    };
    this.activities.push(activity);
    return this.operationScope.run(id, async () => {
      try {
        return await super.run(label, async (context) => {
          if (detailed && startDetail !== undefined) this.reportDetail(startDetail, context);
          for (const queuedDetail of queued) this.reportDetail(queuedDetail, context);
          return operation(context);
        });
      } finally {
        const index = this.activities.indexOf(activity);
        if (index >= 0) this.activities.splice(index, 1);
      }
    });
  }

  public override reportProgress(progress: OperationProgress, context?: OperationFeedbackContext): void {
    const activity = context === undefined
      ? this.activities.at(-1)
      : this.activities.find((candidate) => candidate.id === context.id);
    if (activity !== undefined) activity.progress = progress;
    const id = this.detailedHost.isDetailedDiagnosticsEnabled?.() === true ? activity?.id : undefined;
    if (id === undefined) super.reportProgress(progress, context);
    else this.operationScope.run(id, () => super.reportProgress(progress, context));
  }

  public reportDetail(detail: OperationDiagnosticDetail, context?: OperationFeedbackContext): void {
    if (this.detailedHost.isDetailedDiagnosticsEnabled?.() !== true) return;
    const activity = context === undefined
      ? this.activities.at(-1)
      : this.activities.find((candidate) => candidate.id === context.id);
    if (activity === undefined) return;
    const validated = validateDetail(detail, activity.label === PR_PROGRESS_LABEL);
    activity.detail = validated;
    const entry: OperationLogEntry = {
      timestamp: new Date(this.nowDetailed()).toISOString(),
      label: activity.label,
      event: "detail",
      operationId: activity.id,
      detail: validated,
    };
    detailedEntries.add(entry);
    this.detailedHost.appendLog(entry as BaseOperationLogEntry);
    const latest = this.activities.at(-1);
    if (latest !== undefined) {
      this.detailedHost.showBusy(
        latest.label,
        this.activities.length,
        latest.progress,
        this.activities.map((candidate) => Object.freeze({
          id: candidate.id,
          label: candidate.label,
          ...(candidate.progress === undefined ? {} : { progress: candidate.progress }),
          ...(candidate.detail === undefined ? {} : { detail: candidate.detail }),
        })),
      );
    }
  }
}

let latestDetailedFeedback: WeakRef<OperationFeedback> | undefined;

export const reportActiveOperationDetail = (
  detail: OperationDiagnosticDetail,
  context?: OperationFeedbackContext,
): void => {
  const owner = context?.owner;
  if (owner instanceof OperationFeedback) owner.reportDetail(detail, context);
  else latestDetailedFeedback?.deref()?.reportDetail(detail, context);
};

export const formatOperationLogEntry = (entry: OperationLogEntry): string => {
  if (entry.event === "refresh") return formatBaseOperationLogEntry(entry as BaseOperationLogEntry);
  if (entry.event !== "detail" && entry.event !== "cancelled" && !detailedEntries.has(entry)) {
    return formatBaseOperationLogEntry(entry as BaseOperationLogEntry);
  }
  const stage = entry.event === "started" ? "START"
    : entry.event === "progress" ? "PROGRESS"
      : entry.event === "detail" ? "DETAIL"
        : entry.event === "succeeded" ? "OK"
          : entry.event === "cancelled" ? "CANCEL" : "ERROR";
  const op = entry.operationId === undefined ? "" : ` op=${entry.operationId}`;
  const progress = entry.event === "progress" && entry.progress !== undefined
    ? ` stage=${entry.progress.stage} progress=${entry.progress.completed}${entry.progress.total === undefined ? "" : `/${entry.progress.total}`}`
    : "";
  const detail = entry.detail === undefined ? ""
    : ` reason=${entry.detail.reason}${entry.detail.phase === undefined ? "" : ` phase=${entry.detail.phase}`}${entry.detail.target === undefined ? "" : ` target=${entry.detail.target}`}`;
  const duration = entry.durationMs === undefined ? "" : ` (${entry.durationMs} ms)`;
  return bounded(`[${entry.timestamp}] ${stage}${op} ${entry.label}${progress}${detail}${duration}`, 512);
};

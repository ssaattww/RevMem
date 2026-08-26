import type { OperationDiagnosticDetail } from "../../application/operation-feedback/index";

export interface GlobalUnderstandingRefreshCoalescerHost {
  invalidate(): void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  run(request?: OperationDiagnosticDetail): void | Promise<void>;
}

const pending = new Set<GlobalUnderstandingRefreshCoalescer>();
let latestDetail: OperationDiagnosticDetail | undefined;

/** Coalesces refresh requests and cancels a stale scheduled generation before an immediate refresh. */
export class GlobalUnderstandingRefreshCoalescer {
  private scheduled: unknown | undefined;
  private disposed = false;
  public constructor(private readonly host: GlobalUnderstandingRefreshCoalescerHost, private readonly delayMs = 150) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new RangeError("delayMs must be a non-negative safe integer.");
    pending.add(this);
  }
  public request(request?: OperationDiagnosticDetail): void {
    if (this.disposed) return;
    this.host.invalidate();
    if (request !== undefined) latestDetail = request;
    this.cancel();
    const handle = this.host.schedule(() => {
      if (this.disposed || this.scheduled !== handle) return;
      this.scheduled = undefined;
      void this.host.run(request);
    }, this.delayMs);
    this.scheduled = handle;
  }
  public async flush(request?: OperationDiagnosticDetail): Promise<void> {
    if (this.disposed) return;
    this.cancel();
    await this.host.run(request);
  }
  public cancel(): void {
    if (this.scheduled === undefined) return;
    this.host.cancel(this.scheduled);
    this.scheduled = undefined;
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    pending.delete(this);
  }
}

export const takeLatestPendingGlobalUnderstandingDetail = (): OperationDiagnosticDetail | undefined => {
  const detail = latestDetail;
  latestDetail = undefined;
  return detail;
};

export const cancelPendingGlobalUnderstandingRefreshes = (): void => {
  for (const coalescer of pending) coalescer.cancel();
};

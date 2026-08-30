import type { OperationDiagnosticDetail } from "../../application/operation-feedback/index";

export interface GlobalUnderstandingRefreshCoalescerHost {
  invalidate(): void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  run(request?: OperationDiagnosticDetail): void | Promise<void>;
}

const pending = new Set<GlobalUnderstandingRefreshCoalescer>();
let latestDetail: OperationDiagnosticDetail | undefined;
const identityFor = (
  detail: OperationDiagnosticDetail | undefined,
  effectiveInputIdentity: string | undefined,
): string => effectiveInputIdentity ?? JSON.stringify(detail ?? {});

/** Coalesces refresh requests and cancels a stale scheduled generation before an immediate refresh. */
export class GlobalUnderstandingRefreshCoalescer {
  private scheduled: unknown | undefined;
  private running: { readonly identity: string; readonly promise: Promise<void> } | undefined;
  private disposed = false;
  public constructor(private readonly host: GlobalUnderstandingRefreshCoalescerHost, private readonly delayMs = 150) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new RangeError("delayMs must be a non-negative safe integer.");
    pending.add(this);
  }
  /** Queues a refresh; a supplied effective identity, not diagnostic detail, controls running-work sharing. */
  public request(request?: OperationDiagnosticDetail, effectiveInputIdentity?: string): void {
    if (this.disposed) return;
    if (this.running?.identity === identityFor(request, effectiveInputIdentity)) return;
    this.running = undefined;
    this.host.invalidate();
    if (request !== undefined) latestDetail = request;
    this.cancel();
    const handle = this.host.schedule(() => {
      if (this.disposed || this.scheduled !== handle) return;
      this.scheduled = undefined;
      void this.run(request, effectiveInputIdentity);
    }, this.delayMs);
    this.scheduled = handle;
  }
  /** Immediately runs a refresh and shares only an equal effective immutable input. */
  public async flush(request?: OperationDiagnosticDetail, effectiveInputIdentity?: string): Promise<void> {
    if (this.disposed) return;
    this.cancel();
    await this.run(request, effectiveInputIdentity);
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

  private run(request: OperationDiagnosticDetail | undefined, effectiveInputIdentity?: string): Promise<void> {
    const identity = identityFor(request, effectiveInputIdentity);
    if (this.running?.identity === identity) return this.running.promise;
    const promise = Promise.resolve(this.host.run(request));
    const running = { identity, promise };
    this.running = running;
    void promise.then(
      () => { if (this.running === running) this.running = undefined; },
      () => { if (this.running === running) this.running = undefined; },
    );
    return promise;
  }
}

/** Returns and clears the most recent pending Global refresh diagnostic detail. */
export const takeLatestPendingGlobalUnderstandingDetail = (): OperationDiagnosticDetail | undefined => {
  const detail = latestDetail;
  latestDetail = undefined;
  return detail;
};

export const cancelPendingGlobalUnderstandingRefreshes = (): void => {
  for (const coalescer of pending) coalescer.cancel();
};

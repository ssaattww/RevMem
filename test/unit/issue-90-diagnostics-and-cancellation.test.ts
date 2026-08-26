import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OperationCancelledError,
  OperationFeedback,
  formatOperationLogEntry,
  type OperationActivity,
  type OperationDiagnosticDetail,
  type OperationFeedbackContext,
  type OperationFeedbackHost,
  type OperationLogEntry,
  type OperationProgress,
} from "../../src/application/operation-feedback/index.js";
import {
  GlobalUnderstandingRefreshCoalescer,
} from "../../src/ui/global-understanding/issue-90-global-refresh.js";

class DiagnosticHost implements OperationFeedbackHost {
  public readonly logs: OperationLogEntry[] = [];
  public readonly statuses: Array<{
    readonly label: string;
    readonly activeCount: number;
    readonly progress?: OperationProgress;
    readonly activities?: readonly OperationActivity[];
  } | undefined> = [];
  public reveals = 0;

  public constructor(public detailed = true) {}

  public isDetailedDiagnosticsEnabled(): boolean {
    return this.detailed;
  }

  public showBusy(
    label: string,
    activeCount: number,
    progress?: OperationProgress,
    activities?: readonly OperationActivity[],
  ): void {
    this.statuses.push({
      label,
      activeCount,
      ...(progress === undefined ? {} : { progress }),
      ...(activities === undefined ? {} : { activities }),
    });
  }

  public clearBusy(): void {
    this.statuses.push(undefined);
  }

  public appendLog(entry: OperationLogEntry): void {
    this.logs.push(entry);
  }

  public revealLog(): void {
    this.reveals += 1;
  }
}

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

const detail = (
  reason: string,
  target?: string,
  phase?: string,
): OperationDiagnosticDetail => ({
  reason,
  ...(target === undefined ? {} : { target }),
  ...(phase === undefined ? {} : { phase }),
});

test("Issue #90 manifest exposes opt-in detailed diagnostics with a privacy-safe default", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes: {
      configuration: {
        properties: Record<string, { readonly type?: unknown; readonly default?: unknown; readonly description?: unknown }>;
      };
    };
    scripts: Record<string, string>;
  };
  const setting = manifest.contributes.configuration.properties["reviewRange.diagnostics.detailed"];
  assert.deepEqual(
    { type: setting?.type, default: setting?.default },
    { type: "boolean", default: false },
  );
  assert.match(String(setting?.description), /ファイル名|path|機密/u);
  assert.match(manifest.scripts["test:unit"] ?? "", /issue-90-diagnostics-and-cancellation\.test\.js/u);
});

test("Issue #90 active status enumerates every operation and detailed mode correlates reason, target, and operation id", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 1_000);
  const globalGate = deferred<void>();
  const progressGate = deferred<void>();
  let progressContext: OperationFeedbackContext | undefined;

  const global = feedback.run(
    "Global理解率を再計算",
    async () => globalGate.promise,
    detail("document-changed", "src/global.ts"),
  );
  const progress = feedback.run(
    "PR進捗を計算",
    async (context) => {
      progressContext = context;
      await progressGate.promise;
    },
    detail("selected-pull-request", "github-pr:repo#90"),
  );

  const current = host.statuses.at(-1);
  assert.ok(current);
  assert.equal(current.activeCount, 2);
  assert.deepEqual(
    current.activities?.map((activity) => ({ id: activity.id, label: activity.label, detail: activity.detail })),
    [
      { id: 1, label: "Global理解率を再計算", detail: detail("document-changed", "src/global.ts") },
      { id: 2, label: "PR進捗を計算", detail: detail("selected-pull-request", "github-pr:repo#90") },
    ],
  );

  feedback.reportDetail(
    detail("pull-request-file", "src/progress.ts", "read-content"),
    progressContext,
  );
  const detailEntry = host.logs.at(-1);
  assert.equal(detailEntry?.event, "detail");
  assert.equal(detailEntry?.operationId, 2);
  assert.equal(
    formatOperationLogEntry(detailEntry!),
    "[1970-01-01T00:00:01.000Z] DETAIL op=2 PR進捗を計算 reason=pull-request-file phase=read-content target=src/progress.ts",
  );

  globalGate.resolve();
  progressGate.resolve();
  await Promise.all([global, progress]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "started").map((entry) => entry.operationId), [1, 2]);
  assert.deepEqual(host.logs.filter((entry) => entry.event === "succeeded").map((entry) => entry.operationId).sort(), [1, 2]);
});

test("Issue #90 default diagnostics never emit a supplied file target", async () => {
  const host = new DiagnosticHost(false);
  const feedback = new OperationFeedback(host, () => 2_000);

  await feedback.run(
    "Global理解率を再計算",
    async () => undefined,
    detail("document-changed", "src/private-owner-file.ts"),
  );

  const output = host.logs.map(formatOperationLogEntry).join("\n");
  assert.doesNotMatch(output, /private-owner-file|document-changed/u);
  assert.equal(host.statuses[0]?.activities?.[0]?.detail, undefined);
});

test("Issue #90 superseded work has a cancellation terminal and does not reveal Output as an error", async () => {
  const host = new DiagnosticHost(true);
  const feedback = new OperationFeedback(host, () => 3_000);
  const cancellation = new OperationCancelledError();

  await assert.rejects(
    feedback.run(
      "Global理解率を再計算",
      async () => { throw cancellation; },
      detail("review-state-changed"),
    ),
    cancellation,
  );

  assert.deepEqual(host.logs.map((entry) => entry.event), ["started", "cancelled"]);
  assert.equal(host.logs[1]?.operationId, 1);
  assert.equal(host.reveals, 0);
  assert.match(formatOperationLogEntry(host.logs[1]!), /CANCEL op=1 Global理解率を再計算/u);
});

test("Issue #90 coalescer cancels the pending stale refresh and flushes exactly one latest reason and file", async () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const invalidations: string[] = [];
  const runs: OperationDiagnosticDetail[] = [];
  let nextHandle = 0;
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => { invalidations.push("invalidate"); },
    schedule: (callback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      const numeric = handle as number;
      cancelled.push(numeric);
      callbacks.delete(numeric);
    },
    run: async (request) => {
      assert.ok(request);
      runs.push(request);
    },
  });

  coalescer.request(detail("document-changed", "src/first.ts"));
  coalescer.request(detail("review-state-changed", "src/first.ts"));
  await coalescer.flush(detail("document-review-state-applied", "src/first.ts"));

  assert.deepEqual(invalidations, ["invalidate", "invalidate"]);
  assert.deepEqual(cancelled, [1, 2]);
  assert.deepEqual(runs, [detail("document-review-state-applied", "src/first.ts")]);
  assert.equal(callbacks.size, 0);
  coalescer.dispose();
});

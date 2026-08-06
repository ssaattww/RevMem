import assert from "node:assert/strict";
import test from "node:test";

import {
  GlobalUnderstandingRefreshCoalescer,
  GlobalUnderstandingRefreshController,
  type GlobalUnderstandingTreeSnapshot
} from "../../src/ui/global-understanding/global-understanding-ui-model";

const snapshot: GlobalUnderstandingTreeSnapshot = {
  progress: {
    reviewedNonEmptyLineCount: 0,
    totalNonEmptyLineCount: 0,
    progress: 1,
    files: []
  },
  excludedFileCount: 0,
  prunedExcludedDirectoryCount: 0
};

test("T505-R005 requesting a debounced refresh immediately invalidates the in-flight generation", async () => {
  let rejectInFlight: ((reason: Error) => void) | undefined;
  const events: string[] = [];
  const controller = new GlobalUnderstandingRefreshController(
    {
      recalculate: () => new Promise((_, reject) => {
        rejectInFlight = reject;
      })
    },
    {
      show: () => events.push("show"),
      clear: () => events.push("clear")
    }
  );
  const inFlight = controller.refresh();
  const coalescer = new GlobalUnderstandingRefreshCoalescer({
    invalidate: () => controller.invalidate(),
    schedule: () => 1,
    cancel: () => undefined,
    run: () => undefined
  });

  coalescer.request();
  rejectInFlight?.(new Error("stale after edit"));

  assert.equal(await inFlight, undefined);
  assert.deepEqual(events, []);
  coalescer.dispose();
  void snapshot;
});

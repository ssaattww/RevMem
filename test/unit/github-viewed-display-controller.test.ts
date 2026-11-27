import assert from "node:assert/strict";
import test from "node:test";

import { createRefreshingNormalEditorReviewCommandHandlers } from "../../src/ui/normal-editor/review-command-registration";
import { GitHubViewedDisplayController } from "../../src/composition/pull-request/github-viewed-display-controller";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

test("disabled or stale selection never starts the Viewed reader", async () => {
  let calls = 0;
  const controller = new GitHubViewedDisplayController(() => {});
  const epoch = controller.invalidate();
  const run = async () => { calls++; return "viewed"; };
  const publish = () => assert.fail("Out-of-scope result must not be published");
  await controller.read({ epoch, enabled: false, isSourceCurrent: () => true, run, publish });
  await controller.read({ epoch, enabled: true, isSourceCurrent: () => false, run, publish });
  assert.equal(calls, 0);
});

for (const change of ["setting", "authentication", "selection", "local-confirmation-removed", "local-save-failed"]) {
  test(`does not restore old Viewed labels after ${change}`, async () => {
    let label: string | undefined = "viewed";
    let signal: AbortSignal | undefined;
    let sourceCurrent = true;
    const pending = deferred<string>();
    const controller = new GitHubViewedDisplayController(() => { label = undefined; });
    const epoch = controller.invalidate();
    const read = controller.read({
      epoch, enabled: true, isSourceCurrent: () => sourceCurrent,
      run: (context) => { signal = context.signal; return pending.promise; },
      publish: (value) => { label = value; },
    });
    assert.ok(signal);
    const end = change.startsWith("local-") ? controller.beginLocalChange() : undefined;
    if (end === undefined) {
      sourceCurrent = false;
      controller.invalidate();
    } else {
      await controller.read({
        epoch: controller.invalidate(), enabled: true, isSourceCurrent: () => true,
        run: async () => assert.fail("Do not read during a local save"),
        publish: () => assert.fail("Do not publish during a local save"),
      });
      end();
    }
    assert.equal(label, undefined);
    assert.equal(signal.aborted, true);
    pending.resolve("late");
    await read;
    assert.equal(label, undefined);
  });
}

test("a current unavailable result can publish, but invalidation removes it", async () => {
  let label: string | undefined;
  let current: (() => boolean) | undefined;
  const controller = new GitHubViewedDisplayController(() => { label = undefined; });
  await controller.read({
    epoch: controller.invalidate(), enabled: true, isSourceCurrent: () => true,
    run: async () => "unavailable",
    publish: (value, isCurrent) => { label = value; current = isCurrent; },
  });
  assert.equal(label, "unavailable");
  assert.equal(current?.(), true);
  controller.invalidate();
  assert.equal(label, undefined);
  assert.equal(current?.(), false);
});

for (const failed of [false, true]) {
  test(`normal-editor confirmation removal blocks an old read before saving (fail=${failed})`, async () => {
    let displayed: string | undefined;
    let signal: AbortSignal | undefined;
    let appliedEvents = 0;
    const pending = deferred<string>();
    const controller = new GitHubViewedDisplayController(() => { displayed = undefined; });
    const request = controller.read({
      epoch: controller.invalidate(), enabled: true, isSourceCurrent: () => true,
      run: (context) => { signal = context.signal; return pending.promise; },
      publish: (value) => { displayed = value; },
    });
    displayed = "old-viewed";
    const noOp = () => undefined;
    const handler = createRefreshingNormalEditorReviewCommandHandlers({
      markSelectionReviewed: noOp,
      unmarkSelectionReviewed: async () => {
        assert.equal(displayed, undefined);
        assert.equal(signal?.aborted, true);
        pending.resolve("late-viewed");
        if (failed) throw new Error("mock normal editor save failure");
        return "applied";
      },
      markFileReviewed: noOp,
      unmarkFileReviewed: noOp,
    }, { refreshVisibleEditors: noOp }, {
      beginReviewMutation: () => controller.beginLocalChange(),
      onReviewMutationApplied: () => { appliedEvents++; },
    });
    const operation = Promise.resolve(handler.unmarkSelectionReviewed("normal file"));
    if (failed) await assert.rejects(operation, /mock normal editor save failure/u);
    else assert.equal(await operation, "applied");
    await request;
    assert.equal(displayed, undefined);
    assert.equal(appliedEvents, failed ? 0 : 1);
  });
}

test("normal-editor command guards an async owner change from workspace to PR", async () => {
  let selected: "workspace" | "pull-request" = "workspace";
  let published: string | undefined;
  const ownerLookup = deferred<void>();
  const controller = new GitHubViewedDisplayController(() => { published = undefined; });
  const noOp = () => undefined;
  const handlers = createRefreshingNormalEditorReviewCommandHandlers({
    markSelectionReviewed: noOp,
    unmarkSelectionReviewed: async () => {
      await ownerLookup.promise;
      assert.equal(selected, "pull-request");
      assert.equal(published, undefined);
      return "applied";
    },
    markFileReviewed: noOp,
    unmarkFileReviewed: noOp,
  }, { refreshVisibleEditors: noOp }, {
    beginReviewMutation: () => controller.beginLocalChange(),
  });

  const change = Promise.resolve(handlers.unmarkSelectionReviewed("normal file"));
  selected = "pull-request";
  const epoch = controller.invalidate();
  const read = (generation: number) => controller.read({
    epoch: generation, enabled: true, isSourceCurrent: () => selected === "pull-request",
    run: async () => "fresh-viewed",
    publish: (state) => { published = state; },
  });
  await read(epoch);
  assert.equal(published, undefined);
  ownerLookup.resolve();
  assert.equal(await change, "applied");
  await read(epoch);
  assert.equal(published, undefined);
  await read(controller.invalidate());
  assert.equal(published, "fresh-viewed");
});

for (const outcome of ["cancelled", "no-op"] as const) {
  test(`normal editor ${outcome} refreshes Viewed without normal review changes`, async () => {
    let shown: string | undefined = "old";
    let changes = 0;
    let fresh: Promise<void> | undefined;
    const controller = new GitHubViewedDisplayController(() => { shown = undefined; });
    const noop = () => undefined;
    const options = {
      beginReviewMutation: () => controller.beginLocalChange(),
      onReviewMutationApplied: () => { changes++; },
      onReviewMutationUnchanged: () => {
        fresh = controller.read({
          epoch: controller.invalidate(), enabled: true, isSourceCurrent: () => true,
          run: async () => "fresh", publish: (value) => { shown = value; }
        });
      }
    };
    const handler = createRefreshingNormalEditorReviewCommandHandlers({
      markSelectionReviewed: noop, unmarkSelectionReviewed: noop, markFileReviewed: noop,
      unmarkFileReviewed: async () => { assert.equal(shown, undefined); return outcome; }
    }, { refreshVisibleEditors: () => { changes++; } }, options);
    assert.equal(await handler.unmarkFileReviewed("file"), outcome);
    await fresh;
    assert.equal(shown, "fresh");
    assert.equal(changes, 0);
  });
}

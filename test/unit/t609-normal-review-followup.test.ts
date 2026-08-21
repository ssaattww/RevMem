import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrentContextCandidateSelection,
  CurrentContextRuntimeComposition,
  type CurrentContextUiSnapshot
} from "../../src/ui/current-context/index";

const candidate = (label: string): CurrentContextUiSnapshot => ({
  context: { kind: "branch", label, detail: `/workspace/${label}` },
  progress: undefined
});

test("T609-NR-004 never selects the first repository when no-active-editor has multiple candidates", async () => {
  const first = candidate("one");
  const second = candidate("two");
  let requests = 0;
  const composition = new CurrentContextRuntimeComposition(
    new CurrentContextCandidateSelection(),
    {
      enumerateCandidates: async () => [first, second],
      resolveFallback: async () => undefined,
      requestSelection: async () => {
        requests += 1;
        return second;
      }
    }
  );

  assert.equal(await composition.recompute(), second);
  assert.equal(requests, 1);
});

test("T609-NR-004 keeps the accepted Current Context when the ambiguous-root Quick Pick is cancelled", async () => {
  const first = candidate("one");
  const second = candidate("two");
  const selection = new CurrentContextCandidateSelection();
  selection.acceptExplicit(first);
  const composition = new CurrentContextRuntimeComposition(selection, {
    enumerateCandidates: async () => [first, second],
    resolveFallback: async () => undefined,
    requestSelection: async () => undefined
  });

  const cancelled = await composition.recompute();
  assert.equal(cancelled, undefined);
  composition.acceptRecomputed(cancelled);
  assert.equal(
    await composition.recompute(),
    undefined,
    "a cancellation does not substitute the first candidate or mutate the committed selection"
  );
});

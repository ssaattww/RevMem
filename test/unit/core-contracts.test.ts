import assert from "node:assert/strict";
import test from "node:test";

import { toDefaultVisualState } from "../../src/core/contracts/index";
import "./github-pr-context-layer-store.test";
import "./issue-66-global-pr-progress.test";
import "./issue-66-pr68-review-findings.test";
import "./issue-84-review-context-progress.test";
import "./issue-84-pr85-review-followup.test";
import "./issue-92-pr-progress-context-menu.test";
import "./issue-112-pr-progress-working-tree.test";
import "./issue-112-pr-progress-runtime.test";
import "./issue-112-pr-review-projection-sync.test";
import "./issue-112-working-tree-path.test";
import "./repository-global-state-repository.test";
import "./state-repository-memory.test";
import "./state-repository.test";
import "./t305-projection-refresh.test";

test("toDefaultVisualState only renders certain reviews as reviewed", () => {
  assert.equal(toDefaultVisualState("reviewed"), "reviewed");
  assert.equal(toDefaultVisualState("changed"), "normal");
});

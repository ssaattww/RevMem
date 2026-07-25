import assert from "node:assert/strict";
import test from "node:test";

import { toDefaultVisualState } from "../../src/core/contracts/index";
import "./document-review-state-regressions.test";
import "./document-review-state-session-provider.test";
import "./external-file-state-repository.test";
import "./issue-13-baseline-metadata-review.test";
import "./issue-13-owner-reconciliation-review.test";
import "./local-git-head-classification-review.test";
import "./local-git-ownership-classification.test";
import "./state-repository-memory.test";
import "./state-repository.test";

test("toDefaultVisualState only renders certain reviews as reviewed", () => {
  assert.equal(toDefaultVisualState("reviewed"), "reviewed");
  assert.equal(toDefaultVisualState("changed"), "normal");
});

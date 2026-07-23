import assert from "node:assert/strict";
import test from "node:test";

import { toDefaultVisualState } from "../../src/core/contracts/index";

test("toDefaultVisualState only renders certain reviews as reviewed", () => {
  assert.equal(toDefaultVisualState("reviewed"), "reviewed");
  assert.equal(toDefaultVisualState("changed"), "normal");
});

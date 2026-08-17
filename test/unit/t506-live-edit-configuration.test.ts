import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewRangeMappingOptions } from "../../src/application/configuration/review-range-mapping-options";

test("T506 production mapping settings default invalidation and only accept boolean true", () => {
  assert.deepEqual(
    resolveReviewRangeMappingOptions({ ignoreWhitespaceChanges: undefined, ignoreEolChanges: undefined }),
    { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  );
  assert.deepEqual(
    resolveReviewRangeMappingOptions({ ignoreWhitespaceChanges: true, ignoreEolChanges: false }),
    { ignoreWhitespaceChanges: true, ignoreEolChanges: false }
  );
  assert.deepEqual(
    resolveReviewRangeMappingOptions({ ignoreWhitespaceChanges: false, ignoreEolChanges: true }),
    { ignoreWhitespaceChanges: false, ignoreEolChanges: true }
  );
  assert.deepEqual(
    resolveReviewRangeMappingOptions({ ignoreWhitespaceChanges: "true", ignoreEolChanges: 1 }),
    { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  );
});

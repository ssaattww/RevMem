import assert from "node:assert/strict";
import test from "node:test";

import {
  mapReviewedRangesThroughDocumentChanges,
  type DocumentContentChange
} from "../../src/core/range-mapping/index";

const IGNORE_EOL = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: true
} as const;

test("ignoreEolChanges does not treat an extra final blank line as a final-newline-only change", () => {
  const change: DocumentContentChange = {
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 }
    },
    rangeOffset: 2,
    rangeLength: 0,
    text: "\n"
  };

  assert.deepEqual(
    mapReviewedRangesThroughDocumentChanges({
      beforeText: "a\n",
      reviewed: [{ startLine: 1, endLineExclusive: 2 }],
      changes: [change],
      options: IGNORE_EOL
    }),
    {
      reviewed: [{ startLine: 2, endLineExclusive: 3 }],
      lineCount: 3
    }
  );
});

test("ignoreEolChanges does not preserve a reviewed blank line deleted from multiple terminal newlines", () => {
  const change: DocumentContentChange = {
    range: {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 }
    },
    rangeOffset: 2,
    rangeLength: 1,
    text: ""
  };

  assert.deepEqual(
    mapReviewedRangesThroughDocumentChanges({
      beforeText: "a\n\n",
      reviewed: [{ startLine: 1, endLineExclusive: 2 }],
      changes: [change],
      options: IGNORE_EOL
    }),
    {
      reviewed: [],
      lineCount: 2
    }
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import type { LineInterval } from "../../src/core/contracts/index";
import {
  mapReviewedRangesThroughDocumentChanges,
  type DocumentContentChange,
  type RangeMappingOptions,
  type TextPosition
} from "../../src/core/range-mapping/index";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const DEFAULT_OPTIONS: Readonly<RangeMappingOptions> = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false
};

function lineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\r" && text[index + 1] === "\n") {
      starts.push(index + 2);
      index += 1;
    } else if (character === "\r" || character === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function offsetAt(text: string, position: TextPosition): number {
  const starts = lineStarts(text);
  const start = starts[position.line];
  if (start === undefined) {
    throw new RangeError("Test position line is outside the document.");
  }

  let lineEnd = start;
  while (lineEnd < text.length && text[lineEnd] !== "\r" && text[lineEnd] !== "\n") {
    lineEnd += 1;
  }

  if (position.character < 0 || start + position.character > lineEnd) {
    throw new RangeError("Test position character is outside the line.");
  }

  return start + position.character;
}

function change(
  beforeText: string,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  text: string
): DocumentContentChange {
  const start = { line: startLine, character: startCharacter };
  const end = { line: endLine, character: endCharacter };
  const rangeOffset = offsetAt(beforeText, start);
  const endOffset = offsetAt(beforeText, end);

  return {
    range: { start, end },
    rangeOffset,
    rangeLength: endOffset - rangeOffset,
    text
  };
}

function map(
  beforeText: string,
  reviewed: readonly LineInterval[],
  changes: readonly DocumentContentChange[],
  options: Readonly<RangeMappingOptions> = DEFAULT_OPTIONS
) {
  return mapReviewedRangesThroughDocumentChanges({
    beforeText,
    reviewed,
    changes,
    options
  });
}

test("whole-line insertion leaves inserted lines unreviewed and shifts following ranges", () => {
  const beforeText = "a\nb\nc\nd";

  const result = map(
    beforeText,
    [interval(0, 4)],
    [change(beforeText, 2, 0, 2, 0, "inserted\n")]
  );

  assert.deepEqual(result, {
    reviewed: [interval(0, 2), interval(3, 5)],
    lineCount: 5
  });
});

test("whole-line deletion removes deleted review state and shifts following ranges backward", () => {
  const beforeText = "a\nb\nc\nd";

  const result = map(
    beforeText,
    [interval(1, 3)],
    [change(beforeText, 1, 0, 2, 0, "")]
  );

  assert.deepEqual(result, {
    reviewed: [interval(1, 2)],
    lineCount: 3
  });
});

test("same-line replacement invalidates only the overlapping line", () => {
  const beforeText = "alpha\nbeta\ngamma";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 1, 1, 1, 3, "XX")]
  );

  assert.deepEqual(result, {
    reviewed: [interval(0, 1), interval(2, 3)],
    lineCount: 3
  });
});

test("whole-line replacement invalidates replacement lines and shifts the unchanged suffix", () => {
  const beforeText = "a\nb\nc\nd\ne";

  const result = map(
    beforeText,
    [interval(0, 5)],
    [change(beforeText, 1, 0, 3, 0, "x\ny\nz\n")]
  );

  assert.deepEqual(result, {
    reviewed: [interval(0, 1), interval(4, 6)],
    lineCount: 6
  });
});

test("inserting a line break inside a reviewed line invalidates every line derived from it", () => {
  const beforeText = "a\nb\nc\nd";

  const result = map(
    beforeText,
    [interval(0, 4)],
    [change(beforeText, 1, 1, 1, 1, "\nnew")]
  );

  assert.deepEqual(result, {
    reviewed: [interval(0, 1), interval(3, 5)],
    lineCount: 5
  });
});

test("multiple changes use original coordinates and are mapped from the highest offset", () => {
  const beforeText = "a\nb\nc\nd\ne";
  const changes = [
    change(beforeText, 1, 0, 1, 1, "B"),
    change(beforeText, 3, 0, 3, 0, "inserted\n")
  ];

  const result = map(beforeText, [interval(0, 5)], changes);

  assert.deepEqual(result, {
    reviewed: [interval(0, 1), interval(2, 3), interval(4, 6)],
    lineCount: 6
  });
});

test("whitespace-only replacement invalidates by default", () => {
  const beforeText = "a\n  beta\nc";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 1, 0, 1, 2, "\t")]
  );

  assert.deepEqual(result.reviewed, [interval(0, 1), interval(2, 3)]);
});

test("ignoreWhitespaceChanges preserves whitespace-only replacement", () => {
  const beforeText = "a\n  beta\nc";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 1, 0, 1, 2, "\t")],
    { ignoreWhitespaceChanges: true, ignoreEolChanges: false }
  );

  assert.deepEqual(result.reviewed, [interval(0, 3)]);
});

test("CRLF to LF replacement invalidates by default", () => {
  const beforeText = "a\r\nb\r\nc";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 0, 0, 2, 1, "a\nb\nc")]
  );

  assert.deepEqual(result, { reviewed: [], lineCount: 3 });
});

test("ignoreEolChanges preserves CRLF to LF replacement", () => {
  const beforeText = "a\r\nb\r\nc";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 0, 0, 2, 1, "a\nb\nc")],
    { ignoreWhitespaceChanges: false, ignoreEolChanges: true }
  );

  assert.deepEqual(result, { reviewed: [interval(0, 3)], lineCount: 3 });
});

test("whitespace-ignore does not ignore EOL-only replacement", () => {
  const beforeText = "a\r\nb";

  const result = map(
    beforeText,
    [interval(0, 2)],
    [change(beforeText, 0, 0, 1, 1, "a\nb")],
    { ignoreWhitespaceChanges: true, ignoreEolChanges: false }
  );

  assert.deepEqual(result.reviewed, []);
});

test("EOL-ignore does not ignore horizontal whitespace replacement", () => {
  const beforeText = "a\n  beta\nc";

  const result = map(
    beforeText,
    [interval(0, 3)],
    [change(beforeText, 1, 0, 1, 2, "\t")],
    { ignoreWhitespaceChanges: false, ignoreEolChanges: true }
  );

  assert.deepEqual(result.reviewed, [interval(0, 1), interval(2, 3)]);
});

test("ignoreEolChanges preserves content lines when a final newline is added", () => {
  const beforeText = "a\nb";
  const finalNewline = change(beforeText, 1, 1, 1, 1, "\n");

  assert.deepEqual(map(beforeText, [interval(0, 2)], [finalNewline]), {
    reviewed: [interval(0, 1)],
    lineCount: 3
  });
  assert.deepEqual(
    map(beforeText, [interval(0, 2)], [finalNewline], {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: true
    }),
    {
      reviewed: [interval(0, 2)],
      lineCount: 3
    }
  );
});

test("empty no-op changes leave reviewed ranges unchanged", () => {
  const beforeText = "a\nb";

  assert.deepEqual(
    map(beforeText, [interval(0, 2)], [change(beforeText, 1, 0, 1, 0, "")]),
    {
      reviewed: [interval(0, 2)],
      lineCount: 2
    }
  );
});

test("mapping validates original offsets, lengths, overlap, and reviewed bounds", () => {
  const beforeText = "abcd";
  const first = change(beforeText, 0, 0, 0, 2, "x");
  const overlapping = change(beforeText, 0, 1, 0, 3, "y");

  assert.throws(
    () => map(beforeText, [interval(0, 1)], [{ ...first, rangeOffset: 1 }]),
    /rangeOffset/
  );
  assert.throws(
    () => map(beforeText, [interval(0, 1)], [{ ...first, rangeLength: 1 }]),
    /rangeLength/
  );
  assert.throws(
    () => map(beforeText, [interval(0, 1)], [first, overlapping]),
    /overlap/
  );
  assert.throws(() => map(beforeText, [interval(0, 2)], []), /line count/);
});

test("mapping does not mutate frozen reviewed ranges, changes, or options", () => {
  const beforeText = "a\nb\nc";
  const reviewed = Object.freeze([Object.freeze(interval(0, 3))]);
  const contentChange = change(beforeText, 1, 0, 1, 1, "B");
  const changes = Object.freeze([
    Object.freeze({
      ...contentChange,
      range: Object.freeze({
        start: Object.freeze({ ...contentChange.range.start }),
        end: Object.freeze({ ...contentChange.range.end })
      })
    })
  ]);
  const options = Object.freeze({
    ignoreWhitespaceChanges: false,
    ignoreEolChanges: false
  });

  assert.deepEqual(map(beforeText, reviewed, changes, options), {
    reviewed: [interval(0, 1), interval(2, 3)],
    lineCount: 3
  });
  assert.deepEqual(reviewed, [interval(0, 3)]);
  assert.deepEqual(changes, [contentChange]);
  assert.deepEqual(options, DEFAULT_OPTIONS);
});

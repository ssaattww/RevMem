import assert from "node:assert/strict";
import test from "node:test";

import type { LineInterval } from "../../src/core/contracts/index";
import {
  findLineIntervalContainingLine,
  lineIntervalLength,
  normalizeLineInterval,
  normalizeLineIntervals,
  selectionsToLineIntervals,
  subtractLineIntervals,
  type TextSelection
} from "../../src/core/intervals/index";

const interval = (startLine: number, endLineExclusive: number): LineInterval => ({
  startLine,
  endLineExclusive
});

const selection = (
  anchorLine: number,
  anchorCharacter: number,
  activeLine: number,
  activeCharacter: number
): TextSelection => ({
  anchor: { line: anchorLine, character: anchorCharacter },
  active: { line: activeLine, character: activeCharacter }
});

test("normalizeLineInterval orders endpoints and removes empty intervals", () => {
  assert.deepEqual(normalizeLineInterval(interval(5, 2)), interval(2, 5));
  assert.equal(normalizeLineInterval(interval(3, 3)), undefined);
});

test("lineIntervalLength uses zero-based half-open boundaries", () => {
  assert.equal(lineIntervalLength(interval(0, 1)), 1);
  assert.equal(lineIntervalLength(interval(4, 9)), 5);
  assert.equal(lineIntervalLength(interval(7, 7)), 0);
});

test("normalizeLineIntervals sorts and joins overlapping or adjacent intervals", () => {
  assert.deepEqual(
    normalizeLineIntervals([
      interval(10, 15),
      interval(2, 5),
      interval(0, 2),
      interval(4, 8),
      interval(20, 20),
      interval(18, 16),
      interval(15, 16)
    ]),
    [interval(0, 8), interval(10, 18)]
  );
});

test("findLineIntervalContainingLine finds boundaries with a normalized interval array", () => {
  const intervals = [interval(0, 3), interval(5, 8), interval(10, 11)];

  assert.deepEqual(findLineIntervalContainingLine(intervals, 0), interval(0, 3));
  assert.deepEqual(findLineIntervalContainingLine(intervals, 2), interval(0, 3));
  assert.equal(findLineIntervalContainingLine(intervals, 3), undefined);
  assert.deepEqual(findLineIntervalContainingLine(intervals, 5), interval(5, 8));
  assert.deepEqual(findLineIntervalContainingLine(intervals, 7), interval(5, 8));
  assert.equal(findLineIntervalContainingLine(intervals, 8), undefined);
  assert.deepEqual(findLineIntervalContainingLine(intervals, 10), interval(10, 11));
});

test("subtractLineIntervals removes contained ranges and splits remaining ranges", () => {
  assert.deepEqual(
    subtractLineIntervals(
      [interval(0, 10), interval(12, 20)],
      [interval(2, 4), interval(4, 7), interval(13, 19)]
    ),
    [interval(0, 2), interval(7, 10), interval(12, 13), interval(19, 20)]
  );
});

test("subtractLineIntervals handles full containment and partial boundary overlap", () => {
  assert.deepEqual(
    subtractLineIntervals(
      [interval(2, 6), interval(8, 12), interval(14, 18)],
      [interval(0, 4), interval(9, 11), interval(12, 20)]
    ),
    [interval(4, 6), interval(8, 9), interval(11, 12)]
  );
});

test("selectionsToLineIntervals converts empty selections on line zero and the final line", () => {
  assert.deepEqual(
    selectionsToLineIntervals([selection(0, 0, 0, 0), selection(3, 2, 3, 2)], 4),
    [interval(0, 1), interval(3, 4)]
  );
});

test("selectionsToLineIntervals converts forward and reverse selections identically", () => {
  const forward = selection(1, 3, 4, 2);
  const reverse = selection(4, 2, 1, 3);

  assert.deepEqual(selectionsToLineIntervals([forward], 6), [interval(1, 5)]);
  assert.deepEqual(selectionsToLineIntervals([reverse], 6), [interval(1, 5)]);
});

test("selectionsToLineIntervals excludes an end line when the selection stops at character zero", () => {
  assert.deepEqual(
    selectionsToLineIntervals([selection(1, 3, 4, 0)], 6),
    [interval(1, 4)]
  );
});

test("selectionsToLineIntervals joins overlapping and adjacent multiple selections", () => {
  assert.deepEqual(
    selectionsToLineIntervals(
      [
        selection(4, 5, 2, 1),
        selection(0, 0, 0, 0),
        selection(1, 2, 2, 0),
        selection(5, 0, 5, 0)
      ],
      6
    ),
    [interval(0, 6)]
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createDiffSelectionTargetPlan,
  type ChangeBlock,
  type OriginalStartLineMapping,
} from "../../src/application/review-commands/index";
import type { TextSelection } from "../../src/core/intervals/index";

const cursor = (line: number): TextSelection => ({
  anchor: { line, character: 0 },
  active: { line, character: 0 },
});

const selection = (
  anchorLine: number,
  anchorCharacter: number,
  activeLine: number,
  activeCharacter: number,
): TextSelection => ({
  anchor: { line: anchorLine, character: anchorCharacter },
  active: { line: activeLine, character: activeCharacter },
});

const replacement: ChangeBlock = {
  original: { startLine: 1, endLineExclusive: 3 },
  modified: { startLine: 1, endLineExclusive: 4 },
};

const mappings: readonly OriginalStartLineMapping[] = [
  { originalStartLine: 0, modifiedStartLine: 0, lineCount: 1 },
  { originalStartLine: 3, modifiedStartLine: 4, lineCount: 2 },
];

test("selection targets expand replacement blocks from either operated side", () => {
  for (const side of ["original", "modified"] as const) {
    assert.deepEqual(createDiffSelectionTargetPlan({
      side,
      selections: [cursor(1)],
      editorLineCount: 6,
      originalContentLineCount: 6,
      modifiedContentLineCount: 6,
      changeBlocks: [replacement],
      originalToModifiedLineMappings: mappings,
    }), {
      originalIntervals: [{ startLine: 1, endLineExclusive: 3 }],
      modifiedIntervals: [{ startLine: 1, endLineExclusive: 4 }],
    });
  }
});

test("selection targets normalize reverse selections and exclude a column-zero endpoint", () => {
  const input = {
    side: "original" as const,
    editorLineCount: 6,
    originalContentLineCount: 6,
    modifiedContentLineCount: 6,
    changeBlocks: [
      { original: { startLine: 1, endLineExclusive: 2 }, modified: { startLine: 1, endLineExclusive: 2 } },
      { original: { startLine: 3, endLineExclusive: 4 }, modified: { startLine: 3, endLineExclusive: 4 } },
    ],
    originalToModifiedLineMappings: mappings,
  };
  const expected = {
    originalIntervals: [{ startLine: 1, endLineExclusive: 2 }],
    modifiedIntervals: [{ startLine: 1, endLineExclusive: 2 }],
  };

  assert.deepEqual(createDiffSelectionTargetPlan({
    ...input,
    selections: [selection(1, 0, 3, 0)],
  }), expected);
  assert.deepEqual(createDiffSelectionTargetPlan({
    ...input,
    selections: [selection(3, 0, 1, 0)],
  }), expected);
});

test("selection targets preserve context-only side semantics and merge context with a block", () => {
  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "original",
    selections: [cursor(0)],
    editorLineCount: 6,
    originalContentLineCount: 6,
    modifiedContentLineCount: 6,
    changeBlocks: [replacement],
    originalToModifiedLineMappings: mappings,
  }), {
    originalIntervals: [],
    modifiedIntervals: [{ startLine: 0, endLineExclusive: 1 }],
  });

  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "modified",
    selections: [cursor(0)],
    editorLineCount: 6,
    originalContentLineCount: 6,
    modifiedContentLineCount: 6,
    changeBlocks: [replacement],
    originalToModifiedLineMappings: mappings,
  }), {
    originalIntervals: [],
    modifiedIntervals: [{ startLine: 0, endLineExclusive: 1 }],
  });

  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "original",
    selections: [selection(0, 0, 1, 1)],
    editorLineCount: 6,
    originalContentLineCount: 6,
    modifiedContentLineCount: 6,
    changeBlocks: [replacement],
    originalToModifiedLineMappings: mappings,
  }), {
    originalIntervals: [{ startLine: 1, endLineExclusive: 3 }],
    modifiedIntervals: [{ startLine: 0, endLineExclusive: 4 }],
  });
});

test("selection targets deduplicate overlaps and keep independent touched blocks", () => {
  const blocks: readonly ChangeBlock[] = [
    { original: { startLine: 1, endLineExclusive: 2 }, modified: { startLine: 1, endLineExclusive: 2 } },
    { original: { startLine: 3, endLineExclusive: 4 }, modified: { startLine: 3, endLineExclusive: 4 } },
  ];
  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "modified",
    selections: [cursor(1), selection(1, 0, 1, 1), cursor(3)],
    editorLineCount: 5,
    originalContentLineCount: 5,
    modifiedContentLineCount: 5,
    changeBlocks: blocks,
    originalToModifiedLineMappings: [],
  }), {
    originalIntervals: [
      { startLine: 1, endLineExclusive: 2 },
      { startLine: 3, endLineExclusive: 4 },
    ],
    modifiedIntervals: [
      { startLine: 1, endLineExclusive: 2 },
      { startLine: 3, endLineExclusive: 4 },
    ],
  });
});

test("selection targets retain only existing sides and exclude display-only content", () => {
  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "modified",
    selections: [cursor(2)],
    editorLineCount: 4,
    originalContentLineCount: 2,
    modifiedContentLineCount: 3,
    changeBlocks: [{ modified: { startLine: 2, endLineExclusive: 3 } }],
    originalToModifiedLineMappings: [],
  }), {
    originalIntervals: [],
    modifiedIntervals: [{ startLine: 2, endLineExclusive: 3 }],
  });

  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "original",
    selections: [cursor(2)],
    editorLineCount: 4,
    originalContentLineCount: 3,
    modifiedContentLineCount: 2,
    changeBlocks: [{ original: { startLine: 2, endLineExclusive: 3 } }],
    originalToModifiedLineMappings: [],
  }), {
    originalIntervals: [{ startLine: 2, endLineExclusive: 3 }],
    modifiedIntervals: [],
  });

  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "modified",
    selections: [cursor(1)],
    editorLineCount: 2,
    originalContentLineCount: 0,
    modifiedContentLineCount: 1,
    changeBlocks: [{ modified: { startLine: 0, endLineExclusive: 1 } }],
    originalToModifiedLineMappings: [],
  }), { originalIntervals: [], modifiedIntervals: [] });

  assert.deepEqual(createDiffSelectionTargetPlan({
    side: "modified",
    selections: [],
    editorLineCount: 1,
    originalContentLineCount: 0,
    modifiedContentLineCount: 0,
    changeBlocks: [],
    originalToModifiedLineMappings: [],
  }), { originalIntervals: [], modifiedIntervals: [] });
});

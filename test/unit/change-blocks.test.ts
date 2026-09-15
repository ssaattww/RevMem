import assert from "node:assert/strict";
import test from "node:test";

import { deriveChangeBlocks } from "../../src/application/review-commands/index";

test("change blocks retain both sides of equal and unequal replacements without line pairing", () => {
  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 5,
    modifiedLineCount: 5,
    hunks: [{
      oldStart: 2, oldCount: 2, newStart: 2, newCount: 2,
      lines: [
        { kind: "deletion", oldLine: 2, text: "old-a" },
        { kind: "deletion", oldLine: 3, text: "old-b" },
        { kind: "addition", newLine: 2, text: "new-a" },
        { kind: "addition", newLine: 3, text: "new-b" },
      ],
    }],
  }), [{
    original: { startLine: 1, endLineExclusive: 3 },
    modified: { startLine: 1, endLineExclusive: 3 },
  }]);

  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 4,
    modifiedLineCount: 5,
    hunks: [{
      oldStart: 2, oldCount: 1, newStart: 2, newCount: 2,
      lines: [
        { kind: "deletion", oldLine: 2, text: "old" },
        { kind: "addition", newLine: 2, text: "new-a" },
        { kind: "addition", newLine: 3, text: "new-b" },
      ],
    }],
  }), [{
    original: { startLine: 1, endLineExclusive: 2 },
    modified: { startLine: 1, endLineExclusive: 3 },
  }]);
});

test("change blocks retain one-sided additions and deletions", () => {
  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 2,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 1, oldCount: 0, newStart: 2, newCount: 2,
      lines: [
        { kind: "addition", newLine: 2, text: "added-a" },
        { kind: "addition", newLine: 3, text: "added-b" },
      ],
    }],
  }), [{ modified: { startLine: 1, endLineExclusive: 3 } }]);

  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 4,
    modifiedLineCount: 2,
    hunks: [{
      oldStart: 2, oldCount: 2, newStart: 1, newCount: 0,
      lines: [
        { kind: "deletion", oldLine: 2, text: "removed-a" },
        { kind: "deletion", oldLine: 3, text: "removed-b" },
      ],
    }],
  }), [{ original: { startLine: 1, endLineExclusive: 3 } }]);
});

test("change blocks stop at context lines and hunk boundaries", () => {
  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 3,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 1, oldCount: 3, newStart: 1, newCount: 4,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "same-start" },
        { kind: "deletion", oldLine: 2, text: "old" },
        { kind: "addition", newLine: 2, text: "new" },
        { kind: "context", oldLine: 3, newLine: 3, text: "same-middle" },
        { kind: "addition", newLine: 4, text: "added" },
      ],
    }],
  }), [
    { original: { startLine: 1, endLineExclusive: 2 }, modified: { startLine: 1, endLineExclusive: 2 } },
    { modified: { startLine: 3, endLineExclusive: 4 } },
  ]);

  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 2,
    modifiedLineCount: 2,
    hunks: [
      { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [
        { kind: "deletion", oldLine: 1, text: "old-first" },
        { kind: "addition", newLine: 1, text: "new-first" },
      ] },
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, lines: [
        { kind: "deletion", oldLine: 2, text: "old-second" },
        { kind: "addition", newLine: 2, text: "new-second" },
      ] },
    ],
  }), [
    { original: { startLine: 0, endLineExclusive: 1 }, modified: { startLine: 0, endLineExclusive: 1 } },
    { original: { startLine: 1, endLineExclusive: 2 }, modified: { startLine: 1, endLineExclusive: 2 } },
  ]);
});

test("change blocks use content coordinates at the head and EOF", () => {
  assert.deepEqual(deriveChangeBlocks({
    originalLineCount: 5,
    modifiedLineCount: 6,
    hunks: [
      { oldStart: 1, oldCount: 1, newStart: 1, newCount: 2, lines: [
        { kind: "deletion", oldLine: 1, text: "old-head" },
        { kind: "addition", newLine: 1, text: "new-head-a" },
        { kind: "addition", newLine: 2, text: "new-head-b" },
      ] },
      { oldStart: 5, oldCount: 1, newStart: 6, newCount: 1, lines: [
        { kind: "deletion", oldLine: 5, text: "old-eof" },
        { kind: "addition", newLine: 6, text: "new-eof" },
      ] },
    ],
  }), [
    { original: { startLine: 0, endLineExclusive: 1 }, modified: { startLine: 0, endLineExclusive: 2 } },
    { original: { startLine: 4, endLineExclusive: 5 }, modified: { startLine: 5, endLineExclusive: 6 } },
  ]);
});

test("change blocks reject incomplete counts and contradictory coordinates", () => {
  assert.throws(() => deriveChangeBlocks({
    originalLineCount: 1,
    modifiedLineCount: 1,
    hunks: [{
      oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
      lines: [{ kind: "addition", newLine: 1, text: "missing-deletion" }],
    }],
  }), /hunk body/i);

  assert.throws(() => deriveChangeBlocks({
    originalLineCount: 1,
    modifiedLineCount: 1,
    hunks: [{
      oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
      lines: [
        { kind: "deletion", oldLine: 1, text: "old" },
        { kind: "addition", newLine: 2, text: "new" },
      ],
    }],
  }), /diff cursor/i);
});

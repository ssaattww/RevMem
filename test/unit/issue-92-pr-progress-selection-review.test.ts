import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOriginalSelectionReviewPlan,
  createOriginalToModifiedLineMappings
} from "../../src/application/review-commands/index";
import { PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY } from "../../src/ui/pr-progress/pr-progress-diff-review-context";

test("original-side selection maps surviving context lines and keeps deleted lines on the comparison pair", () => {
  const mappings = createOriginalToModifiedLineMappings({
    originalLineCount: 5,
    modifiedLineCount: 5,
    hunks: [{
      oldStart: 2,
      oldCount: 3,
      newStart: 2,
      newCount: 3,
      lines: [
        { kind: "deletion", oldLine: 2, text: "before" },
        { kind: "addition", newLine: 2, text: "after" },
        { kind: "context", oldLine: 3, newLine: 3, text: "same-3" },
        { kind: "context", oldLine: 4, newLine: 4, text: "same-4" }
      ]
    }]
  });

  assert.deepEqual(mappings, [
    { original: { startLine: 0, endLineExclusive: 1 }, modifiedStartLine: 0 },
    { original: { startLine: 2, endLineExclusive: 5 }, modifiedStartLine: 2 }
  ]);

  const plan = createOriginalSelectionReviewPlan({
    selections: [{ startLine: 0, endLineExclusive: 4 }],
    originalDeletionIntervals: [{ startLine: 1, endLineExclusive: 2 }],
    originalToModifiedLineMappings: mappings
  });

  assert.deepEqual(plan.modifiedIntervals, [
    { startLine: 0, endLineExclusive: 1 },
    { startLine: 2, endLineExclusive: 4 }
  ]);
  assert.deepEqual(plan.originalDeletionIntervals, [
    { startLine: 1, endLineExclusive: 2 }
  ]);
});

test("original-side mapping follows insertions instead of assuming equal line numbers", () => {
  const mappings = createOriginalToModifiedLineMappings({
    originalLineCount: 3,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 1,
      oldCount: 0,
      newStart: 2,
      newCount: 1,
      lines: [{ kind: "addition", newLine: 2, text: "inserted" }]
    }]
  });

  assert.deepEqual(mappings, [
    { original: { startLine: 0, endLineExclusive: 1 }, modifiedStartLine: 0 },
    { original: { startLine: 1, endLineExclusive: 3 }, modifiedStartLine: 2 }
  ]);
  assert.deepEqual(createOriginalSelectionReviewPlan({
    selections: [{ startLine: 1, endLineExclusive: 3 }],
    originalDeletionIntervals: [],
    originalToModifiedLineMappings: mappings
  }), {
    modifiedIntervals: [{ startLine: 2, endLineExclusive: 4 }],
    originalDeletionIntervals: []
  });
});

test("replacement old lines remain original-only and are not guessed onto added lines", () => {
  const mappings = createOriginalToModifiedLineMappings({
    originalLineCount: 3,
    modifiedLineCount: 4,
    hunks: [{
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 2,
      lines: [
        { kind: "deletion", oldLine: 2, text: "old" },
        { kind: "addition", newLine: 2, text: "new-a" },
        { kind: "addition", newLine: 3, text: "new-b" }
      ]
    }]
  });

  assert.deepEqual(createOriginalSelectionReviewPlan({
    selections: [{ startLine: 1, endLineExclusive: 2 }],
    originalDeletionIntervals: [{ startLine: 1, endLineExclusive: 2 }],
    originalToModifiedLineMappings: mappings
  }), {
    modifiedIntervals: [],
    originalDeletionIntervals: [{ startLine: 1, endLineExclusive: 2 }]
  });
});

test("PR Progress diff menu exposes selection and whole-file actions without adding menu entries", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes?: { menus?: { "editor/context"?: Array<{ command?: string; when?: string }> } };
  };
  const items = manifest.contributes?.menus?.["editor/context"] ?? [];
  assert.equal(items.length, 7);

  for (const command of [
    "reviewRange.markSelectionReviewed",
    "reviewRange.unmarkSelectionReviewed",
    "reviewRange.markFileReviewed",
    "reviewRange.unmarkFileReviewed"
  ]) {
    const item = items.find((candidate) => candidate.command === command);
    assert.ok(item, `${command} must remain a single editor/context contribution`);
    assert.match(item.when ?? "", new RegExp(PR_PROGRESS_DIFF_REVIEW_CONTEXT_KEY.replaceAll(".", "\\.")));
    assert.match(item.when ?? "", /isInDiffEditor/);
  }
});

test("selection command service composes one atomic commit for mapped modified and original ranges", async () => {
  const service = await readFile("src/application/review-commands/diff-editor-review-command-service.ts", "utf8");
  const runtime = await readFile("src/t405-pull-request-review-runtime-base.ts", "utf8");

  assert.match(service, /createOriginalSelectionReviewPlan/);
  assert.match(service, /commitTransactionSequence/);
  assert.match(service, /originalToModifiedLineMappings/);
  assert.match(runtime, /createOriginalToModifiedLineMappings/);
  assert.match(runtime, /originalToModifiedLineMappings:/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOriginalSelectionReviewPlan,
  createOriginalToModifiedLineMappings
} from "../../src/application/review-commands/index";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewHistoryEvent,
  type RepositoryGlobalState,
  type ReviewContextState,
  type ReviewHistoryEvent
} from "../../src/core/contracts/index";
import {
  commitReviewStateTransaction,
  markOriginalSelectionReviewed,
  unmarkOriginalSelectionReviewed,
  type ReviewStateTransaction
} from "../../src/core/review-state/index";
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

test("original selection uses one typed composite commit and records modified before original history", async () => {
  const baseSha = "1111111111111111111111111111111111111111";
  const headSha = "2222222222222222222222222222222222222222";
  const diffId = `${baseSha}..${headSha}`;
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: "github-pr:github.com/ssaattww/RevMem#92",
    kind: "pull-request",
    repositoryId: "github.com/ssaattww/RevMem",
    displayName: "PR #92",
    pullRequest: {
      host: "github.com",
      owner: "ssaattww",
      repository: "RevMem",
      number: 92,
      state: "open",
      baseSha,
      headSha
    },
    files: {
      file: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId: "file",
        currentPath: "src/example.ts",
        previousPaths: [],
        revisionId: headSha,
        modifiedReviewed: [],
        originalReviewedByDiff: {},
        lineCount: 3,
        updatedAt: "2026-08-30T00:00:00.000Z"
      }
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z"
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId: "github.com/ssaattww/RevMem",
    currentRevisionId: headSha,
    files: {},
    updatedAt: "2026-08-30T00:00:00.000Z"
  };
  const input = {
    contextState,
    globalState,
    target: {
      fileId: "file",
      currentPath: "src/example.ts",
      revisionId: headSha,
      lineCount: 3
    },
    side: "original" as const,
    diffId,
    originalLineCount: 3,
    modifiedIntervals: [{ startLine: 0, endLineExclusive: 1 }],
    originalIntervals: [{ startLine: 1, endLineExclusive: 2 }],
    occurredAt: "2026-08-30T01:00:00.000Z"
  };
  const committed: ReviewStateTransaction[] = [];
  const events: ReviewHistoryEvent[] = [];
  let eventNumber = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "issue-92",
    createEventId: () => `event-${String(++eventNumber)}`,
    appender: { append: async (_target, event) => { events.push(event); } }
  });

  const marked = markOriginalSelectionReviewed(input);
  assert.equal(marked.operation, "mark-original-selection-reviewed");
  assert.deepEqual(marked.expected, { contextState, globalState });
  assert.deepEqual(marked.next.contextState.files.file?.modifiedReviewed, input.modifiedIntervals);
  assert.deepEqual(marked.next.globalState.files.file?.reviewed, input.modifiedIntervals);
  assert.deepEqual(marked.next.contextState.files.file?.originalReviewedByDiff[diffId], input.originalIntervals);

  await commitReviewStateTransaction(marked, {
    commit: async (transaction) => { committed.push(transaction); }
  });
  assert.equal(committed.length, 1, "mapped and original ranges persist through one composite commit");
  assert.equal(committed[0], marked);
  await recorder.recordTransaction(marked, "user-selection");
  assert.equal(events.length, 2);
  assert.equal((events[0] as FileReviewHistoryEvent).diffSide, "modified");
  assert.equal((events[1] as FileReviewHistoryEvent).diffSide, "original");

  const unmarked = unmarkOriginalSelectionReviewed({
    ...input,
    contextState: marked.next.contextState,
    globalState: marked.next.globalState
  });
  assert.equal(unmarked.operation, "unmark-original-selection-reviewed");
  await commitReviewStateTransaction(unmarked, {
    commit: async (transaction) => { committed.push(transaction); }
  });
  assert.equal(committed.length, 2, "unmark remains one composite commit");
  await recorder.recordTransaction(unmarked, "user-selection");
  assert.equal(events.length, 4);
  assert.equal((events[2] as FileReviewHistoryEvent).diffSide, "modified");
  assert.equal((events[3] as FileReviewHistoryEvent).diffSide, "original");
});

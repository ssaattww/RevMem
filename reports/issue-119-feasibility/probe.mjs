// Investigation only; never imported by the extension or the default test suite.
// Run from repo root after npm run compile:test. --require-feature expects the missing feature.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DiffEditorReviewCommandService, deriveOriginalToModifiedLineMappings } from '../../test-dist/src/application/review-commands/index.js';
import { markOriginalSelectionReviewed, unmarkOriginalSelectionReviewed } from '../../test-dist/src/core/review-state/index.js';
import { ReviewHistoryRecorder } from '../../test-dist/src/application/review-history/index.js';
import { calculatePullRequestDiffProgress } from '../../test-dist/src/core/pr-progress/index.js';
import { ReviewFileExclusionPolicy } from '../../test-dist/src/core/file-exclusion/index.js';
import { normalizeLineIntervals } from '../../test-dist/src/core/intervals/index.js';
const range = (startLine, endLineExclusive) => ({ startLine, endLineExclusive });
const BASE = '1'.repeat(40), HEAD = '2'.repeat(40), DIFF = `${BASE}..${HEAD}`;
const changed = (kind, n) => ({ kind, [kind === 'addition' ? 'newLine' : 'oldLine']: n, text: kind });
const context = (oldLine, newLine) => ({ kind: 'context', oldLine, newLine, text: 'unchanged' });
const evidence = { originalLineCount: 5, modifiedLineCount: 6, hunks: [{
  oldStart: 1, oldCount: 5, newStart: 1, newCount: 6,
  lines: [context(1, 1), changed('deletion', 2), changed('deletion', 3),
    changed('addition', 2), changed('addition', 3), changed('addition', 4),
    context(4, 5), changed('deletion', 5), changed('addition', 6)]
}] };
// The candidate groups actions; it does not equate replaced lines for revision mapping.
function candidateBlocks(input) {
  deriveOriginalToModifiedLineMappings(input);
  const result = [];
  for (const hunk of input.hunks) {
    let original = [], modified = [];
    const flush = () => {
      if (original.length || modified.length) result.push({
        original: normalizeLineIntervals(original), modified: normalizeLineIntervals(modified)
      });
      original = []; modified = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === 'context') flush();
      else if (line.kind === 'deletion') original.push(range(line.oldLine - 1, line.oldLine));
      else modified.push(range(line.newLine - 1, line.newLine));
    }
    flush();
  }
  return result;
}
const expectedBlocks = [
  { original: [range(1, 3)], modified: [range(1, 4)] },
  { original: [range(4, 5)], modified: [range(5, 6)] }
];
function state() {
  const at = '2026-09-10T00:00:00.000Z';
  return {
    contextState: { schemaVersion: 1, repositoryId: 'repo', contextId: 'pr', kind: 'pull-request', displayName: 'PR #119',
      pullRequest: { host: 'github.com', owner: 'ssaattww', repository: 'RevMem', number: 119, state: 'open', baseSha: BASE, headSha: HEAD },
      files: {}, createdAt: at, updatedAt: at },
    globalState: { schemaVersion: 1, repositoryId: 'repo', currentRevisionId: HEAD, files: {}, updatedAt: at }
  };
}
const target = { fileId: 'f', currentPath: 'sample.ts', revisionId: HEAD, lineCount: 6 };
const diff = { contextId: 'pr', baseSha: BASE, headSha: HEAD, originalDiffId: DIFF,
  files: [{ fileId: 'f', status: 'modified', oldPath: 'sample.ts', newPath: 'sample.ts', additions: 4, deletions: 3, hunks: evidence.hunks }] };
const progress = (reviewContext) => calculatePullRequestDiffProgress({ diff, reviewContext,
  exclusionPolicy: new ReviewFileExclusionPolicy({ userGlobs: [] }) });
for (const side of ['original', 'modified']) test(`production ${side} selection does not yet link replacement sides`, async () => {
  const initial = state(); let transaction; let commits = 0; let histories = 0;
  const session = { ...initial, target, diffId: DIFF, originalLineCount: 5,
    originalDeletionIntervals: [range(1, 3), range(4, 5)], originalToModifiedLineMappings: deriveOriginalToModifiedLineMappings(evidence),
    committer: { commit: async (value) => { transaction = value; commits++; } } };
  const service = new DiffEditorReviewCommandService({ getSide: () => side,
    getLineCount: () => side === 'original' ? 5 : 6,
    getSelections: () => [{ anchor: { line: 1, character: 0 }, active: { line: side === 'original' ? 3 : 4, character: 0 } }],
    openSession: async () => session, confirmWholeFileOperation: async () => true, requestHistory: async () => { histories++; } });
  assert.equal(await service.markSelectionReviewed({}), 'applied');
  assert.equal(commits, 1); assert.equal(histories, 1);
  const expected = process.argv.includes('--require-feature') ? 5 : side === 'original' ? 2 : 3;
  assert.equal(progress(transaction.next.contextState).reviewedLineCount, expected);
});
test('candidate separates two replacement blocks inside one hunk', () => assert.deepEqual(candidateBlocks(evidence), expectedBlocks));
for (const kind of ['addition', 'deletion']) test(`candidate ${kind}-only block has no invented opposite line`, () => {
  const adding = kind === 'addition';
  const input = { originalLineCount: adding ? 0 : 2, modifiedLineCount: adding ? 2 : 0,
    hunks: [{ oldStart: adding ? 0 : 1, oldCount: adding ? 0 : 2, newStart: adding ? 1 : 0, newCount: adding ? 2 : 0,
      lines: [changed(kind, 1), changed(kind, 2)] }] };
  assert.deepEqual(candidateBlocks(input), [{ original: adding ? [] : [range(0, 2)], modified: adding ? [range(0, 2)] : [] }]);
});
test('candidate rejects malformed hunk counts', () => {
  const invalid = structuredClone(evidence); invalid.hunks[0].oldCount++;
  assert.throws(() => candidateBlocks(invalid), /line counts|count/i);
});
test('existing composite primitive represents both sides, history and progress without a schema change', async () => {
  // Explicit ranges are supplied here; this does NOT connect the candidate to the production command.
  const initial = state(); const events = []; let sequence = 0;
  const input = { ...initial, target, side: 'original', diffId: DIFF, originalLineCount: 5,
    modifiedIntervals: [range(1, 4)], originalIntervals: [range(1, 3)], occurredAt: '2026-09-10T00:01:00.000Z' };
  const transaction = markOriginalSelectionReviewed(input);
  const recorder = new ReviewHistoryRecorder({ sessionId: 'probe', createEventId: () => String(++sequence),
    appender: { append: async (_target, event) => { events.push(event); } } });
  await recorder.recordTransaction(transaction, 'feasibility-explicit-ranges');
  assert.equal(progress(transaction.next.contextState).reviewedLineCount, 5);
  assert.equal(progress(transaction.next.contextState).totalLineCount, 7);
  assert.deepEqual(transaction.next.globalState.files.f.reviewed, [range(1, 4)]);
  assert.deepEqual(events.map((event) => event.diffSide), ['modified', 'original']);
  assert.equal(events[1].diffId, DIFF);
  const undone = unmarkOriginalSelectionReviewed({ ...input, ...transaction.next });
  assert.equal(progress(undone.next.contextState).reviewedLineCount, 0);
  assert.deepEqual(initial.contextState.files, {});
});

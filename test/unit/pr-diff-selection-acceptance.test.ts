import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildSnapshotFromLocalGitDiff } from "../../src/application/github-pr-diff/pull-request-diff-builders.js";
import { ReviewHistoryRecorder } from "../../src/application/review-history/index.js";
import { recordPullRequestReviewHistory } from "../../src/composition/pull-request/pull-request-review-history.js";
import {
  PullRequestReviewRuntime,
  type PullRequestReviewRuntimeRepository,
} from "../../src/composition/pull-request/pull-request-review-runtime.js";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type FileReviewHistoryEvent,
  type LineInterval,
  type RepositoryGlobalState,
  type ReviewContextState,
  type ReviewHistoryEvent,
} from "../../src/core/contracts/index.js";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/index.js";
import { deriveDocumentLineContract, type TextSelection } from "../../src/core/intervals/index.js";
import type { PullRequestDiffSnapshot } from "../../src/core/pr-progress/index.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const REPOSITORY_ID = "github.com/ssaattww/revmem";
const CONTEXT_ID = `github-pr:${REPOSITORY_ID}#52`;
const DIFF_ID = `${BASE}..${HEAD}`;
const OCCURRED_AT = "2026-09-17T00:00:00.000Z";
const contentHash = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

const contentLines = (content: string | undefined): readonly string[] => {
  if (content === undefined || content.length === 0) return [];
  const normalized = content.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
};

const hunkPosition = (count: number): string => {
  if (count === 0) return "0,0";
  return count === 1 ? "1" : `1,${count}`;
};

const appendChangedSide = (
  output: string[],
  prefix: "-" | "+",
  content: string | undefined,
): void => {
  const lines = contentLines(content);
  for (const line of lines) output.push(`${prefix}${line}`);
  if (lines.length > 0 && !content!.endsWith("\n")) {
    output.push("\\ No newline at end of file");
  }
};
const wholeFilePatch = (
  original: string | undefined,
  modified: string | undefined,
): string => {
  const added = original === undefined;
  const deleted = modified === undefined;
  const originalLines = contentLines(original);
  const modifiedLines = contentLines(modified);
  const output = [
    "diff --git a/src/example.ts b/src/example.ts",
    ...(added ? ["new file mode 100644"] : deleted ? ["deleted file mode 100644"] : []),
    added ? "--- /dev/null" : "--- a/src/example.ts",
    deleted ? "+++ /dev/null" : "+++ b/src/example.ts",
    `@@ -${hunkPosition(originalLines.length)} +${hunkPosition(modifiedLines.length)} @@`,
  ];
  appendChangedSide(output, "-", original);
  appendChangedSide(output, "+", modified);
  return `${output.join("\n")}\n`;
};

const snapshotFromPatch = (patch: string): PullRequestDiffSnapshot => {
  const built = buildSnapshotFromLocalGitDiff({
    contextId: CONTEXT_ID,
    repository: { host: "github.com", owner: "ssaattww", repository: "revmem" },
    number: 52,
    baseSha: BASE,
    headSha: HEAD,
  }, patch);
  assert.equal(built.kind, "success");
  return built.snapshot;
};
const emptyContext = (): ReviewContextState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  contextId: CONTEXT_ID,
  kind: "pull-request",
  repositoryId: REPOSITORY_ID,
  displayName: "PR #52",
  pullRequest: {
    host: "github.com",
    owner: "ssaattww",
    repository: "revmem",
    number: 52,
    state: "open",
    title: "Acceptance fixture",
    baseSha: BASE,
    headSha: HEAD,
  },
  files: {},
  createdAt: OCCURRED_AT,
  updatedAt: OCCURRED_AT,
});

const emptyGlobal = (): RepositoryGlobalState => ({
  schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
  repositoryId: REPOSITORY_ID,
  currentRevisionId: HEAD,
  files: {},
  updatedAt: OCCURRED_AT,
});

type PersistedCommit = {
  readonly schemaVersion: typeof REVIEW_RANGE_SCHEMA_VERSION;
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
};
class MemoryRepository implements PullRequestReviewRuntimeRepository {
  public commits = 0;

  public constructor(public current: PersistedCommit) {}

  public async load(): Promise<PersistedCommit> {
    return structuredClone(this.current);
  }

  public async commit(transaction: Parameters<PullRequestReviewRuntimeRepository["commit"]>[0]): Promise<void> {
    this.commits += 1;
    this.current = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: structuredClone(transaction.next.contextState) as ReviewContextState,
      globalState: structuredClone(transaction.next.globalState) as RepositoryGlobalState,
    };
  }
}

type AcceptanceFixture = {
  readonly original: string | undefined;
  readonly modified: string | undefined;
  readonly snapshot: PullRequestDiffSnapshot;
  readonly fileId: string;
  readonly repository: MemoryRepository;
  readonly runtime: PullRequestReviewRuntime<string>;
  readonly opened: Array<{ readonly original: string; readonly modified: string }>;
  readonly events: ReviewHistoryEvent[];
};
const createFixture = (
  original: string | undefined,
  modified: string | undefined,
  patch = wholeFilePatch(original, modified),
  getMode: () => "side" | "block" = () => "block",
): AcceptanceFixture => {
  const snapshot = snapshotFromPatch(patch);
  assert.equal(snapshot.files.length, 1);
  const fileId = snapshot.files[0]!.fileId;
  const repository = new MemoryRepository({
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: emptyContext(),
    globalState: emptyGlobal(),
  });
  const opened: Array<{ readonly original: string; readonly modified: string }> = [];
  const events: ReviewHistoryEvent[] = [];
  let eventId = 0;
  const recorder = new ReviewHistoryRecorder({
    sessionId: "acceptance-session",
    createEventId: () => `event-${++eventId}`,
    appender: { append: async (_target, event) => { events.push(event); } },
  });
  const runtime = new PullRequestReviewRuntime<string>({
    repository,
    requestHistory: (transaction) => recordPullRequestReviewHistory(recorder, transaction),
    diffHost: {
      parseUri: (value) => value,
      openDiff: async (originalUri, modifiedUri) => {
        opened.push({ original: originalUri, modified: modifiedUri });
      },
    },
    getExclusionPolicy: () => new ReviewFileExclusionPolicy({ userGlobs: [] }),
    getDiffSelectionMode: getMode,
  });
  runtime.register({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: "/repo",
    fileSystemPathSemantics: "posix",
    snapshot,
    readTextContent: async (descriptor) => {
      const content = descriptor.side === "original" ? original : modified;
      return content === undefined
        ? { kind: "missing-file" as const }
        : { kind: "found" as const, content };
    },
  });
  return {
    original,
    modified,
    snapshot,
    fileId,
    repository,
    runtime,
    opened,
    events,
  };
};

const cursor = (line: number): TextSelection => ({
  anchor: { line, character: 0 },
  active: { line, character: 0 },
});
type ComponentState = "unreviewed" | "partial" | "reviewed";
const componentStates: readonly ComponentState[] = ["unreviewed", "partial", "reviewed"];
const blockRange: LineInterval = { startLine: 0, endLineExclusive: 2 };

const rangesFor = (state: ComponentState): LineInterval[] => {
  if (state === "unreviewed") return [];
  if (state === "partial") return [{ startLine: 0, endLineExclusive: 1 }];
  return [{ ...blockRange }];
};

const lineContractFor = (content: string | undefined) => deriveDocumentLineContract(
  content === undefined
    ? { existence: "absent" as const }
    : { existence: "present" as const, content },
);

const seedComponents = (
  fixture: AcceptanceFixture,
  states: { readonly original?: ComponentState; readonly modified?: ComponentState; readonly global?: ComponentState },
): void => {
  const currentPath = fixture.snapshot.files[0]!.newPath ?? fixture.snapshot.files[0]!.oldPath ?? "src/example.ts";
  const modifiedContract = lineContractFor(fixture.modified);
  const contextFile = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    fileId: fixture.fileId,
    currentPath,
    previousPaths: [],
    revisionId: HEAD,
    modifiedReviewed: states.modified === undefined ? [] : rangesFor(states.modified),
    originalReviewedByDiff: states.original === undefined ? {} : { [DIFF_ID]: rangesFor(states.original) },
    lineCount: modifiedContract.editorLineCount,
    updatedAt: OCCURRED_AT,
    ...(fixture.modified === undefined ? {} : { contentHash: contentHash(fixture.modified) }),
  };
  fixture.repository.current = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextState: {
      ...emptyContext(),
      files: { [fixture.fileId]: contextFile },
    },
    globalState: {
      ...emptyGlobal(),
      files: states.global === undefined ? {} : {
        [fixture.fileId]: {
          fileId: fixture.fileId,
          currentPath,
          revisionId: HEAD,
          reviewed: rangesFor(states.global),
          contentHash: contentHash(fixture.modified ?? ""),
          updatedAt: OCCURRED_AT,
        },
      },
    },
  };
};

const openCommand = async (
  fixture: AcceptanceFixture,
  side: "original" | "modified",
  selections: readonly TextSelection[],
) => {
  await fixture.runtime.openReviewDiff(CONTEXT_ID, fixture.fileId);
  const pair = fixture.opened.at(-1)!;
  fixture.runtime.validateDiffDocumentPair(pair.original, pair.modified);
  const content = side === "original" ? fixture.original : fixture.modified;
  const lineCount = lineContractFor(content).editorLineCount;
  const editor = { uri: pair[side], side } as const;
  const commands = fixture.runtime.createCommandService<typeof editor>({
    getDocumentUri: (value) => value.uri,
    getSide: (value) => value.side,
    getLineCount: () => lineCount,
    getSelections: () => selections,
    confirmWholeFileOperation: async () => true,
  });
  return { editor, commands };
};

const changedBy = (state: ComponentState, operation: "mark" | "unmark"): boolean =>
  operation === "mark" ? state !== "reviewed" : state !== "unreviewed";

const finalRanges = (operation: "mark" | "unmark"): LineInterval[] =>
  operation === "mark" ? [{ ...blockRange }] : [];

const eventSides = (events: readonly ReviewHistoryEvent[]): Array<"modified" | "original"> =>
  events.map((event) => (event as FileReviewHistoryEvent).diffSide);

const assertProgress = async (
  fixture: AcceptanceFixture,
  reviewedLineCount: number,
  totalLineCount: number,
): Promise<void> => {
  const progress = await fixture.runtime.getProgress(CONTEXT_ID);
  assert.deepEqual(progress, {
    reviewedLineCount,
    totalLineCount,
    progress: totalLineCount === 0 ? 1 : reviewedLineCount / totalLineCount,
  });
};
test("replacement state product stays atomic through runtime, history, progress, and Global", async () => {
  let caseCount = 0;
  for (const originalState of componentStates) {
    for (const modifiedState of componentStates) {
      for (const globalState of componentStates) {
        for (const operation of ["mark", "unmark"] as const) {
          for (const side of ["original", "modified"] as const) {
            const fixture = createFixture("old-1\nold-2", "new-1\nnew-2");
            seedComponents(fixture, { original: originalState, modified: modifiedState, global: globalState });
            const command = await openCommand(fixture, side, [cursor(0)]);
            const result = operation === "mark"
              ? await command.commands.markSelectionReviewed(command.editor)
              : await command.commands.unmarkSelectionReviewed(command.editor);
            const originalChanged = changedBy(originalState, operation);
            const modifiedChanged = changedBy(modifiedState, operation);
            const globalChanged = changedBy(globalState, operation);
            const anyChanged = originalChanged || modifiedChanged || globalChanged;
            const expected = finalRanges(operation);

            assert.equal(result, anyChanged ? "applied" : "no-op");
            assert.equal(fixture.repository.commits, anyChanged ? 1 : 0);
            assert.deepEqual(
              fixture.repository.current.contextState.files[fixture.fileId]?.originalReviewedByDiff[DIFF_ID] ?? [],
              expected,
            );
            assert.deepEqual(fixture.repository.current.contextState.files[fixture.fileId]?.modifiedReviewed, expected);
            assert.deepEqual(fixture.repository.current.globalState.files[fixture.fileId]?.reviewed, expected);
            assert.deepEqual(eventSides(fixture.events), [
              ...(modifiedChanged || globalChanged ? ["modified" as const] : []),
              ...(originalChanged ? ["original" as const] : []),
            ]);
            if (modifiedChanged || globalChanged) {
              const modifiedEvent = fixture.events[0] as FileReviewHistoryEvent;
              assert.equal(modifiedEvent.reason, "user-block-selection");
              assert.deepEqual(modifiedEvent.previousRanges, rangesFor(modifiedState));
              assert.deepEqual(modifiedEvent.nextRanges, expected);
              assert.equal(modifiedEvent.rangeRepresentation, "context-and-global");
              assert.deepEqual(modifiedEvent.globalPreviousRanges, rangesFor(globalState));
              assert.deepEqual(modifiedEvent.globalNextRanges, expected);
            }
            if (originalChanged) {
              const originalEvent = fixture.events.at(-1) as FileReviewHistoryEvent;
              assert.equal(originalEvent.reason, "user-block-selection");
              assert.equal(originalEvent.diffId, DIFF_ID);
              assert.deepEqual(originalEvent.previousRanges, rangesFor(originalState));
              assert.deepEqual(originalEvent.nextRanges, expected);
            }
            await assertProgress(fixture, operation === "mark" ? 4 : 0, 4);
            caseCount += 1;
          }
        }
      }
    }
  }
  assert.equal(caseCount, 108);
});

test("addition state product persists only modified Context and Global through the runtime", async () => {
  let caseCount = 0;
  for (const modifiedState of componentStates) {
    for (const globalState of componentStates) {
      for (const operation of ["mark", "unmark"] as const) {
        const fixture = createFixture(undefined, "new-1\nnew-2");
        seedComponents(fixture, { modified: modifiedState, global: globalState });
        const command = await openCommand(fixture, "modified", [cursor(0)]);
        const result = operation === "mark"
          ? await command.commands.markSelectionReviewed(command.editor)
          : await command.commands.unmarkSelectionReviewed(command.editor);
        const modifiedChanged = changedBy(modifiedState, operation);
        const globalChanged = changedBy(globalState, operation);
        const anyChanged = modifiedChanged || globalChanged;
        const expected = finalRanges(operation);

        assert.equal(result, anyChanged ? "applied" : "no-op");
        assert.equal(fixture.repository.commits, anyChanged ? 1 : 0);
        const contextFile = fixture.repository.current.contextState.files[fixture.fileId]!;
        assert.equal(Object.hasOwn(contextFile.originalReviewedByDiff, DIFF_ID), false);
        assert.deepEqual(contextFile.modifiedReviewed, expected);
        assert.deepEqual(fixture.repository.current.globalState.files[fixture.fileId]?.reviewed, expected);
        assert.deepEqual(eventSides(fixture.events), anyChanged ? ["modified"] : []);
        if (anyChanged) assert.equal(fixture.events[0]?.reason, "user-block-selection");
        await assertProgress(fixture, operation === "mark" ? 2 : 0, 2);
        caseCount += 1;
      }
    }
  }
  assert.equal(caseCount, 18);
});

test("deletion state product persists only original review state through the runtime", async () => {
  let caseCount = 0;
  for (const originalState of componentStates) {
    for (const operation of ["mark", "unmark"] as const) {
      const fixture = createFixture("old-1\nold-2", undefined);
      seedComponents(fixture, { original: originalState });
      const command = await openCommand(fixture, "original", [cursor(0)]);
      const result = operation === "mark"
        ? await command.commands.markSelectionReviewed(command.editor)
        : await command.commands.unmarkSelectionReviewed(command.editor);
      const changed = changedBy(originalState, operation);
      const expected = finalRanges(operation);

      assert.equal(result, changed ? "applied" : "no-op");
      assert.equal(fixture.repository.commits, changed ? 1 : 0);
      const contextFile = fixture.repository.current.contextState.files[fixture.fileId]!;
      assert.deepEqual(contextFile.originalReviewedByDiff[DIFF_ID] ?? [], expected);
      assert.deepEqual(contextFile.modifiedReviewed, []);
      assert.equal(fixture.repository.current.globalState.files[fixture.fileId], undefined);
      assert.deepEqual(eventSides(fixture.events), changed ? ["original"] : []);
      if (changed) assert.equal(fixture.events[0]?.reason, "user-block-selection");
      await assertProgress(fixture, operation === "mark" ? 2 : 0, 2);
      caseCount += 1;
    }
  }
  assert.equal(caseCount, 6);
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

const contextualOriginal = "prefix\nold-1\nmiddle\nold-2\nsuffix\n";
const contextualModified = "prefix\nnew-1\nmiddle\nnew-2\nsuffix\n";
const contextualPatch = [
  "diff --git a/src/example.ts b/src/example.ts",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -2 +2 @@",
  "-old-1",
  "+new-1",
  "@@ -4 +4 @@",
  "-old-2",
  "+new-2",
  "",
].join("\n");

const intervals = (...pairs: ReadonlyArray<readonly [number, number]>): LineInterval[] =>
  pairs.map(([startLine, endLineExclusive]) => ({ startLine, endLineExclusive }));
const reviewedRanges = (fixture: AcceptanceFixture) => {
  const contextFile = fixture.repository.current.contextState.files[fixture.fileId];
  return {
    original: contextFile?.originalReviewedByDiff[DIFF_ID] ?? [],
    modified: contextFile?.modifiedReviewed ?? [],
    global: fixture.repository.current.globalState.files[fixture.fileId]?.reviewed ?? [],
  };
};

const markSelectionCase = async (options: {
  readonly original: string | undefined;
  readonly modified: string | undefined;
  readonly mode: "side" | "block";
  readonly side: "original" | "modified";
  readonly selections: readonly TextSelection[];
  readonly patch?: string;
}) => {
  const fixture = createFixture(
    options.original,
    options.modified,
    options.patch ?? wholeFilePatch(options.original, options.modified),
    () => options.mode,
  );
  const command = await openCommand(fixture, options.side, options.selections);
  const result = await command.commands.markSelectionReviewed(command.editor);
  return { fixture, command, result };
};
type NormalCase = {
  readonly name: string;
  readonly original: string | undefined;
  readonly modified: string | undefined;
  readonly mode: "side" | "block";
  readonly side: "original" | "modified";
  readonly selections: readonly TextSelection[];
  readonly patch?: string;
  readonly expectedOriginal: readonly LineInterval[];
  readonly expectedModified: readonly LineInterval[];
  readonly expectedGlobal: readonly LineInterval[];
  readonly reviewed: number;
  readonly total: number;
  readonly historySides: readonly ("modified" | "original")[];
};

const normalCases: readonly NormalCase[] = [
  {
    name: "original changed line keeps side mode on the operated side",
    original: "old", modified: "new", mode: "side", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 1]), expectedModified: [], expectedGlobal: [],
    reviewed: 1, total: 2, historySides: ["original"],
  },
  {
    name: "modified changed line keeps side mode on the operated side",
    original: "old", modified: "new", mode: "side", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 1, total: 2, historySides: ["modified"],
  },
  {
    name: "partial replacement selection stays partial in side mode",
    original: "old-1\nold-2", modified: "new-1\nnew-2", mode: "side", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 1, total: 4, historySides: ["modified"],
  },
  {
    name: "partial replacement selection expands the complete block",
    original: "old-1\nold-2", modified: "new-1\nnew-2", mode: "block", side: "modified", selections: [cursor(0)],
    expectedOriginal: intervals([0, 2]), expectedModified: intervals([0, 2]), expectedGlobal: intervals([0, 2]),
    reviewed: 4, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "equal-size replacement expands both block sides",
    original: "old", modified: "new", mode: "block", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 1]), expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 2, total: 2, historySides: ["modified", "original"],
  },
  {
    name: "unequal replacement keeps a side selection narrow",
    original: "old-1\nold-2", modified: "new-1\nnew-2\nnew-3", mode: "side", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 1]), expectedModified: [], expectedGlobal: [],
    reviewed: 1, total: 5, historySides: ["original"],
  },
  {
    name: "unequal replacement expands complete original and modified blocks",
    original: "old-1\nold-2", modified: "new-1\nnew-2\nnew-3", mode: "block", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 2]), expectedModified: intervals([0, 3]), expectedGlobal: intervals([0, 3]),
    reviewed: 5, total: 5, historySides: ["modified", "original"],
  },
  {
    name: "addition expands only the existing modified side",
    original: undefined, modified: "new-1\nnew-2", mode: "block", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 2]), expectedGlobal: intervals([0, 2]),
    reviewed: 2, total: 2, historySides: ["modified"],
  },
  {
    name: "deletion expands only the existing original side",
    original: "old-1\nold-2", modified: undefined, mode: "block", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 2]), expectedModified: [], expectedGlobal: [],
    reviewed: 2, total: 2, historySides: ["original"],
  },
  {
    name: "original context-only selection stays out of change blocks",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "original", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 0, total: 4, historySides: ["modified"],
  },
  {
    name: "modified context-only selection stays out of change blocks",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 0, total: 4, historySides: ["modified"],
  },
  {
    name: "original changed and adjacent context selection merges mapped context with its block",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "original", selections: [selection(1, 0, 2, 1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([1, 3]), expectedGlobal: intervals([1, 3]),
    reviewed: 2, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "modified changed and adjacent context selection merges context with its block",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "modified", selections: [selection(1, 0, 2, 1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([1, 3]), expectedGlobal: intervals([1, 3]),
    reviewed: 2, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "one selection touching multiple blocks expands each block once",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "modified", selections: [selection(1, 0, 3, 1)],
    expectedOriginal: intervals([1, 2], [3, 4]), expectedModified: intervals([1, 4]), expectedGlobal: intervals([1, 4]),
    reviewed: 4, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "multiple selections touching one block deduplicate the block",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "modified", selections: [cursor(1), cursor(1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([1, 2]), expectedGlobal: intervals([1, 2]),
    reviewed: 2, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "multiple selections on different blocks keep the blocks independent",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "block", side: "modified", selections: [cursor(1), cursor(3)],
    expectedOriginal: intervals([1, 2], [3, 4]), expectedModified: intervals([1, 2], [3, 4]), expectedGlobal: intervals([1, 2], [3, 4]),
    reviewed: 4, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "addition side mode keeps a multi-line partial selection narrow",
    original: undefined, modified: "new-1\nnew-2", mode: "side", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 1, total: 2, historySides: ["modified"],
  },
  {
    name: "deletion side mode keeps a multi-line partial selection narrow",
    original: "old-1\nold-2", modified: undefined, mode: "side", side: "original", selections: [cursor(0)],
    expectedOriginal: intervals([0, 1]), expectedModified: [], expectedGlobal: [],
    reviewed: 1, total: 2, historySides: ["original"],
  },
  {
    name: "original context-only selection stays narrow in side mode",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "original", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 0, total: 4, historySides: ["modified"],
  },
  {
    name: "modified context-only selection stays narrow in side mode",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), expectedGlobal: intervals([0, 1]),
    reviewed: 0, total: 4, historySides: ["modified"],
  },
  {
    name: "original changed and adjacent context selection stays side-local",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "original", selections: [selection(1, 0, 2, 1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([2, 3]), expectedGlobal: intervals([2, 3]),
    reviewed: 1, total: 4, historySides: ["modified", "original"],
  },
  {
    name: "modified changed and adjacent context selection stays side-local",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "modified", selections: [selection(1, 0, 2, 1)],
    expectedOriginal: [], expectedModified: intervals([1, 3]), expectedGlobal: intervals([1, 3]),
    reviewed: 1, total: 4, historySides: ["modified"],
  },
  {
    name: "one selection touching multiple blocks stays narrow in side mode",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "modified", selections: [selection(1, 0, 3, 1)],
    expectedOriginal: [], expectedModified: intervals([1, 4]), expectedGlobal: intervals([1, 4]),
    reviewed: 2, total: 4, historySides: ["modified"],
  },
  {
    name: "multiple selections touching one block stay narrow in side mode",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "modified", selections: [cursor(1), cursor(1)],
    expectedOriginal: [], expectedModified: intervals([1, 2]), expectedGlobal: intervals([1, 2]),
    reviewed: 1, total: 4, historySides: ["modified"],
  },
  {
    name: "multiple selections on different blocks stay narrow in side mode",
    original: contextualOriginal, modified: contextualModified, patch: contextualPatch,
    mode: "side", side: "modified", selections: [cursor(1), cursor(3)],
    expectedOriginal: [], expectedModified: intervals([1, 2], [3, 4]), expectedGlobal: intervals([1, 2], [3, 4]),
    reviewed: 2, total: 4, historySides: ["modified"],
  },];

test("normal acceptance matrix preserves required side-mode scenarios", () => {
  const requiredNames = [
    "addition side mode keeps a multi-line partial selection narrow",
    "deletion side mode keeps a multi-line partial selection narrow",
    "original context-only selection stays narrow in side mode",
    "modified context-only selection stays narrow in side mode",
    "original changed and adjacent context selection stays side-local",
    "modified changed and adjacent context selection stays side-local",
    "one selection touching multiple blocks stays narrow in side mode",
    "multiple selections touching one block stay narrow in side mode",
    "multiple selections on different blocks stay narrow in side mode",
  ] as const;
  const names = new Set(normalCases.map((item) => item.name));
  assert.deepEqual(requiredNames.filter((name) => !names.has(name)), []);
});
test("normal selection cases persist the designed ranges with matching history and PR progress", async (t) => {
  for (const item of normalCases) {
    await t.test(item.name, async () => {
      const { fixture, result } = await markSelectionCase(item);
      assert.equal(result, "applied");
      assert.equal(fixture.repository.commits, 1);
      assert.deepEqual(reviewedRanges(fixture), {
        original: item.expectedOriginal,
        modified: item.expectedModified,
        global: item.expectedGlobal,
      });
      assert.deepEqual(eventSides(fixture.events), item.historySides);
      await assertProgress(fixture, item.reviewed, item.total);
    });
  }
});

test("whole-file review ignores the selection mode and keeps the legacy transaction", async () => {
  let modeReads = 0;
  const fixture = createFixture(contextualOriginal, contextualModified, contextualPatch, () => {
    modeReads += 1;
    return "block";
  });
  const command = await openCommand(fixture, "modified", [cursor(1)]);

  assert.equal(await command.commands.markFileReviewed(command.editor), "applied");
  assert.equal(modeReads, 0);
  assert.deepEqual(reviewedRanges(fixture), {
    original: intervals([1, 2], [3, 4]),
    modified: intervals([0, 6]),
    global: intervals([0, 6]),
  });
  assert.deepEqual(eventSides(fixture.events), ["modified", "original"]);
  await assertProgress(fixture, 4, 4);

  assert.equal(await command.commands.unmarkFileReviewed(command.editor), "applied");
  assert.equal(modeReads, 0);
  assert.deepEqual(reviewedRanges(fixture), { original: [], modified: [], global: [] });
  assert.deepEqual(eventSides(fixture.events), ["modified", "original", "modified", "original"]);
  await assertProgress(fixture, 0, 4);
  assert.equal(fixture.repository.commits, 2);
});
type BoundaryCase = {
  readonly name: string;
  readonly side: "original" | "modified";
  readonly selections: readonly TextSelection[];
  readonly expectedOriginal: readonly LineInterval[];
  readonly expectedModified: readonly LineInterval[];
  readonly reviewed: number;
  readonly historySides: readonly ("modified" | "original")[];
};

const boundaryCases: readonly BoundaryCase[] = [
  {
    name: "original changed-line cursor touches its block", side: "original", selections: [cursor(1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([1, 2]), reviewed: 2,
    historySides: ["modified", "original"],
  },
  {
    name: "modified changed-line cursor touches its block", side: "modified", selections: [cursor(1)],
    expectedOriginal: intervals([1, 2]), expectedModified: intervals([1, 2]), reviewed: 2,
    historySides: ["modified", "original"],
  },
  {
    name: "original context cursor uses only unchanged-line mapping", side: "original", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), reviewed: 0, historySides: ["modified"],
  },
  {
    name: "modified context cursor stays on modified context", side: "modified", selections: [cursor(0)],
    expectedOriginal: [], expectedModified: intervals([0, 1]), reviewed: 0, historySides: ["modified"],
  },
  {
    name: "original forward selection uses its normalized half-open range", side: "original",
    selections: [selection(1, 0, 2, 1)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
  {
    name: "original reverse selection normalizes to the same range", side: "original",
    selections: [selection(2, 1, 1, 0)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
  {
    name: "modified forward selection uses its normalized half-open range", side: "modified",
    selections: [selection(1, 0, 2, 1)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
  {
    name: "modified reverse selection normalizes to the same range", side: "modified",
    selections: [selection(2, 1, 1, 0)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
  {
    name: "original column-zero endpoint excludes the next block", side: "original",
    selections: [selection(1, 0, 3, 0)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
  {
    name: "modified column-zero endpoint excludes the next block", side: "modified",
    selections: [selection(1, 0, 3, 0)], expectedOriginal: intervals([1, 2]),
    expectedModified: intervals([1, 3]), reviewed: 2, historySides: ["modified", "original"],
  },
];

test("selection normalization applies the same block targets to mark and unmark", async (t) => {
  for (const item of boundaryCases) {
    await t.test(item.name, async () => {
      const fixture = createFixture(contextualOriginal, contextualModified, contextualPatch);
      const command = await openCommand(fixture, item.side, item.selections);

      assert.equal(await command.commands.markSelectionReviewed(command.editor), "applied");
      assert.deepEqual(reviewedRanges(fixture), {
        original: item.expectedOriginal,
        modified: item.expectedModified,
        global: item.expectedModified,
      });
      assert.deepEqual(eventSides(fixture.events), item.historySides);
      await assertProgress(fixture, item.reviewed, 4);

      assert.equal(await command.commands.unmarkSelectionReviewed(command.editor), "applied");
      assert.deepEqual(reviewedRanges(fixture), { original: [], modified: [], global: [] });
      assert.deepEqual(eventSides(fixture.events), [...item.historySides, ...item.historySides]);
      await assertProgress(fixture, 0, 4);
      assert.equal(fixture.repository.commits, 2);
    });
  }
});

test("empty selections on both sides are no-ops before a review session is opened", async () => {
  for (const side of ["original", "modified"] as const) {
    let modeReads = 0;
    const fixture = createFixture(contextualOriginal, contextualModified, contextualPatch, () => {
      modeReads += 1;
      return "block";
    });
    const command = await openCommand(fixture, side, []);

    assert.equal(await command.commands.markSelectionReviewed(command.editor), "no-op");
    assert.equal(await command.commands.unmarkSelectionReviewed(command.editor), "no-op");
    assert.equal(modeReads, 0);
    assert.equal(fixture.repository.commits, 0);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(reviewedRanges(fixture), { original: [], modified: [], global: [] });
    await assertProgress(fixture, 0, 4);
  }
});
type NewlineCase = {
  readonly name: string;
  readonly original: string | undefined;
  readonly modified: string | undefined;
  readonly side: "original" | "modified";
  readonly originalEditor: number;
  readonly originalContent: number;
  readonly modifiedEditor: number;
  readonly modifiedContent: number;
};

const newlineCases: readonly NewlineCase[] = [
  {
    name: "new file without terminal newline", original: undefined, modified: "new", side: "modified",
    originalEditor: 0, originalContent: 0, modifiedEditor: 1, modifiedContent: 1,
  },
  {
    name: "new file with LF", original: undefined, modified: "new\n", side: "modified",
    originalEditor: 0, originalContent: 0, modifiedEditor: 2, modifiedContent: 1,
  },
  {
    name: "new file with CRLF", original: undefined, modified: "new\r\n", side: "modified",
    originalEditor: 0, originalContent: 0, modifiedEditor: 2, modifiedContent: 1,
  },
  {
    name: "deleted file without terminal newline", original: "old", modified: undefined, side: "original",
    originalEditor: 1, originalContent: 1, modifiedEditor: 0, modifiedContent: 0,
  },
  {
    name: "deleted file with LF", original: "old\n", modified: undefined, side: "original",
    originalEditor: 2, originalContent: 1, modifiedEditor: 0, modifiedContent: 0,
  },
  {
    name: "deleted file with CRLF", original: "old\r\n", modified: undefined, side: "original",
    originalEditor: 2, originalContent: 1, modifiedEditor: 0, modifiedContent: 0,
  },
  {
    name: "replacement with terminal LF on both sides", original: "old\n", modified: "new\n", side: "modified",
    originalEditor: 2, originalContent: 1, modifiedEditor: 2, modifiedContent: 1,
  },
  {
    name: "replacement adding terminal LF", original: "old", modified: "new\n", side: "modified",
    originalEditor: 1, originalContent: 1, modifiedEditor: 2, modifiedContent: 1,
  },
  {
    name: "replacement removing terminal LF", original: "old\n", modified: "new", side: "modified",
    originalEditor: 2, originalContent: 1, modifiedEditor: 1, modifiedContent: 1,
  },
  {
    name: "existing empty file receives content", original: "", modified: "new", side: "modified",
    originalEditor: 1, originalContent: 0, modifiedEditor: 1, modifiedContent: 1,
  },
  {
    name: "existing file becomes empty", original: "old", modified: "", side: "original",
    originalEditor: 1, originalContent: 1, modifiedEditor: 1, modifiedContent: 0,
  },
  {
    name: "terminal newline only is added", original: "same", modified: "same\n", side: "modified",
    originalEditor: 1, originalContent: 1, modifiedEditor: 2, modifiedContent: 1,
  },
  {
    name: "terminal newline only is removed", original: "same\n", modified: "same", side: "original",
    originalEditor: 2, originalContent: 1, modifiedEditor: 1, modifiedContent: 1,
  },
];

test("newline and existence acceptance cases keep editor and Git-content ranges distinct", async (t) => {
  for (const item of newlineCases) {
    await t.test(item.name, async () => {
      const originalContract = lineContractFor(item.original);
      const modifiedContract = lineContractFor(item.modified);
      assert.deepEqual(
        [originalContract.editorLineCount, originalContract.diffContentLineCount],
        [item.originalEditor, item.originalContent],
      );
      assert.deepEqual(
        [modifiedContract.editorLineCount, modifiedContract.diffContentLineCount],
        [item.modifiedEditor, item.modifiedContent],
      );

      const fixture = createFixture(item.original, item.modified);
      const command = await openCommand(fixture, item.side, [cursor(0)]);
      const file = fixture.snapshot.files[0]!;
      const expectedOriginal = item.originalContent === 0 ? [] : intervals([0, item.originalContent]);
      const expectedModified = item.modifiedContent === 0 ? [] : intervals([0, item.modifiedContent]);
      const expectedHistorySides = [
        ...(item.modifiedContent === 0 ? [] : ["modified" as const]),
        ...(item.originalContent === 0 ? [] : ["original" as const]),
      ];

      assert.equal(await command.commands.markSelectionReviewed(command.editor), "applied");
      assert.deepEqual(reviewedRanges(fixture), {
        original: expectedOriginal,
        modified: expectedModified,
        global: expectedModified,
      });
      assert.deepEqual(eventSides(fixture.events), expectedHistorySides);
      await assertProgress(fixture, file.additions + file.deletions, file.additions + file.deletions);
      assert.equal(await command.commands.unmarkSelectionReviewed(command.editor), "applied");
      assert.deepEqual(reviewedRanges(fixture), { original: [], modified: [], global: [] });
      assert.deepEqual(eventSides(fixture.events), [...expectedHistorySides, ...expectedHistorySides]);
      await assertProgress(fixture, 0, file.additions + file.deletions);
      assert.equal(fixture.repository.commits, 2);
    });
  }
});

test("display-only trailing and existing-empty lines do not become change-block targets", async () => {
  for (const [original, modified, side, line] of [
    [undefined, "new\n", "modified", 1],
    ["", "new", "original", 0],
    ["old", "", "modified", 0],
  ] as const) {
    const fixture = createFixture(original, modified);
    const command = await openCommand(fixture, side, [cursor(line)]);
    assert.equal(await command.commands.markSelectionReviewed(command.editor), "no-op");
    assert.equal(await command.commands.unmarkSelectionReviewed(command.editor), "no-op");
    assert.equal(fixture.repository.commits, 0);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(reviewedRanges(fixture), { original: [], modified: [], global: [] });
    const file = fixture.snapshot.files[0]!;
    await assertProgress(fixture, 0, file.additions + file.deletions);
  }
});

test("selection mode changes apply from the next operation with matching persisted progress", async () => {
  let mode: "side" | "block" = "block";
  let modeReads = 0;
  const fixture = createFixture("old", "new", undefined, () => {
    modeReads += 1;
    return mode;
  });
  const modified = await openCommand(fixture, "modified", [cursor(0)]);

  assert.equal(await modified.commands.markSelectionReviewed(modified.editor), "applied");
  assert.deepEqual(reviewedRanges(fixture), {
    original: intervals([0, 1]), modified: intervals([0, 1]), global: intervals([0, 1]),
  });
  await assertProgress(fixture, 2, 2);

  mode = "side";
  assert.equal(await modified.commands.unmarkSelectionReviewed(modified.editor), "applied");
  assert.deepEqual(reviewedRanges(fixture), {
    original: intervals([0, 1]), modified: [], global: [],
  });
  await assertProgress(fixture, 1, 2);
  assert.equal(modeReads, 2);
  assert.deepEqual(eventSides(fixture.events), ["modified", "original", "modified"]);
  assert.deepEqual(
    fixture.events.map((event) => event.reason),
    ["user-block-selection", "user-block-selection", "user-selection"],
  );
  assert.equal(fixture.repository.commits, 2);
});

test("a Global-only block change commits history without changing the PR Progress numerator", async () => {
  const fixture = createFixture("old-1\nold-2", "new-1\nnew-2");
  seedComponents(fixture, { original: "reviewed", modified: "reviewed", global: "unreviewed" });
  await assertProgress(fixture, 4, 4);
  const command = await openCommand(fixture, "original", [cursor(0)]);

  assert.equal(await command.commands.markSelectionReviewed(command.editor), "applied");
  assert.equal(fixture.repository.commits, 1);
  assert.deepEqual(reviewedRanges(fixture), {
    original: intervals([0, 2]), modified: intervals([0, 2]), global: intervals([0, 2]),
  });
  assert.deepEqual(eventSides(fixture.events), ["modified"]);
  const event = fixture.events[0] as FileReviewHistoryEvent;
  assert.deepEqual(event.previousRanges, intervals([0, 2]));
  assert.deepEqual(event.nextRanges, intervals([0, 2]));
  assert.deepEqual(event.globalPreviousRanges, []);
  assert.deepEqual(event.globalNextRanges, intervals([0, 2]));
  await assertProgress(fixture, 4, 4);
});
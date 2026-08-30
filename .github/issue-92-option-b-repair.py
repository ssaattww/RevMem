from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MODULE = r'''import type { DiffHunk, LineInterval } from "../../core/contracts/index";
import { normalizeLineIntervals } from "../../core/intervals/index";

/** One contiguous original-side interval whose lines survive at a contiguous modified-side location. */
export interface OriginalIntervalMapping {
  readonly original: LineInterval;
  readonly modifiedStartLine: number;
}

/** Compatibility mapping used by the session-oriented projection API. */
export interface OriginalStartLineMapping {
  readonly originalStartLine: number;
  readonly modifiedStartLine: number;
  readonly lineCount: number;
}

export type OriginalToModifiedLineMapping = OriginalIntervalMapping | OriginalStartLineMapping;

/** Complete immutable original-side projection for one file comparison. */
export interface OriginalSideLineProjection {
  readonly originalToModifiedLineMappings: OriginalStartLineMapping[];
  readonly originalDeletionIntervals: LineInterval[];
}

/** Partition of one original-side selection into current-side and comparison-only review ranges. */
export interface OriginalSelectionReviewPlan {
  readonly modifiedIntervals: LineInterval[];
  readonly originalDeletionIntervals: LineInterval[];
}

const requireLineCount = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
};

const requireLineIndex = (value: number | undefined, expected: number, name: string): void => {
  if (value === undefined || value - 1 !== expected) {
    throw new Error(`${name} does not match the immutable diff cursor.`);
  }
};

const hunkStartIndex = (start: number, count: number, name: string): number => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`${name} contains an invalid hunk range.`);
  }
  const index = count === 0 ? start : start - 1;
  if (index < 0) throw new RangeError(`${name} contains an invalid hunk anchor.`);
  return index;
};

const appendIntervalMapping = (
  mappings: OriginalIntervalMapping[],
  originalStartLine: number,
  modifiedStartLine: number,
  length: number
): void => {
  if (length <= 0) return;
  const previous = mappings.at(-1);
  if (
    previous !== undefined &&
    previous.original.endLineExclusive === originalStartLine &&
    previous.modifiedStartLine + previous.original.endLineExclusive - previous.original.startLine === modifiedStartLine
  ) {
    mappings[mappings.length - 1] = {
      original: {
        startLine: previous.original.startLine,
        endLineExclusive: originalStartLine + length
      },
      modifiedStartLine: previous.modifiedStartLine
    };
    return;
  }
  mappings.push({
    original: { startLine: originalStartLine, endLineExclusive: originalStartLine + length },
    modifiedStartLine
  });
};

/**
 * Derives exact surviving-line mappings from a validated immutable diff.
 * Deletions and additions are intentionally not paired, including replacement blocks.
 */
export const createOriginalToModifiedLineMappings = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): OriginalIntervalMapping[] => {
  requireLineCount(input.originalLineCount, "originalLineCount");
  requireLineCount(input.modifiedLineCount, "modifiedLineCount");
  const mappings: OriginalIntervalMapping[] = [];
  let originalCursor = 0;
  let modifiedCursor = 0;

  for (const hunk of input.hunks) {
    const originalStart = hunkStartIndex(hunk.oldStart, hunk.oldCount, "original side");
    const modifiedStart = hunkStartIndex(hunk.newStart, hunk.newCount, "modified side");
    if (originalStart < originalCursor || modifiedStart < modifiedCursor) {
      throw new Error("Immutable diff hunks must be ordered and non-overlapping.");
    }
    const originalGap = originalStart - originalCursor;
    const modifiedGap = modifiedStart - modifiedCursor;
    if (originalGap !== modifiedGap) {
      throw new Error("Immutable diff gap does not preserve a one-to-one context mapping.");
    }
    appendIntervalMapping(mappings, originalCursor, modifiedCursor, originalGap);
    originalCursor = originalStart;
    modifiedCursor = modifiedStart;
    let consumedOriginal = 0;
    let consumedModified = 0;

    for (const line of hunk.lines) {
      if (line.kind === "context") {
        requireLineIndex(line.oldLine, originalCursor, "Context oldLine");
        requireLineIndex(line.newLine, modifiedCursor, "Context newLine");
        appendIntervalMapping(mappings, originalCursor, modifiedCursor, 1);
        originalCursor += 1;
        modifiedCursor += 1;
        consumedOriginal += 1;
        consumedModified += 1;
      } else if (line.kind === "deletion") {
        requireLineIndex(line.oldLine, originalCursor, "Deletion oldLine");
        originalCursor += 1;
        consumedOriginal += 1;
      } else {
        requireLineIndex(line.newLine, modifiedCursor, "Addition newLine");
        modifiedCursor += 1;
        consumedModified += 1;
      }
    }
    if (consumedOriginal !== hunk.oldCount || consumedModified !== hunk.newCount) {
      throw new Error("Immutable diff hunk body does not match its declared line counts.");
    }
  }

  if (originalCursor > input.originalLineCount || modifiedCursor > input.modifiedLineCount) {
    throw new Error("Immutable diff exceeds a document line count.");
  }
  const originalTail = input.originalLineCount - originalCursor;
  const modifiedTail = input.modifiedLineCount - modifiedCursor;
  if (originalTail !== modifiedTail) {
    throw new Error("Immutable diff tail does not preserve a one-to-one context mapping.");
  }
  appendIntervalMapping(mappings, originalCursor, modifiedCursor, originalTail);
  return mappings;
};

const intervalOf = (mapping: OriginalToModifiedLineMapping): LineInterval =>
  "original" in mapping
    ? mapping.original
    : {
      startLine: mapping.originalStartLine,
      endLineExclusive: mapping.originalStartLine + mapping.lineCount
    };

const intersectRanges = (
  left: readonly LineInterval[],
  right: readonly LineInterval[]
): LineInterval[] => normalizeLineIntervals(left.flatMap((selection) =>
  right.flatMap((candidate) => {
    const startLine = Math.max(selection.startLine, candidate.startLine);
    const endLineExclusive = Math.min(selection.endLineExclusive, candidate.endLineExclusive);
    return startLine < endLineExclusive ? [{ startLine, endLineExclusive }] : [];
  })
));

/** Splits original-side selections into mapped current lines and original-only deletion lines. */
export const createOriginalSelectionReviewPlan = (input: {
  readonly selections: readonly LineInterval[];
  readonly originalDeletionIntervals: readonly LineInterval[];
  readonly originalToModifiedLineMappings: readonly OriginalToModifiedLineMapping[];
}): OriginalSelectionReviewPlan => {
  const selections = normalizeLineIntervals(input.selections);
  const originalDeletionIntervals = intersectRanges(selections, input.originalDeletionIntervals);
  const modifiedIntervals = normalizeLineIntervals(selections.flatMap((selection) =>
    input.originalToModifiedLineMappings.flatMap((mapping) => {
      const original = intervalOf(mapping);
      const startLine = Math.max(selection.startLine, original.startLine);
      const endLineExclusive = Math.min(selection.endLineExclusive, original.endLineExclusive);
      if (startLine >= endLineExclusive) return [];
      const modifiedStartLine = mapping.modifiedStartLine + startLine - original.startLine;
      return [{
        startLine: modifiedStartLine,
        endLineExclusive: modifiedStartLine + endLineExclusive - startLine
      }];
    })
  ));
  return { modifiedIntervals, originalDeletionIntervals };
};

/** Builds the session-oriented projection shape while sharing the canonical mapping algorithm. */
export const buildOriginalSideLineProjection = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): OriginalSideLineProjection => ({
  originalToModifiedLineMappings: createOriginalToModifiedLineMappings(input).map((mapping) => ({
    originalStartLine: mapping.original.startLine,
    modifiedStartLine: mapping.modifiedStartLine,
    lineCount: mapping.original.endLineExclusive - mapping.original.startLine
  })),
  originalDeletionIntervals: normalizeLineIntervals(input.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) => line.kind === "deletion" && line.oldLine !== undefined
      ? [{ startLine: line.oldLine - 1, endLineExclusive: line.oldLine }]
      : [])
  ))
});

/** Applies selected original intervals to a previously validated session projection. */
export const projectOriginalSelectionIntervals = (
  selections: readonly LineInterval[],
  projection: Readonly<OriginalSideLineProjection>
): OriginalSelectionReviewPlan => createOriginalSelectionReviewPlan({
  selections,
  originalDeletionIntervals: projection.originalDeletionIntervals,
  originalToModifiedLineMappings: projection.originalToModifiedLineMappings
});
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")
    return text.replace(old, new, 1)


def update_index() -> None:
    path = ROOT / "src/application/review-commands/index.ts"
    text = path.read_text(encoding="utf-8")
    line = 'export * from "./original-selection-review-plan";\n'
    if line not in text:
        if not text.endswith("\n"):
            text += "\n"
        text += line
    path.write_text(text, encoding="utf-8")


def update_package() -> None:
    path = ROOT / "package.json"
    text = path.read_text(encoding="utf-8")
    old = '"when": "editorTextFocus && !isInDiffEditor"'
    new = '"when": "editorTextFocus && (!isInDiffEditor || (isInDiffEditor && reviewRange.prProgressDiffReviewActions))"'
    if old in text:
        if text.count(old) != 2:
            raise RuntimeError("selection menu condition must occur exactly twice")
        text = text.replace(old, new)
    parsed = json.loads(text)
    items = parsed["contributes"]["menus"]["editor/context"]
    if len(items) != 7:
        raise RuntimeError(f"editor/context must remain at 7 entries, found {len(items)}")
    entries = [
        "test-dist/test/unit/original-diff-selection-projection.test.js",
        "test-dist/test/unit/issue-92-pr-progress-selection-review.test.js",
    ]
    anchor = "test-dist/test/unit/diff-editor-review-command-service.test.js"
    for entry in entries:
        if entry not in text:
            if anchor not in text:
                raise RuntimeError("test:unit insertion anchor was not found")
            text = text.replace(anchor, f"{anchor} {entry}", 1)
    path.write_text(text, encoding="utf-8")


def update_service() -> None:
    path = ROOT / "src/application/review-commands/diff-editor-review-command-service.ts"
    text = path.read_text(encoding="utf-8")
    import_anchor = 'import { normalizeLineIntervals, selectionsToLineIntervals } from "../../core/intervals/index";\n'
    extra_import = 'import {\n  createOriginalSelectionReviewPlan,\n  type OriginalToModifiedLineMapping\n} from "./original-selection-review-plan";\n'
    if extra_import not in text:
        text = replace_once(text, import_anchor, import_anchor + extra_import, "selection projection import")

    session_anchor = '  readonly originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[];\n'
    session_field = '  /** Exact immutable mappings for original lines that still exist on the modified side. */\n  readonly originalToModifiedLineMappings: readonly OriginalToModifiedLineMapping[];\n'
    if session_field not in text:
        text = replace_once(text, session_anchor, session_anchor + session_field, "session projection field")

    start = text.index('  private async applySelectionOperation(')
    end = text.index('  private async applyWholeFileOperation(', start)
    replacement = r'''  private async applySelectionOperation(editor: Editor, operation: "mark" | "unmark"): Promise<DiffEditorReviewCommandResult> {
    const side = this.dependencies.getSide(editor);
    const lineCount = this.dependencies.getLineCount(editor);
    const intervals = selectionsToLineIntervals(this.dependencies.getSelections(editor), lineCount);
    if (intervals.length === 0) return "no-op";
    const session = await this.openMatchingSession(editor, side, lineCount);
    const common = {
      target: session.target,
      occurredAt: this.now().toISOString()
    };
    if (side === "modified") {
      const transaction = operation === "mark"
        ? markReviewedRanges({
          ...common,
          contextState: session.contextState,
          globalState: session.globalState,
          intervals
        })
        : unmarkReviewedRanges({
          ...common,
          contextState: session.contextState,
          globalState: session.globalState,
          intervals
        });
      return this.commitWhenChanged(transaction, session.committer);
    }

    const plan = createOriginalSelectionReviewPlan({
      selections: intervals,
      originalDeletionIntervals: session.originalDeletionIntervals,
      originalToModifiedLineMappings: session.originalToModifiedLineMappings
    });
    if (plan.modifiedIntervals.length === 0 && plan.originalDeletionIntervals.length === 0) return "no-op";

    const transactions: ReviewStateTransaction[] = [];
    let contextState = session.contextState;
    let globalState = session.globalState;
    if (plan.modifiedIntervals.length > 0) {
      const transaction = operation === "mark"
        ? markReviewedRanges({ ...common, contextState, globalState, intervals: plan.modifiedIntervals })
        : unmarkReviewedRanges({ ...common, contextState, globalState, intervals: plan.modifiedIntervals });
      if (hasSemanticChange(transaction)) {
        transactions.push(transaction);
        contextState = transaction.next.contextState;
        globalState = transaction.next.globalState;
      }
    }
    if (plan.originalDeletionIntervals.length > 0) {
      const originalInput = {
        ...common,
        contextState,
        globalState,
        side,
        diffId: canonicalDiffIdFor(session.contextState, session.diffId),
        originalLineCount: session.originalLineCount,
        intervals: plan.originalDeletionIntervals
      } as const;
      const transaction = operation === "mark"
        ? markOriginalReviewedRanges(originalInput)
        : unmarkOriginalReviewedRanges(originalInput);
      if (hasSemanticChange(transaction)) transactions.push(transaction);
    }
    return this.commitTransactionSequence(transactions, session.committer);
  }
'''
    text = text[:start] + replacement + text[end:]

    commit_anchor = '  private async commitWhenChanged(transaction: ReviewStateTransaction, committer: ReviewStateTransactionCommitter): Promise<DiffEditorReviewCommandResult> {'
    sequence = r'''  private async commitTransactionSequence(
    transactions: readonly ReviewStateTransaction[],
    committer: ReviewStateTransactionCommitter
  ): Promise<DiffEditorReviewCommandResult> {
    if (transactions.length === 0) return "no-op";
    const first = transactions[0];
    const last = transactions.at(-1);
    if (first === undefined || last === undefined) return "no-op";
    const combined: ReviewStateTransaction = {
      ...first,
      expected: first.expected,
      next: last.next
    };
    await commitReviewStateTransaction(combined, committer);
    for (const transaction of transactions) await this.dependencies.requestHistory(transaction);
    return "applied";
  }
'''
    if '  private async commitTransactionSequence(' not in text:
        text = replace_once(text, commit_anchor, sequence + commit_anchor, "transaction sequence helper")
    path.write_text(text, encoding="utf-8")


def update_runtime() -> None:
    path = ROOT / "src/t405-pull-request-review-runtime-base.ts"
    text = path.read_text(encoding="utf-8")
    import_old = '''import {
  DiffEditorReviewCommandService,
  type DiffEditorReviewCommandDependencies,
} from "./application/review-commands/index";'''
    import_new = '''import {
  createOriginalToModifiedLineMappings,
  DiffEditorReviewCommandService,
  type DiffEditorReviewCommandDependencies,
} from "./application/review-commands/index";'''
    if "createOriginalToModifiedLineMappings" not in text.split("from \"./application/review-commands/index\";")[0].splitlines()[-10:]:
        if import_old not in text:
            raise RuntimeError("runtime review command import was not found")
        text = text.replace(import_old, import_new, 1)

    if "originalToModifiedLineMappings:" not in text:
        marker_matches = list(re.finditer(r'(?m)^(?P<indent>\s*)originalDeletionIntervals:\s*diffFile\.hunks\.flatMap\([\s\S]*?^\s*\)\),$', text))
        if len(marker_matches) != 1:
            raise RuntimeError(f"runtime original deletion marker: expected 1, found {len(marker_matches)}")
        marker = marker_matches[0]
        indent = marker.group("indent")
        insertion = marker.group(0) + "\n" + (
            indent + "originalToModifiedLineMappings: createOriginalToModifiedLineMappings({\n" +
            indent + "  originalLineCount,\n" +
            indent + "  modifiedLineCount,\n" +
            indent + "  hunks: diffFile.hunks,\n" +
            indent + "}),"
        )
        text = text[:marker.start()] + insertion + text[marker.end():]
    path.write_text(text, encoding="utf-8")


def main() -> None:
    module = ROOT / "src/application/review-commands/original-selection-review-plan.ts"
    module.write_text(MODULE, encoding="utf-8")
    update_index()
    update_package()
    update_service()
    update_runtime()


if __name__ == "__main__":
    main()

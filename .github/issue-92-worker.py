from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DESIGN_SECTION = r'''
### 5.1.1 diff editorのoriginal側から選択した場合

PRのdiff editorでoriginal側を選択して確認済みまたは未確認へ変更した場合は、選択範囲をimmutable diffの対応関係に従って次の2種類へ分割する。

- modified側にも同一内容として存在するcontext行は、対応するmodified側行へ写像して`modifiedReviewed`およびGlobal確認済み状態を更新する。
- original側にしか存在しない削除行は、現在の`${baseSha}..${headSha}`をkeyとする`originalReviewedByDiff`を更新する。置換前の行も削除行として扱い、置換後の追加行へ推測で対応付けない。

行番号が同じという理由だけで対応付けてはならない。対応関係は、PR Progressが保持する検証済みのimmutable diff hunkにあるold/new座標と、hunk間の不変なcontext区間から決定する。対応が不明、矛盾、またはstaleな場合は状態を更新しない。

1回の選択操作でmodified側とoriginal側の両方が対象になる場合でも、Context、Global、および`originalReviewedByDiff`は1回のatomic state transactionとしてcommitする。どれか一部だけを更新した状態を許容しない。履歴イベントはstate commit成功後に、modified側、original側の順で記録する。

PRのbase SHAまたはhead SHAが更新された後、旧revision pairを表示したままのdiff tabからは確認操作を受理しない。現在登録されているcontext ID、file ID、base SHA、head SHA、各sideのrevision、および`originalDiffId`が一致する場合だけ操作できる。
'''.strip()

TEST_CONTENT = r'''import assert from "node:assert/strict";
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
'''

MODULE_CONTENT = r'''import type { DiffHunk, LineInterval } from "../../core/contracts/index";
import { normalizeLineIntervals } from "../../core/intervals/index";

/** One contiguous original-side interval whose lines survive at a contiguous modified-side location. */
export interface OriginalToModifiedLineMapping {
  readonly original: LineInterval;
  readonly modifiedStartLine: number;
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

const appendMapping = (
  mappings: OriginalToModifiedLineMapping[],
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
}): OriginalToModifiedLineMapping[] => {
  requireLineCount(input.originalLineCount, "originalLineCount");
  requireLineCount(input.modifiedLineCount, "modifiedLineCount");
  const mappings: OriginalToModifiedLineMapping[] = [];
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
    appendMapping(mappings, originalCursor, modifiedCursor, originalGap);
    originalCursor = originalStart;
    modifiedCursor = modifiedStart;
    let consumedOriginal = 0;
    let consumedModified = 0;

    for (const line of hunk.lines) {
      if (line.kind === "context") {
        requireLineIndex(line.oldLine, originalCursor, "Context oldLine");
        requireLineIndex(line.newLine, modifiedCursor, "Context newLine");
        appendMapping(mappings, originalCursor, modifiedCursor, 1);
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
  appendMapping(mappings, originalCursor, modifiedCursor, originalTail);
  return mappings;
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
      const startLine = Math.max(selection.startLine, mapping.original.startLine);
      const endLineExclusive = Math.min(selection.endLineExclusive, mapping.original.endLineExclusive);
      if (startLine >= endLineExclusive) return [];
      const modifiedStartLine = mapping.modifiedStartLine + startLine - mapping.original.startLine;
      return [{
        startLine: modifiedStartLine,
        endLineExclusive: modifiedStartLine + endLineExclusive - startLine
      }];
    })
  ));
  return { modifiedIntervals, originalDeletionIntervals };
};
'''


def require_once(text: str, needle: str, label: str) -> None:
    count = text.count(needle)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}")


def update_design(root: Path) -> None:
    path = root / "doc/design/vscode-review-range-tracker-design.md"
    text = path.read_text(encoding="utf-8")
    if DESIGN_SECTION in text:
        return
    if "VS Code レビュー範囲トラッカー 設計書 rev7" in text:
        text = text.replace("VS Code レビュー範囲トラッカー 設計書 rev7", "VS Code レビュー範囲トラッカー 設計書 rev8", 1)
    require_once(text, "### 5.2 選択範囲を解除する", "design insertion point")
    text = text.replace("### 5.2 選択範囲を解除する", DESIGN_SECTION + "\n\n### 5.2 選択範囲を解除する", 1)
    path.write_text(text, encoding="utf-8")


def write_tests(root: Path) -> None:
    path = root / "test/unit/issue-92-pr-progress-selection-review.test.ts"
    path.write_text(TEST_CONTENT, encoding="utf-8")


def update_package(root: Path) -> None:
    path = root / "package.json"
    text = path.read_text(encoding="utf-8")
    old = '"when": "editorTextFocus && !isInDiffEditor"'
    new = '"when": "editorTextFocus && (!isInDiffEditor || (isInDiffEditor && reviewRange.prProgressDiffReviewActions))"'
    count = text.count(old)
    if count not in (0, 2):
        raise RuntimeError(f"package selection menu condition: expected 2 old occurrences, found {count}")
    if count == 2:
        text = text.replace(old, new)
    parsed = json.loads(text)
    items = parsed["contributes"]["menus"]["editor/context"]
    if len(items) != 7:
        raise RuntimeError(f"editor/context must remain at 7 entries, found {len(items)}")
    path.write_text(text, encoding="utf-8")


def update_index(root: Path) -> None:
    path = root / "src/application/review-commands/index.ts"
    text = path.read_text(encoding="utf-8")
    line = 'export * from "./original-selection-review-plan";\n'
    if line not in text:
        if not text.endswith("\n"):
            text += "\n"
        text += line
    path.write_text(text, encoding="utf-8")


def update_service(root: Path) -> None:
    path = root / "src/application/review-commands/diff-editor-review-command-service.ts"
    text = path.read_text(encoding="utf-8")
    import_anchor = 'import { normalizeLineIntervals, selectionsToLineIntervals } from "../../core/intervals/index";\n'
    require_once(text, import_anchor, "service import anchor")
    extra_import = 'import {\n  createOriginalSelectionReviewPlan,\n  type OriginalToModifiedLineMapping\n} from "./original-selection-review-plan";\n'
    if extra_import not in text:
        text = text.replace(import_anchor, import_anchor + extra_import, 1)

    session_anchor = '  readonly originalDeletionIntervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[];\n'
    require_once(text, session_anchor, "session mapping anchor")
    session_field = '  /** Exact immutable mappings for original lines that still exist on the modified side. */\n  readonly originalToModifiedLineMappings: readonly OriginalToModifiedLineMapping[];\n'
    if session_field not in text:
        text = text.replace(session_anchor, session_anchor + session_field, 1)

    start = text.find('  private async applySelectionOperation(')
    end = text.find('  private async applyWholeFileOperation(', start)
    if start < 0 or end < 0:
        raise RuntimeError("selection operation method boundaries were not found")
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
    require_once(text, commit_anchor, "commit helper anchor")
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
        text = text.replace(commit_anchor, sequence + commit_anchor, 1)
    path.write_text(text, encoding="utf-8")


def update_runtime(root: Path) -> None:
    path = root / "src/t405-pull-request-review-runtime-base.ts"
    text = path.read_text(encoding="utf-8")
    import_old = '''import {\n  DiffEditorReviewCommandService,\n  type DiffEditorReviewCommandDependencies,\n} from "./application/review-commands/index";'''
    import_new = '''import {\n  createOriginalToModifiedLineMappings,\n  DiffEditorReviewCommandService,\n  type DiffEditorReviewCommandDependencies,\n} from "./application/review-commands/index";'''
    require_once(text, import_old, "runtime review-command import")
    text = text.replace(import_old, import_new, 1)

    if "originalToModifiedLineMappings:" in text:
        path.write_text(text, encoding="utf-8")
        return
    marker_matches = list(re.finditer(r'(?m)^(?P<indent>\s*)originalDeletionIntervals:\s*[^\n]+,\s*$', text))
    if len(marker_matches) != 1:
        raise RuntimeError(f"runtime session marker: expected 1, found {len(marker_matches)}")
    marker = marker_matches[0]
    prefix = text[max(0, marker.start() - 12000):marker.start()]

    file_names = re.findall(r'const\s+(\w+)\s*=\s*(?:registration\.)?snapshot\.files\.find', prefix)
    if not file_names:
        file_names = re.findall(r'const\s+(\w+)\s*=\s*registration\.snapshot\.files\.find', prefix)
    if not file_names:
        raise RuntimeError("runtime snapshot file variable was not found")
    snapshot_file = file_names[-1]

    state_names = re.findall(r'const\s+(\w+)\s*=\s*\w+\.contextState\.files\[[^\]]+\]', prefix)
    state_file = state_names[-1] if state_names else None
    if state_file is None:
        target_names = re.findall(r'const\s+(\w+)\s*:\s*ReviewStateFileTarget\s*=\s*\{', prefix)
        if not target_names:
            target_names = re.findall(r'const\s+(\w+)\s*=\s*\{[\s\S]{0,500}?lineCount:', prefix)
        if not target_names:
            raise RuntimeError("runtime modified line-count source was not found")
        modified_expr = f"{target_names[-1]}.lineCount"
    else:
        modified_expr = f"{state_file}.lineCount"

    indent = marker.group("indent")
    insertion = (
        marker.group(0) + "\n" +
        indent + "originalToModifiedLineMappings: createOriginalToModifiedLineMappings({\n" +
        indent + "  originalLineCount,\n" +
        indent + f"  modifiedLineCount: {modified_expr},\n" +
        indent + f"  hunks: {snapshot_file}.hunks,\n" +
        indent + "}),"
    )
    text = text[:marker.start()] + insertion + text[marker.end():]
    path.write_text(text, encoding="utf-8")


def implementation(root: Path) -> None:
    module = root / "src/application/review-commands/original-selection-review-plan.ts"
    module.write_text(MODULE_CONTENT, encoding="utf-8")
    update_index(root)
    update_package(root)
    update_service(root)
    update_runtime(root)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["design", "tests", "implementation"])
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.mode == "design":
        update_design(root)
    elif args.mode == "tests":
        write_tests(root)
    else:
        implementation(root)


if __name__ == "__main__":
    main()

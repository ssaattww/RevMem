import type { DiffHunk, LineInterval } from "../../core/contracts/index";
import { createOriginalToModifiedLineMappings } from "./original-selection-review-plan";

/** Contiguous changed ranges on one or both sides of one immutable diff hunk. */
export interface ChangeBlock {
  /** Deleted original-side lines, when this block is not addition-only. */
  readonly original?: LineInterval;
  /** Added modified-side lines, when this block is not deletion-only. */
  readonly modified?: LineInterval;
}

interface PendingChangeBlock {
  originalStartLine: number | undefined;
  originalEndLineExclusive: number | undefined;
  modifiedStartLine: number | undefined;
  modifiedEndLineExclusive: number | undefined;
}

const emptyPendingBlock = (): PendingChangeBlock => ({
  originalStartLine: undefined,
  originalEndLineExclusive: undefined,
  modifiedStartLine: undefined,
  modifiedEndLineExclusive: undefined,
});

const appendPendingBlock = (blocks: ChangeBlock[], pending: PendingChangeBlock): void => {
  if (pending.originalStartLine === undefined && pending.modifiedStartLine === undefined) return;
  const block: { original?: LineInterval; modified?: LineInterval } = {};
  if (pending.originalStartLine !== undefined && pending.originalEndLineExclusive !== undefined) {
    block.original = {
      startLine: pending.originalStartLine,
      endLineExclusive: pending.originalEndLineExclusive,
    };
  }
  if (pending.modifiedStartLine !== undefined && pending.modifiedEndLineExclusive !== undefined) {
    block.modified = {
      startLine: pending.modifiedStartLine,
      endLineExclusive: pending.modifiedEndLineExclusive,
    };
  }
  blocks.push(block);
};

/**
 * Derives change blocks from complete immutable hunk evidence.
 *
 * Context lines and hunk boundaries always end a block. Replacement sides are
 * retained as ranges in the same block without inferring a line-to-line match.
 */
export const deriveChangeBlocks = (input: {
  readonly originalLineCount: number;
  readonly modifiedLineCount: number;
  readonly hunks: readonly DiffHunk[];
}): ChangeBlock[] => {
  // Reuse the complete-diff cursor validation shared by unchanged-line mapping.
  // It rejects invalid counts, coordinates, unordered hunks, and unmatched tails.
  createOriginalToModifiedLineMappings(input);

  const blocks: ChangeBlock[] = [];
  for (const hunk of input.hunks) {
    let pending = emptyPendingBlock();
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        appendPendingBlock(blocks, pending);
        pending = emptyPendingBlock();
        continue;
      }
      if (line.kind === "deletion") {
        const startLine = line.oldLine! - 1;
        pending.originalStartLine ??= startLine;
        pending.originalEndLineExclusive = startLine + 1;
        continue;
      }
      const startLine = line.newLine! - 1;
      pending.modifiedStartLine ??= startLine;
      pending.modifiedEndLineExclusive = startLine + 1;
    }
    appendPendingBlock(blocks, pending);
  }
  return blocks;
};

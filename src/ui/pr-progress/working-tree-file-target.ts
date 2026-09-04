import type {
  PullRequestProgressTreeDiffTarget,
  PullRequestProgressTreeFileNode
} from "./pull-request-progress-tree-data-provider";

/** Validates a PR Progress node before opening its current working-tree file. */
export const requireWorkingTreeFileTarget = (
  node: PullRequestProgressTreeFileNode,
  isCurrent: boolean
): PullRequestProgressTreeDiffTarget => {
  if (!isCurrent) {
    throw new RangeError(
      "Selected PR progress node is stale and does not belong to the current snapshot."
    );
  }
  if (node.source.status === "deleted" || node.source.newPath === undefined) {
    throw new RangeError(
      "Deleted PR progress file does not exist in the working tree."
    );
  }
  return node.openTarget;
};

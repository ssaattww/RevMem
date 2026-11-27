import type { GitHubViewedSelectionRead } from "../review-contexts/github-viewed-selection-reader";
import type { PullRequestProgressTreeDataProvider } from "../../ui/pr-progress";
import { projectGitHubViewedCandidates } from "../../ui/pr-progress/github-viewed-candidate-projection";

/** Coordinates a transient Viewed overlay without storing or changing review progress. */
export class GitHubViewedDisplayController {
  private epoch = 0;
  private pending: AbortController | undefined;
  private localChanges = 0;

  public constructor(private readonly clear: () => void) {}

  public invalidate(): number {
    this.epoch += 1;
    this.pending?.abort();
    this.pending = undefined;
    this.clear();
    return this.epoch;
  }

  public beginLocalChange(): () => void {
    this.localChanges += 1;
    this.invalidate();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.localChanges -= 1;
      this.invalidate();
    };
  }

  public async read<T>(input: {
    readonly epoch: number;
    readonly enabled: boolean;
    readonly isSourceCurrent: () => boolean;
    readonly run: (context: {
      readonly generation: number;
      readonly isCurrent: () => boolean;
      readonly signal: AbortSignal;
    }) => Promise<T | undefined>;
    readonly publish: (value: T, current: () => boolean) => void;
  }): Promise<void> {
    if (!input.enabled || this.localChanges !== 0 ||
        input.epoch !== this.epoch || !input.isSourceCurrent()) return;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const isCurrent = (): boolean => !controller.signal.aborted &&
      this.localChanges === 0 && input.epoch === this.epoch && input.isSourceCurrent();
    try {
      const value = await input.run({ generation: input.epoch, isCurrent, signal: controller.signal });
      if (value !== undefined && isCurrent()) input.publish(value, isCurrent);
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }
}

/** Adapts the local-change guard for commands whose storage owner can differ from the selected context. */
export const beginGitHubViewedCommand = (begin: () => () => void, refresh: () => void) => {
  const end = begin();
  return (outcome: "settled" | "failed"): void => {
    end();
    if (outcome === "settled") refresh();
  };
};

/** Publishes the read-only overlay through the same tree used for local PR progress. */
export const publishGitHubViewedSelection = (input: {
  readonly result: GitHubViewedSelectionRead;
  readonly current: () => boolean;
  readonly progress: PullRequestProgressTreeDataProvider;
  readonly contextId: string;
  readonly number: number;
  readonly headSha: string;
  readonly baseSha: string;
  readonly originalDiffId: string;
  readonly generation: number;
  readonly fileCount: number;
}): boolean => {
  const { result, current, progress, contextId, number, headSha, baseSha, originalDiffId, generation, fileCount } = input;
  if (result.kind === "unavailable") {
    return progress.showGitHubViewedUnavailable(current);
  }
  const { viewer, read } = result;
  const files = progress.getChildren().flatMap(category =>
    progress.getChildren(category).filter(node => node.kind === "file"));
  const candidates = projectGitHubViewedCandidates({
    viewer, expectedViewerId: result.expectedViewerId, targetRepository: read.repository,
    selectedPullRequest: {
      nodeId: read.pullRequestNodeId, number: number,
      state: "open", repository: read.repository, headSha: headSha,
      comparisonBaseSha: baseSha, originalDiffId: originalDiffId, generation,
    },
    progressSnapshot: {
      contextId, repository: read.repository, pullRequestNumber: number,
      headSha: headSha, comparisonBaseSha: baseSha, originalDiffId: originalDiffId,
      generation, complete: files.length === fileCount,
    },
    viewedRead: read, files,
  });
  return progress.replaceGitHubViewedCandidates(candidates, current);
};

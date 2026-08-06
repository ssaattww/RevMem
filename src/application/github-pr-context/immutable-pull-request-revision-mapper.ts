import { mapRepositoryGlobalStateThroughGitDiff } from "../global-review-mapping/index";
import {
  applyGitFileStateTransitions,
  type GitFileStateTransitionInput,
  type GitNewFileStateInput,
} from "../../core/git-diff/index";
import type {
  PullRequestRevisionMapper,
  PullRequestRevisionMappingEvidence,
} from "./github-pull-request-context-layer-store";

/** Immutable diff/blob evidence required to remap reviewed ranges across one PR revision transition. */
export interface ImmutablePullRequestRevisionEvidence {
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly targetBaseSha: string;
  readonly targetHeadSha: string;
  readonly diff: string;
  readonly oldTexts: Readonly<Record<string, string>>;
  readonly newFiles: Readonly<Record<string, Readonly<GitNewFileStateInput>>>;
  readonly updatedAt?: string;
}

export type ImmutablePullRequestRevisionEvidenceLoader = (
  evidence: Readonly<PullRequestRevisionMappingEvidence>
) => Promise<ImmutablePullRequestRevisionEvidence>;

const DEFAULT_MAPPING_OPTIONS: GitFileStateTransitionInput["options"] = {
  ignoreWhitespaceChanges: false,
  ignoreEolChanges: false,
};

const requireMatchingEvidence = (
  expected: Readonly<PullRequestRevisionMappingEvidence>,
  actual: Readonly<ImmutablePullRequestRevisionEvidence>
): void => {
  if (
    actual.sourceBaseSha !== expected.sourceBaseSha ||
    actual.sourceHeadSha !== expected.sourceHeadSha ||
    actual.targetBaseSha !== expected.targetBaseSha ||
    actual.targetHeadSha !== expected.targetHeadSha
  ) {
    throw new Error("Immutable PR revision evidence does not match the requested revision transition");
  }
  if (actual.diff.length === 0) throw new Error("Immutable PR revision evidence requires a complete diff");
};

/**
 * Creates the T404 revision mapper that actually remaps reviewed ranges from immutable
 * base/head diff and blob/content evidence instead of merely advancing revision IDs.
 */
export function createImmutablePullRequestRevisionMapper(
  loadEvidence: ImmutablePullRequestRevisionEvidenceLoader,
  options: GitFileStateTransitionInput["options"] = DEFAULT_MAPPING_OPTIONS
): PullRequestRevisionMapper {
  return async ({ current, nextPullRequest, evidence }) => {
    const immutable = await loadEvidence(Object.freeze({ ...evidence }));
    requireMatchingEvidence(evidence, immutable);
    const updatedAt = immutable.updatedAt ?? new Date().toISOString();

    const contextTransition = applyGitFileStateTransitions({
      files: current.contextState.files,
      diff: immutable.diff,
      newRevisionId: evidence.targetHeadSha,
      updatedAt,
      options,
      oldTexts: immutable.oldTexts,
      newFiles: immutable.newFiles,
    });
    if (contextTransition.unresolved.length > 0) {
      throw new Error(`Immutable PR revision mapping is unresolved: ${contextTransition.unresolved.map((item) => item.reason).join(", ")}`);
    }

    const globalState = mapRepositoryGlobalStateThroughGitDiff({
      globalState: current.globalState,
      diff: immutable.diff,
      newRevisionId: evidence.targetHeadSha,
      updatedAt,
      options,
      oldTexts: immutable.oldTexts,
      newFiles: immutable.newFiles,
    });

    return {
      contextState: {
        ...current.contextState,
        pullRequest: { ...nextPullRequest },
        files: contextTransition.files,
        updatedAt,
      },
      globalState,
    };
  };
}

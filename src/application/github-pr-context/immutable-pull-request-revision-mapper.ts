import { mapRepositoryGlobalStateThroughGitDiff } from "../global-review-mapping/index";
import {
  applyGitFileStateTransitions,
  parseZeroContextGitDiff,
  type GitFileStateTransitionInput,
  type GitNewFileStateInput,
} from "../../core/git-diff/index";
import type { FileReviewState } from "../../core/contracts/index";
import type {
  PullRequestRevisionMapper,
  PullRequestRevisionMappingEvidence,
} from "./github-pull-request-context-layer-store";

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
  actual: Readonly<ImmutablePullRequestRevisionEvidence>,
  files: Readonly<Record<string, Readonly<FileReviewState>>>
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

  const trackedPaths = new Set(Object.values(files).map((file) => file.currentPath));
  for (const changed of parseZeroContextGitDiff(actual.diff).files) {
    const touchesTracked =
      (changed.oldPath !== undefined && trackedPaths.has(changed.oldPath)) ||
      (changed.newPath !== undefined && trackedPaths.has(changed.newPath));
    if (!touchesTracked) continue;
    if (changed.oldPath !== undefined && actual.oldTexts[changed.oldPath] === undefined) {
      throw new Error(`Immutable PR revision evidence is missing old blob text for ${changed.oldPath}`);
    }
    if (changed.newPath !== undefined) {
      const destination = actual.newFiles[changed.newPath];
      if (destination === undefined || destination.newText === undefined) {
        throw new Error(`Immutable PR revision evidence is missing new blob text for ${changed.newPath}`);
      }
    }
  }
};

const advanceRetainedContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string
): Record<string, FileReviewState> => Object.fromEntries(
  Object.entries(files).map(([fileId, file]) => [
    fileId,
    {
      ...file,
      revisionId,
      modifiedReviewed: file.modifiedReviewed.map((interval) => ({ ...interval })),
      originalReviewedByDiff: Object.fromEntries(
        Object.entries(file.originalReviewedByDiff).map(([diffId, intervals]) => [
          diffId,
          intervals.map((interval) => ({ ...interval })),
        ])
      ),
    },
  ])
);

/**
 * Creates the T404 revision mapper that remaps reviewed ranges from immutable
 * revision-bound diff and blob/content evidence.
 */
export function createImmutablePullRequestRevisionMapper(
  loadEvidence: ImmutablePullRequestRevisionEvidenceLoader,
  options: GitFileStateTransitionInput["options"] = DEFAULT_MAPPING_OPTIONS
): PullRequestRevisionMapper {
  return async ({ current, nextPullRequest, evidence }) => {
    const immutable = await loadEvidence(Object.freeze({ ...evidence }));
    requireMatchingEvidence(evidence, immutable, current.contextState.files);
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

    const contextFiles = advanceRetainedContextFiles(contextTransition.files, evidence.targetHeadSha);
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
        files: contextFiles,
        updatedAt,
      },
      globalState,
    };
  };
}

import type { ReviewStateRepositoryTarget } from "./adapters/state-repository/index";
import type { GitDiffMappingOptions } from "./core/git-diff/index";
import { REVIEW_RANGE_SCHEMA_VERSION, type RepositoryGlobalState } from "./core/contracts/index";
import { type GitContextRevisionMapper, type ResolvedGitReviewContext } from "./application/review-context/index";

const PATH_SEMANTICS = process.platform === "win32" ? "windows" as const : "posix" as const;

export interface T405GlobalStateRepository {
  loadGlobal(target: ReviewStateRepositoryTarget): Promise<RepositoryGlobalState | undefined>;
}

export interface PreparedNewPullRequestGlobal {
  readonly expectedGlobalState: RepositoryGlobalState | undefined;
  readonly nextGlobalState: RepositoryGlobalState;
}

/** Composes the new pull-request Global snapshot with the live opened-document encoding hints. */
export const currentGlobalForNewPullRequest = async (
  repository: T405GlobalStateRepository,
  current: ResolvedGitReviewContext,
  mapper: GitContextRevisionMapper,
  mappingOptions: Readonly<GitDiffMappingOptions>,
  encodingHintsByPath: Readonly<Record<string, string>>,
): Promise<PreparedNewPullRequestGlobal> => {
  const expectedGlobalState = await repository.loadGlobal({
    kind: "git",
    repositoryId: current.repositoryId,
    contextId: "review-contexts-current-global",
  });
  if (expectedGlobalState === undefined) {
    return {
      expectedGlobalState: undefined,
      nextGlobalState: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        repositoryId: current.repositoryId,
        currentRevisionId: current.revisionId,
        files: {},
        updatedAt: new Date().toISOString(),
      },
    };
  }
  if (expectedGlobalState.currentRevisionId === current.revisionId) {
    return { expectedGlobalState, nextGlobalState: expectedGlobalState };
  }
  const branch = current.contextState.branch;
  if (branch === undefined) throw new Error("Git revision mapping requires branch-schema persistence.");
  const mapped = await mapper.map({
    current,
    contextState: {
      ...current.contextState,
      branch: { ...branch, headRevision: expectedGlobalState.currentRevisionId },
      files: {},
      updatedAt: expectedGlobalState.updatedAt,
    },
    globalState: expectedGlobalState,
    fileSystemPathSemantics: PATH_SEMANTICS,
    options: mappingOptions,
    encodingHintsByPath,
  });
  return { expectedGlobalState, nextGlobalState: mapped.globalState };
};

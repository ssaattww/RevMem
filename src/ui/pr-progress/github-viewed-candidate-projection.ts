import type { GitHubRepositoryIdentity } from "../../application/github-pr-context/index";
import type { PullRequestDiffFileProgress } from "../../core/pr-progress/index";
import type {
  PullRequestProgressTreeCategory,
  PullRequestProgressTreeFileNode
} from "./pull-request-progress-tree-data-provider";

import type { GitHubViewedChangedFile, GitHubViewedReadSnapshot, GitHubViewedSelectedPullRequest, GitHubViewedState, GitHubViewedViewer } from "../../application/github-pr-context/github-viewed-contracts";
export type { GitHubViewedChangedFile, GitHubViewedReadSnapshot, GitHubViewedSelectedPullRequest, GitHubViewedState, GitHubViewedViewer } from "../../application/github-pr-context/github-viewed-contracts";

/** Current immutable local PR Progress snapshot identity. */
export interface GitHubViewedProgressSnapshot {
  readonly contextId: string;
  readonly repository: GitHubRepositoryIdentity;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly comparisonBaseSha: string;
  readonly originalDiffId: string;
  readonly generation: number;
  readonly complete: boolean;
}

/** A read-only label, not evidence that the local review belongs to the GitHub viewer. */
export interface GitHubViewedCandidate {
  readonly fileId: string;
  readonly path: string;
  readonly localCategory: PullRequestProgressTreeCategory;
  readonly viewedState: GitHubViewedState;
  readonly synchronizationEligible: false;
}

export interface ProjectGitHubViewedCandidatesInput {
  /** Undefined means authentication or viewer identity is unknown. */
  readonly viewer: GitHubViewedViewer | undefined;
  /** Viewer ID bound to the account-specific setting for this repository. */
  readonly expectedViewerId: string | undefined;
  readonly targetRepository: GitHubRepositoryIdentity;
  readonly selectedPullRequest: GitHubViewedSelectedPullRequest | undefined;
  readonly progressSnapshot: GitHubViewedProgressSnapshot | undefined;
  readonly viewedRead: GitHubViewedReadSnapshot | undefined;
  /** Existing Tree classification and authoritative progress record. */
  readonly files: readonly Pick<PullRequestProgressTreeFileNode, "category" | "source">[];
}

const normalizedRepository = (
  repository: GitHubRepositoryIdentity
): string =>
  `${repository.host.toLowerCase()}/${repository.owner.toLowerCase()}/${repository.repository.toLowerCase()}`;

const sameRepository = (
  left: GitHubRepositoryIdentity,
  right: GitHubRepositoryIdentity
): boolean => normalizedRepository(left) === normalizedRepository(right);

const sameSelectedSnapshot = (
  selected: GitHubViewedSelectedPullRequest,
  snapshot: GitHubViewedProgressSnapshot
): boolean =>
  selected.repository !== undefined &&
  sameRepository(selected.repository, snapshot.repository) &&
  selected.number === snapshot.pullRequestNumber &&
  selected.headSha === snapshot.headSha &&
  selected.comparisonBaseSha === snapshot.comparisonBaseSha &&
  selected.originalDiffId === snapshot.originalDiffId &&
  selected.generation === snapshot.generation;

const isPathUnambiguous = (
  file: PullRequestDiffFileProgress,
  remote: GitHubViewedChangedFile
): boolean => {
  // Renames and copies need a separate identity contract. Do not infer their
  // GitHub path from oldPath/newPath or from a display label.
  if (file.status === "renamed" || file.status === "copied") return false;

  // Added/deleted files have one present path. Modified files must have the
  // same path on both sides. This accepts only a literal path match.
  const expectedPath = file.status === "added"
    ? file.newPath
    : file.status === "deleted"
      ? file.oldPath
      : file.status === "modified" && file.oldPath === file.newPath
        ? file.newPath
        : undefined;

  return expectedPath !== undefined &&
    expectedPath === file.path &&
    remote.path === expectedPath &&
    remote.status === file.status &&
    remote.additions === file.additions &&
    remote.deletions === file.deletions;
};

/**
 * Projects only current, unambiguous local completed files with a complete
 * GitHub read for the authorized viewer and exact selected PR snapshot.
 *
 * This function performs no I/O and cannot update GitHub.
 */
export const projectGitHubViewedCandidates = (
  input: Readonly<ProjectGitHubViewedCandidatesInput>
): readonly GitHubViewedCandidate[] => {
  const viewer = input.viewer;
  const selected = input.selectedPullRequest;
  const snapshot = input.progressSnapshot;
  const viewedRead = input.viewedRead;

  if (
    viewer === undefined ||
    viewer.id.length === 0 ||
    viewer.login.length === 0 ||
    viewer.host.length === 0 ||
    input.expectedViewerId === undefined ||
    input.expectedViewerId.length === 0 ||
    viewer.id !== input.expectedViewerId ||
    viewer.host.toLowerCase() !== input.targetRepository.host.toLowerCase() ||
    selected === undefined ||
    selected.state !== "open" ||
    !sameRepository(selected.repository, input.targetRepository) ||
    snapshot === undefined ||
    !snapshot.complete ||
    !sameRepository(snapshot.repository, input.targetRepository) ||
    !sameSelectedSnapshot(selected, snapshot) ||
    viewedRead === undefined ||
    !viewedRead.complete ||
    viewedRead.viewerId !== viewer.id ||
    viewedRead.pullRequestNodeId !== selected.nodeId ||
    viewedRead.pullRequestNumber !== selected.number ||
    viewedRead.state !== "open" ||
    !sameRepository(viewedRead.repository, input.targetRepository) ||
    viewedRead.headSha !== snapshot.headSha ||
    viewedRead.comparisonBaseSha !== snapshot.comparisonBaseSha ||
    viewedRead.originalDiffId !== snapshot.originalDiffId ||
    viewedRead.generation !== snapshot.generation
  ) {
    return [];
  }

  const localCompletedFiles = input.files.filter(({ category, source }) =>
    category === "completed" &&
    !source.excluded &&
    source.totalLineCount > 0 &&
    source.reviewedLineCount === source.totalLineCount &&
    source.path.length > 0
  );

  // All files, including excluded or not yet reviewed ones, must account for
  // the same diff. We cannot certify an exact diff from a matching subset.
  if (input.files.length !== viewedRead.files.length) return [];
  const remoteByPath = new Map<string, GitHubViewedChangedFile>();
  for (const remote of viewedRead.files) {
    if (remoteByPath.has(remote.path)) return [];
    remoteByPath.set(remote.path, remote);
  }
  const localPaths = new Set<string>();
  for (const { source } of input.files) {
    if (localPaths.has(source.path)) return [];
    localPaths.add(source.path);
    const remote = remoteByPath.get(source.path);
    if (remote === undefined || !isPathUnambiguous(source, remote)) return [];
  }

  const candidates: GitHubViewedCandidate[] = [];
  for (const { category, source } of localCompletedFiles) {
    const remote = remoteByPath.get(source.path);
    if (remote === undefined) continue;
    candidates.push(Object.freeze({
      fileId: source.fileId,
      path: source.path,
      localCategory: category,
      viewedState: remote.viewedState,
      synchronizationEligible: false
    }));
  }

  return Object.freeze(candidates);
};

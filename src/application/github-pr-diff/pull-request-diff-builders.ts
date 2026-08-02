export {
  buildSnapshotFromFileContents,
  type PullRequestFileContents
} from "./content-diff-builder";
export { buildSnapshotFromGitHubPatches } from "./github-patch-diff-builder";
export { buildSnapshotFromLocalGitDiff } from "./local-git-diff-builder";
export type { PullRequestDiffBuildResult } from "./snapshot-builder-shared";

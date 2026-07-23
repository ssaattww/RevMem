/** Public Local Git Adapter API for workspace-side Git inspection. */
export {
  GitCommandFailedError,
  GitExecutableNotFoundError
} from "./contracts";
export { normalizeGitRemoteUrl } from "./git-remote-normalization";
export { LocalGitAdapter } from "./local-git-adapter";
export {
  NodeGitCommandExecutor,
  type NodeGitCommandExecutorOptions
} from "./node-git-command-executor";

export type {
  GitCommandExecutor,
  GitCommandInvocation,
  GitCommandResult,
  LocalGitBranchRef,
  LocalGitBranchState,
  LocalGitDetachedHead,
  LocalGitNonRepositoryInspection,
  LocalGitRemote,
  LocalGitRepository,
  LocalGitRepositoryInspection,
  LocalGitRepositoryInspectionSuccess,
  LocalGitUnavailableInspection
} from "./contracts";

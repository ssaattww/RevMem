/** Public Local Git Adapter API for workspace-side Git inspection. */
export {
  GitCommandFailedError,
  GitExecutableNotFoundError
} from "./contracts";
export { normalizeGitRemoteUrl } from "./git-remote-normalization";
export { LocalGitAdapter } from "./local-git-adapter";
export { LocalGitPullRequestDiffAdapter } from "./local-git-pull-request-diff-adapter";
export {
  NodeGitBlobReader,
  type NodeGitBlobReaderOptions
} from "./node-git-blob-reader";
export {
  NodeGitCommandExecutor,
  type NodeGitCommandExecutorOptions
} from "./node-git-command-executor";
export {
  createNodeLocalGitAdapter,
  type NodeLocalGitAdapterOptions
} from "./node-local-git-adapter";

export type { GitBlobReader } from "./git-blob-reader";
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
export type {
  LocalGitRevisionTextFound,
  LocalGitRevisionTextInvalidEncoding,
  LocalGitRevisionTextMissingFile,
  LocalGitRevisionTextMissingRevision,
  LocalGitRevisionTextReadResult
} from "./revision-text-content";

/** One direct Git process invocation without a shell command string. */
export interface GitCommandInvocation {
  /** Git arguments passed as distinct process arguments. */
  readonly argumentsList: readonly string[];
  /** Working directory used to resolve the repository context. */
  readonly cwd?: string;
}

/** Captured result from one completed Git process. */
export interface GitCommandResult {
  /** Process exit code. */
  readonly exitCode: number;
  /** Standard output decoded as UTF-8. */
  readonly stdout: string;
  /** Standard error decoded as UTF-8. */
  readonly stderr: string;
}

/** Injectable boundary used by unit tests and the Node Extension Host adapter. */
export interface GitCommandExecutor {
  /** Executes one Git invocation using an argument array. */
  execute(invocation: GitCommandInvocation): Promise<GitCommandResult>;
}

/** Error raised when the configured Git executable cannot be started. */
export class GitExecutableNotFoundError extends Error {
  /** Executable name or path that could not be resolved. */
  public readonly executable: string;

  /** Creates a not-installed/not-found classification for Git discovery. */
  public constructor(executable: string, options?: ErrorOptions) {
    super(`Git executable was not found: ${executable}`, options);
    this.name = "GitExecutableNotFoundError";
    this.executable = executable;
  }
}

/** Error raised when a required Git command exits unsuccessfully. */
export class GitCommandFailedError extends Error {
  /** Invocation that failed. */
  public readonly invocation: GitCommandInvocation;
  /** Captured process result. */
  public readonly result: GitCommandResult;

  /** Creates a diagnostic failure while preserving arguments and output separately. */
  public constructor(
    invocation: GitCommandInvocation,
    result: GitCommandResult
  ) {
    super(
      `Git command failed with exit code ${result.exitCode}: ${invocation.argumentsList.join(" ")}`
    );
    this.name = "GitCommandFailedError";
    this.invocation = {
      cwd: invocation.cwd,
      argumentsList: [...invocation.argumentsList]
    };
    this.result = { ...result };
  }
}

/** Remote selected as the stable repository identity source. */
export interface LocalGitRemote {
  /** Remote name, preferring `origin` when present. */
  readonly name: string;
  /** Exact URL returned by Git. */
  readonly rawUrl: string;
  /** Credential-free canonical remote identity. */
  readonly normalizedUrl: string;
}

/** Attached branch metadata with the complete `refs/heads/...` name. */
export interface LocalGitBranchRef {
  /** Discriminator for an attached branch. */
  readonly kind: "branch";
  /** Complete symbolic ref returned by Git. */
  readonly fullRef: string;
}

/** Detached-HEAD metadata. */
export interface LocalGitDetachedHead {
  /** Discriminator for a detached HEAD. */
  readonly kind: "detached";
}

/** Current branch attachment state. */
export type LocalGitBranchState = LocalGitBranchRef | LocalGitDetachedHead;

/** Stable information resolved from one local Git working tree. */
export interface LocalGitRepository {
  /** Git version used for the inspection. */
  readonly gitVersion: string;
  /** Absolute top-level working-tree path. */
  readonly rootPath: string;
  /** Normalized remote URL, or a hashed root URI when no remote exists. */
  readonly repositoryId: string;
  /** Selected identity remote when at least one remote exists. */
  readonly remote?: LocalGitRemote;
  /** Attached full branch ref or detached state. */
  readonly branch: LocalGitBranchState;
  /** Commit object currently named by HEAD; absent for an unborn branch. */
  readonly head?: string;
}

/** Git is unavailable in the workspace-side Extension Host. */
export interface LocalGitUnavailableInspection {
  /** Outcome discriminator. */
  readonly kind: "git-unavailable";
  /** Executable name or path that could not be started. */
  readonly executable: string;
}

/** Git exists, but the inspected path is not inside a working tree. */
export interface LocalGitNonRepositoryInspection {
  /** Outcome discriminator. */
  readonly kind: "not-repository";
  /** Installed Git version. */
  readonly gitVersion: string;
}

/** Git working-tree inspection succeeded. */
export interface LocalGitRepositoryInspectionSuccess {
  /** Outcome discriminator. */
  readonly kind: "repository";
  /** Resolved local repository information. */
  readonly repository: LocalGitRepository;
}

/** Complete outcome of local Git discovery. */
export type LocalGitRepositoryInspection =
  | LocalGitUnavailableInspection
  | LocalGitNonRepositoryInspection
  | LocalGitRepositoryInspectionSuccess;

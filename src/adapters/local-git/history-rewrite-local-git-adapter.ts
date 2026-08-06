import {
  GitCommandFailedError,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult
} from "./contracts";
import type { GitBlobReader } from "./git-blob-reader";
import { LocalGitAdapter as BaseLocalGitAdapter } from "./local-git-adapter";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * Extends the existing Local Git metadata adapter with complete immutable tree
 * enumeration used only for history-rewrite rename recovery.
 */
export class LocalGitAdapter extends BaseLocalGitAdapter {
  public constructor(
    private readonly treeCommandExecutor: GitCommandExecutor,
    blobReader: GitBlobReader
  ) {
    super(treeCommandExecutor, blobReader);
  }

  /**
   * Lists every path at one exact commit using NUL framing.
   *
   * `undefined` means the commit is absent. An empty array is a proven empty tree.
   */
  public async listFilePathsAtRevision(
    repositoryRoot: string,
    revision: string
  ): Promise<readonly string[] | undefined> {
    const root = requireRoot(repositoryRoot);
    const object = requireObjectId(revision);
    const revisionInvocation: GitCommandInvocation = {
      cwd: root,
      argumentsList: [
        "rev-parse",
        "--verify",
        "--quiet",
        `${object}^{commit}`
      ]
    };
    const revisionResult = await this.treeCommandExecutor.execute(revisionInvocation);
    if (revisionResult.exitCode === 1) {
      return undefined;
    }
    requireSuccess(revisionInvocation, revisionResult);
    if (firstNonEmptyLine(revisionResult.stdout) !== object) {
      throw new GitCommandFailedError(revisionInvocation, {
        ...revisionResult,
        exitCode: 1,
        stderr: revisionResult.stderr.length > 0
          ? revisionResult.stderr
          : "git rev-parse returned an unexpected object ID"
      });
    }

    const treeInvocation: GitCommandInvocation = {
      cwd: root,
      argumentsList: [
        "ls-tree",
        "--full-tree",
        "-r",
        "--name-only",
        "-z",
        object,
        "--"
      ]
    };
    const treeResult = await this.treeCommandExecutor.execute(treeInvocation);
    requireSuccess(treeInvocation, treeResult);
    return parseNulTerminatedPaths(treeResult.stdout);
  }
}

function requireRoot(value: string): string {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path without null characters");
  }
  return value;
}

function requireObjectId(value: string): string {
  if (!FULL_OBJECT_ID.test(value)) {
    throw new TypeError(
      "revision must be a lowercase full SHA-1 or SHA-256 commit object ID"
    );
  }
  return value;
}

function requireSuccess(
  invocation: GitCommandInvocation,
  result: GitCommandResult
): void {
  if (result.exitCode !== 0) {
    throw new GitCommandFailedError(invocation, result);
  }
}

function firstNonEmptyLine(output: string): string | undefined {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function parseNulTerminatedPaths(output: string): readonly string[] {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith("\0")) {
    throw new Error("git ls-tree path output is not NUL terminated");
  }
  const paths = output.slice(0, -1).split("\0");
  const seen = new Set<string>();
  for (const path of paths) {
    if (path.length === 0 || path.includes("\0")) {
      throw new Error("git ls-tree returned an empty or invalid path");
    }
    if (seen.has(path)) {
      throw new Error("git ls-tree returned duplicate path evidence");
    }
    seen.add(path);
  }
  return paths;
}

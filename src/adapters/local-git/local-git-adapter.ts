import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult,
  type LocalGitBranchState,
  type LocalGitRemote,
  type LocalGitRepositoryInspection
} from "./contracts";
import { normalizeGitRemoteUrl } from "./git-remote-normalization";

const requirePath = (value: string, name: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty path without null characters`);
  }

  return value;
};

const requireRevision = (value: string, name: string): string => {
  if (
    value.trim().length === 0 ||
    value.startsWith("-") ||
    value.includes("\0") ||
    /[\r\n]/u.test(value)
  ) {
    throw new TypeError(
      `${name} must be a non-empty Git revision that cannot be parsed as an option`
    );
  }

  return value;
};

const firstOutputLine = (output: string, name: string): string => {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);

  if (line === undefined) {
    throw new Error(`${name} did not produce a value`);
  }

  return line;
};

const parseGitVersion = (stdout: string): string => {
  const line = firstOutputLine(stdout, "git --version");
  const match = /^git version\s+(.+)$/iu.exec(line);
  if (match === null || match[1]!.trim().length === 0) {
    throw new Error(`Unsupported Git version output: ${line}`);
  }

  return match[1]!.trim();
};

const splitOutputLines = (stdout: string): string[] =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const rootRepositoryId = (rootPath: string): string => {
  const canonicalRootUri = pathToFileURL(path.resolve(rootPath)).href;
  const digest = createHash("sha256")
    .update(`git-root\0${canonicalRootUri}`, "utf8")
    .digest("hex");
  return `git-root:${digest}`;
};

const isMissingValueExit = (result: GitCommandResult): boolean =>
  result.exitCode === 1 || result.exitCode === 128;

/**
 * Reads stable repository identity and revision metadata through local Git only.
 *
 * This adapter is independent from GitHub authentication and API availability.
 * All process execution is delegated as argument arrays to `GitCommandExecutor`.
 */
export class LocalGitAdapter {
  /** Creates the adapter with an injectable direct-process execution boundary. */
  public constructor(private readonly commandExecutor: GitCommandExecutor) {}

  /**
   * Inspects a path and distinguishes missing Git, non-Git folders, and repositories.
   *
   * @param startPath Workspace-side path at or below a possible repository root.
   * @returns A discriminated result containing stable local Git metadata.
   */
  public async inspectRepository(
    startPath: string
  ): Promise<LocalGitRepositoryInspection> {
    const inspectedPath = requirePath(startPath, "startPath");
    let versionResult: GitCommandResult;

    try {
      versionResult = await this.execute(undefined, ["--version"]);
    } catch (error) {
      if (error instanceof GitExecutableNotFoundError) {
        return {
          kind: "git-unavailable",
          executable: error.executable
        };
      }

      throw error;
    }

    this.requireSuccess(
      { cwd: undefined, argumentsList: ["--version"] },
      versionResult
    );
    const gitVersion = parseGitVersion(versionResult.stdout);
    const rootResult = await this.execute(inspectedPath, [
      "rev-parse",
      "--show-toplevel"
    ]);

    if (rootResult.exitCode !== 0) {
      return {
        kind: "not-repository",
        gitVersion
      };
    }

    const rootPath = path.resolve(firstOutputLine(rootResult.stdout, "repository root"));
    const remote = await this.resolveIdentityRemote(rootPath);
    const branch = await this.resolveBranchState(rootPath);
    const head = await this.resolveHead(rootPath);

    return {
      kind: "repository",
      repository: {
        gitVersion,
        rootPath,
        repositoryId: remote?.normalizedUrl ?? rootRepositoryId(rootPath),
        ...(remote === undefined ? {} : { remote }),
        branch,
        ...(head === undefined ? {} : { head })
      }
    };
  }

  /**
   * Finds one best common ancestor for two revisions.
   *
   * @returns The merge-base object ID, or `undefined` when no merge base exists.
   */
  public async findMergeBase(
    repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string | undefined> {
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const left = requireRevision(leftRevision, "leftRevision");
    const right = requireRevision(rightRevision, "rightRevision");
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["merge-base", left, right]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 1) {
      return undefined;
    }

    this.requireSuccess(invocation, result);
    return firstOutputLine(result.stdout, "git merge-base");
  }

  /**
   * Determines whether an object expression resolves in the local object database.
   */
  public async objectExists(
    repositoryRoot: string,
    objectName: string
  ): Promise<boolean> {
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const object = requireRevision(objectName, "objectName");
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["cat-file", "-e", `${object}^{object}`]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 0) {
      return true;
    }
    if (isMissingValueExit(result)) {
      return false;
    }

    throw new GitCommandFailedError(invocation, result);
  }

  private execute(
    cwd: string | undefined,
    argumentsList: readonly string[]
  ): Promise<GitCommandResult> {
    return this.commandExecutor.execute({
      cwd,
      argumentsList: [...argumentsList]
    });
  }

  private requireSuccess(
    invocation: GitCommandInvocation,
    result: GitCommandResult
  ): void {
    if (result.exitCode !== 0) {
      throw new GitCommandFailedError(invocation, result);
    }
  }

  private async resolveIdentityRemote(
    rootPath: string
  ): Promise<LocalGitRemote | undefined> {
    const listInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["remote"]
    };
    const listResult = await this.commandExecutor.execute(listInvocation);
    this.requireSuccess(listInvocation, listResult);

    const names = splitOutputLines(listResult.stdout).sort((left, right) =>
      left.localeCompare(right)
    );
    const name = names.includes("origin") ? "origin" : names[0];
    if (name === undefined) {
      return undefined;
    }

    const urlInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["remote", "get-url", name]
    };
    const urlResult = await this.commandExecutor.execute(urlInvocation);
    this.requireSuccess(urlInvocation, urlResult);
    const rawUrl = firstOutputLine(urlResult.stdout, `remote ${name} URL`);

    return {
      name,
      rawUrl,
      normalizedUrl: normalizeGitRemoteUrl(rawUrl, rootPath)
    };
  }

  private async resolveBranchState(
    rootPath: string
  ): Promise<LocalGitBranchState> {
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["symbolic-ref", "--quiet", "HEAD"]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 1) {
      return { kind: "detached" };
    }

    this.requireSuccess(invocation, result);
    const fullRef = firstOutputLine(result.stdout, "HEAD symbolic ref");
    if (!fullRef.startsWith("refs/heads/")) {
      throw new Error(`HEAD symbolic ref is not a local branch: ${fullRef}`);
    }

    return {
      kind: "branch",
      fullRef
    };
  }

  private async resolveHead(rootPath: string): Promise<string | undefined> {
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["rev-parse", "--verify", "HEAD^{commit}"]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (isMissingValueExit(result)) {
      return undefined;
    }

    this.requireSuccess(invocation, result);
    return firstOutputLine(result.stdout, "HEAD commit");
  }
}

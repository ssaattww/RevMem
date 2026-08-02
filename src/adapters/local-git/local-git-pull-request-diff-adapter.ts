import { requirePullRequestDiffAcquisitionRequest } from "../../application/github-pr-diff/index";
import type {
  LocalPullRequestDiffPort,
  PullRequestDiffAcquisitionRequest
} from "../../application/github-pr-diff/index";
import {
  GitExecutableNotFoundError,
  type GitCommandExecutor,
  type GitCommandInvocation
} from "./contracts";

const requireRoot = (value: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path without NUL characters.");
  }
  return value;
};

const missingRevision = (stderr: string): boolean =>
  /(?:bad object|unknown revision|invalid object name|ambiguous argument|not a valid object name)/iu.test(stderr);

/** Local immutable base/head Git implementation of the first T402 route. */
export class LocalGitPullRequestDiffAdapter implements LocalPullRequestDiffPort {
  private readonly repositoryRoot: string;

  public constructor(
    private readonly commandExecutor: GitCommandExecutor,
    repositoryRoot: string
  ) {
    this.repositoryRoot = requireRoot(repositoryRoot);
  }

  public async loadDiff(request: PullRequestDiffAcquisitionRequest): ReturnType<LocalPullRequestDiffPort["loadDiff"]> {
    requirePullRequestDiffAcquisitionRequest(request);
    const invocation: GitCommandInvocation = {
      cwd: this.repositoryRoot,
      argumentsList: [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=0",
        "--find-renames",
        "--find-copies",
        request.baseSha,
        request.headSha,
        "--"
      ]
    };
    try {
      const result = await this.commandExecutor.execute(invocation);
      if (result.exitCode === 0) return { kind: "available", diff: result.stdout };
      if (missingRevision(`${result.stdout}\n${result.stderr}`)) {
        return { kind: "unavailable", reason: "missing-revision" };
      }
      return { kind: "unavailable", reason: "git-failure" };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof GitExecutableNotFoundError ? "git-unavailable" : "git-failure"
      };
    }
  }
}

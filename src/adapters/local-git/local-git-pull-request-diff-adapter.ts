import { requirePullRequestDiffAcquisitionRequest } from "../../application/github-pr-diff/index";
import type {
  LocalPullRequestDiffPort,
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffUnavailableReason
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
    try {
      for (const revision of [request.baseSha, request.headSha]) {
        const unavailable = await this.verifyCommitObject(revision);
        if (unavailable !== undefined) {
          return { kind: "unavailable", reason: unavailable };
        }
      }
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

  private async verifyCommitObject(
    revision: string
  ): Promise<PullRequestDiffUnavailableReason | undefined> {
    const result = await this.commandExecutor.execute({
      cwd: this.repositoryRoot,
      argumentsList: ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]
    });
    if (result.exitCode === 1) return "missing-revision";
    if (result.exitCode !== 0 || result.stdout.trim() !== revision) return "git-failure";
    return undefined;
  }
}

import { requirePullRequestDiffAcquisitionRequest } from "../../application/github-pr-diff/index";
import type {
  LocalPullRequestDiffPort,
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffUnavailableReason
} from "../../application/github-pr-diff/index";
import {
  GitExecutableNotFoundError,
  type GitCommandExecutor,
  type GitCommandResult
} from "./contracts";

const MAX_RENAME_COPY_CANDIDATES = 1_000;

const requireRoot = (value: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path without NUL characters.");
  }
  return value;
};

const missingRevision = (stderr: string): boolean =>
  /(?:bad object|unknown revision|invalid object name|ambiguous argument|not a valid object name)/iu.test(stderr);

const skippedRenameOrCopyDetection = (diagnostic: string): boolean =>
  /(?:exhaustive rename detection was skipped|too many files.*rename detection)/iu.test(diagnostic);

const containsAddedFile = (diff: string): boolean => /^new file mode /mu.test(diff);

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

      const ordinary = await this.executeDiff(request, false);
      const ordinaryFailure = this.classifyDiffFailure(ordinary);
      if (ordinaryFailure !== undefined) return { kind: "unavailable", reason: ordinaryFailure };
      if (!containsAddedFile(ordinary.stdout)) {
        return { kind: "available", diff: ordinary.stdout };
      }

      const exhaustive = await this.executeDiff(request, true);
      const exhaustiveFailure = this.classifyDiffFailure(exhaustive);
      if (exhaustiveFailure !== undefined) return { kind: "unavailable", reason: exhaustiveFailure };
      return { kind: "available", diff: exhaustive.stdout };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof GitExecutableNotFoundError ? "git-unavailable" : "git-failure"
      };
    }
  }

  private executeDiff(
    request: PullRequestDiffAcquisitionRequest,
    exhaustiveCopies: boolean
  ): Promise<GitCommandResult> {
    const copyArguments = exhaustiveCopies
      ? ["--find-copies-harder"]
      : ["--find-copies"];
    return this.commandExecutor.execute({
      cwd: this.repositoryRoot,
      argumentsList: [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--unified=0",
        "--find-renames",
        ...copyArguments,
        `-l${MAX_RENAME_COPY_CANDIDATES}`,
        request.baseSha,
        request.headSha,
        "--"
      ]
    });
  }

  private classifyDiffFailure(result: GitCommandResult): PullRequestDiffUnavailableReason | undefined {
    const diagnostic = `${result.stdout}\n${result.stderr}`;
    if (skippedRenameOrCopyDetection(diagnostic)) return "diff-too-large";
    if (result.exitCode === 0) return undefined;
    return missingRevision(diagnostic) ? "missing-revision" : "git-failure";
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

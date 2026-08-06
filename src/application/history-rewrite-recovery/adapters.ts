import { parseZeroContextGitDiff } from "../../core/git-diff/index";
import type { NonGitSnapshotMappingResult } from "../non-git-snapshots/index";
import type { GitRevisionMappingSource } from "../review-context/contracts";
import type { FileSystemPathSemantics } from "../workspace-identity/index";
import type {
  HistoryRewriteCurrentFile,
  HistoryRewriteGitObjectPort,
  HistoryRewriteGitObjectRequest,
  HistoryRewriteGitObjectResult,
  HistoryRewriteSnapshotPort,
  HistoryRewriteSnapshotResult
} from "./index";

export interface NonGitSnapshotHistoryRewriteTracker {
  map(
    snapshotId: string,
    currentContent: string,
    now: number
  ): Promise<NonGitSnapshotMappingResult>;
}

export class NonGitSnapshotHistoryRewritePort implements HistoryRewriteSnapshotPort {
  public constructor(
    private readonly tracker: NonGitSnapshotHistoryRewriteTracker
  ) {}

  public async map(
    snapshotId: string,
    currentFile: HistoryRewriteCurrentFile,
    now: number
  ): Promise<HistoryRewriteSnapshotResult> {
    if (currentFile.content === undefined) {
      return { kind: "missing" };
    }
    const result = await this.tracker.map(snapshotId, currentFile.content, now);
    if (result.status === "mapped") {
      return {
        kind: "mapped",
        reviewedRanges: result.reviewedRanges.map((range) => ({ ...range }))
      };
    }
    return { kind: result.status };
  }
}

/**
 * Legacy test boundary for the ordered recovery service. Production mapping
 * uses the existing GitContextRevisionMapper and never routes copy metadata
 * through this adapter.
 */
export class GitRevisionMappingHistoryRewritePort implements HistoryRewriteGitObjectPort {
  public constructor(
    private readonly source: GitRevisionMappingSource,
    private readonly repositoryRoot: string,
    private readonly fileSystemPathSemantics: FileSystemPathSemantics
  ) {
    if (repositoryRoot.length === 0) {
      throw new TypeError("repositoryRoot must not be empty.");
    }
  }

  public async diff(
    request: HistoryRewriteGitObjectRequest
  ): Promise<HistoryRewriteGitObjectResult> {
    try {
      const oldExists = await this.source.objectExists(
        this.repositoryRoot,
        request.oldRevisionId
      );
      if (!oldExists) {
        return { kind: "missing-old-revision" };
      }

      const diff = await this.source.diffRevisions(
        this.repositoryRoot,
        request.oldRevisionId,
        request.newRevisionId
      );
      if (containsCopyFrom(diff, request.oldPath)) {
        return failure("Git copy evidence cannot transfer stable file identity.");
      }
      const candidates = parseZeroContextGitDiff(diff).files.filter(
        (file) => file.oldPath === request.oldPath
      );
      if (candidates.length === 0) {
        return { kind: "unchanged", newPath: request.oldPath };
      }
      if (candidates.length !== 1) {
        return failure("Ambiguous Git file mapping for the old path.");
      }
      const candidate = candidates[0];
      if (candidate?.newPath === undefined) {
        return failure("The Git file mapping has no destination path.");
      }

      const [oldText, newText] = await Promise.all([
        this.source.readTextFileAtRevision(
          this.repositoryRoot,
          request.oldRevisionId,
          request.oldPath,
          this.fileSystemPathSemantics
        ),
        this.source.readTextFileAtRevision(
          this.repositoryRoot,
          request.newRevisionId,
          candidate.newPath,
          this.fileSystemPathSemantics
        )
      ]);
      if (oldText.kind !== "found" || newText.kind !== "found") {
        return failure(
          `Git text proof is unavailable (${oldText.kind}/${newText.kind}).`
        );
      }
      return {
        kind: "diff",
        oldPath: request.oldPath,
        newPath: candidate.newPath,
        diff,
        oldText: oldText.content,
        newText: newText.content
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Unknown Git failure.");
    }
  }
}

function containsCopyFrom(diff: string, oldPath: string): boolean {
  return diff.split(/\r?\n/u).some(
    (line) => line === `copy from ${oldPath}`
  );
}

function failure(reason: string): HistoryRewriteGitObjectResult {
  return { kind: "failure", reason };
}

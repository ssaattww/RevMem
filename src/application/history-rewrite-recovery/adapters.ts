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
      const parsed = parseZeroContextGitDiff(diff);
      const sections = diffSections(diff);
      if (sections.length !== parsed.files.length) {
        return failure("Git diff section framing is inconsistent.");
      }
      const candidates = parsed.files
        .map((file, index) => ({ file, index }))
        .filter(({ file }) => file.oldPath === request.oldPath);
      if (candidates.length === 0) {
        return { kind: "unchanged", newPath: request.oldPath };
      }
      if (candidates.length !== 1) {
        return failure("Ambiguous Git file mapping for the old path.");
      }
      const candidate = candidates[0];
      if (candidate === undefined) {
        return failure("Git file mapping candidate is missing.");
      }
      if (sectionHasCopyMetadata(sections[candidate.index] ?? "")) {
        return failure("Git copy evidence cannot transfer stable file identity.");
      }
      if (candidate.file.newPath === undefined) {
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
          candidate.file.newPath,
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
        newPath: candidate.file.newPath,
        diff,
        oldText: oldText.content,
        newText: newText.content
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Unknown Git failure.");
    }
  }
}

function diffSections(diff: string): readonly string[] {
  return diff
    .split(/(?=^diff --git )/mu)
    .filter((section) => section.startsWith("diff --git "));
}

function sectionHasCopyMetadata(section: string): boolean {
  return section.split(/\r?\n/u).some(
    (line) => line.startsWith("copy from ") || line.startsWith("copy to ")
  );
}

function failure(reason: string): HistoryRewriteGitObjectResult {
  return { kind: "failure", reason };
}

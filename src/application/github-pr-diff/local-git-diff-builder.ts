import type {
  DiffHunk,
  DiffLine,
  PullRequestFileChange,
  PullRequestFileChangeStatus
} from "../../core/contracts/index";
import { parseZeroContextGitDiff, type GitDiffFile } from "../../core/git-diff/index";
import type { PullRequestDiffAcquisitionRequest } from "./contracts";
import {
  createSnapshot,
  normalizedPaths,
  statusMatrixValid,
  type PullRequestDiffBuildResult
} from "./snapshot-builder-shared";

const sectionsOf = (diff: string): readonly string[] => {
  const lines = diff.split(/\r?\n/u);
  const sections: string[] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) sections.push(current.join("\n"));
      current = [line];
    } else if (current !== undefined) {
      current.push(line);
    } else if (line.length > 0) {
      throw new SyntaxError("Git diff content must begin with a file header.");
    }
  }
  if (current !== undefined) sections.push(current.join("\n"));
  return sections;
};

const localStatus = (
  section: string,
  file: GitDiffFile
): PullRequestFileChangeStatus => {
  if (/^(?:Binary files .+ differ|GIT binary patch)$/mu.test(section)) return "binary";
  if (/^new file mode /mu.test(section) || file.oldPath === undefined) return "added";
  if (/^deleted file mode /mu.test(section) || file.newPath === undefined) return "deleted";
  if (/^rename from /mu.test(section) || /^rename to /mu.test(section) || file.isRename) {
    return "renamed";
  }
  if (/^copy from /mu.test(section) || /^copy to /mu.test(section)) return "copied";
  return "modified";
};

const localHunks = (file: GitDiffFile): readonly DiffHunk[] => file.hunks.map((hunk) => {
  const lines: DiffLine[] = [];
  hunk.removedLines.forEach((text, offset) => lines.push({
    kind: "deletion",
    oldLine: hunk.oldStart + offset + 1,
    text
  }));
  hunk.addedLines.forEach((text, offset) => lines.push({
    kind: "addition",
    newLine: hunk.newStart + offset + 1,
    text
  }));
  return {
    oldStart: hunk.oldLineCount === 0 ? hunk.oldStart : hunk.oldStart + 1,
    oldCount: hunk.oldLineCount,
    newStart: hunk.newLineCount === 0 ? hunk.newStart : hunk.newStart + 1,
    newCount: hunk.newLineCount,
    lines
  };
});

/** Converts one complete zero-context local Git diff into the T301 snapshot contract. */
export const buildSnapshotFromLocalGitDiff = (
  request: PullRequestDiffAcquisitionRequest,
  diff: string
): PullRequestDiffBuildResult => {
  try {
    const parsed = parseZeroContextGitDiff(diff);
    const sections = sectionsOf(diff);
    if (parsed.files.length !== sections.length) {
      return { kind: "failure", reason: "invalid-data" };
    }
    const files = parsed.files.map((file, index): PullRequestFileChange => {
      const section = sections[index]!;
      const status = localStatus(section, file);
      const hasModeOnlyChange = /^old mode /mu.test(section) && /^new mode /mu.test(section);
      if (status === "modified" && file.hunks.length === 0 && !hasModeOnlyChange) {
        throw new SyntaxError("Local Git diff file section has no change evidence.");
      }
      const paths = normalizedPaths({
        ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
        ...(file.newPath === undefined ? {} : { newPath: file.newPath }),
        status,
        additions: 0,
        deletions: 0
      });
      const { oldPath, newPath, fileId } = paths;
      if (!statusMatrixValid(status, oldPath, newPath)) {
        throw new RangeError("Local Git status/path matrix is invalid.");
      }
      const hunks = status === "binary" ? [] : localHunks(file);
      return {
        fileId,
        ...(oldPath === undefined ? {} : { oldPath }),
        ...(newPath === undefined ? {} : { newPath }),
        status,
        additions: hunks.reduce(
          (sum, hunk) => sum + hunk.lines.filter(line => line.kind === "addition").length,
          0
        ),
        deletions: hunks.reduce(
          (sum, hunk) => sum + hunk.lines.filter(line => line.kind === "deletion").length,
          0
        ),
        hunks: [...hunks]
      };
    });
    return { kind: "success", snapshot: createSnapshot(request, files) };
  } catch {
    return { kind: "failure", reason: "invalid-data" };
  }
};

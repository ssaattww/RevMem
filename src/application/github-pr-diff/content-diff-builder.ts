import type {
  DiffHunk,
  DiffLine,
  PullRequestFileChange,
  PullRequestFileChangeStatus
} from "../../core/contracts/index";
import type {
  PullRequestDiffAcquisitionRequest,
  PullRequestRemoteFile
} from "./contracts";
import {
  createSnapshot,
  normalizedPaths,
  statusMatrixValid,
  statusStatisticsValid,
  type PullRequestDiffBuildResult
} from "./snapshot-builder-shared";

const MAX_DIFF_MATRIX_CELLS = 1_000_000;

interface TextLine {
  readonly text: string;
  readonly ending: "" | "\n" | "\r" | "\r\n";
}

type EditOperation =
  | { readonly kind: "equal"; readonly oldLine: TextLine; readonly newLine: TextLine }
  | { readonly kind: "deletion"; readonly line: TextLine }
  | { readonly kind: "addition"; readonly line: TextLine };

const textLines = (content: string): readonly TextLine[] => {
  const result: TextLine[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character !== "\r" && character !== "\n") continue;
    const ending = character === "\r" && content[index + 1] === "\n" ? "\r\n" : character;
    result.push({ text: content.slice(start, index), ending });
    if (ending === "\r\n") index += 1;
    start = index + 1;
  }
  if (start < content.length) result.push({ text: content.slice(start), ending: "" });
  return result;
};

const lineEqual = (left: TextLine, right: TextLine): boolean =>
  left.text === right.text && left.ending === right.ending;

const editOperations = (
  oldLines: readonly TextLine[],
  newLines: readonly TextLine[]
): readonly EditOperation[] | undefined => {
  if ((oldLines.length + 1) * (newLines.length + 1) > MAX_DIFF_MATRIX_CELLS) {
    return undefined;
  }
  const width = newLines.length + 1;
  const matrix = new Uint32Array((oldLines.length + 1) * width);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex;
      matrix[offset] = lineEqual(oldLines[oldIndex]!, newLines[newIndex]!)
        ? matrix[(oldIndex + 1) * width + newIndex + 1]! + 1
        : Math.max(
            matrix[(oldIndex + 1) * width + newIndex]!,
            matrix[oldIndex * width + newIndex + 1]!
          );
    }
  }
  const operations: EditOperation[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length && newIndex < newLines.length &&
      lineEqual(oldLines[oldIndex]!, newLines[newIndex]!)
    ) {
      operations.push({
        kind: "equal",
        oldLine: oldLines[oldIndex]!,
        newLine: newLines[newIndex]!
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex >= newLines.length ||
      (oldIndex < oldLines.length &&
        matrix[(oldIndex + 1) * width + newIndex]! >=
          matrix[oldIndex * width + newIndex + 1]!)
    ) {
      operations.push({ kind: "deletion", line: oldLines[oldIndex]! });
      oldIndex += 1;
    } else {
      operations.push({ kind: "addition", line: newLines[newIndex]! });
      newIndex += 1;
    }
  }
  return operations;
};

const hunksFromContents = (
  oldContent: string,
  newContent: string
): readonly DiffHunk[] | undefined => {
  const operations = editOperations(textLines(oldContent), textLines(newContent));
  if (operations === undefined) return undefined;
  const hunks: DiffHunk[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let operationIndex = 0;
  while (operationIndex < operations.length) {
    const operation = operations[operationIndex]!;
    if (operation.kind === "equal") {
      oldIndex += 1;
      newIndex += 1;
      operationIndex += 1;
      continue;
    }
    const oldStartIndex = oldIndex;
    const newStartIndex = newIndex;
    const lines: DiffLine[] = [];
    let oldCount = 0;
    let newCount = 0;
    while (operationIndex < operations.length && operations[operationIndex]!.kind !== "equal") {
      const changed = operations[operationIndex]!;
      if (changed.kind === "deletion") {
        lines.push({ kind: "deletion", oldLine: oldIndex + 1, text: changed.line.text });
        oldIndex += 1;
        oldCount += 1;
      } else if (changed.kind === "addition") {
        lines.push({ kind: "addition", newLine: newIndex + 1, text: changed.line.text });
        newIndex += 1;
        newCount += 1;
      }
      operationIndex += 1;
    }
    hunks.push({
      oldStart: oldCount === 0 ? oldStartIndex : oldStartIndex + 1,
      oldCount,
      newStart: newCount === 0 ? newStartIndex : newStartIndex + 1,
      newCount,
      lines
    });
  }
  return hunks;
};

const completeAddedOrDeleted = (
  status: PullRequestFileChangeStatus,
  additions: number,
  deletions: number,
  hunks: readonly DiffHunk[]
): boolean => {
  if (status === "added" && additions > 0) {
    const hunk = hunks.length === 1 ? hunks[0] : undefined;
    return hunk !== undefined && hunk.oldStart === 0 && hunk.oldCount === 0 &&
      hunk.newStart === 1 && hunk.newCount === additions;
  }
  if (status === "deleted" && deletions > 0) {
    const hunk = hunks.length === 1 ? hunks[0] : undefined;
    return hunk !== undefined && hunk.oldStart === 1 && hunk.oldCount === deletions &&
      hunk.newStart === 0 && hunk.newCount === 0;
  }
  return true;
};

export interface PullRequestFileContents {
  readonly oldContent?: string;
  readonly newContent?: string;
}

class DiffTooLargeError extends Error {}

/** Rebuilds every file diff from exact base/head text while checking API statistics. */
export const buildSnapshotFromFileContents = (
  request: PullRequestDiffAcquisitionRequest,
  remoteFiles: readonly PullRequestRemoteFile[],
  contents: readonly PullRequestFileContents[]
): PullRequestDiffBuildResult => {
  if (remoteFiles.length !== contents.length) {
    return { kind: "failure", reason: "invalid-data" };
  }
  try {
    const files = remoteFiles.map((remote, index): PullRequestFileChange => {
      if (!statusStatisticsValid(remote.status, remote.additions, remote.deletions)) {
        throw new RangeError("Invalid file statistics.");
      }
      const { oldPath, newPath, fileId } = normalizedPaths(remote);
      if (!statusMatrixValid(remote.status, oldPath, newPath)) {
        throw new RangeError("Invalid status/path matrix.");
      }
      const content = contents[index]!;
      if (remote.status === "binary") {
        return {
          fileId,
          ...(oldPath === undefined ? {} : { oldPath }),
          ...(newPath === undefined ? {} : { newPath }),
          status: "binary",
          additions: 0,
          deletions: 0,
          hunks: []
        };
      }
      if (
        (oldPath === undefined) !== (content.oldContent === undefined) ||
        (newPath === undefined) !== (content.newContent === undefined)
      ) {
        throw new RangeError("Content presence does not match file status.");
      }
      const hunks = hunksFromContents(content.oldContent ?? "", content.newContent ?? "");
      if (hunks === undefined) throw new DiffTooLargeError();
      const additions = hunks.reduce(
        (sum, hunk) => sum + hunk.lines.filter(line => line.kind === "addition").length,
        0
      );
      const deletions = hunks.reduce(
        (sum, hunk) => sum + hunk.lines.filter(line => line.kind === "deletion").length,
        0
      );
      if (additions !== remote.additions || deletions !== remote.deletions) {
        throw new RangeError("Content diff statistics do not match the GitHub file record.");
      }
      if (!completeAddedOrDeleted(remote.status, additions, deletions, hunks)) {
        throw new RangeError("Added/deleted content diff is incomplete.");
      }
      return {
        fileId,
        ...(oldPath === undefined ? {} : { oldPath }),
        ...(newPath === undefined ? {} : { newPath }),
        status: remote.status,
        additions,
        deletions,
        hunks: [...hunks]
      };
    });
    return { kind: "success", snapshot: createSnapshot(request, files) };
  } catch (error) {
    return {
      kind: "failure",
      reason: error instanceof DiffTooLargeError ? "diff-too-large" : "invalid-data"
    };
  }
};

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
  safeCount,
  statusMatrixValid,
  statusStatisticsValid,
  type PullRequestDiffBuildResult
} from "./snapshot-builder-shared";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;

interface ParsedPatchPosition {
  readonly oldAnchor: number;
  readonly newAnchor: number;
  readonly oldEndAnchor: number;
  readonly newEndAnchor: number;
}

const parseCoordinate = (raw: string, count: number): number => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || (count > 0 && value === 0)) {
    throw new RangeError("Unified patch coordinate is invalid.");
  }
  return value;
};

const patchPosition = (hunk: DiffHunk): ParsedPatchPosition => {
  const oldAnchor = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
  const newAnchor = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
  return {
    oldAnchor,
    newAnchor,
    oldEndAnchor: oldAnchor + hunk.oldCount,
    newEndAnchor: newAnchor + hunk.newCount
  };
};

const parsePatch = (
  patch: string,
  expectedAdditions: number,
  expectedDeletions: number
): readonly DiffHunk[] => {
  const rows = patch.split(/\r?\n/u);
  const hunks: DiffHunk[] = [];
  let index = 0;
  let additionCount = 0;
  let deletionCount = 0;
  let previous: ParsedPatchPosition | undefined;
  let cumulativeDelta = 0;
  while (index < rows.length) {
    const row = rows[index]!;
    if (row.length === 0 && index === rows.length - 1) break;
    const match = HUNK_HEADER.exec(row);
    if (match === null) throw new SyntaxError("GitHub patch contains content outside a hunk.");
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    if (!safeCount(oldCount) || !safeCount(newCount) || (oldCount === 0 && newCount === 0)) {
      throw new RangeError("GitHub patch hunk count is invalid.");
    }
    const oldStart = parseCoordinate(match[1]!, oldCount);
    const newStart = parseCoordinate(match[3]!, newCount);
    let oldCursor = oldStart;
    let newCursor = newStart;
    const lines: DiffLine[] = [];
    index += 1;
    while (index < rows.length && !rows[index]!.startsWith("@@ ")) {
      const body = rows[index]!;
      if (body === "\\ No newline at end of file") {
        index += 1;
        continue;
      }
      if (body.length === 0 && index === rows.length - 1) break;
      const prefix = body[0];
      const text = body.slice(1);
      if (prefix === " ") {
        lines.push({ kind: "context", oldLine: oldCursor, newLine: newCursor, text });
        oldCursor += 1;
        newCursor += 1;
      } else if (prefix === "-") {
        lines.push({ kind: "deletion", oldLine: oldCursor, text });
        oldCursor += 1;
        deletionCount += 1;
      } else if (prefix === "+") {
        lines.push({ kind: "addition", newLine: newCursor, text });
        newCursor += 1;
        additionCount += 1;
      } else {
        throw new SyntaxError("GitHub patch contains an unsupported body line.");
      }
      index += 1;
    }
    if (oldCursor !== oldStart + oldCount || newCursor !== newStart + newCount) {
      throw new SyntaxError("GitHub patch hunk body does not match its header.");
    }
    if (!lines.some(line => line.kind !== "context")) {
      throw new SyntaxError("GitHub patch hunk contains no changed line.");
    }
    const hunk = { oldStart, oldCount, newStart, newCount, lines };
    const position = patchPosition(hunk);
    if (position.newAnchor - position.oldAnchor !== cumulativeDelta) {
      throw new RangeError("GitHub patch hunk delta is inconsistent with preceding hunks.");
    }
    if (previous !== undefined) {
      const oldGap = position.oldAnchor - previous.oldEndAnchor;
      const newGap = position.newAnchor - previous.newEndAnchor;
      if (oldGap < 0 || newGap < 0 || oldGap !== newGap) {
        throw new RangeError("GitHub patch hunks are overlapping or gap-inconsistent.");
      }
    }
    cumulativeDelta += newCount - oldCount;
    if (!Number.isSafeInteger(cumulativeDelta)) {
      throw new RangeError("GitHub patch cumulative delta exceeds safe integer bounds.");
    }
    previous = position;
    hunks.push(hunk);
  }
  if (additionCount !== expectedAdditions || deletionCount !== expectedDeletions) {
    throw new RangeError("GitHub patch changed-line statistics are incomplete.");
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

class MissingPatchError extends Error {}
class IncompletePatchError extends Error {}
class InvalidRemoteDataError extends Error {}

/** Builds a snapshot only when every GitHub file patch is present and complete. */
export const buildSnapshotFromGitHubPatches = (
  request: PullRequestDiffAcquisitionRequest,
  remoteFiles: readonly PullRequestRemoteFile[]
): PullRequestDiffBuildResult => {
  try {
    const files = remoteFiles.map((remote): PullRequestFileChange => {
      if (!statusStatisticsValid(remote.status, remote.additions, remote.deletions)) {
        throw new InvalidRemoteDataError("GitHub file statistics do not match its status.");
      }
      let paths: ReturnType<typeof normalizedPaths>;
      try {
        paths = normalizedPaths(remote);
      } catch (error) {
        throw new InvalidRemoteDataError("GitHub file path is invalid.", { cause: error });
      }
      const { oldPath, newPath, fileId } = paths;
      if (!statusMatrixValid(remote.status, oldPath, newPath)) {
        throw new InvalidRemoteDataError("GitHub status/path matrix is invalid.");
      }
      let hunks: readonly DiffHunk[];
      if (remote.status === "binary") {
        hunks = [];
      } else if (remote.additions === 0 && remote.deletions === 0) {
        if (remote.patch !== undefined && remote.patch.length > 0) {
          throw new InvalidRemoteDataError("Zero-change file must not have a patch.");
        }
        throw new MissingPatchError();
      } else {
        if (remote.patch === undefined) throw new MissingPatchError();
        try {
          hunks = parsePatch(remote.patch, remote.additions, remote.deletions);
        } catch (error) {
          throw new IncompletePatchError("GitHub patch is malformed or incomplete.", {
            cause: error
          });
        }
        if (!completeAddedOrDeleted(remote.status, remote.additions, remote.deletions, hunks)) {
          throw new IncompletePatchError();
        }
      }
      return {
        fileId,
        ...(oldPath === undefined ? {} : { oldPath }),
        ...(newPath === undefined ? {} : { newPath }),
        status: remote.status,
        additions: remote.additions,
        deletions: remote.deletions,
        hunks: [...hunks]
      };
    });
    return { kind: "success", snapshot: createSnapshot(request, files) };
  } catch (error) {
    if (error instanceof MissingPatchError) return { kind: "failure", reason: "missing-patch" };
    if (error instanceof IncompletePatchError) {
      return { kind: "failure", reason: "incomplete-patch" };
    }
    return { kind: "failure", reason: "invalid-data" };
  }
};

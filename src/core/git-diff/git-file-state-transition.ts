import type { FileReviewState } from "../contracts/index";
import {
  mapReviewedIntervalsAcrossDiff,
  parseZeroContextGitDiff,
  type GitDiffMappingOptions
} from "./git-diff-interval-mapping";

export type GitFileTransitionUnresolvedReason = "ambiguous-file-mapping" | "missing-source-state";

export interface GitFileTransitionUnresolved {
  readonly oldPath: string | undefined;
  readonly newPath: string | undefined;
  readonly reason: GitFileTransitionUnresolvedReason;
}

export interface GitFileStateTransitionInput {
  readonly files: Readonly<Record<string, Readonly<FileReviewState>>>;
  readonly diff: string;
  readonly newRevisionId: string;
  readonly updatedAt: string;
  readonly options: Readonly<GitDiffMappingOptions>;
}

export interface GitFileStateTransitionResult {
  readonly files: Record<string, FileReviewState>;
  readonly deletedFileIds: string[];
  readonly unresolved: GitFileTransitionUnresolved[];
}

type SectionKind = "rename" | "copy" | "delete" | "other";

interface FileSection {
  oldPath?: string;
  newPath?: string;
  kind: SectionKind;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function decodeQuotedPath(raw: string): string {
  const bytes: number[] = [];
  let index = 1;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\"") {
      return UTF8_DECODER.decode(Uint8Array.from(bytes));
    }
    if (character !== "\\") {
      const codePoint = raw.codePointAt(index);
      if (codePoint === undefined) {
        throw new SyntaxError("Git path is malformed.");
      }
      const value = String.fromCodePoint(codePoint);
      bytes.push(...UTF8_ENCODER.encode(value));
      index += value.length;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined) {
      throw new SyntaxError("Git path ends in an incomplete escape.");
    }
    const escapes: Readonly<Record<string, number>> = {
      a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "\"": 34
    };
    if (escaped in escapes) {
      bytes.push(escapes[escaped] as number);
      index += 2;
      continue;
    }
    const octal = raw.slice(index + 1, index + 4);
    if (!/^[0-7]{3}$/.test(octal)) {
      throw new SyntaxError("Git path contains an unsupported escape.");
    }
    bytes.push(Number.parseInt(octal, 8));
    index += 4;
  }
  throw new SyntaxError("Quoted Git path is unterminated.");
}

function decodeMetadataPath(raw: string): string {
  const value = raw.startsWith("\"") ? decodeQuotedPath(raw) : raw;
  if (value.length === 0 || value.includes("\0")) {
    throw new SyntaxError("Git metadata path is invalid.");
  }
  return value;
}

function splitSections(diff: string): string[][] {
  if (typeof diff !== "string") {
    throw new TypeError("diff must be a string.");
  }
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections[sections.length - 1]?.push(line);
    } else if (line.length > 0) {
      throw new SyntaxError("Diff content must begin with a diff --git header.");
    }
  }
  return sections;
}

function parseSections(diff: string): FileSection[] {
  const parsed = parseZeroContextGitDiff(diff);
  const rawSections = splitSections(diff);
  if (parsed.files.length !== rawSections.length) {
    throw new SyntaxError("Parsed diff section count is inconsistent.");
  }
  return rawSections.map((lines, index) => {
    const parsedFile = parsed.files[index];
    let copyFrom: string | undefined;
    let copyTo: string | undefined;
    let deleted = false;
    for (const line of lines) {
      if (line.startsWith("copy from ")) {
        copyFrom = decodeMetadataPath(line.slice("copy from ".length));
      } else if (line.startsWith("copy to ")) {
        copyTo = decodeMetadataPath(line.slice("copy to ".length));
      } else if (line.startsWith("deleted file mode ")) {
        deleted = true;
      }
    }
    if ((copyFrom === undefined) !== (copyTo === undefined)) {
      throw new SyntaxError("Copy metadata must contain both source and destination paths.");
    }
    if (copyFrom !== undefined && copyTo !== undefined) {
      return { oldPath: copyFrom, newPath: copyTo, kind: "copy" };
    }
    if (parsedFile?.isRename === true) {
      return { oldPath: parsedFile.oldPath, newPath: parsedFile.newPath, kind: "rename" };
    }
    if (deleted || (parsedFile?.oldPath !== undefined && parsedFile.newPath === undefined)) {
      return { oldPath: parsedFile?.oldPath, kind: "delete" };
    }
    return { oldPath: parsedFile?.oldPath, newPath: parsedFile?.newPath, kind: "other" };
  });
}

function cloneState(state: Readonly<FileReviewState>): FileReviewState {
  return {
    ...state,
    previousPaths: [...state.previousPaths],
    modifiedReviewed: state.modifiedReviewed.map((interval) => ({ ...interval })),
    originalReviewedByDiff: Object.fromEntries(
      Object.entries(state.originalReviewedByDiff).map(([key, intervals]) => [
        key,
        intervals.map((interval) => ({ ...interval }))
      ])
    )
  };
}

function findFileIdByPath(files: Readonly<Record<string, Readonly<FileReviewState>>>, path: string): string | undefined {
  const matches = Object.entries(files).filter(([, state]) => state.currentPath === path);
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}

function countByPath(sections: readonly FileSection[], selector: (section: FileSection) => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const path = selector(section);
    if (path !== undefined) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

export function applyGitFileStateTransitions(
  input: Readonly<GitFileStateTransitionInput>
): GitFileStateTransitionResult {
  if (input.newRevisionId.length === 0) {
    throw new TypeError("newRevisionId must not be empty.");
  }
  if (!Number.isFinite(Date.parse(input.updatedAt))) {
    throw new TypeError("updatedAt must be an ISO-compatible timestamp.");
  }

  const sections = parseSections(input.diff);
  const active = Object.fromEntries(
    Object.entries(input.files).map(([fileId, state]) => [fileId, cloneState(state)])
  );
  const deletedFileIds: string[] = [];
  const unresolved: GitFileTransitionUnresolved[] = [];
  const sourceCounts = countByPath(sections.filter((section) => section.kind === "rename" || section.kind === "copy"), (section) => section.oldPath);
  const destinationCounts = countByPath(sections.filter((section) => section.kind === "rename" || section.kind === "copy"), (section) => section.newPath);

  for (const section of sections) {
    if (section.kind === "copy") {
      unresolved.push({ oldPath: section.oldPath, newPath: section.newPath, reason: "ambiguous-file-mapping" });
      continue;
    }
    if (section.kind === "delete" && section.oldPath !== undefined) {
      const fileId = findFileIdByPath(active, section.oldPath);
      if (fileId === undefined) {
        unresolved.push({ oldPath: section.oldPath, newPath: undefined, reason: "missing-source-state" });
        continue;
      }
      delete active[fileId];
      deletedFileIds.push(fileId);
      continue;
    }
    if (section.kind !== "rename" || section.oldPath === undefined || section.newPath === undefined) {
      continue;
    }
    const unique = sourceCounts.get(section.oldPath) === 1 && destinationCounts.get(section.newPath) === 1;
    const fileId = findFileIdByPath(active, section.oldPath);
    if (!unique || fileId === undefined) {
      unresolved.push({
        oldPath: section.oldPath,
        newPath: section.newPath,
        reason: unique ? "missing-source-state" : "ambiguous-file-mapping"
      });
      continue;
    }
    const current = active[fileId] as FileReviewState;
    const mapped = mapReviewedIntervalsAcrossDiff({
      reviewed: current.modifiedReviewed,
      diff: input.diff,
      oldPath: section.oldPath,
      newPath: section.newPath,
      options: input.options
    });
    const parsedFile = parseZeroContextGitDiff(input.diff).files.find(
      (candidate) => candidate.oldPath === section.oldPath && candidate.newPath === section.newPath
    );
    const lineDelta = parsedFile?.hunks.reduce(
      (sum, hunk) => sum + hunk.newLineCount - hunk.oldLineCount,
      0
    ) ?? 0;
    active[fileId] = {
      ...current,
      currentPath: section.newPath,
      previousPaths: current.previousPaths.includes(section.oldPath)
        ? [...current.previousPaths]
        : [...current.previousPaths, section.oldPath],
      revisionId: input.newRevisionId,
      modifiedReviewed: mapped.reviewed,
      lineCount: current.lineCount + lineDelta,
      updatedAt: input.updatedAt
    };
  }

  return {
    files: active,
    deletedFileIds: deletedFileIds.sort(),
    unresolved
  };
}

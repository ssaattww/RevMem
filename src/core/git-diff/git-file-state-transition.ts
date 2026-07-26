import type { FileReviewState, LineInterval } from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";
import {
  parseZeroContextGitDiff,
  type GitDiffFile,
  type GitDiffHunk,
  type GitDiffMappingOptions
} from "./git-diff-interval-mapping";

/** Why a file transition could not safely inherit reviewed state. */
export type GitFileTransitionUnresolvedReason =
  | "ambiguous-file-mapping"
  | "missing-source-state";

/** One conservative file-level transition that was returned unreviewed. */
export interface GitFileTransitionUnresolved {
  /** Path in the old revision, when one exists. */
  readonly oldPath: string | undefined;
  /** Path in the new revision, when one exists. */
  readonly newPath: string | undefined;
  /** Deterministic reason why reviewed state was not inherited. */
  readonly reason: GitFileTransitionUnresolvedReason;
}

/** Required metadata for a file that exists in the new revision. */
export interface GitNewFileStateInput {
  /** Stable ID to use for a genuinely new or unresolved destination file. */
  readonly fileId: string;
  /** Exact line count in the new revision. */
  readonly lineCount: number;
  /** Hash of the complete new content, when available. */
  readonly contentHash?: string;
  /** Complete new text used to prove whitespace/EOL equivalence. */
  readonly newText?: string;
}

/** Input for applying all file transitions in one complete Git diff atomically. */
export interface GitFileStateTransitionInput {
  /** Complete pre-transition file-state snapshot keyed by stable file ID. */
  readonly files: Readonly<Record<string, Readonly<FileReviewState>>>;
  /** Complete `--unified=0 --find-renames --find-copies` Git diff. */
  readonly diff: string;
  /** Revision assigned to files processed or conservatively invalidated by this operation. */
  readonly newRevisionId: string;
  /** ISO timestamp assigned to files changed by this operation. */
  readonly updatedAt: string;
  /** Whitespace/EOL equivalence policy shared with T203. */
  readonly options: Readonly<GitDiffMappingOptions>;
  /** Complete old text keyed by old path, required to prove ignored changes. */
  readonly oldTexts?: Readonly<Record<string, string>>;
  /** Required metadata for every new, copied, or unresolved destination in the diff. */
  readonly newFiles?: Readonly<Record<string, Readonly<GitNewFileStateInput>>>;
}

/** Atomic result containing the complete post-transition snapshot. */
export interface GitFileStateTransitionResult {
  /** Complete detached snapshot. Unaffected files may retain their prior file-level revision. */
  readonly files: Record<string, FileReviewState>;
  /** Stable IDs removed because their files were explicitly deleted. */
  readonly deletedFileIds: string[];
  /** Transitions whose source review state was not inherited. */
  readonly unresolved: GitFileTransitionUnresolved[];
}

type SectionKind = "rename" | "copy" | "delete" | "add" | "other";

interface FileSection {
  readonly file: GitDiffFile;
  readonly kind: SectionKind;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly similarity?: number;
}

interface PlannedRename {
  readonly section: FileSection;
  readonly fileId: string;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function decodeQuotedPath(raw: string): string {
  const bytes: number[] = [];
  let index = 1;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\"") {
      if (index + 1 !== raw.length) {
        throw new SyntaxError("Quoted Git path has trailing content.");
      }
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
      a: 7,
      b: 8,
      f: 12,
      n: 10,
      r: 13,
      t: 9,
      v: 11,
      "\\": 92,
      "\"": 34
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
    const byte = Number.parseInt(octal, 8);
    if (byte === 0 || byte > 0xff) {
      throw new SyntaxError("Git path contains an invalid octal escape.");
    }
    bytes.push(byte);
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

function setOnce(current: string | undefined, next: string, label: string): string {
  if (current !== undefined) {
    throw new SyntaxError(`Git section contains duplicate ${label} metadata.`);
  }
  return decodeMetadataPath(next);
}

function parseSections(diff: string): FileSection[] {
  const parsed = parseZeroContextGitDiff(diff);
  const rawSections = splitSections(diff);
  if (parsed.files.length !== rawSections.length) {
    throw new SyntaxError("Parsed diff section count is inconsistent.");
  }
  return rawSections.map((lines, index) => {
    const file = parsed.files[index];
    if (file === undefined) {
      throw new SyntaxError("Parsed diff section is missing.");
    }
    let copyFrom: string | undefined;
    let copyTo: string | undefined;
    let deleted = false;
    let added = false;
    let similarity: number | undefined;
    for (const line of lines) {
      if (line.startsWith("copy from ")) {
        copyFrom = setOnce(copyFrom, line.slice("copy from ".length), "copy from");
      } else if (line.startsWith("copy to ")) {
        copyTo = setOnce(copyTo, line.slice("copy to ".length), "copy to");
      } else if (line.startsWith("deleted file mode ")) {
        if (deleted) {
          throw new SyntaxError("Git section contains duplicate delete metadata.");
        }
        deleted = true;
      } else if (line.startsWith("new file mode ")) {
        if (added) {
          throw new SyntaxError("Git section contains duplicate new-file metadata.");
        }
        added = true;
      } else if (line.startsWith("similarity index ")) {
        if (similarity !== undefined) {
          throw new SyntaxError("Git section contains duplicate similarity metadata.");
        }
        const match = /^similarity index (\d+)%$/.exec(line);
        if (match === null) {
          throw new SyntaxError("Git similarity metadata is malformed.");
        }
        similarity = Number(match[1]);
        if (!Number.isInteger(similarity) || similarity < 0 || similarity > 100) {
          throw new RangeError("Git similarity must be between 0 and 100.");
        }
      }
    }
    if ((copyFrom === undefined) !== (copyTo === undefined)) {
      throw new SyntaxError("Copy metadata must contain both source and destination paths.");
    }
    const statusCount =
      Number(copyFrom !== undefined) +
      Number(file.isRename) +
      Number(deleted) +
      Number(added);
    if (statusCount > 1) {
      throw new SyntaxError("Git section contains conflicting file status metadata.");
    }
    if (copyFrom !== undefined && copyTo !== undefined) {
      return {
        file,
        oldPath: copyFrom,
        newPath: copyTo,
        kind: "copy",
        ...(similarity === undefined ? {} : { similarity })
      };
    }
    if (file.isRename) {
      return {
        file,
        oldPath: file.oldPath,
        newPath: file.newPath,
        kind: "rename",
        ...(similarity === undefined ? {} : { similarity })
      };
    }
    if (deleted || (file.oldPath !== undefined && file.newPath === undefined)) {
      return { file, oldPath: file.oldPath, kind: "delete" };
    }
    if (added || (file.oldPath === undefined && file.newPath !== undefined)) {
      return { file, newPath: file.newPath, kind: "add" };
    }
    return { file, oldPath: file.oldPath, newPath: file.newPath, kind: "other" };
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

function validateLineCount(lineCount: number, label: string): void {
  if (!Number.isSafeInteger(lineCount) || lineCount < 0) {
    throw new RangeError(`${label} lineCount must be a non-negative safe integer.`);
  }
}

function validateStateSnapshot(
  files: Readonly<Record<string, Readonly<FileReviewState>>>
): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const [key, file] of Object.entries(files)) {
    if (key !== file.fileId) {
      throw new RangeError("File-state key must equal fileId.");
    }
    if (file.currentPath.length === 0 || byPath.has(file.currentPath)) {
      throw new RangeError("File-state paths must be non-empty and unique.");
    }
    validateLineCount(file.lineCount, `File ${file.fileId}`);
    for (const interval of normalizeLineIntervals(file.modifiedReviewed)) {
      if (interval.startLine < 0 || interval.endLineExclusive > file.lineCount) {
        throw new RangeError(`File ${file.fileId} reviewed interval is outside lineCount.`);
      }
    }
    byPath.set(file.currentPath, file.fileId);
  }
  return byPath;
}

function countByPath(
  sections: readonly FileSection[],
  selector: (section: FileSection) => string | undefined
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const path = selector(section);
    if (path !== undefined) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

function canonicalizeHorizontal(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/[^\S\r\n]+/g, ""));
}

function canonicalizeText(
  text: string,
  options: Readonly<GitDiffMappingOptions>
): string {
  const eolNormalized = text.replace(/\r\n|\r/g, "\n");
  return options.ignoreWhitespaceChanges
    ? eolNormalized.replace(/[^\S\r\n]+/g, "")
    : eolNormalized;
}

function differsByOneTerminalLineBreak(
  oldText: string,
  newText: string,
  options: Readonly<GitDiffMappingOptions>
): boolean {
  const oldCanonical = canonicalizeText(oldText, options);
  const newCanonical = canonicalizeText(newText, options);
  const oldHasTerminal = oldCanonical.endsWith("\n");
  const newHasTerminal = newCanonical.endsWith("\n");
  if (oldHasTerminal === newHasTerminal) {
    return false;
  }
  const withTerminal = oldHasTerminal ? oldCanonical : newCanonical;
  const withoutTerminal = oldHasTerminal ? newCanonical : oldCanonical;
  return !withTerminal.endsWith("\n\n") && withTerminal.slice(0, -1) === withoutTerminal;
}

function documentsDifferOnlyByIgnoredEol(
  oldText: string | undefined,
  newText: string | undefined,
  options: Readonly<GitDiffMappingOptions>
): boolean {
  if (
    !options.ignoreEolChanges ||
    oldText === undefined ||
    newText === undefined ||
    oldText === newText
  ) {
    return false;
  }
  const oldCanonical = canonicalizeText(oldText, options);
  const newCanonical = canonicalizeText(newText, options);
  return (
    oldCanonical === newCanonical ||
    differsByOneTerminalLineBreak(oldText, newText, options)
  );
}

function hasProvenUnchangedEols(
  hunk: GitDiffHunk,
  oldText: string | undefined,
  newText: string | undefined
): boolean {
  if (oldText === undefined || newText === undefined) {
    return false;
  }
  const oldEndings = Array.from(oldText.matchAll(/\r\n|\r|\n/g), (match) => match[0]);
  const newEndings = Array.from(newText.matchAll(/\r\n|\r|\n/g), (match) => match[0]);
  for (let offset = 0; offset < hunk.oldLineCount; offset += 1) {
    if (
      (oldEndings[hunk.oldStart + offset] ?? "") !==
      (newEndings[hunk.newStart + offset] ?? "")
    ) {
      return false;
    }
  }
  return true;
}

function isIgnoredHunk(
  hunk: GitDiffHunk,
  oldText: string | undefined,
  newText: string | undefined,
  options: Readonly<GitDiffMappingOptions>,
  documentEolOnly: boolean
): boolean {
  if (hunk.oldLineCount !== hunk.newLineCount) {
    return false;
  }
  if (documentEolOnly) {
    return true;
  }
  if (
    !options.ignoreWhitespaceChanges ||
    !hasProvenUnchangedEols(hunk, oldText, newText)
  ) {
    return false;
  }
  const removed = canonicalizeHorizontal(hunk.removedLines);
  const added = canonicalizeHorizontal(hunk.addedLines);
  return removed.every((line, index) => line === added[index]);
}

function intersect(
  interval: LineInterval,
  start: number,
  end: number
): LineInterval | undefined {
  const overlapStart = Math.max(interval.startLine, start);
  const overlapEnd = Math.min(interval.endLineExclusive, end);
  return overlapStart < overlapEnd
    ? { startLine: overlapStart, endLineExclusive: overlapEnd }
    : undefined;
}

function mapReviewed(
  reviewed: readonly LineInterval[],
  file: GitDiffFile,
  oldText: string | undefined,
  newText: string | undefined,
  options: Readonly<GitDiffMappingOptions>
): LineInterval[] {
  const mapped: LineInterval[] = [];
  const documentEolOnly = documentsDifferOnlyByIgnoredEol(oldText, newText, options);
  for (const interval of normalizeLineIntervals(reviewed)) {
    let cursor = interval.startLine;
    let delta = 0;
    for (const hunk of file.hunks) {
      const oldEnd = hunk.oldStart + hunk.oldLineCount;
      if (oldEnd <= interval.startLine) {
        delta += hunk.newLineCount - hunk.oldLineCount;
        continue;
      }
      if (hunk.oldStart >= interval.endLineExclusive) {
        break;
      }
      const unchangedEnd = Math.min(interval.endLineExclusive, hunk.oldStart);
      if (cursor < unchangedEnd) {
        mapped.push({
          startLine: cursor + delta,
          endLineExclusive: unchangedEnd + delta
        });
      }
      cursor = Math.max(cursor, hunk.oldStart);
      const changed = intersect(interval, hunk.oldStart, oldEnd);
      if (changed !== undefined) {
        if (isIgnoredHunk(hunk, oldText, newText, options, documentEolOnly)) {
          mapped.push({
            startLine: changed.startLine + delta,
            endLineExclusive: changed.endLineExclusive + delta
          });
        }
        cursor = Math.max(cursor, changed.endLineExclusive);
      }
      delta += hunk.newLineCount - hunk.oldLineCount;
    }
    if (cursor < interval.endLineExclusive) {
      mapped.push({
        startLine: cursor + delta,
        endLineExclusive: interval.endLineExclusive + delta
      });
    }
  }
  return normalizeLineIntervals(mapped);
}

function createUnreviewed(
  path: string,
  metadata: Readonly<GitNewFileStateInput>,
  revisionId: string,
  updatedAt: string
): FileReviewState {
  validateLineCount(metadata.lineCount, `New file ${path}`);
  return {
    schemaVersion: 1,
    fileId: metadata.fileId,
    currentPath: path,
    previousPaths: [],
    revisionId,
    modifiedReviewed: [],
    originalReviewedByDiff: {},
    lineCount: metadata.lineCount,
    updatedAt,
    ...(metadata.contentHash === undefined
      ? {}
      : { contentHash: metadata.contentHash })
  };
}

/**
 * Applies rename/copy/add/delete transitions after validating the complete transition graph.
 *
 * The input is never mutated and no partial result is returned on error. Sources are resolved from
 * the pre-transition snapshot, so chains, swaps, and delete-plus-rename sequences are order
 * independent. Copy sources remain unchanged; only copy destinations start unreviewed. Ambiguous
 * rename sources that no longer exist in the new revision are removed. Every destination that does
 * not preserve an existing stable ID requires `newFiles` metadata, and its absence rejects the
 * entire operation atomically.
 *
 * @param input Complete old snapshot, complete diff, revision metadata, settings, and content proof.
 * @returns A detached complete snapshot with file-level revisions allowed to remain mixed for unaffected files.
 * @throws On malformed metadata, missing destination metadata, invalid state, duplicate IDs/paths, unsafe line counts, or conflicting transitions.
 */
export function applyGitFileStateTransitions(
  input: Readonly<GitFileStateTransitionInput>
): GitFileStateTransitionResult {
  if (input.newRevisionId.length === 0) {
    throw new TypeError("newRevisionId must not be empty.");
  }
  if (!Number.isFinite(Date.parse(input.updatedAt))) {
    throw new TypeError("updatedAt must be an ISO-compatible timestamp.");
  }
  if (
    typeof input.options.ignoreWhitespaceChanges !== "boolean" ||
    typeof input.options.ignoreEolChanges !== "boolean"
  ) {
    throw new TypeError("Git diff mapping options must be booleans.");
  }

  const byPath = validateStateSnapshot(input.files);
  const sections = parseSections(input.diff);
  const sourceCounts = countByPath(
    sections.filter(
      (section) => section.kind === "rename" || section.kind === "copy"
    ),
    (section) => section.oldPath
  );
  const destinationCounts = countByPath(
    sections.filter(
      (section) => section.kind === "rename" || section.kind === "copy"
    ),
    (section) => section.newPath
  );
  const vacatedPaths = new Set(
    sections
      .filter(
        (section) => section.kind === "rename" || section.kind === "delete"
      )
      .map((section) => section.oldPath)
      .filter((path): path is string => path !== undefined)
  );
  const snapshot = Object.fromEntries(
    Object.entries(input.files).map(([id, state]) => [id, cloneState(state)])
  );
  const active = Object.fromEntries(
    Object.entries(snapshot).map(([id, state]) => [id, cloneState(state)])
  );
  const plannedRenames: PlannedRename[] = [];
  const plannedDeletes = new Set<string>();
  const unresolvedRenameSourceIds = new Set<string>();
  const unresolved: GitFileTransitionUnresolved[] = [];
  const newDestinations = new Map<string, FileReviewState>();

  const addDestination = (path: string): void => {
    const metadata = input.newFiles?.[path];
    if (metadata === undefined) {
      throw new RangeError(`New-file metadata is required for destination ${path}.`);
    }
    if (
      metadata.fileId in snapshot ||
      [...newDestinations.values()].some(
        (state) => state.fileId === metadata.fileId
      )
    ) {
      throw new RangeError(
        "New-file metadata fileId must be unique and must not replace an unrelated file."
      );
    }
    newDestinations.set(
      path,
      createUnreviewed(path, metadata, input.newRevisionId, input.updatedAt)
    );
  };

  for (const section of sections) {
    if (section.kind === "add" && section.newPath !== undefined) {
      addDestination(section.newPath);
      continue;
    }
    if (section.kind === "delete" && section.oldPath !== undefined) {
      const sourceId = byPath.get(section.oldPath);
      if (sourceId === undefined) {
        unresolved.push({
          oldPath: section.oldPath,
          newPath: undefined,
          reason: "missing-source-state"
        });
      } else {
        plannedDeletes.add(sourceId);
      }
      continue;
    }
    if (
      section.kind === "copy" &&
      section.oldPath !== undefined &&
      section.newPath !== undefined
    ) {
      const sourceId = byPath.get(section.oldPath);
      addDestination(section.newPath);
      unresolved.push({
        oldPath: section.oldPath,
        newPath: section.newPath,
        reason:
          sourceId === undefined
            ? "missing-source-state"
            : "ambiguous-file-mapping"
      });
      continue;
    }
    if (
      section.kind !== "rename" ||
      section.oldPath === undefined ||
      section.newPath === undefined
    ) {
      continue;
    }

    const sourceId = byPath.get(section.oldPath);
    const destinationOccupant = byPath.get(section.newPath);
    const unique =
      sourceCounts.get(section.oldPath) === 1 &&
      destinationCounts.get(section.newPath) === 1;
    const destinationAvailable =
      destinationOccupant === undefined || vacatedPaths.has(section.newPath);
    if (sourceId === undefined || !unique || !destinationAvailable) {
      if (sourceId !== undefined) {
        unresolvedRenameSourceIds.add(sourceId);
      }
      addDestination(section.newPath);
      unresolved.push({
        oldPath: section.oldPath,
        newPath: section.newPath,
        reason:
          sourceId === undefined
            ? "missing-source-state"
            : "ambiguous-file-mapping"
      });
      continue;
    }
    plannedRenames.push({ section, fileId: sourceId });
  }

  for (const fileId of plannedDeletes) {
    delete active[fileId];
  }
  for (const fileId of unresolvedRenameSourceIds) {
    if (!plannedDeletes.has(fileId)) {
      delete active[fileId];
    }
  }

  for (const plan of plannedRenames) {
    const current = snapshot[plan.fileId];
    const oldPath = plan.section.oldPath;
    const newPath = plan.section.newPath;
    if (current === undefined || oldPath === undefined || newPath === undefined) {
      throw new RangeError("Planned rename lost its source state.");
    }
    const metadata = input.newFiles?.[newPath];
    if (metadata !== undefined && metadata.fileId !== plan.fileId) {
      throw new RangeError(
        "Rename destination metadata must preserve the source fileId."
      );
    }
    const delta = plan.section.file.hunks.reduce(
      (sum, hunk) => sum + hunk.newLineCount - hunk.oldLineCount,
      0
    );
    const lineCount = metadata?.lineCount ?? current.lineCount + delta;
    validateLineCount(lineCount, `Renamed file ${newPath}`);
    const reviewed = mapReviewed(
      current.modifiedReviewed,
      plan.section.file,
      input.oldTexts?.[oldPath],
      metadata?.newText,
      input.options
    );
    if (
      reviewed.some(
        (interval) =>
          interval.startLine < 0 || interval.endLineExclusive > lineCount
      )
    ) {
      throw new RangeError(
        "Mapped reviewed interval is outside the new lineCount."
      );
    }
    const contentChanged =
      plan.section.file.hunks.length > 0 || plan.section.similarity !== 100;
    const renamed = cloneState(current);
    delete renamed.contentHash;
    active[plan.fileId] = {
      ...renamed,
      currentPath: newPath,
      previousPaths: current.previousPaths.includes(oldPath)
        ? [...current.previousPaths]
        : [...current.previousPaths, oldPath],
      revisionId: input.newRevisionId,
      modifiedReviewed: reviewed,
      lineCount,
      updatedAt: input.updatedAt,
      ...(!contentChanged &&
      metadata?.contentHash === undefined &&
      current.contentHash !== undefined
        ? { contentHash: current.contentHash }
        : metadata?.contentHash === undefined
          ? {}
          : { contentHash: metadata.contentHash })
    };
  }

  for (const [path, state] of newDestinations) {
    if (
      [...Object.values(active)].some(
        (file) => file.currentPath === path && file.fileId !== state.fileId
      )
    ) {
      throw new RangeError("New destination collides with an active file path.");
    }
    active[state.fileId] = state;
  }

  validateStateSnapshot(active);
  return {
    files: active,
    deletedFileIds: [...plannedDeletes].sort(),
    unresolved
  };
}

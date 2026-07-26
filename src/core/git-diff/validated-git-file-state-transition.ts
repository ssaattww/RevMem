import type { FileReviewState, LineInterval } from "../contracts/index";
import {
  applyGitFileStateTransitions as applyGitFileStateTransitionsUnchecked,
  type GitFileStateTransitionInput,
  type GitFileStateTransitionResult,
  type GitNewFileStateInput
} from "./git-file-state-transition";
import { parseZeroContextGitDiff } from "./git-diff-interval-mapping";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DEV_NULL = "/dev/null";

type SourceOperation = "delete" | "rename";

interface ValidatedSection {
  readonly destination?: string;
  readonly source?: string;
  readonly sourceOperation?: SourceOperation;
}

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
      a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "\"": 34
    };
    if (escaped in escapes) {
      bytes.push(escapes[escaped] as number);
      index += 2;
      continue;
    }
    const octal = raw.slice(index + 1, index + 4);
    if (!/^[0-7]{3}$/u.test(octal)) {
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

function decodeFileHeaderPath(raw: string): string {
  const tabIndex = raw.indexOf("\t");
  const path = tabIndex >= 0 ? raw.slice(0, tabIndex) : raw;
  return decodeMetadataPath(path);
}

function metadataValues(lines: readonly string[], prefix: string): readonly string[] {
  return lines.filter((line) => line.startsWith(prefix)).map((line) => decodeMetadataPath(line.slice(prefix.length)));
}

function headerPath(lines: readonly string[], prefix: "--- " | "+++ "): string | undefined {
  const headers = lines.filter((line) => line.startsWith(prefix));
  if (headers.length > 1) {
    throw new SyntaxError(`Git diff contains duplicate ${prefix.trim()} file headers.`);
  }
  const header = headers[0];
  return header === undefined ? undefined : decodeFileHeaderPath(header.slice(prefix.length));
}

function canonicalPath(path: string): string {
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

function validateSection(lines: readonly string[]): ValidatedSection {
  const renameFrom = metadataValues(lines, "rename from ");
  const renameTo = metadataValues(lines, "rename to ");
  if (renameFrom.length > 0 || renameTo.length > 0) {
    if (renameFrom.length !== 1 || renameTo.length !== 1) {
      throw new SyntaxError("Rename metadata must contain exactly one rename from and one rename to path.");
    }
    return {
      source: renameFrom[0],
      destination: renameTo[0],
      sourceOperation: "rename"
    };
  }

  const copyTo = metadataValues(lines, "copy to ");
  if (copyTo.length > 1) {
    throw new SyntaxError("Copy metadata must contain exactly one copy to path.");
  }
  if (copyTo.length === 1) {
    return { destination: copyTo[0] };
  }

  const isNewFile = lines.some((line) => line.startsWith("new file mode "));
  const isDeletedFile = lines.some((line) => line.startsWith("deleted file mode "));
  if (isNewFile && isDeletedFile) {
    throw new SyntaxError("Git diff section cannot contain both new file mode and deleted file mode.");
  }
  const oldPath = headerPath(lines, "--- ");
  const newPath = headerPath(lines, "+++ ");
  if (isNewFile) {
    if (oldPath !== DEV_NULL || newPath === undefined || newPath === DEV_NULL) {
      throw new SyntaxError("New file mode requires /dev/null on the old header side and a real destination path.");
    }
    return { destination: canonicalPath(newPath) };
  }
  if (isDeletedFile) {
    if (oldPath === undefined || oldPath === DEV_NULL || newPath !== DEV_NULL) {
      throw new SyntaxError("Deleted file mode requires a real old path and /dev/null on the new header side.");
    }
    return { source: canonicalPath(oldPath), sourceOperation: "delete" };
  }
  return {};
}

function parseAndValidateSections(diff: string): readonly ValidatedSection[] {
  const rawSections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      rawSections.push([line]);
    } else if (rawSections.length > 0) {
      rawSections[rawSections.length - 1]?.push(line);
    }
  }
  return rawSections.map(validateSection);
}

function validateUniqueDestinations(sections: readonly ValidatedSection[]): void {
  const destinations = new Set<string>();
  for (const section of sections) {
    const destination = section.destination;
    if (destination === undefined) {
      continue;
    }
    if (destinations.has(destination)) {
      throw new SyntaxError(`Git diff contains duplicate destination path: ${destination}`);
    }
    destinations.add(destination);
  }
}

function validateSourceOperations(sections: readonly ValidatedSection[]): void {
  const deletedSources = new Set<string>();
  const renamedSources = new Set<string>();
  for (const section of sections) {
    const source = section.source;
    if (source === undefined || section.sourceOperation === undefined) {
      continue;
    }
    if (section.sourceOperation === "delete") {
      if (deletedSources.has(source)) {
        throw new SyntaxError(`Git diff contains duplicate delete source operation: ${source}`);
      }
      deletedSources.add(source);
    } else {
      renamedSources.add(source);
    }
  }
  for (const source of deletedSources) {
    if (renamedSources.has(source)) {
      throw new SyntaxError(`Git diff contains conflicting delete and rename source operations: ${source}`);
    }
  }
}

function validateCanonicalIntervals(
  intervals: readonly LineInterval[],
  label: string,
  upperBound?: number
): void {
  let previousEnd = -1;
  for (const interval of intervals) {
    const { startLine, endLineExclusive } = interval;
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLineExclusive) ||
      startLine < 0 ||
      startLine >= endLineExclusive ||
      (upperBound !== undefined && endLineExclusive > upperBound)
    ) {
      throw new RangeError(`${label} contains an invalid interval.`);
    }
    if (startLine <= previousEnd) {
      throw new RangeError(`${label} must be canonical, sorted, non-overlapping, and non-adjacent.`);
    }
    previousEnd = endLineExclusive;
  }
}

function validateFileState(file: Readonly<FileReviewState>, key: string): void {
  if (file.schemaVersion !== 1) {
    throw new RangeError("File-state schemaVersion is unsupported.");
  }
  if (file.fileId.length === 0 || key !== file.fileId) {
    throw new RangeError("File-state fileId must be non-empty and match its key.");
  }
  if (file.currentPath.length === 0 || file.revisionId.length === 0 || file.updatedAt.length === 0) {
    throw new RangeError("File-state path, revisionId, and updatedAt must be non-empty.");
  }
  if (Number.isNaN(Date.parse(file.updatedAt))) {
    throw new RangeError("File-state updatedAt must be a valid timestamp.");
  }
  if (!Number.isSafeInteger(file.lineCount) || file.lineCount < 0) {
    throw new RangeError("File-state lineCount must be a non-negative safe integer.");
  }
  const previousPaths = new Set<string>();
  for (const path of file.previousPaths) {
    if (path.length === 0 || path === file.currentPath || previousPaths.has(path)) {
      throw new RangeError("File-state previousPaths must be non-empty, unique, and exclude currentPath.");
    }
    previousPaths.add(path);
  }
  if (file.contentHash !== undefined && file.contentHash.length === 0) {
    throw new RangeError("File-state contentHash must be non-empty when present.");
  }
  validateCanonicalIntervals(file.modifiedReviewed, "modifiedReviewed", file.lineCount);
  for (const [diffId, intervals] of Object.entries(file.originalReviewedByDiff)) {
    if (diffId.length === 0) {
      throw new RangeError("originalReviewedByDiff diff ID must be non-empty.");
    }
    validateCanonicalIntervals(intervals, `originalReviewedByDiff[${diffId}]`);
  }
}

function validateStateSnapshot(files: Readonly<Record<string, Readonly<FileReviewState>>>): void {
  const paths = new Set<string>();
  for (const [key, file] of Object.entries(files)) {
    validateFileState(file, key);
    if (paths.has(file.currentPath)) {
      throw new RangeError("File-state currentPath values must be unique.");
    }
    paths.add(file.currentPath);
  }
}

interface TextDocumentEvidence {
  readonly endings: readonly string[];
  readonly lines: readonly string[];
}

function parseTextDocumentEvidence(text: string): TextDocumentEvidence {
  if (text.length === 0) {
    return { lines: [], endings: [] };
  }
  const lines: string[] = [];
  const endings: string[] = [];
  let cursor = 0;
  const separators = /\r\n|\r|\n/gu;
  let separator: RegExpExecArray | null;
  while ((separator = separators.exec(text)) !== null) {
    lines.push(text.slice(cursor, separator.index));
    endings.push(separator[0]);
    cursor = separator.index + separator[0].length;
  }
  if (cursor < text.length) {
    lines.push(text.slice(cursor));
    endings.push("");
  }
  return { lines, endings };
}

function textLines(text: string): readonly string[] {
  return parseTextDocumentEvidence(text).lines;
}

function validateNewFileMetadata(
  newFiles: Readonly<Record<string, Readonly<GitNewFileStateInput>>> | undefined
): void {
  if (newFiles === undefined) {
    return;
  }
  for (const [path, metadata] of Object.entries(newFiles)) {
    if (path.length === 0 || metadata.fileId.length === 0) {
      throw new RangeError("newFiles path and fileId must be non-empty.");
    }
    if (!Number.isSafeInteger(metadata.lineCount) || metadata.lineCount < 0) {
      throw new RangeError("newFiles lineCount must be a non-negative safe integer.");
    }
    if (metadata.contentHash !== undefined && metadata.contentHash.length === 0) {
      throw new RangeError("newFiles contentHash must be non-empty when present.");
    }
    if (metadata.newText !== undefined && textLines(metadata.newText).length !== metadata.lineCount) {
      throw new RangeError("newFiles newText line count must equal lineCount.");
    }
  }
}

function equalLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function reconstructNewLines(
  oldLines: readonly string[],
  hunks: readonly { oldStart: number; oldLineCount: number; addedLines: readonly string[] }[]
): string[] {
  const reconstructed: string[] = [];
  let oldCursor = 0;
  for (const hunk of hunks) {
    reconstructed.push(...oldLines.slice(oldCursor, hunk.oldStart));
    reconstructed.push(...hunk.addedLines);
    oldCursor = hunk.oldStart + hunk.oldLineCount;
  }
  reconstructed.push(...oldLines.slice(oldCursor));
  return reconstructed;
}

function reconstructNewEndings(
  oldEndings: readonly string[],
  hunks: readonly { oldStart: number; oldLineCount: number; newLineCount: number }[]
): readonly (string | undefined)[] {
  const reconstructed: (string | undefined)[] = [];
  let oldCursor = 0;
  for (const hunk of hunks) {
    reconstructed.push(...oldEndings.slice(oldCursor, hunk.oldStart));
    for (let index = 0; index < hunk.newLineCount; index += 1) {
      reconstructed.push(
        index < hunk.oldLineCount ? oldEndings[hunk.oldStart + index] : undefined
      );
    }
    oldCursor = hunk.oldStart + hunk.oldLineCount;
  }
  reconstructed.push(...oldEndings.slice(oldCursor));
  return reconstructed;
}

function hasMatchingEolSignature(
  expectedEndings: readonly (string | undefined)[],
  actualEndings: readonly string[]
): boolean {
  return (
    expectedEndings.length === actualEndings.length &&
    expectedEndings.every((ending, index) => ending === undefined || ending === actualEndings[index])
  );
}

function validateFullTextEvidence(input: Readonly<GitFileStateTransitionInput>): void {
  if (!input.options.ignoreWhitespaceChanges && !input.options.ignoreEolChanges) {
    return;
  }
  const parsed = parseZeroContextGitDiff(input.diff);
  const stateByPath = new Map(Object.values(input.files).map((file) => [file.currentPath, file]));
  for (const file of parsed.files) {
    if (file.oldPath === undefined || file.newPath === undefined) {
      continue;
    }
    const oldText = input.oldTexts?.[file.oldPath];
    const newMetadata = input.newFiles?.[file.newPath];
    const newText = newMetadata?.newText;
    if (oldText === undefined || newText === undefined) {
      continue;
    }
    const oldDocument = parseTextDocumentEvidence(oldText);
    const newDocument = parseTextDocumentEvidence(newText);
    const oldLines = oldDocument.lines;
    const newLines = newDocument.lines;
    const oldState = stateByPath.get(file.oldPath);
    if (oldState !== undefined && oldLines.length !== oldState.lineCount) {
      throw new RangeError("oldTexts line count must equal the source file-state lineCount.");
    }
    for (const hunk of file.hunks) {
      const removed = oldLines.slice(hunk.oldStart, hunk.oldStart + hunk.oldLineCount);
      const added = newLines.slice(hunk.newStart, hunk.newStart + hunk.newLineCount);
      if (!equalLines(removed, hunk.removedLines) || !equalLines(added, hunk.addedLines)) {
        throw new SyntaxError("Full-text evidence does not match the parsed diff hunk.");
      }
    }
    if (!equalLines(reconstructNewLines(oldLines, file.hunks), newLines)) {
      throw new SyntaxError("Full-text evidence does not reconstruct the complete new document.");
    }
    if (
      !input.options.ignoreEolChanges &&
      !hasMatchingEolSignature(
        reconstructNewEndings(oldDocument.endings, file.hunks),
        newDocument.endings
      )
    ) {
      throw new SyntaxError("Full-text evidence does not preserve the required EOL signature.");
    }
  }
}

function canonicalizeRenameHistory(
  input: Readonly<GitFileStateTransitionInput>,
  sections: readonly ValidatedSection[],
  result: GitFileStateTransitionResult
): GitFileStateTransitionResult {
  const inputByPath = new Map(Object.values(input.files).map((file) => [file.currentPath, file]));
  const renameByDestination = new Map<string, string>(
    sections
      .filter(
        (section): section is ValidatedSection & { source: string; destination: string } =>
          section.sourceOperation === "rename" &&
          section.source !== undefined &&
          section.destination !== undefined
      )
      .map((section) => [section.destination, section.source])
  );
  const files = Object.fromEntries(
    Object.entries(result.files).map(([fileId, file]) => {
      const source = renameByDestination.get(file.currentPath);
      const sourceState = source === undefined ? undefined : inputByPath.get(source);
      if (source === undefined || sourceState?.fileId !== file.fileId) {
        return [fileId, file];
      }
      const previousPaths = file.previousPaths.filter((path) => path !== file.currentPath);
      if (!previousPaths.includes(source)) {
        previousPaths.push(source);
      }
      return [fileId, { ...file, previousPaths }];
    })
  );
  return { ...result, files };
}

function validateResultConsistency(result: Readonly<GitFileStateTransitionResult>): void {
  const deleted = new Set<string>();
  for (const fileId of result.deletedFileIds) {
    if (fileId.length === 0 || deleted.has(fileId)) {
      throw new RangeError("deletedFileIds must contain unique non-empty file IDs.");
    }
    if (fileId in result.files) {
      throw new RangeError("A file ID cannot be present in both files and deletedFileIds.");
    }
    deleted.add(fileId);
  }
}

/**
 * Validates the complete state snapshot, transition metadata, full-text evidence, and result snapshot.
 *
 * @param input Complete transition input accepted by the underlying T204 engine.
 * @returns The detached complete post-transition snapshot.
 * @throws When state invariants, generated-file metadata, Git transition metadata, or text evidence are malformed.
 */
export function applyGitFileStateTransitions(
  input: Readonly<GitFileStateTransitionInput>
): GitFileStateTransitionResult {
  validateStateSnapshot(input.files);
  validateNewFileMetadata(input.newFiles);
  const sections = parseAndValidateSections(input.diff);
  validateUniqueDestinations(sections);
  validateSourceOperations(sections);
  validateFullTextEvidence(input);
  const result = canonicalizeRenameHistory(
    input,
    sections,
    applyGitFileStateTransitionsUnchecked(input)
  );
  validateStateSnapshot(result.files);
  validateResultConsistency(result);
  return result;
}

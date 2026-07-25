import {
  applyGitFileStateTransitions as applyGitFileStateTransitionsUnchecked,
  type GitFileStateTransitionInput,
  type GitFileStateTransitionResult
} from "./git-file-state-transition";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DEV_NULL = "/dev/null";

interface ValidatedSection {
  readonly destination?: string;
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
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => decodeMetadataPath(line.slice(prefix.length)));
}

function headerPath(lines: readonly string[], prefix: "--- " | "+++ "): string | undefined {
  const headers = lines.filter((line) => line.startsWith(prefix));
  if (headers.length > 1) {
    throw new SyntaxError(`Git diff contains duplicate ${prefix.trim()} file headers.`);
  }
  const header = headers[0];
  return header === undefined ? undefined : decodeFileHeaderPath(header.slice(prefix.length));
}

function canonicalDestination(path: string): string {
  return path.startsWith("b/") ? path.slice(2) : path;
}

function validateSection(lines: readonly string[]): ValidatedSection {
  const renameFrom = metadataValues(lines, "rename from ");
  const renameTo = metadataValues(lines, "rename to ");
  const hasRenameMetadata = renameFrom.length > 0 || renameTo.length > 0;
  if (hasRenameMetadata) {
    if (renameFrom.length !== 1 || renameTo.length !== 1) {
      throw new SyntaxError("Rename metadata must contain exactly one rename from and one rename to path.");
    }
    return { destination: renameTo[0] };
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
    return { destination: canonicalDestination(newPath) };
  }

  if (isDeletedFile) {
    if (oldPath === undefined || oldPath === DEV_NULL || newPath !== DEV_NULL) {
      throw new SyntaxError("Deleted file mode requires a real old path and /dev/null on the new header side.");
    }
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

/**
 * Validates transition metadata and cross-section destination uniqueness before applying the atomic T204 transition.
 *
 * @param input Complete transition input accepted by the underlying T204 engine.
 * @returns The detached complete post-transition snapshot.
 * @throws When rename metadata is incomplete or duplicated, add/delete headers contradict file status,
 * or multiple copy, rename, or addition sections target the same destination path.
 */
export function applyGitFileStateTransitions(
  input: Readonly<GitFileStateTransitionInput>
): GitFileStateTransitionResult {
  const sections = parseAndValidateSections(input.diff);
  validateUniqueDestinations(sections);
  return applyGitFileStateTransitionsUnchecked(input);
}

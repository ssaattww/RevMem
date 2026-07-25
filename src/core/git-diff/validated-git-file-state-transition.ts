import {
  applyGitFileStateTransitions as applyGitFileStateTransitionsUnchecked,
  type GitFileStateTransitionInput,
  type GitFileStateTransitionResult
} from "./git-file-state-transition";

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

function destinationOfSection(lines: readonly string[]): string | undefined {
  const copyTo = lines.find((line) => line.startsWith("copy to "));
  if (copyTo !== undefined) {
    return decodeMetadataPath(copyTo.slice("copy to ".length));
  }
  const renameTo = lines.find((line) => line.startsWith("rename to "));
  if (renameTo !== undefined) {
    return decodeMetadataPath(renameTo.slice("rename to ".length));
  }
  if (lines.some((line) => line.startsWith("new file mode "))) {
    const newHeader = lines.find((line) => line.startsWith("+++ "));
    if (newHeader === undefined || newHeader === "+++ /dev/null") {
      throw new SyntaxError("New-file section is missing its destination header.");
    }
    const rawPath = newHeader.slice("+++ ".length);
    const decoded = decodeFileHeaderPath(rawPath);
    return decoded.startsWith("b/") ? decoded.slice(2) : decoded;
  }
  return undefined;
}

function validateUniqueDestinations(diff: string): void {
  const sections: string[][] = [];
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
    } else if (sections.length > 0) {
      sections[sections.length - 1]?.push(line);
    }
  }

  const destinations = new Set<string>();
  for (const section of sections) {
    const destination = destinationOfSection(section);
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
 * Validates cross-section destination uniqueness before applying the atomic T204 transition.
 *
 * @param input Complete transition input accepted by the underlying T204 engine.
 * @returns The detached complete post-transition snapshot.
 * @throws When multiple copy, rename, or addition sections target the same destination path.
 */
export function applyGitFileStateTransitions(
  input: Readonly<GitFileStateTransitionInput>
): GitFileStateTransitionResult {
  validateUniqueDestinations(input.diff);
  return applyGitFileStateTransitionsUnchecked(input);
}

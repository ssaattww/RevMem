import type { FileSystemPathSemantics } from "../workspace-identity/index";

const WINDOWS_RELATIVE_DRIVE_PATTERN = /^[A-Za-z]:(?:\/|$)/u;

const containsUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const containsWindowsForbiddenControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/**
 * Validates a canonical repository-relative path using workspace filesystem semantics.
 *
 * POSIX paths retain every filename character except NUL and `/` separators. Windows
 * paths use `/` as the canonical separator and reject backslashes and control characters.
 * Neither form normalizes `.` or `..`; non-canonical input is rejected instead.
 */
export function requireCanonicalRepositoryRelativePath(
  value: unknown,
  pathSemantics: FileSystemPathSemantics,
  name = "repositoryRelativePath"
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new TypeError(`${name} must not contain a null character`);
  }
  if (containsUnpairedSurrogate(value)) {
    throw new TypeError(`${name} must be well-formed UTF-16`);
  }
  if (pathSemantics !== "posix" && pathSemantics !== "windows") {
    throw new TypeError('pathSemantics must be either "posix" or "windows"');
  }
  if (
    value.startsWith("/") ||
    (pathSemantics === "windows" && WINDOWS_RELATIVE_DRIVE_PATTERN.test(value))
  ) {
    throw new TypeError(`${name} must be repository-relative`);
  }
  if (pathSemantics === "windows") {
    if (value.includes("\\")) {
      throw new TypeError(`${name} must use forward slashes as canonical separators`);
    }
    if (containsWindowsForbiddenControl(value)) {
      throw new TypeError(`${name} contains a character forbidden by Windows semantics`);
    }
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError(`${name} must not contain empty, dot, or parent segments`);
  }

  return value;
}

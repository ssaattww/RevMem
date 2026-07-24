/** Default repository-relative globs excluded from review progress and understanding metrics. */
export const DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS = Object.freeze([
  "**/.git/**",
  "**/node_modules/**",
  "**/bin/**",
  "**/obj/**",
  "**/dist/**",
  "**/build/**"
] as const);

/** Git or GitHub changed-file attributes consumed by the shared exclusion policy. */
export interface ReviewFileExclusionCandidate {
  /** Repository-relative path. Git path matching remains case-sensitive. */
  readonly path: string;
  /** Whether the upstream diff or file inspection classified the file as binary. */
  readonly isBinary: boolean;
}

/** Stable reason retained for progress views and later Global aggregation reporting. */
export type ReviewFileExclusionReason =
  | { readonly kind: "binary" }
  | { readonly kind: "default-glob"; readonly pattern: string }
  | { readonly kind: "user-glob"; readonly pattern: string };

/** Result of evaluating one repository file against the shared exclusion policy. */
export type ReviewFileExclusionDecision =
  | {
      readonly excluded: false;
      readonly normalizedPath: string;
    }
  | {
      readonly excluded: true;
      readonly normalizedPath: string;
      readonly reason: ReviewFileExclusionReason;
    };

/** Constructor options for a shared review-file exclusion policy snapshot. */
export interface ReviewFileExclusionPolicyOptions {
  /** User-configured exclusion globs. Blank and duplicate patterns are removed. */
  readonly userGlobs?: readonly string[];
}

interface CompiledGlob {
  readonly pattern: string;
  readonly expressions: readonly RegExp[];
}

const REGULAR_EXPRESSION_META_CHARACTERS = /[\\^$.*+?()[\]{}|]/;

const escapeRegularExpressionCharacter = (character: string): string =>
  REGULAR_EXPRESSION_META_CHARACTERS.test(character)
    ? `\\${character}`
    : character;

const splitPathSegments = (value: string): readonly string[] => value.split("/");

const normalizeRepositoryRelativePath = (path: string): string => {
  if (typeof path !== "string" || path.length === 0 || path.includes("\u0000")) {
    throw new RangeError("A non-empty repository-relative path is required.");
  }

  let normalized = path.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/{2,}/g, "/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new RangeError("A non-empty repository-relative path is required.");
  }

  const segments: string[] = [];
  for (const segment of splitPathSegments(normalized)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new RangeError("A repository-relative path cannot escape its repository.");
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new RangeError("A non-empty repository-relative path is required.");
  }
  return segments.join("/");
};

const normalizeGlob = (pattern: string): string | undefined => {
  if (typeof pattern !== "string") {
    throw new TypeError("Exclusion glob must be a string.");
  }

  let normalized = pattern.trim().replaceAll("\\", "/");
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.startsWith("!")) {
    throw new RangeError("Negated glob patterns are not supported by the exclusion policy.");
  }
  if (normalized.includes("\u0000")) {
    throw new RangeError("Exclusion glob cannot contain a NUL character.");
  }

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new RangeError("Exclusion glob must be repository-relative.");
  }
  if (splitPathSegments(normalized).includes("..")) {
    throw new RangeError("Exclusion glob cannot escape its repository.");
  }
  if (normalized.endsWith("/")) {
    normalized += "**";
  }
  return normalized;
};

const findBraceClose = (pattern: string, openIndex: number): number => {
  let depth = 0;
  for (let index = openIndex; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

const splitBraceAlternatives = (value: string): readonly string[] => {
  const alternatives: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      alternatives.push(value.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(value.slice(start));
  return alternatives;
};

const expandBraces = (pattern: string): readonly string[] => {
  const openIndex = pattern.indexOf("{");
  if (openIndex < 0) {
    if (pattern.includes("}")) {
      throw new RangeError("Exclusion glob contains an unmatched closing brace.");
    }
    return [pattern];
  }

  const closeIndex = findBraceClose(pattern, openIndex);
  if (closeIndex < 0) {
    throw new RangeError("Exclusion glob contains an unmatched opening brace.");
  }

  const alternatives = splitBraceAlternatives(
    pattern.slice(openIndex + 1, closeIndex)
  );
  if (alternatives.some((alternative) => alternative.length === 0)) {
    throw new RangeError("Exclusion glob brace alternatives cannot be empty.");
  }

  const expanded: string[] = [];
  for (const alternative of alternatives) {
    expanded.push(
      ...expandBraces(
        pattern.slice(0, openIndex) + alternative + pattern.slice(closeIndex + 1)
      )
    );
  }
  return expanded;
};

const compileCharacterClass = (
  pattern: string,
  startIndex: number
): { readonly source: string; readonly nextIndex: number } | undefined => {
  const closeIndex = pattern.indexOf("]", startIndex + 1);
  if (closeIndex < 0 || closeIndex === startIndex + 1) {
    return undefined;
  }

  let contents = pattern.slice(startIndex + 1, closeIndex);
  if (contents.startsWith("!")) {
    contents = `^${contents.slice(1)}`;
  } else if (contents.startsWith("^")) {
    contents = `\\${contents}`;
  }
  contents = contents.replaceAll("\\", "\\\\");
  return {
    source: `[${contents}]`,
    nextIndex: closeIndex + 1
  };
};

const compileExpandedGlob = (expandedPattern: string): RegExp => {
  const pattern = expandedPattern.includes("/")
    ? expandedPattern
    : `**/${expandedPattern}`;
  let source = "^";

  for (let index = 0; index < pattern.length;) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
      continue;
    }
    if (character === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    if (character === "[") {
      const characterClass = compileCharacterClass(pattern, index);
      if (characterClass !== undefined) {
        source += characterClass.source;
        index = characterClass.nextIndex;
        continue;
      }
    }

    source += escapeRegularExpressionCharacter(character);
    index += 1;
  }

  source += "$";
  return new RegExp(source);
};

const compileGlob = (pattern: string): CompiledGlob => ({
  pattern,
  expressions: expandBraces(pattern).map(compileExpandedGlob)
});

const normalizeGlobList = (patterns: readonly string[]): readonly string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const value = normalizeGlob(pattern);
    if (value !== undefined && !seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  return normalized;
};

const firstMatchingGlob = (
  path: string,
  globs: readonly CompiledGlob[]
): CompiledGlob | undefined => globs.find(({ expressions }) =>
  expressions.some((expression) => expression.test(path))
);

/**
 * Evaluates Git and GitHub changed files using one immutable policy snapshot.
 *
 * Binary classification has priority, followed by the designed defaults and then user globs.
 * The first matching pattern is retained so PR and Global views can report a deterministic
 * exclusion reason without duplicating matching logic.
 */
export class ReviewFileExclusionPolicy {
  private readonly defaultGlobs: readonly CompiledGlob[];
  private readonly userGlobs: readonly CompiledGlob[];

  public constructor(options: ReviewFileExclusionPolicyOptions = {}) {
    this.defaultGlobs = DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS.map(compileGlob);
    this.userGlobs = normalizeGlobList(options.userGlobs ?? []).map(compileGlob);
  }

  /** Returns a detached normalized snapshot of the configured user globs. */
  public getUserGlobs(): readonly string[] {
    return this.userGlobs.map(({ pattern }) => pattern);
  }

  /** Determines whether one changed file is excluded and retains the decisive reason. */
  public evaluate(
    candidate: Readonly<ReviewFileExclusionCandidate>
  ): ReviewFileExclusionDecision {
    const normalizedPath = normalizeRepositoryRelativePath(candidate.path);
    if (candidate.isBinary) {
      return {
        excluded: true,
        normalizedPath,
        reason: { kind: "binary" }
      };
    }

    const defaultGlob = firstMatchingGlob(normalizedPath, this.defaultGlobs);
    if (defaultGlob !== undefined) {
      return {
        excluded: true,
        normalizedPath,
        reason: { kind: "default-glob", pattern: defaultGlob.pattern }
      };
    }

    const userGlob = firstMatchingGlob(normalizedPath, this.userGlobs);
    if (userGlob !== undefined) {
      return {
        excluded: true,
        normalizedPath,
        reason: { kind: "user-glob", pattern: userGlob.pattern }
      };
    }

    return { excluded: false, normalizedPath };
  }
}

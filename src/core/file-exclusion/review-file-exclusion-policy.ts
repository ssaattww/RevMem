/** Default repository-relative globs excluded from review progress and understanding metrics. */
export const DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS = Object.freeze([
  "**/.git/**",
  "**/node_modules/**",
  "**/bin/**",
  "**/obj/**",
  "**/dist/**",
  "**/build/**"
] as const);

/** Repository-relative globs that remain excluded even when the effective setting is empty. */
const ALWAYS_REVIEW_FILE_EXCLUDE_GLOBS = Object.freeze([
  "**/.git/**"
] as const);

/** Maximum raw user glob entries accepted from one configuration snapshot. */
export const MAX_REVIEW_FILE_EXCLUDE_GLOBS = 256;
/** Maximum UTF-16 code-unit length of one exclusion glob. */
export const MAX_REVIEW_FILE_EXCLUDE_GLOB_LENGTH = 1024;
/** Maximum total brace-expanded regular expressions compiled for user globs. */
export const MAX_REVIEW_FILE_EXCLUDE_EXPRESSIONS = 1024;
const MAX_REVIEW_FILE_EXCLUDE_BRACE_DEPTH = 32;

/** Git or GitHub changed-file attributes consumed by the shared exclusion policy. */
export interface ReviewFileExclusionCandidate {
  /** Git-format repository-relative path. Slash is the only separator and backslash is data. */
  readonly path: string;
  /** Whether the upstream diff or file inspection classified the file as binary. */
  readonly isBinary: boolean;
}

/** Stable reason retained for progress views and later Global aggregation reporting. */
export type ReviewFileExclusionReason =
  /** The candidate is binary regardless of its path. */
  | { readonly kind: "binary" }
  /** A manifest-known exclusion glob decided the result. */
  | {
    readonly kind: "default-glob";
    /** Replay-safe canonical glob text; literal backslashes are represented by two backslashes. */
    readonly pattern: string;
  }
  /** An exclusion glob added outside the manifest defaults decided the result. */
  | {
    readonly kind: "user-glob";
    /** Replay-safe canonical glob text; literal backslashes are represented by two backslashes. */
    readonly pattern: string;
  };

/** Result of evaluating one repository file against the shared exclusion policy. */
export type ReviewFileExclusionDecision =
  /** The candidate remains included after path and binary checks. */
  | { readonly excluded: false; readonly normalizedPath: string }
  /** The candidate is excluded and carries the stable decisive reason. */
  | { readonly excluded: true; readonly normalizedPath: string; readonly reason: ReviewFileExclusionReason };

/** Constructor options for a shared review-file exclusion policy snapshot. Omitted entries use manifest defaults. */
export interface ReviewFileExclusionPolicyOptions {
  /**
   * Raw setting entries or a canonical snapshot. Omission uses manifest defaults, while an explicit
   * empty array retains only binary and `.git` exclusion. Blank and duplicate patterns are removed.
   */
  readonly userGlobs?: readonly string[];
}

/** One normalized glob and its compiled regular expressions. */
interface CompiledGlob {
  /** Normalized glob text retained for decisions and snapshots. */
  readonly pattern: string;
  /** Expanded regular expressions that implement the glob. */
  readonly expressions: readonly RegExp[];
}

/** One compiled effective glob together with its externally stable reason kind. */
interface EffectiveCompiledGlob extends CompiledGlob {
  /** Reason kind reported when this glob matches. */
  readonly reasonKind: "default-glob" | "user-glob";
}

/** Shared counter used to enforce the expanded-expression ceiling. */
interface ExpansionBudget {
  /** Number of expressions compiled so far. */
  count: number;
  /** Maximum number of expressions permitted for this compile operation. */
  readonly limit: number;
}

const REGULAR_EXPRESSION_META_CHARACTERS = /[\\^$.*+?()[\]{}|]/;
const escapeRegularExpressionCharacter = (character: string): string =>
  REGULAR_EXPRESSION_META_CHARACTERS.test(character) ? `\\${character}` : character;
const splitPathSegments = (value: string): readonly string[] => value.split("/");

const normalizeRepositoryRelativePath = (path: string): string => {
  if (typeof path !== "string" || path.length === 0 || path.includes("\u0000")) {
    throw new RangeError("A non-empty repository-relative path is required.");
  }

  let normalized = path;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/{2,}/g, "/");

  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new RangeError("A non-empty repository-relative path is required.");
  }

  const segments: string[] = [];
  for (const segment of splitPathSegments(normalized)) {
    if (segment === "" || segment === ".") continue;
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
  if (typeof pattern !== "string") throw new TypeError("Exclusion glob must be a string.");
  if (pattern.length > MAX_REVIEW_FILE_EXCLUDE_GLOB_LENGTH) {
    throw new RangeError(`Exclusion glob is too long; maximum is ${MAX_REVIEW_FILE_EXCLUDE_GLOB_LENGTH}.`);
  }

  let normalized = "";
  const trimmed = pattern.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "\\") {
      normalized += trimmed[index];
      continue;
    }
    if (trimmed[index + 1] === "\\") {
      normalized += "\\";
      index += 1;
      continue;
    }
    normalized += "/";
  }
  if (normalized.length === 0) return undefined;
  if (normalized.startsWith("!")) {
    throw new RangeError("Negated glob patterns are not supported by the exclusion policy.");
  }
  if (normalized.includes("\u0000")) throw new RangeError("Exclusion glob cannot contain a NUL character.");

  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new RangeError("Exclusion glob must be repository-relative.");
  }
  if (splitPathSegments(normalized).includes("..")) {
    throw new RangeError("Exclusion glob cannot escape its repository.");
  }
  if (normalized.endsWith("/")) normalized += "**";
  return normalized;
};

const findBraceClose = (pattern: string, openIndex: number): number => {
  let depth = 0;
  for (let index = openIndex; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
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
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      alternatives.push(value.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(value.slice(start));
  return alternatives;
};

const expandBraces = (
  pattern: string,
  budget: ExpansionBudget,
  depth = 0
): readonly string[] => {
  if (depth > MAX_REVIEW_FILE_EXCLUDE_BRACE_DEPTH) {
    throw new RangeError("Exclusion glob brace nesting limit exceeded.");
  }
  const openIndex = pattern.indexOf("{");
  if (openIndex < 0) {
    if (pattern.includes("}")) throw new RangeError("Exclusion glob contains an unmatched closing brace.");
    budget.count += 1;
    if (budget.count > budget.limit) {
      throw new RangeError(`Exclusion glob expansion limit exceeded; maximum is ${budget.limit}.`);
    }
    return [pattern];
  }

  const closeIndex = findBraceClose(pattern, openIndex);
  if (closeIndex < 0) throw new RangeError("Exclusion glob contains an unmatched opening brace.");
  const alternatives = splitBraceAlternatives(pattern.slice(openIndex + 1, closeIndex));
  if (alternatives.some((alternative) => alternative.length === 0)) {
    throw new RangeError("Exclusion glob brace alternatives cannot be empty.");
  }

  const expanded: string[] = [];
  for (const alternative of alternatives) {
    expanded.push(...expandBraces(
      pattern.slice(0, openIndex) + alternative + pattern.slice(closeIndex + 1),
      budget,
      depth + 1
    ));
  }
  return expanded;
};

const compileCharacterClass = (
  pattern: string,
  startIndex: number
): { readonly source: string; readonly nextIndex: number } | undefined => {
  const closeIndex = pattern.indexOf("]", startIndex + 1);
  if (closeIndex < 0 || closeIndex === startIndex + 1) return undefined;
  let contents = pattern.slice(startIndex + 1, closeIndex);
  if (contents.startsWith("!")) contents = `^${contents.slice(1)}`;
  else if (contents.startsWith("^")) contents = `\\${contents}`;
  contents = contents.replaceAll("\\", "\\\\");
  return { source: `[${contents}]`, nextIndex: closeIndex + 1 };
};

const compileExpandedGlob = (expandedPattern: string): RegExp => {
  const pattern = expandedPattern.includes("/") ? expandedPattern : `**/${expandedPattern}`;
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
  return new RegExp(`${source}$`);
};

const compileGlobList = (
  patterns: readonly string[],
  budget: ExpansionBudget
): readonly CompiledGlob[] => {
  return patterns.map((pattern) => ({
    pattern,
    expressions: expandBraces(pattern, budget).map(compileExpandedGlob)
  }));
};

const normalizeGlobList = (patterns: readonly string[]): readonly string[] => {
  if (patterns.length > MAX_REVIEW_FILE_EXCLUDE_GLOBS) {
    throw new RangeError(`Too many exclusion globs; maximum is ${MAX_REVIEW_FILE_EXCLUDE_GLOBS}.`);
  }
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

/** Escapes each literal backslash so a normalized glob can be safely replayed as raw input. */
const toCanonicalGlob = (normalizedGlob: string): string => normalizedGlob.replaceAll("\\", "\\\\");

const firstMatchingGlob = <T extends CompiledGlob>(
  path: string,
  globs: readonly T[]
): T | undefined =>
  globs.find(({ expressions }) => expressions.some((expression) => expression.test(path)));

const defaultGlobSet = new Set<string>(DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS);
const alwaysGlobSet = new Set<string>(ALWAYS_REVIEW_FILE_EXCLUDE_GLOBS);

/** Evaluates Git and GitHub changed files using one immutable policy snapshot. */
export class ReviewFileExclusionPolicy {
  private readonly alwaysGlobs: readonly CompiledGlob[];
  private readonly effectiveGlobs: readonly EffectiveCompiledGlob[];

  public constructor(options: ReviewFileExclusionPolicyOptions = {}) {
    this.alwaysGlobs = compileGlobList(
      ALWAYS_REVIEW_FILE_EXCLUDE_GLOBS,
      { count: 0, limit: ALWAYS_REVIEW_FILE_EXCLUDE_GLOBS.length }
    );
    const inputGlobs = options.userGlobs ?? DEFAULT_REVIEW_FILE_EXCLUDE_GLOBS;
    const normalizedEffectiveGlobs = normalizeGlobList(inputGlobs)
      .filter((glob) => !alwaysGlobSet.has(glob));
    const budget: ExpansionBudget = { count: 0, limit: MAX_REVIEW_FILE_EXCLUDE_EXPRESSIONS };
    this.effectiveGlobs = compileGlobList(normalizedEffectiveGlobs, budget).map((glob) => ({
      ...glob,
      reasonKind: defaultGlobSet.has(glob.pattern) ? "default-glob" : "user-glob"
    }));
  }

  /** Returns a detached replay-safe canonical snapshot of decision-bearing effective exclusion globs. */
  public getUserGlobs(): readonly string[] {
    return this.effectiveGlobs.map(({ pattern }) => toCanonicalGlob(pattern));
  }

  /** Determines whether one changed file is excluded and retains the decisive reason. */
  public evaluate(candidate: Readonly<ReviewFileExclusionCandidate>): ReviewFileExclusionDecision {
    const normalizedPath = normalizeRepositoryRelativePath(candidate.path);
    if (candidate.isBinary) return { excluded: true, normalizedPath, reason: { kind: "binary" } };
    const alwaysGlob = firstMatchingGlob(normalizedPath, this.alwaysGlobs);
    if (alwaysGlob !== undefined) {
      return {
        excluded: true,
        normalizedPath,
        reason: { kind: "default-glob", pattern: toCanonicalGlob(alwaysGlob.pattern) }
      };
    }
    const effectiveGlob = firstMatchingGlob(normalizedPath, this.effectiveGlobs);
    if (effectiveGlob !== undefined) {
      return {
        excluded: true,
        normalizedPath,
        reason: { kind: effectiveGlob.reasonKind, pattern: toCanonicalGlob(effectiveGlob.pattern) }
      };
    }
    return { excluded: false, normalizedPath };
  }
}

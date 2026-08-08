import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  type ReviewFileExclusionCandidate,
  type ReviewFileExclusionDecision,
  type ReviewFileExclusionReason
} from "../../core/file-exclusion/review-file-exclusion-policy";

/** A repository file that contributes non-empty lines to the Global denominator candidate set. */
export interface IncludedRepositoryFile {
  readonly path: string;
  readonly nonEmptyLineCount: number;
}

export type RepositoryFileEnumerationExclusionReason =
  | ReviewFileExclusionReason
  | { readonly kind: "gitignore"; readonly pattern: string }
  | { readonly kind: "symbolic-link" }
  | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" };

/** One concrete file identity excluded from Global aggregation. */
export interface ExcludedRepositoryFile {
  readonly path: string;
  readonly reason: RepositoryFileEnumerationExclusionReason;
}

/**
 * One pruned directory identity excluded from traversal.
 *
 * This record represents exactly one directory, not every descendant file. Descendant identities and counts are
 * deliberately unknown because traversal stops at the directory boundary. T505 may display this as a separate
 * excluded-directory diagnostic, but must not add it to the excluded-file count or the Global line denominator.
 */
export interface ExcludedRepositoryDirectory {
  readonly path: string;
  readonly reason: Exclude<
    RepositoryFileEnumerationExclusionReason,
    { readonly kind: "symbolic-link" | "invalid-encoding" }
  >;
}

/**
 * Stable public boundary between repository enumeration and later Global calculation/UI tasks.
 *
 * `included` and `excluded` contain file identities only. `excludedDirectories` contains one entry per pruned
 * directory and never expands descendants. T504 consumes only `included` for denominator calculation. T505 reports
 * `excluded.length` as excluded files and may report `excludedDirectories.length` separately; the two counts must
 * never be merged. All arrays are repository-path sorted and contain no duplicate path within the same array.
 */
export interface RepositoryFileEnumerationResult {
  readonly included: readonly IncludedRepositoryFile[];
  readonly excluded: readonly ExcludedRepositoryFile[];
  readonly excludedDirectories: readonly ExcludedRepositoryDirectory[];
}

interface GitIgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly expression: RegExp;
}

interface WalkResult {
  readonly files: string[];
  readonly excluded: ExcludedRepositoryFile[];
  readonly excludedDirectories: ExcludedRepositoryDirectory[];
}

const toRepositoryPath = (value: string): string => value.split(path.sep).join("/");
const escapeRegExp = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

const compileGitIgnorePattern = (pattern: string): string => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  return source;
};

const compileGitIgnoreRule = (rawLine: string): GitIgnoreRule | undefined => {
  let line = rawLine.trim();
  if (line.length === 0 || line.startsWith("#")) return undefined;
  const negated = line.startsWith("!");
  if (negated) line = line.slice(1);
  if (line.length === 0) return undefined;
  const directoryOnly = line.endsWith("/");
  if (directoryOnly) line = line.slice(0, -1);
  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);

  const prefix = anchored || line.includes("/") ? "^" : "(?:^|/)";
  const suffix = "$";
  return {
    pattern: rawLine.trim(),
    negated,
    directoryOnly,
    expression: new RegExp(prefix + compileGitIgnorePattern(line) + suffix)
  };
};

const parseGitIgnore = (content: string): readonly GitIgnoreRule[] =>
  content.split(/\r?\n/u).map(compileGitIgnoreRule).filter((rule): rule is GitIgnoreRule => rule !== undefined);

const matchingGitIgnoreRule = (
  repositoryPath: string,
  isDirectory: boolean,
  rules: readonly GitIgnoreRule[]
): GitIgnoreRule | undefined => {
  let match: GitIgnoreRule | undefined;
  for (const rule of rules) {
    if ((!rule.directoryOnly || isDirectory) && rule.expression.test(repositoryPath)) match = rule;
  }
  return match?.negated === true ? undefined : match;
};

const isBinary = (content: Buffer): boolean => content.subarray(0, Math.min(content.length, 8192)).includes(0);
const decodeUtf8 = (content: Buffer): string => new TextDecoder("utf-8", { fatal: true }).decode(content);
const compareRepositoryPaths = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
const byRepositoryPath = <T extends { readonly path: string }>(left: T, right: T): number =>
  compareRepositoryPaths(left.path, right.path);

/** Deterministically enumerates repository files for Global-understanding aggregation. */
export interface RepositoryFileExclusionPolicy {
  evaluate(candidate: Readonly<ReviewFileExclusionCandidate>): ReviewFileExclusionDecision;
  evaluateDirectory(path: string): ReviewFileExclusionDecision;
}

export class NodeRepositoryFileEnumerator {
  public constructor(private readonly exclusionPolicy: RepositoryFileExclusionPolicy) {}

  public static countNonEmptyLines(content: string): number {
    return content.split(/\r\n|\r|\n/u).reduce((count, line) => count + (line.trim().length > 0 ? 1 : 0), 0);
  }

  public async enumerate(repositoryRoot: string): Promise<RepositoryFileEnumerationResult> {
    const gitIgnoreRules = await this.readRootGitIgnore(repositoryRoot);
    const walked = await this.walk(repositoryRoot, repositoryRoot, gitIgnoreRules);
    const included: IncludedRepositoryFile[] = [];
    const excluded = [...walked.excluded];
    const excludedDirectories = [...walked.excludedDirectories];

    for (const repositoryPath of walked.files.sort(compareRepositoryPaths)) {
      const absolutePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
      const content = await readFile(absolutePath);
      const binary = isBinary(content);
      let decoded: string | undefined;
      if (!binary) {
        try {
          decoded = decodeUtf8(content);
        } catch {
          excluded.push({
            path: repositoryPath,
            reason: { kind: "invalid-encoding", encoding: "utf-8" }
          });
          continue;
        }
      }
      const decision = this.exclusionPolicy.evaluate({ path: repositoryPath, isBinary: binary });
      if (decision.excluded) {
        excluded.push({ path: decision.normalizedPath, reason: decision.reason });
        continue;
      }
      included.push({
        path: repositoryPath,
        nonEmptyLineCount: NodeRepositoryFileEnumerator.countNonEmptyLines(decoded!)
      });
    }

    included.sort(byRepositoryPath);
    excluded.sort(byRepositoryPath);
    excludedDirectories.sort(byRepositoryPath);
    return { included, excluded, excludedDirectories };
  }

  private async readRootGitIgnore(repositoryRoot: string): Promise<readonly GitIgnoreRule[]> {
    try {
      return parseGitIgnore(await readFile(path.join(repositoryRoot, ".gitignore"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async walk(
    repositoryRoot: string,
    currentDirectory: string,
    gitIgnoreRules: readonly GitIgnoreRule[]
  ): Promise<WalkResult> {
    const files: string[] = [];
    const excluded: ExcludedRepositoryFile[] = [];
    const excludedDirectories: ExcludedRepositoryDirectory[] = [];
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const repositoryPath = toRepositoryPath(path.relative(repositoryRoot, absolutePath));
      if (entry.isSymbolicLink()) {
        excluded.push({ path: repositoryPath, reason: { kind: "symbolic-link" } });
        continue;
      }

      const policyDecision = entry.isDirectory()
        ? this.exclusionPolicy.evaluateDirectory(repositoryPath)
        : this.exclusionPolicy.evaluate({ path: repositoryPath, isBinary: false });
      if (policyDecision.excluded) {
        if (entry.isDirectory()) {
          excludedDirectories.push({ path: repositoryPath, reason: policyDecision.reason });
        } else {
          excluded.push({ path: repositoryPath, reason: policyDecision.reason });
        }
        continue;
      }

      const gitIgnoreRule = matchingGitIgnoreRule(repositoryPath, entry.isDirectory(), gitIgnoreRules);
      if (gitIgnoreRule !== undefined) {
        const reason = { kind: "gitignore" as const, pattern: gitIgnoreRule.pattern };
        if (entry.isDirectory()) excludedDirectories.push({ path: repositoryPath, reason });
        else excluded.push({ path: repositoryPath, reason });
        continue;
      }

      if (entry.isDirectory()) {
        const nested = await this.walk(repositoryRoot, absolutePath, gitIgnoreRules);
        files.push(...nested.files);
        excluded.push(...nested.excluded);
        excludedDirectories.push(...nested.excludedDirectories);
      } else if (entry.isFile()) {
        files.push(repositoryPath);
      }
    }
    return { files, excluded, excludedDirectories };
  }
}

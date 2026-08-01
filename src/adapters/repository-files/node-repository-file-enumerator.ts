import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ReviewFileExclusionPolicy,
  type ReviewFileExclusionReason
} from "../../core/file-exclusion/review-file-exclusion-policy";

export interface IncludedRepositoryFile {
  readonly path: string;
  readonly nonEmptyLineCount: number;
}

export type RepositoryFileEnumerationExclusionReason =
  | ReviewFileExclusionReason
  | { readonly kind: "gitignore"; readonly pattern: string };

export interface ExcludedRepositoryFile {
  readonly path: string;
  readonly reason: RepositoryFileEnumerationExclusionReason;
}

export interface RepositoryFileEnumerationResult {
  readonly included: readonly IncludedRepositoryFile[];
  readonly excluded: readonly ExcludedRepositoryFile[];
}

interface GitIgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly expression: RegExp;
}

const toRepositoryPath = (value: string): string => value.split(path.sep).join("/");
const escapeRegExp = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

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

  let source = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === "*" && line[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  const prefix = anchored || line.includes("/") ? "^" : "(?:^|/)";
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";
  return { pattern: rawLine.trim(), negated, directoryOnly, expression: new RegExp(prefix + source + suffix) };
};

const parseGitIgnore = (content: string): readonly GitIgnoreRule[] =>
  content.split(/\r?\n/u).map(compileGitIgnoreRule).filter((rule): rule is GitIgnoreRule => rule !== undefined);

const matchingGitIgnoreRule = (repositoryPath: string, rules: readonly GitIgnoreRule[]): GitIgnoreRule | undefined => {
  let match: GitIgnoreRule | undefined;
  for (const rule of rules) {
    if (rule.expression.test(repositoryPath)) match = rule;
  }
  return match?.negated === true ? undefined : match;
};

const isBinary = (content: Buffer): boolean => content.subarray(0, Math.min(content.length, 8192)).includes(0);

/** Deterministically enumerates repository files for Global-understanding aggregation. */
export class NodeRepositoryFileEnumerator {
  public constructor(private readonly exclusionPolicy: ReviewFileExclusionPolicy) {}

  public static countNonEmptyLines(content: string): number {
    return content.split(/\r?\n/u).reduce((count, line) => count + (line.trim().length > 0 ? 1 : 0), 0);
  }

  public async enumerate(repositoryRoot: string): Promise<RepositoryFileEnumerationResult> {
    const gitIgnoreRules = await this.readRootGitIgnore(repositoryRoot);
    const paths = await this.walk(repositoryRoot, repositoryRoot);
    const included: IncludedRepositoryFile[] = [];
    const excluded: ExcludedRepositoryFile[] = [];

    for (const repositoryPath of paths.sort((left, right) => left.localeCompare(right, "en"))) {
      const absolutePath = path.join(repositoryRoot, ...repositoryPath.split("/"));
      const content = await readFile(absolutePath);
      const decision = this.exclusionPolicy.evaluate({ path: repositoryPath, isBinary: isBinary(content) });
      if (decision.excluded) {
        excluded.push({ path: decision.normalizedPath, reason: decision.reason });
        continue;
      }
      const gitIgnoreRule = matchingGitIgnoreRule(repositoryPath, gitIgnoreRules);
      if (gitIgnoreRule !== undefined) {
        excluded.push({ path: repositoryPath, reason: { kind: "gitignore", pattern: gitIgnoreRule.pattern } });
        continue;
      }
      included.push({ path: repositoryPath, nonEmptyLineCount: NodeRepositoryFileEnumerator.countNonEmptyLines(content.toString("utf8")) });
    }

    return { included, excluded };
  }

  private async readRootGitIgnore(repositoryRoot: string): Promise<readonly GitIgnoreRule[]> {
    try {
      return parseGitIgnore(await readFile(path.join(repositoryRoot, ".gitignore"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async walk(repositoryRoot: string, currentDirectory: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const repositoryPath = toRepositoryPath(path.relative(repositoryRoot, absolutePath));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const directoryDecision = this.exclusionPolicy.evaluate({ path: `${repositoryPath}/.enumeration-probe`, isBinary: false });
        if (directoryDecision.excluded) continue;
        result.push(...await this.walk(repositoryRoot, absolutePath));
      } else if (entry.isFile()) {
        result.push(repositoryPath);
      }
    }
    return result;
  }
}

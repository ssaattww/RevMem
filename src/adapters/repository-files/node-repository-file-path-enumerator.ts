import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExcludedRepositoryDirectory,
  ExcludedRepositoryFile,
  RepositoryFileExclusionPolicy
} from "./node-repository-file-enumerator";

export interface RepositoryFilePathEnumerationResult {
  readonly includedPaths: readonly string[];
  readonly excluded: readonly ExcludedRepositoryFile[];
  readonly excludedDirectories: readonly ExcludedRepositoryDirectory[];
}

interface GitIgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly expression: RegExp;
}

const toRepositoryPath = (value: string): string => value.split(path.sep).join("/");
const escapeRegExp = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
const compareRepositoryPaths = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

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
  return {
    pattern: rawLine.trim(),
    negated,
    directoryOnly,
    expression: new RegExp(prefix + compileGitIgnorePattern(line) + "$")
  };
};

const parseGitIgnore = (content: string): readonly GitIgnoreRule[] =>
  content.split(/\r?\n/u).map(compileGitIgnoreRule)
    .filter((rule): rule is GitIgnoreRule => rule !== undefined);

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

/**
 * Enumerates candidate repository paths for Issue #59 Global file counts without
 * opening file contents. Binary/encoding decisions are therefore deferred until
 * a file is actually opened and contributes line evidence.
 */
export class NodeRepositoryFilePathEnumerator {
  public constructor(private readonly exclusionPolicy: RepositoryFileExclusionPolicy) {}

  public async enumerate(repositoryRoot: string): Promise<RepositoryFilePathEnumerationResult> {
    const rules = await this.readRootGitIgnore(repositoryRoot);
    const includedPaths: string[] = [];
    const excluded: ExcludedRepositoryFile[] = [];
    const excludedDirectories: ExcludedRepositoryDirectory[] = [];
    await this.walk(
      repositoryRoot,
      repositoryRoot,
      rules,
      includedPaths,
      excluded,
      excludedDirectories
    );
    includedPaths.sort(compareRepositoryPaths);
    excluded.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    excludedDirectories.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    return { includedPaths, excluded, excludedDirectories };
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
    rules: readonly GitIgnoreRule[],
    includedPaths: string[],
    excluded: ExcludedRepositoryFile[],
    excludedDirectories: ExcludedRepositoryDirectory[]
  ): Promise<void> {
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
          excluded.push({ path: policyDecision.normalizedPath, reason: policyDecision.reason });
        }
        continue;
      }

      const gitIgnoreRule = matchingGitIgnoreRule(repositoryPath, entry.isDirectory(), rules);
      if (gitIgnoreRule !== undefined) {
        const reason = { kind: "gitignore" as const, pattern: gitIgnoreRule.pattern };
        if (entry.isDirectory()) excludedDirectories.push({ path: repositoryPath, reason });
        else excluded.push({ path: repositoryPath, reason });
        continue;
      }

      if (entry.isDirectory()) {
        await this.walk(
          repositoryRoot,
          absolutePath,
          rules,
          includedPaths,
          excluded,
          excludedDirectories
        );
      } else if (entry.isFile()) {
        includedPaths.push(repositoryPath);
      }
    }
  }
}

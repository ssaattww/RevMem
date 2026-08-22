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

/** Scheduler and pruning seams shared by folder discovery and direct enumeration. */
export interface NodeRepositoryFilePathEnumeratorOptions {
  readonly maxEntriesPerStage?: number;
  readonly yieldControl?: () => void | Promise<void>;
  readonly accountWorkBatch?: (entry: Readonly<{ kind: "repository-entry"; count: number }>) => void;
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
const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new DOMException("Repository path enumeration was superseded.", "AbortError");
};

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
  private readonly maxEntriesPerStage: number;
  private readonly yieldControl: () => void | Promise<void>;
  private readonly accountWorkBatch: NodeRepositoryFilePathEnumeratorOptions["accountWorkBatch"];
  public constructor(private readonly exclusionPolicy: RepositoryFileExclusionPolicy, options: NodeRepositoryFilePathEnumeratorOptions = {}) {
    this.maxEntriesPerStage = options.maxEntriesPerStage ?? 128;
    if (!Number.isSafeInteger(this.maxEntriesPerStage) || this.maxEntriesPerStage <= 0) throw new RangeError("maxEntriesPerStage must be a positive integer.");
    this.yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    this.accountWorkBatch = options.accountWorkBatch;
  }

  public async enumerate(repositoryRoot: string, signal?: AbortSignal): Promise<RepositoryFilePathEnumerationResult> {
    throwIfAborted(signal);
    const rules = await this.readRootGitIgnore(repositoryRoot, signal);
    const includedPaths: string[] = [];
    const excluded: ExcludedRepositoryFile[] = [];
    const excludedDirectories: ExcludedRepositoryDirectory[] = [];
    const budget = { pending: 0 };
    await this.walk(
      repositoryRoot,
      repositoryRoot,
      rules,
      includedPaths,
      excluded,
      excludedDirectories,
      signal, undefined, budget
    );
    this.flushBudget(budget);
    includedPaths.sort(compareRepositoryPaths);
    excluded.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    excludedDirectories.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    return { includedPaths, excluded, excludedDirectories };
  }

  /**
   * Enumerates only direct entries of already-active T610 folder scopes.
   * Unlike {@link enumerate}, this never walks an inactive sibling or root
   * descendant. Recursive discovery is reserved for an explicit folder start.
   */
  public async enumerateDirectFolders(
    repositoryRoot: string,
    folders: readonly string[],
    signal?: AbortSignal
  ): Promise<RepositoryFilePathEnumerationResult> {
    throwIfAborted(signal);
    const rules = await this.readRootGitIgnore(repositoryRoot, signal);
    const includedPaths: string[] = [];
    const excluded: ExcludedRepositoryFile[] = [];
    const excludedDirectories: ExcludedRepositoryDirectory[] = [];
    let pending = 0;
    const checkpoint = async (): Promise<void> => {
      if (++pending < this.maxEntriesPerStage) return;
      this.accountWorkBatch?.({ kind: "repository-entry", count: pending }); pending = 0;
      await this.yieldControl(); throwIfAborted(signal);
    };
    for (const folder of [...new Set(folders)].sort(compareRepositoryPaths)) {
      throwIfAborted(signal);
      const directory = folder.length === 0
        ? repositoryRoot
        : path.join(repositoryRoot, ...folder.split("/"));
      const entries = await readdir(directory, { withFileTypes: true });
      throwIfAborted(signal);
      for (const entry of entries) {
        throwIfAborted(signal);
        await checkpoint();
        const absolutePath = path.join(directory, entry.name);
        const repositoryPath = toRepositoryPath(path.relative(repositoryRoot, absolutePath));
        if (entry.isSymbolicLink()) { excluded.push({ path: repositoryPath, reason: { kind: "symbolic-link" } }); continue; }
        const policyDecision = entry.isDirectory()
          ? this.exclusionPolicy.evaluateDirectory(repositoryPath)
          : this.exclusionPolicy.evaluate({ path: repositoryPath, isBinary: false });
        if (policyDecision.excluded) {
          if (entry.isDirectory()) excludedDirectories.push({ path: repositoryPath, reason: policyDecision.reason });
          else excluded.push({ path: policyDecision.normalizedPath, reason: policyDecision.reason });
          continue;
        }
        const gitIgnoreRule = matchingGitIgnoreRule(repositoryPath, entry.isDirectory(), rules);
        if (gitIgnoreRule !== undefined) {
          const reason = { kind: "gitignore" as const, pattern: gitIgnoreRule.pattern };
          if (entry.isDirectory()) excludedDirectories.push({ path: repositoryPath, reason });
          else excluded.push({ path: repositoryPath, reason });
          continue;
        }
        if (entry.isFile()) includedPaths.push(repositoryPath);
      }
    }
    includedPaths.sort(compareRepositoryPaths);
    excluded.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    excludedDirectories.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    return { includedPaths, excluded, excludedDirectories };
  }

  /** Recursively discovers folders only beneath an explicitly selected scope. */
  public async enumerateSubtreeFolders(
    repositoryRoot: string,
    folder: string,
    signal?: AbortSignal,
    shouldPruneFolder?: (repositoryRelativeFolder: string) => boolean
  ): Promise<readonly string[]> {
    throwIfAborted(signal);
    const normalized = folder.replace(/^\/+|\/+$/gu, "");
    const root = normalized.length === 0 ? repositoryRoot : path.join(repositoryRoot, ...normalized.split("/"));
    const includedPaths: string[] = [];
    const excluded: ExcludedRepositoryFile[] = [];
    const excludedDirectories: ExcludedRepositoryDirectory[] = [];
    const budget = { pending: 0 };
    await this.walk(repositoryRoot, root, await this.readRootGitIgnore(repositoryRoot, signal), includedPaths, excluded, excludedDirectories, signal, shouldPruneFolder, budget);
    this.flushBudget(budget);
    throwIfAborted(signal);
    const folders = new Set<string>([normalized]);
    for (const entry of [...includedPaths, ...excluded.map((item) => item.path), ...excludedDirectories.map((item) => item.path)]) {
      const parts = entry.split("/");
      parts.pop();
      for (let length = 1; length <= parts.length; length += 1) folders.add(parts.slice(0, length).join("/"));
    }
    return [...folders].filter((candidate) => candidate === normalized || candidate.startsWith(normalized.length === 0 ? "" : `${normalized}/`)).sort(compareRepositoryPaths);
  }

  private async readRootGitIgnore(repositoryRoot: string, signal?: AbortSignal): Promise<readonly GitIgnoreRule[]> {
    try {
      const content = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
      throwIfAborted(signal);
      return parseGitIgnore(content);
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
    excludedDirectories: ExcludedRepositoryDirectory[],
    signal?: AbortSignal,
    shouldPruneFolder?: (repositoryRelativeFolder: string) => boolean,
    budget: { pending: number } = { pending: 0 }
  ): Promise<void> {
    throwIfAborted(signal);
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    throwIfAborted(signal);
    for (const entry of entries) {
      throwIfAborted(signal);
      if (++budget.pending >= this.maxEntriesPerStage) {
        this.accountWorkBatch?.({ kind: "repository-entry", count: budget.pending }); budget.pending = 0;
        await this.yieldControl(); throwIfAborted(signal);
      }
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
        if (shouldPruneFolder?.(repositoryPath) === true) continue;
        await this.walk(
          repositoryRoot,
          absolutePath,
          rules,
          includedPaths,
          excluded,
          excludedDirectories,
          signal,
          shouldPruneFolder, budget
        );
      } else if (entry.isFile()) {
        includedPaths.push(repositoryPath);
      }
    }
  }

  /** Accounts for a final partial operation-wide stage, including pruned entries. */
  private flushBudget(budget: { pending: number }): void {
    if (budget.pending === 0) return;
    this.accountWorkBatch?.({ kind: "repository-entry", count: budget.pending });
    budget.pending = 0;
  }
}

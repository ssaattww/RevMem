import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";
import {
  GitCommandFailedError,
  GitExecutableNotFoundError,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type GitCommandResult,
  type LocalGitBranchState,
  type LocalGitRemote,
  type LocalGitRepositoryInspection
} from "./contracts";
import type { GitBlobReader } from "./git-blob-reader";
import { normalizeGitRemoteUrl } from "./git-remote-normalization";
import type { LocalGitRevisionTextReadResult } from "./revision-text-content";

const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const LS_TREE_ENTRY_PATTERN = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** VS Code境界でopened documentのencoding hintを適用するdecoder。 */
export type GitBlobTextDecoder = (
  bytes: Uint8Array,
  encoding: string
) => Promise<string>;

const requirePath = (value: string, name: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty path without null characters`);
  }

  return value;
};

const requireRevision = (value: string, name: string): string => {
  if (
    value.trim().length === 0 ||
    value.startsWith("-") ||
    value.includes("\0") ||
    /[\r\n]/u.test(value)
  ) {
    throw new TypeError(
      `${name} must be a non-empty Git revision that cannot be parsed as an option`
    );
  }

  return value;
};

const requireImmutableCommitObjectId = (value: string, name: string): string => {
  if (!FULL_OBJECT_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${name} must be a lowercase full SHA-1 or SHA-256 commit object ID`
    );
  }
  return value;
};

const firstOutputLine = (output: string, name: string): string => {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);

  if (line === undefined) {
    throw new Error(`${name} did not produce a value`);
  }

  return line;
};

const parseGitVersion = (stdout: string): string => {
  const line = firstOutputLine(stdout, "git --version");
  const match = /^git version\s+(.+)$/iu.exec(line);
  if (match === null || match[1]!.trim().length === 0) {
    throw new Error(`Unsupported Git version output: ${line}`);
  }

  return match[1]!.trim();
};

const splitOutputLines = (stdout: string): string[] =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const rootRepositoryId = (rootPath: string): string => {
  const canonicalRootUri = pathToFileURL(path.resolve(rootPath)).href;
  const digest = createHash("sha256")
    .update(`git-root\0${canonicalRootUri}`, "utf8")
    .digest("hex");
  return `git-root:${digest}`;
};

const parseLsTreeBlobObjectId = (
  output: string,
  expectedPath: string
): string | undefined => {
  if (output.length === 0) {
    return undefined;
  }
  if (!output.endsWith("\0")) {
    throw new Error("git ls-tree output is not NUL terminated");
  }

  const records = output.slice(0, -1).split("\0");
  if (records.length !== 1) {
    throw new Error("git ls-tree returned an ambiguous exact-path result");
  }

  const record = records[0]!;
  const separator = record.indexOf("\t");
  if (separator < 0) {
    throw new Error("git ls-tree output is missing its path separator");
  }
  const metadata = record.slice(0, separator);
  const returnedPath = record.slice(separator + 1);
  const match = LS_TREE_ENTRY_PATTERN.exec(metadata);
  if (match === null || returnedPath !== expectedPath) {
    throw new Error("git ls-tree output does not match the requested exact path");
  }
  if (match[2] !== "blob") {
    return undefined;
  }
  return match[3]!;
};

const isMissingObjectExit = (result: GitCommandResult): boolean =>
  result.exitCode === 1 || result.exitCode === 128;

const isNotRepositoryResult = (result: GitCommandResult): boolean =>
  result.exitCode === 128 &&
  /(?:^|\n)fatal:\s+not a git repository\b/iu.test(
    `${result.stdout}\n${result.stderr}`
  );

const isUnbornHeadResult = (result: GitCommandResult): boolean =>
  result.exitCode === 128 &&
  /^fatal:\s+Needed a single revision\s*$/u.test(result.stderr.trim());

/**
 * Reads stable repository identity and revision metadata through local Git only.
 *
 * This adapter is independent from GitHub authentication and API availability.
 * Metadata commands use argument arrays; immutable file content is streamed as raw
 * blob bytes through the injected `GitBlobReader`.
 */
export class LocalGitAdapter {
  /**
   * Creates the adapter with explicit metadata and blob-content boundaries.
   *
   * Node Extension Host production wiring must use `createNodeLocalGitAdapter()` so
   * every subprocess shares one executable and timeout policy. Direct construction is
   * reserved for tests and alternate runtimes and therefore requires both boundaries.
   */
  public constructor(
    private readonly commandExecutor: GitCommandExecutor,
    private readonly blobReader: GitBlobReader,
    private readonly decodeWithHint?: GitBlobTextDecoder
  ) {}

  /**
   * Inspects a path and distinguishes missing Git, non-Git folders, and repositories.
   *
   * @param startPath Workspace-side path at or below a possible repository root.
   * @returns A discriminated result containing stable local Git metadata.
   */
  public async inspectRepository(
    startPath: string
  ): Promise<LocalGitRepositoryInspection> {
    const inspectedPath = requirePath(startPath, "startPath");
    let versionResult: GitCommandResult;

    try {
      versionResult = await this.execute(undefined, ["--version"]);
    } catch (error) {
      if (error instanceof GitExecutableNotFoundError) {
        return {
          kind: "git-unavailable",
          executable: error.executable
        };
      }

      throw error;
    }

    this.requireSuccess(
      { cwd: undefined, argumentsList: ["--version"] },
      versionResult
    );
    const gitVersion = parseGitVersion(versionResult.stdout);
    const rootInvocation: GitCommandInvocation = {
      cwd: inspectedPath,
      argumentsList: ["rev-parse", "--show-toplevel"]
    };
    const rootResult = await this.commandExecutor.execute(rootInvocation);

    if (isNotRepositoryResult(rootResult)) {
      return {
        kind: "not-repository",
        gitVersion
      };
    }
    this.requireSuccess(rootInvocation, rootResult);

    const rootPath = path.resolve(firstOutputLine(rootResult.stdout, "repository root"));
    const remote = await this.resolveIdentityRemote(rootPath);
    const branch = await this.resolveBranchState(rootPath);
    const head = await this.resolveHead(rootPath);

    return {
      kind: "repository",
      repository: {
        gitVersion,
        rootPath,
        repositoryId: remote?.normalizedUrl ?? rootRepositoryId(rootPath),
        ...(remote === undefined ? {} : { remote }),
        branch,
        ...(head === undefined ? {} : { head })
      }
    };
  }

  /**
   * Finds one best common ancestor for two revisions.
   *
   * @returns The merge-base object ID, or `undefined` when no merge base exists.
   */
  public async findMergeBase(
    repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string | undefined> {
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const left = requireRevision(leftRevision, "leftRevision");
    const right = requireRevision(rightRevision, "rightRevision");
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["merge-base", left, right]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 1) {
      return undefined;
    }

    this.requireSuccess(invocation, result);
    return firstOutputLine(result.stdout, "git merge-base");
  }

  /** Determines whether an object expression resolves in the local object database. */
  public async objectExists(
    repositoryRoot: string,
    objectName: string
  ): Promise<boolean> {
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const object = requireRevision(objectName, "objectName");
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["rev-parse", "--verify", "--quiet", `${object}^{object}`]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 0) {
      return true;
    }
    if (isMissingObjectExit(result)) {
      return false;
    }

    throw new GitCommandFailedError(invocation, result);
  }

  /**
   * Reads one canonical repository-relative UTF-8 text file from an immutable commit.
   *
   * Missing commit objects, missing paths, and invalid UTF-8 are separate outcomes.
   * Fatal Git failures retain the invocation and captured output.
   */
  public async readTextFileAtRevision(
    repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string,
    fileSystemPathSemantics: FileSystemPathSemantics,
    feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
    encodingHint?: string,
  ): Promise<LocalGitRevisionTextReadResult> {
    if (signal?.aborted) throw new DOMException("Git revision content read was superseded.", "AbortError");
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const object = requireImmutableCommitObjectId(revision, "revision");
    const filePath = requireCanonicalRepositoryRelativePath(
      repositoryRelativePath,
      fileSystemPathSemantics,
      "repositoryRelativePath"
    );
    const revisionInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: [
        "rev-parse",
        "--verify",
        "--quiet",
        `${object}^{commit}`
      ]
    };
    const revisionResult = await this.commandExecutor.execute(revisionInvocation, feedbackContext, signal);

    if (revisionResult.exitCode === 1) {
      return { kind: "missing-revision" };
    }
    this.requireSuccess(revisionInvocation, revisionResult);
    if (firstOutputLine(revisionResult.stdout, "immutable commit object") !== object) {
      return { kind: "missing-revision" };
    }

    const fileInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: [
        "ls-tree",
        "--full-tree",
        "-z",
        object,
        "--",
        `:(literal)${filePath}`
      ]
    };
    const fileResult = await this.commandExecutor.execute(fileInvocation, feedbackContext, signal);
    this.requireSuccess(fileInvocation, fileResult);
    const blobObjectId = parseLsTreeBlobObjectId(fileResult.stdout, filePath);
    if (blobObjectId === undefined) {
      return { kind: "missing-file" };
    }

    const bytes = await this.blobReader.readBlob(rootPath, blobObjectId, feedbackContext, signal);
    if (signal?.aborted) throw new DOMException("Git revision content read was superseded.", "AbortError");
    try {
      return {
        kind: "found",
        content: encodingHint === undefined
          ? utf8Decoder.decode(bytes)
          : await this.decodeWithHintOrReject(bytes, encodingHint)
      };
    } catch {
      return { kind: "invalid-encoding", encoding: "utf-8" };
    }
  }

  /** Applies an opened-document hint only through the injected VS Code boundary. */
  private async decodeWithHintOrReject(bytes: Uint8Array, encoding: string): Promise<string> {
    if (this.decodeWithHint === undefined || encoding.length === 0) {
      throw new TypeError("A non-empty VS Code encoding hint is required.");
    }
    const content = await this.decodeWithHint(bytes, encoding);
    if (content.includes("\uFFFD")) {
      throw new TypeError("Decoded Git blob contains substitution characters.");
    }
    return content;
  }

  private execute(
    cwd: string | undefined,
    argumentsList: readonly string[]
  ): Promise<GitCommandResult> {
    return this.commandExecutor.execute({
      cwd,
      argumentsList: [...argumentsList]
    });
  }

  private requireSuccess(
    invocation: GitCommandInvocation,
    result: GitCommandResult
  ): void {
    if (result.exitCode !== 0) {
      throw new GitCommandFailedError(invocation, result);
    }
  }

  private async resolveIdentityRemote(
    rootPath: string
  ): Promise<LocalGitRemote | undefined> {
    const listInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["remote"]
    };
    const listResult = await this.commandExecutor.execute(listInvocation);
    this.requireSuccess(listInvocation, listResult);

    const names = splitOutputLines(listResult.stdout).sort((left, right) =>
      left.localeCompare(right)
    );
    const candidates = names.includes("origin")
      ? ["origin", ...names.filter((name) => name !== "origin")]
      : names;

    for (const name of candidates) {
      const urlInvocation: GitCommandInvocation = {
        cwd: rootPath,
        argumentsList: ["remote", "get-url", name]
      };
      const urlResult = await this.commandExecutor.execute(urlInvocation);
      if (urlResult.exitCode !== 0) {
        continue;
      }

      let rawUrl: string;
      try {
        rawUrl = firstOutputLine(urlResult.stdout, `remote ${name} URL`);
        return {
          name,
          rawUrl,
          normalizedUrl: normalizeGitRemoteUrl(rawUrl, rootPath)
        };
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async resolveBranchState(
    rootPath: string
  ): Promise<LocalGitBranchState> {
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["symbolic-ref", "--quiet", "HEAD"]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (result.exitCode === 1) {
      return { kind: "detached" };
    }

    this.requireSuccess(invocation, result);
    const fullRef = firstOutputLine(result.stdout, "HEAD symbolic ref");
    if (!fullRef.startsWith("refs/heads/")) {
      throw new Error(`HEAD symbolic ref is not a local branch: ${fullRef}`);
    }

    return {
      kind: "branch",
      fullRef
    };
  }

  private async resolveHead(rootPath: string): Promise<string | undefined> {
    const invocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]
    };
    const result = await this.commandExecutor.execute(invocation);

    if (isUnbornHeadResult(result)) {
      return undefined;
    }

    this.requireSuccess(invocation, result);
    return firstOutputLine(result.stdout, "HEAD commit");
  }
}

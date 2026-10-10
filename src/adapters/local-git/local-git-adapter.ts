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
  type LocalGitRepository,
  type LocalGitRepositoryInspection
} from "./contracts";
import { MAX_GIT_BLOB_BATCH_OBJECTS, GitBlobBatchObjectTooLargeError, type GitBlobReader } from "./git-blob-reader";
import { normalizeGitRemoteUrl } from "./git-remote-normalization";
import type { LocalGitRevisionTextReadResult } from "./revision-text-content";

const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const LS_TREE_ENTRY_PATTERN = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_LS_TREE_PATHSPEC_ARGUMENT_UNITS = 28 * 1024;
const MAX_LS_TREE_PATHSPEC_COUNT = 128;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface GitTreeEntry {
  readonly mode: string;
  readonly type: "blob" | "tree" | "commit";
  readonly objectId: string;
}

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

const parseLsTreeBlobObjectId = (output: string, expectedPath: string): string | undefined => {
  if (output.length === 0) return undefined;
  if (!output.endsWith("\0")) throw new Error("git ls-tree output is not NUL terminated");

  const records = output.slice(0, -1).split("\0");
  if (records.length !== 1) throw new Error("git ls-tree returned an ambiguous exact-path result");
  const separator = records[0]!.indexOf("\t");
  if (separator < 0) throw new Error("git ls-tree output is missing its path separator");
  const metadata = records[0]!.slice(0, separator);
  const returnedPath = records[0]!.slice(separator + 1);
  const match = LS_TREE_ENTRY_PATTERN.exec(metadata);
  if (match === null || returnedPath !== expectedPath) {
    throw new Error("git ls-tree output does not match the requested exact path");
  }
  return match[2] === "blob" ? match[3] : undefined;
};

const parseLsTreeEntries = (
  output: string,
  expectedPaths: ReadonlySet<string>,
): ReadonlyMap<string, GitTreeEntry> => {
  const entries = new Map<string, GitTreeEntry>();
  if (output.length === 0) return entries;
  if (!output.endsWith("\0")) throw new Error("git ls-tree output is not NUL terminated");
  for (const record of output.slice(0, -1).split("\0")) {
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error("git ls-tree output is missing its path separator");
    const metadata = record.slice(0, separator);
    const returnedPath = record.slice(separator + 1);
    const match = LS_TREE_ENTRY_PATTERN.exec(metadata);
    if (match === null || !expectedPaths.has(returnedPath)) {
      throw new Error("git ls-tree output does not match a requested exact path");
    }
    if (entries.has(returnedPath)) throw new Error("git ls-tree returned duplicate exact-path entries");
    entries.set(returnedPath, {
      mode: match[1]!,
      type: match[2] as GitTreeEntry["type"],
      objectId: match[3]!,
    });
  }
  return entries;
};

// spawn(shell:false) still serializes argv on Windows. Doubling UTF-16 units
// covers escaped backslashes/quotes; four units allow surrounding quotes,
// argument separation, and the command-line terminator. UTF-8 remains the
// tighter bound on non-Windows hosts and for some Unicode arguments.
const pathspecCommandLineUpperBound = (pathspec: string): number =>
  Math.max(
    Buffer.byteLength(pathspec, "utf8") + 1,
    pathspec.length * 2 + 4,
  );

const chunkPathspecs = (paths: readonly string[]): readonly (readonly string[])[] => {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let usedUnits = 0;
  for (const filePath of paths) {
    const pathspec = `:(literal)${filePath}`;
    const units = pathspecCommandLineUpperBound(pathspec);
    if (units > MAX_LS_TREE_PATHSPEC_ARGUMENT_UNITS) {
      throw new RangeError("Git pathspec exceeds the safe argument batch limit");
    }
    if (chunk.length > 0 && (
      chunk.length >= MAX_LS_TREE_PATHSPEC_COUNT ||
      usedUnits + units > MAX_LS_TREE_PATHSPEC_ARGUMENT_UNITS ||
      // Git expands a parent directory when the same invocation also selects
      // its descendant. Separate overlapping paths so every result stays exact.
      chunk.some((existing) => filePath.startsWith(`${existing}/`) || existing.startsWith(`${filePath}/`))
    )) {
      chunks.push(chunk);
      chunk = [];
      usedUnits = 0;
    }
    chunk.push(filePath);
    usedUnits += units;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
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
  /** Recently verified immutable commits avoid repeating the same commit peel for every PR file. */
  private readonly verifiedCommits = new Map<string, true>();
  private static readonly VERIFIED_COMMIT_LIMIT = 128;
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

  /** Reads multiple exact paths with bounded ls-tree invocations and sequentially decoded blob batches. */
  public async readTextFilesAtRevision(
    repositoryRoot: string,
    revision: string,
    repositoryRelativePaths: readonly string[],
    fileSystemPathSemantics: FileSystemPathSemantics,
    feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
    encodingHintsByPath?: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, LocalGitRevisionTextReadResult>> {
    const assertActive = (): void => {
      if (signal?.aborted) throw new DOMException("Git revision content read was superseded.", "AbortError");
    };
    assertActive();
    const rootPath = requirePath(repositoryRoot, "repositoryRoot");
    const object = requireImmutableCommitObjectId(revision, "revision");
    const paths = [...new Set(repositoryRelativePaths.map((candidate) =>
      requireCanonicalRepositoryRelativePath(candidate, fileSystemPathSemantics, "repositoryRelativePath")))];
    if (paths.length === 0) return new Map();

    const commitKey = `${rootPath}\0${object}`;
    const verifyCommit = async (): Promise<boolean> => {
      const revisionInvocation: GitCommandInvocation = {
        cwd: rootPath,
        argumentsList: ["rev-parse", "--verify", "--quiet", `${object}^{commit}`]
      };
      const revisionResult = await this.commandExecutor.execute(revisionInvocation, feedbackContext, signal);
      assertActive();
      if (revisionResult.exitCode === 1) return false;
      this.requireSuccess(revisionInvocation, revisionResult);
      return firstOutputLine(revisionResult.stdout, "immutable commit object") === object;
    };
    const touchCommit = (): void => {
      this.verifiedCommits.delete(commitKey);
      this.verifiedCommits.set(commitKey, true);
      if (this.verifiedCommits.size > LocalGitAdapter.VERIFIED_COMMIT_LIMIT) {
        const oldest = this.verifiedCommits.keys().next().value;
        if (oldest !== undefined) this.verifiedCommits.delete(oldest);
      }
    };
    if (!this.verifiedCommits.has(commitKey)) {
      if (!await verifyCommit()) {
        return new Map(paths.map((filePath) => [filePath, { kind: "missing-revision" } as const]));
      }
    }
    touchCommit();

    // This result map is request-local: interrupted metadata is never memoized.
    const entries = new Map<string, GitTreeEntry>();
    for (const chunk of chunkPathspecs(paths)) {
      assertActive();
      const invocation: GitCommandInvocation = {
        cwd: rootPath,
        argumentsList: ["ls-tree", "--full-tree", "-z", object, "--", ...chunk.map((filePath) => `:(literal)${filePath}`)]
      };
      const result = await this.commandExecutor.execute(invocation, feedbackContext, signal);
      assertActive();
      if (result.exitCode === 1 || result.exitCode === 128) {
        this.verifiedCommits.delete(commitKey);
        if (!await verifyCommit()) {
          return new Map(paths.map((filePath) => [filePath, { kind: "missing-revision" } as const]));
        }
        touchCommit();
        if (result.exitCode === 1) continue;
      }
      this.requireSuccess(invocation, result);
      for (const [filePath, entry] of parseLsTreeEntries(result.stdout, new Set(chunk))) entries.set(filePath, entry);
    }

    const output = new Map<string, LocalGitRevisionTextReadResult>(
      paths.map((filePath) => [filePath, { kind: "missing-file" } as const]),
    );
    const readBlobs = this.blobReader.readBlobs;
    const pathsByObjectId = new Map<string, string[]>();
    for (const filePath of paths) {
      const entry = entries.get(filePath);
      if (entry?.type !== "blob") continue;
      const objectPaths = pathsByObjectId.get(entry.objectId) ?? [];
      objectPaths.push(filePath);
      pathsByObjectId.set(entry.objectId, objectPaths);
    }
    const decodeObject = async (
      objectId: string,
      bytes: Uint8Array,
      target: Map<string, LocalGitRevisionTextReadResult>,
      assertCurrent: () => void,
    ): Promise<void> => {
      const objectPaths = pathsByObjectId.get(objectId);
      if (objectPaths === undefined) throw new Error("Git blob content was not requested");
      for (const filePath of objectPaths) {
        assertCurrent();
        let result: LocalGitRevisionTextReadResult;
        try {
          const hint = encodingHintsByPath?.get(filePath);
          const content = hint === undefined ? utf8Decoder.decode(bytes) : await this.decodeWithHintOrReject(bytes, hint);
          assertCurrent();
          result = { kind: "found", content };
        } catch {
          assertCurrent();
          result = { kind: "invalid-encoding", encoding: "utf-8" };
        }
        assertCurrent();
        target.set(filePath, result);
      }
    };
    try {
      // Starting a batch subprocess for one unique object is more expensive than
      // the existing single-object reader. Keep duplicate paths in the single
      // path separate for hint-aware decoding while reading the OID only once.
      if (readBlobs !== undefined && pathsByObjectId.size > 1) {
        const objectIds = [...pathsByObjectId.keys()];
        for (let start = 0; start < objectIds.length; start += MAX_GIT_BLOB_BATCH_OBJECTS) {
          assertActive();
          const group = objectIds.slice(start, start + MAX_GIT_BLOB_BATCH_OBJECTS);
          const groupObjectIds = new Set(group);
          const groupResults = new Map<string, LocalGitRevisionTextReadResult>();
          const receivedObjectIds = new Set<string>();
          let groupActive = true;
          const assertGroupActive = (): void => {
            assertActive();
            if (!groupActive) throw new DOMException("Git blob batch group was superseded.", "AbortError");
          };
          try {
            await readBlobs.call(this.blobReader, rootPath, group, async (blobObjectId, bytes) => {
              assertGroupActive();
              if (!groupObjectIds.has(blobObjectId) || receivedObjectIds.has(blobObjectId)) {
                throw new Error("Git blob batch reader returned an unexpected or duplicate object");
              }
              receivedObjectIds.add(blobObjectId);
              await decodeObject(blobObjectId, bytes, groupResults, assertGroupActive);
              assertGroupActive();
            }, feedbackContext, signal);
            assertGroupActive();
            if (receivedObjectIds.size !== group.length) {
              throw new Error("Git blob batch reader completed without returning every requested object");
            }
          } catch (error) {
            groupActive = false;
            groupResults.clear();
            receivedObjectIds.clear();
            assertActive();
            if (!(error instanceof GitBlobBatchObjectTooLargeError)) throw error;

            // The batch reader may already have decoded earlier frames; discard their text and reread this group sequentially.
            const fallbackResults = new Map<string, LocalGitRevisionTextReadResult>();
            let fallbackActive = true;
            const assertFallbackActive = (): void => {
              assertActive();
              if (!fallbackActive) throw new DOMException("Git blob fallback was superseded.", "AbortError");
            };
            try {
              for (const blobObjectId of group) {
                assertFallbackActive();
                const bytes = await this.blobReader.readBlob(rootPath, blobObjectId, feedbackContext, signal);
                assertFallbackActive();
                await decodeObject(blobObjectId, bytes, fallbackResults, assertFallbackActive);
                assertFallbackActive();
              }
            } catch (fallbackError) {
              fallbackActive = false;
              fallbackResults.clear();
              throw fallbackError;
            }
            assertFallbackActive();
            for (const [filePath, result] of fallbackResults) output.set(filePath, result);
            fallbackActive = false;
            fallbackResults.clear();
            continue;
          }
          assertGroupActive();
          for (const [filePath, result] of groupResults) output.set(filePath, result);
          groupActive = false;
          groupResults.clear();
        }
      } else {
        for (const objectId of pathsByObjectId.keys()) {
          assertActive();
          const bytes = await this.blobReader.readBlob(rootPath, objectId, feedbackContext, signal);
          assertActive();
          await decodeObject(objectId, bytes, output, assertActive);
        }
      }
      assertActive();
      return output;
    } catch (error) {
      output.clear();
      throw error;
    }
  }

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

  /** tracking設定を優先し、削除済みtracking refでもhead branchとremoteを識別する。 */
  public async resolvePullRequestBranch(
    repository: LocalGitRepository,
    signal?: AbortSignal,
  ): Promise<{ readonly headRef: string; readonly remoteUrl: string } | undefined> {
    if (repository.branch.kind !== "branch" || repository.remote === undefined) return undefined;
    const invocation: GitCommandInvocation = {
      cwd: repository.rootPath,
      argumentsList: ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", repository.branch.fullRef],
    };
    const result = await this.commandExecutor.execute(invocation, undefined, signal);
    this.requireSuccess(invocation, result);
    const [remoteName = "", remoteRef = ""] = result.stdout.replace(/\r?\n$/u, "").split("\0");
    if (remoteName.length === 0 && remoteRef.length === 0) {
      return { headRef: repository.branch.fullRef.slice("refs/heads/".length), remoteUrl: repository.remote.rawUrl };
    }
    if (remoteName === "." || !remoteRef.startsWith("refs/heads/")) return undefined;
    const remoteInvocation: GitCommandInvocation = {
      cwd: repository.rootPath, argumentsList: ["remote", "get-url", remoteName],
    };
    const remoteResult = await this.commandExecutor.execute(remoteInvocation, undefined, signal);
    if (remoteResult.exitCode !== 0) return undefined;
    return { headRef: remoteRef.slice("refs/heads/".length), remoteUrl: firstOutputLine(remoteResult.stdout, "PR head remote") };
  }

  /** Resolves the fetched identity-remote upstream when local HEAD is its ancestor. */
  public async resolveIdentityRemoteTrackingRevision(
    repository: LocalGitRepository,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (repository.branch.kind !== "branch" || repository.remote === undefined || repository.head === undefined) {
      return undefined;
    }
    const upstreamInvocation: GitCommandInvocation = {
      cwd: repository.rootPath,
      argumentsList: ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream)", repository.branch.fullRef]
    };
    const upstreamResult = await this.commandExecutor.execute(upstreamInvocation, undefined, signal);
    this.requireSuccess(upstreamInvocation, upstreamResult);
    const fields = upstreamResult.stdout.replace(/\r?\n$/u, "").split("\0");
    const upstreamRemote = fields[0] ?? "";
    const upstreamRef = fields[1] ?? "";
    if (upstreamRemote !== repository.remote.name || !upstreamRef.startsWith(`refs/remotes/${repository.remote.name}/`)) {
      return undefined;
    }

    const revisionInvocation: GitCommandInvocation = {
      cwd: repository.rootPath,
      argumentsList: ["rev-parse", "--verify", "--quiet", `${upstreamRef}^{commit}`]
    };
    const revisionResult = await this.commandExecutor.execute(revisionInvocation, undefined, signal);
    if (isMissingObjectExit(revisionResult)) return undefined;
    this.requireSuccess(revisionInvocation, revisionResult);
    const trackingRevision = firstOutputLine(revisionResult.stdout, "identity remote tracking commit");

    const ancestryInvocation: GitCommandInvocation = {
      cwd: repository.rootPath,
      argumentsList: ["merge-base", "--is-ancestor", repository.head, trackingRevision]
    };
    const ancestryResult = await this.commandExecutor.execute(ancestryInvocation, undefined, signal);
    if (ancestryResult.exitCode === 1) return undefined;
    this.requireSuccess(ancestryInvocation, ancestryResult);
    return trackingRevision;
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
    const commitKey = `${rootPath}\0${object}`;
    const commitWasCached = this.verifiedCommits.has(commitKey);
    if (!commitWasCached) {
      const revisionInvocation: GitCommandInvocation = {
        cwd: rootPath,
        argumentsList: ["rev-parse", "--verify", "--quiet", `${object}^{commit}`]
      };
      const revisionResult = await this.commandExecutor.execute(revisionInvocation, feedbackContext, signal);
      if (revisionResult.exitCode === 1) return { kind: "missing-revision" };
      this.requireSuccess(revisionInvocation, revisionResult);
      if (firstOutputLine(revisionResult.stdout, "immutable commit object") !== object) {
        return { kind: "missing-revision" };
      }
      this.verifiedCommits.delete(commitKey);
      this.verifiedCommits.set(commitKey, true);
      if (this.verifiedCommits.size > LocalGitAdapter.VERIFIED_COMMIT_LIMIT) {
        const oldest = this.verifiedCommits.keys().next().value;
        if (oldest !== undefined) this.verifiedCommits.delete(oldest);
      }
    } else {
      this.verifiedCommits.delete(commitKey);
      this.verifiedCommits.set(commitKey, true);
    }

    // Resolve the exact immutable path directly. `ls-tree` used to spawn a
    // second metadata process for every side of every PR file even though the
    // commit had already been validated above.
    const fileInvocation: GitCommandInvocation = {
      cwd: rootPath,
      argumentsList: ["ls-tree", "--full-tree", "-z", object, "--", `:(literal)${filePath}`]
    };
    const fileResult = await this.commandExecutor.execute(fileInvocation, feedbackContext, signal);
    if (fileResult.exitCode === 1 || fileResult.exitCode === 128) {
      // A cached commit may have been pruned after an earlier successful read.
      // Recheck after an object lookup failure so stale cache entries cannot
      // turn a missing revision into an unrelated Git error.
      this.verifiedCommits.delete(commitKey);
      const revisionInvocation: GitCommandInvocation = {
        cwd: rootPath,
        argumentsList: ["rev-parse", "--verify", "--quiet", `${object}^{commit}`]
      };
      const revisionResult = await this.commandExecutor.execute(revisionInvocation, feedbackContext, signal);
      if (revisionResult.exitCode === 1) return { kind: "missing-revision" };
      this.requireSuccess(revisionInvocation, revisionResult);
      if (firstOutputLine(revisionResult.stdout, "immutable commit object") !== object) {
        return { kind: "missing-revision" };
      }
      this.verifiedCommits.set(commitKey, true);
      if (fileResult.exitCode === 1) return { kind: "missing-file" };
      this.requireSuccess(fileInvocation, fileResult);
    }
    this.requireSuccess(fileInvocation, fileResult);
    const blobObjectId = parseLsTreeBlobObjectId(fileResult.stdout, filePath);
    if (blobObjectId === undefined) return { kind: "missing-file" };

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

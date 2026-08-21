import { stat } from "node:fs/promises";

import type { GitRevisionMappingSource } from "../../application/review-context/index";
import {
  GitCommandFailedError,
  type GitCommandExecutor,
  type GitCommandInvocation,
  type LocalGitRepositoryInspection
} from "./contracts";
import { gitInspectionStartPath } from "./git-inspection-start-path";
import { LocalGitAdapter } from "./history-rewrite-local-git-adapter";
import type { GitBlobTextDecoder } from "./local-git-adapter";
import { NodeGitBlobReader } from "./node-git-blob-reader";
import {
  NodeGitCommandExecutor,
  type NodeGitCommandExecutorOptions
} from "./node-git-command-executor";

/**
 * Shared Node Extension Host runtime options for all local Git subprocesses.
 *
 * `executable` and `timeoutMs` are applied to both metadata commands and raw
 * blob reads. `maxBufferBytes` applies only to bounded metadata command output.
 */
export interface NodeLocalGitAdapterOptions
  extends NodeGitCommandExecutorOptions {
  /** Grace period between blob SIGTERM and SIGKILL escalation. */
  readonly blobTerminationGraceMs?: number;
  /** VS Code workspace.decodeへ委譲するopened-document encoding decoder。 */
  readonly decodeWithHint?: GitBlobTextDecoder;
}

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

const requireRoot = (value: string): string => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("repositoryRoot must be a non-empty path without null characters");
  }
  return value;
};

const normalizeInspectionStartPath = async (startPath: string): Promise<string> => {
  try {
    const details = await stat(startPath);
    return details.isDirectory() ? startPath : gitInspectionStartPath(startPath);
  } catch {
    return startPath;
  }
};

class NodeLocalGitAdapter extends LocalGitAdapter
implements GitRevisionMappingSource {
  public constructor(
    private readonly metadataExecutor: GitCommandExecutor,
    blobReader: NodeGitBlobReader,
    decodeWithHint?: GitBlobTextDecoder
  ) {
    super(metadataExecutor, blobReader, decodeWithHint);
  }

  /** Accepts either a directory or a normal file as the repository-inspection starting resource. */
  public override async inspectRepository(
    startPath: string
  ): Promise<LocalGitRepositoryInspection> {
    return super.inspectRepository(await normalizeInspectionStartPath(startPath));
  }

  /** Returns one complete zero-context repository diff without constructing a shell command string. */
  public async diffRevisions(
    repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string> {
    const invocation: GitCommandInvocation = {
      cwd: requireRoot(repositoryRoot),
      argumentsList: [
        "diff",
        "--unified=0",
        "--find-renames",
        "--find-copies",
        requireRevision(leftRevision, "leftRevision"),
        requireRevision(rightRevision, "rightRevision"),
        "--"
      ]
    };
    const result = await this.metadataExecutor.execute(invocation);
    if (result.exitCode !== 0) {
      throw new GitCommandFailedError(invocation, result);
    }
    return result.stdout;
  }
}

/**
 * Creates a local Git adapter whose metadata, complete diff, blob, and tree
 * enumeration commands use one runtime executable and timeout policy.
 */
export function createNodeLocalGitAdapter(
  options: NodeLocalGitAdapterOptions = {}
): LocalGitAdapter & GitRevisionMappingSource {
  const blobReaderOptions = {
    ...(options.executable === undefined
      ? {}
      : { executable: options.executable }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.blobTerminationGraceMs === undefined
      ? {}
      : { terminationGraceMs: options.blobTerminationGraceMs })
  };
  const metadataExecutor = new NodeGitCommandExecutor(options);

  return new NodeLocalGitAdapter(
    metadataExecutor,
    new NodeGitBlobReader(blobReaderOptions),
    options.decodeWithHint
  );
}

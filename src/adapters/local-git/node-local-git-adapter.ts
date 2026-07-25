import { LocalGitAdapter } from "./local-git-adapter";
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
export type NodeLocalGitAdapterOptions = NodeGitCommandExecutorOptions;

/**
 * Creates a local Git adapter whose metadata and blob commands use one runtime policy.
 */
export function createNodeLocalGitAdapter(
  options: NodeLocalGitAdapterOptions = {}
): LocalGitAdapter {
  const blobReaderOptions = {
    ...(options.executable === undefined
      ? {}
      : { executable: options.executable }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  };

  return new LocalGitAdapter(
    new NodeGitCommandExecutor(options),
    new NodeGitBlobReader(blobReaderOptions)
  );
}

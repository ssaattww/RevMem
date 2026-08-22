import path from "node:path";

import {
  resolveWorkspaceResourceEligibility,
  type FileSystemPathSemantics,
  type ResourceUri
} from "./application/workspace-identity/index";

/** One workspace root whose URI identity has already crossed the T609 filesystem boundary. */
export interface T305WorkspaceRootUriCandidate {
  readonly filesystemPath: string;
  readonly uri: ResourceUri;
}

const containsRepositoryRoot = (
  workspaceRoot: string,
  repositoryRoot: string,
  semantics: FileSystemPathSemantics
): boolean => {
  if (workspaceRoot.length === 0 || repositoryRoot.length === 0) return false;
  const paths = semantics === "windows" ? path.win32 : path.posix;
  const relative = paths.relative(paths.resolve(workspaceRoot), paths.resolve(repositoryRoot));
  return relative.length === 0 || (
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
};

/**
 * Resolves a Git root to exactly one containing workspace URI without reducing
 * remote authority to a local filesystem string. Windows comparisons use the
 * workspace-side path semantics; ambiguous roots deliberately have no owner.
 */
export const resolveT305RepositoryRootUri = (input: {
  readonly repositoryRoot: string;
  readonly workspaceFolders: readonly T305WorkspaceRootUriCandidate[];
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}): ResourceUri | undefined => {
  const matches = input.workspaceFolders.filter((workspaceFolder) => {
    if (!containsRepositoryRoot(
      workspaceFolder.filesystemPath,
      input.repositoryRoot,
      input.fileSystemPathSemantics
    )) return false;
    return resolveWorkspaceResourceEligibility({
      documentUri: workspaceFolder.uri,
      workspaceFolders: [{ uri: workspaceFolder.uri, name: "repository-root" }],
      fileSystemPathSemantics: input.fileSystemPathSemantics
    }) !== undefined;
  });
  return matches.length === 1 ? matches[0]!.uri : undefined;
};

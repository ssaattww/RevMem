import path from "node:path";

import { requireCanonicalRepositoryRelativePath } from "./application/repository-path/index";
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

const matchingWorkspaceRoots = (input: {
  readonly repositoryRoot: string;
  readonly workspaceFolders: readonly T305WorkspaceRootUriCandidate[];
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}): readonly T305WorkspaceRootUriCandidate[] => input.workspaceFolders.filter((workspaceFolder) => {
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
  const matches = matchingWorkspaceRoots(input);
  return matches.length === 1 ? matches[0]!.uri : undefined;
};

/**
 * Resolves a canonical repository-relative working-tree path through exactly one
 * registered workspace root while preserving that root's remote URI identity.
 */
export const resolveT305RepositoryWorkingTreeFileTarget = (input: {
  readonly repositoryRoot: string;
  readonly repositoryPath: string;
  readonly workspaceFolders: readonly T305WorkspaceRootUriCandidate[];
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
}): Readonly<{
  readonly workspaceFolderUri: ResourceUri;
  readonly relativePathSegments: readonly string[];
}> | undefined => {
  const repositoryPath = requireCanonicalRepositoryRelativePath(
    input.repositoryPath,
    input.fileSystemPathSemantics,
    "PR Progress repository-relative working-tree path"
  );
  const matches = matchingWorkspaceRoots(input);
  if (matches.length !== 1) return undefined;

  const paths = input.fileSystemPathSemantics === "windows" ? path.win32 : path.posix;
  const workspaceRoot = paths.resolve(matches[0]!.filesystemPath);
  const repositoryRoot = paths.resolve(input.repositoryRoot);
  const repositoryRelative = paths.relative(workspaceRoot, repositoryRoot);
  const repositorySegments = repositoryRelative.length === 0
    ? []
    : repositoryRelative.split(paths.sep).filter((segment) => segment.length > 0);

  return Object.freeze({
    workspaceFolderUri: matches[0]!.uri,
    relativePathSegments: Object.freeze([
      ...repositorySegments,
      ...repositoryPath.split("/")
    ])
  });
};

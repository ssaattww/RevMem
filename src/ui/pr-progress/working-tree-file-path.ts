import path from "node:path";

import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";

/** Resolves one canonical repository-relative path without allowing repository escape. */
export const resolveWorkingTreeFilePath = (
  repositoryRoot: string,
  repositoryPath: string,
  semantics: FileSystemPathSemantics
): string => {
  const pathApi = semantics === "windows" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(repositoryRoot)) {
    throw new RangeError("Registered repository root must be absolute.");
  }
  const canonicalPath = requireCanonicalRepositoryRelativePath(
    repositoryPath,
    semantics,
    "PR Progress working-tree repository path"
  );
  const root = pathApi.resolve(repositoryRoot);
  const resolved = pathApi.resolve(root, ...canonicalPath.split("/"));
  const relative = pathApi.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    throw new RangeError("PR Progress working-tree path escapes the registered repository root.");
  }
  return resolved;
};

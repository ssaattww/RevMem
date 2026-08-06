import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

const FIXTURE_PREFIX = "review-range-vscode-";

/** Resolves and proves that cleanup targets one direct, owned VS Code fixture directory. */
export const requireOwnedTemporaryDirectoryRoot = async (rootPath: string | undefined): Promise<string> => {
  if (rootPath === undefined || rootPath.length === 0) {
    throw new Error("Owned temporary-directory cleanup root is missing.");
  }
  const resolvedRoot = resolve(rootPath);
  const resolvedTemporaryDirectory = resolve(tmpdir());
  if (
    resolvedRoot === resolvedTemporaryDirectory ||
    dirname(resolvedRoot) !== resolvedTemporaryDirectory ||
    !basename(resolvedRoot).startsWith(FIXTURE_PREFIX)
  ) {
    throw new Error("Owned temporary-directory cleanup root must be one direct review-range-vscode fixture directory.");
  }
  const metadata = await lstat(resolvedRoot);
  if (!metadata.isDirectory()) {
    throw new Error("Owned temporary-directory cleanup root must be a directory.");
  }
  return resolvedRoot;
};

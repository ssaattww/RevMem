import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temporary directory owned by one test and removable during cleanup. */
export interface TemporaryDirectory {
  /** Absolute path to the temporary directory. */
  readonly path: string;
  /** Removes the directory and every test artifact below it. */
  cleanup(): Promise<void>;
}

/**
 * Creates an isolated directory beneath the operating-system temporary path.
 *
 * @param prefix Human-readable prefix for the temporary directory name.
 * @returns A directory whose caller is responsible for cleaning up.
 */
export async function createTemporaryDirectory(prefix: string): Promise<TemporaryDirectory> {
  const directoryPath = await mkdtemp(join(tmpdir(), `${prefix}-`));

  return {
    path: directoryPath,
    async cleanup(): Promise<void> {
      await rm(directoryPath, { force: true, recursive: true });
    }
  };
}

/**
 * Determines whether a path remains on disk, including directories.
 *
 * @param targetPath Absolute or relative path to inspect.
 * @returns `true` when the path exists.
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

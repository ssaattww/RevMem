import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  lstat,
  type FileHandle
} from "node:fs/promises";
import path from "node:path";

import type { AtomicTextFileStore } from "./contracts";

const isErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === code;

const closeIfOpen = async (handle: FileHandle | undefined): Promise<void> => {
  if (handle === undefined) {
    return;
  }

  await handle.close();
};

export type StoragePathSemantics = "windows" | "posix";

/** Determines whether a resolved path has the configured root as an exact ancestor. */
export const isStoragePathContained = (
  root: string,
  candidate: string,
  semantics: StoragePathSemantics = process.platform === "win32" ? "windows" : "posix"
): boolean => {
  const hostPath = semantics === "windows" ? path.win32 : path.posix;
  const relative = hostPath.relative(root, candidate);
  return relative.length === 0 || (
    !hostPath.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${hostPath.sep}`)
  );
};

/** Node filesystem implementation of temp-write, file flush, and atomic replace. */
export class NodeAtomicTextFileStore implements AtomicTextFileStore {
  private readonly rootPath: string | undefined;
  private readonly resolvedRoot: string | undefined;

  /** When supplied, all final Node mutations are performed through a physical descendant of this root. */
  public constructor(rootPath?: string) {
    this.rootPath = rootPath === undefined ? undefined : path.resolve(rootPath);
    this.resolvedRoot = this.rootPath;
  }

  /**
   * Reads a UTF-8 file without treating its absence as an error.
   *
   * @returns The content at `filePath`, or `undefined` when it does not exist.
   * @throws Propagates filesystem failures other than `ENOENT`.
   */
  public async readText(filePath: string): Promise<string | undefined> {
    try {
      return await readFile(await this.physicalPath(filePath, false), "utf8");
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return undefined;
      }

      throw error;
    }
  }

  /** Removes a persisted file and treats absence as success. */
  public async deleteText(filePath: string): Promise<void> {
    await rm(await this.physicalPath(filePath, false), { force: true });
  }

  /**
   * Flushes complete UTF-8 content to a unique temporary file and renames it over `filePath`.
   *
   * @throws Rejects with the original filesystem error after best-effort temporary-file cleanup; it never exposes partial content at the destination through this method.
   */
  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    let handle: FileHandle | undefined;
    let destination = await this.physicalPath(filePath, true);
    // Revalidate after directory creation: containment is established before
    // mutation and every newly materialized component is checked again.
    await mkdir(path.dirname(destination), { recursive: true });
    destination = await this.physicalPath(filePath, true);
    const physicalDirectory = path.dirname(destination);
    const physicalTemporaryPath = path.join(
      physicalDirectory,
      `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`
    );

    try {
      handle = await open(physicalTemporaryPath, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await closeIfOpen(handle);
      handle = undefined;
      await rename(physicalTemporaryPath, destination);
    } catch (error) {
      await closeIfOpen(handle).catch(() => undefined);
      await rm(physicalTemporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Validates logical containment before every I/O operation and rejects the
   * configured root plus every existing component, including the final path,
   * when it is a link, junction, or reparse point.  Creation occurs only after
   * that validation, so an outside sibling can never be created on rejection.
   */
  private async physicalPath(filePath: string, requireExists: boolean): Promise<string> {
    if (this.rootPath === undefined || this.resolvedRoot === undefined) return filePath;
    const root = this.resolvedRoot;
    const candidate = path.resolve(filePath);
    if (!isStoragePathContained(root, candidate)) {
      throw new Error("Persistence path escapes its configured storage root.");
    }
    const assertNotLink = async (logical: string): Promise<boolean> => {
      try {
        const state = await lstat(logical);
        if (state.isSymbolicLink()) {
          throw new Error("Persistence storage must not traverse a symbolic link or junction.");
        }
        return true;
      } catch (error) {
        if (!isErrorCode(error, "ENOENT")) throw error;
        return false;
      }
    };
    if (!(await assertNotLink(root))) {
      if (!requireExists) return candidate;
      await mkdir(root, { recursive: true });
      await assertNotLink(root);
    }
    const relative = path.relative(root, candidate);
    const pieces = relative.split(path.sep).filter((piece) => piece.length > 0);
    let logical = root;
    for (const piece of pieces) {
      logical = path.join(logical, piece);
      const exists = await assertNotLink(logical);
      if (!exists) break;
    }
    if (requireExists) {
      // All existing components (including a pre-existing final file) were
      // checked above; now create only the logical descendant directory.
      await mkdir(path.dirname(candidate), { recursive: true });
      logical = root;
      for (const piece of pieces) {
        logical = path.join(logical, piece);
        await assertNotLink(logical);
      }
    }
    return candidate;
  }
}

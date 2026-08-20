import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
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
    const directory = path.dirname(filePath);
    let handle: FileHandle | undefined;

    await mkdir(directory, { recursive: true });
    const destination = await this.physicalPath(filePath, true);
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

  /** Resolves final Node I/O through existing physical directories, rejecting every link/reparse ancestor. */
  private async physicalPath(filePath: string, requireExists: boolean): Promise<string> {
    if (this.rootPath === undefined || this.resolvedRoot === undefined) return filePath;
    const root = this.resolvedRoot;
    const candidate = path.resolve(filePath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error("Persistence path escapes its configured storage root.");
    }
    const relative = path.relative(root, candidate);
    let logical = root;
    const pieces = relative.split(path.sep).filter((piece) => piece.length > 0);
    const last = pieces.pop();
    for (const piece of pieces) {
      logical = path.join(logical, piece);
      try {
        if ((await lstat(logical)).isSymbolicLink()) {
          throw new Error("Persistence storage must not traverse a symbolic link or junction.");
        }
      } catch (error) {
        if (!isErrorCode(error, "ENOENT")) throw error;
        break;
      }
    }
    const physicalRoot = await realpath(root).catch(async (error: unknown) => {
      if (!isErrorCode(error, "ENOENT")) throw error;
      await mkdir(root, { recursive: true });
      return realpath(root);
    });
    const physicalDirectory = await realpath(path.dirname(candidate)).catch((error: unknown) => {
      if (requireExists || !isErrorCode(error, "ENOENT")) throw error;
      return path.dirname(candidate);
    });
    if (physicalDirectory !== physicalRoot && !physicalDirectory.startsWith(`${physicalRoot}${path.sep}`)) {
      throw new Error("Persistence storage resolves outside its configured storage root.");
    }
    return path.join(physicalDirectory, last ?? "");
  }
}

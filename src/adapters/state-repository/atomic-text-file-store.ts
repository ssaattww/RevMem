import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
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
  /**
   * Reads a UTF-8 file without treating its absence as an error.
   *
   * @returns The content at `filePath`, or `undefined` when it does not exist.
   * @throws Propagates filesystem failures other than `ENOENT`.
   */
  public async readText(filePath: string): Promise<string | undefined> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Flushes complete UTF-8 content to a unique temporary file and renames it over `filePath`.
   *
   * @throws Rejects with the original filesystem error after best-effort temporary-file cleanup; it never exposes partial content at the destination through this method.
   */
  public async writeTextAtomically(filePath: string, content: string): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
    );
    let handle: FileHandle | undefined;

    await mkdir(directory, { recursive: true });

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await closeIfOpen(handle);
      handle = undefined;
      await rename(temporaryPath, filePath);
    } catch (error) {
      await closeIfOpen(handle).catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

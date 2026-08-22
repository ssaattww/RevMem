import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FolderUnderstandingStoppedStore } from "../../application/global-understanding/index";

interface StoredMarkers { readonly schemaVersion: 1; readonly repositoryId: string; readonly repositoryRoot: string; readonly stoppedFolders: readonly string[]; }

/** Filesystem persistence for T610 stopped markers; no active evidence is stored. */
export class NodeFolderUnderstandingStoppedStore implements FolderUnderstandingStoppedStore {
  public constructor(private readonly globalStoragePath: string) {}
  public async loadStopped(repositoryId: string, repositoryRoot: string): Promise<readonly string[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file(repositoryId, repositoryRoot), "utf8")) as Partial<StoredMarkers>;
      if (parsed.schemaVersion !== 1 || parsed.repositoryId !== repositoryId || parsed.repositoryRoot !== repositoryRoot || !Array.isArray(parsed.stoppedFolders) || !parsed.stoppedFolders.every((value) => typeof value === "string")) return [];
      return [...new Set(parsed.stoppedFolders)].sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return [];
    }
  }
  public async saveStopped(repositoryId: string, repositoryRoot: string, paths: readonly string[]): Promise<void> {
    const file = this.file(repositoryId, repositoryRoot);
    await mkdir(path.dirname(file), { recursive: true });
    const value: StoredMarkers = { schemaVersion: 1, repositoryId, repositoryRoot, stoppedFolders: [...new Set(paths)].sort() };
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
    await rename(temporary, file);
  }
  private file(repositoryId: string, repositoryRoot: string): string {
    const identity = createHash("sha256").update(`${repositoryId}\0${repositoryRoot}`, "utf8").digest("hex");
    return path.join(this.globalStoragePath, "folder-understanding", `${identity}.json`);
  }
}

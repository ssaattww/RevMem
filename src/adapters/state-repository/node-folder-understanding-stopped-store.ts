import { createHash } from "node:crypto";
import path from "node:path";

import type { FolderUnderstandingStoppedStore } from "../../application/global-understanding/index";
import { NodeAtomicTextFileStore, withStorageRootLock, type AtomicTextFileStore, type StorageRootLockDiagnostic } from "./index";

interface StoredMarkers { readonly schemaVersion: 1; readonly repositoryId: string; readonly repositoryRoot: string; readonly stoppedFolders: readonly string[]; }

/** Privacy-safe error which intentionally omits storage paths and marker values. */
export class FolderUnderstandingStoppedStoreError extends Error {
  public constructor(operation: "load" | "save") { super(`Global Understanding stopped-marker ${operation} failed.`); this.name = "FolderUnderstandingStoppedStoreError"; }
}

/** Root-contained atomic and lock-protected persistence for explicit T610 markers. */
export class NodeFolderUnderstandingStoppedStore implements FolderUnderstandingStoppedStore {
  private readonly atomicFileStore: AtomicTextFileStore;
  public constructor(
    private readonly globalStoragePath: string,
    options: { readonly atomicFileStore?: AtomicTextFileStore; readonly notifyStorageLockDiagnostic?: (value: StorageRootLockDiagnostic) => void | Promise<void> } = {}
  ) { this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore(globalStoragePath); this.notifyStorageLockDiagnostic = options.notifyStorageLockDiagnostic; }
  private readonly notifyStorageLockDiagnostic: ((value: StorageRootLockDiagnostic) => void | Promise<void>) | undefined;
  public async loadStopped(repositoryId: string, repositoryRoot: string): Promise<readonly string[]> {
    try {
      const text = await this.atomicFileStore.readText(this.file(repositoryId, repositoryRoot));
      if (text === undefined) return [];
      const parsed = JSON.parse(text) as Partial<StoredMarkers>;
      if (parsed.schemaVersion !== 1 || parsed.repositoryId !== repositoryId || parsed.repositoryRoot !== repositoryRoot || !Array.isArray(parsed.stoppedFolders) || !parsed.stoppedFolders.every((value) => typeof value === "string")) throw new FolderUnderstandingStoppedStoreError("load");
      return [...new Set(parsed.stoppedFolders)].sort();
    } catch (error) { if (error instanceof FolderUnderstandingStoppedStoreError) throw error; throw new FolderUnderstandingStoppedStoreError("load"); }
  }
  public async saveStopped(repositoryId: string, repositoryRoot: string, paths: readonly string[]): Promise<void> {
    const value: StoredMarkers = { schemaVersion: 1, repositoryId, repositoryRoot, stoppedFolders: [...new Set(paths)].sort() };
    try {
      await withStorageRootLock({ rootPath: this.globalStoragePath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
        await lease.assertOwned();
        await this.atomicFileStore.writeTextAtomically(this.file(repositoryId, repositoryRoot), `${JSON.stringify(value)}\n`);
      });
    } catch { throw new FolderUnderstandingStoppedStoreError("save"); }
  }
  /** Applies one marker delta while holding the same root-local lease as every other window. */
  public async mutateStopped(
    repositoryId: string,
    repositoryRoot: string,
    mutation: Readonly<{ add: readonly string[]; remove: readonly string[] }>
  ): Promise<readonly string[]> {
    try {
      return await withStorageRootLock({ rootPath: this.globalStoragePath, notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
        await lease.assertOwned();
        const text = await this.atomicFileStore.readText(this.file(repositoryId, repositoryRoot));
        const current = text === undefined ? [] : this.parse(text, repositoryId, repositoryRoot);
        const next = new Set(current);
        for (const value of mutation.add) next.add(value);
        for (const value of mutation.remove) next.delete(value);
        const stoppedFolders = [...next].sort();
        const value: StoredMarkers = { schemaVersion: 1, repositoryId, repositoryRoot, stoppedFolders };
        await this.atomicFileStore.writeTextAtomically(this.file(repositoryId, repositoryRoot), `${JSON.stringify(value)}\n`);
        return stoppedFolders;
      });
    } catch { throw new FolderUnderstandingStoppedStoreError("save"); }
  }
  private file(repositoryId: string, repositoryRoot: string): string {
    const identity = createHash("sha256").update(`${repositoryId}\0${repositoryRoot}`, "utf8").digest("hex");
    return path.join(this.globalStoragePath, "folder-understanding", `${identity}.json`);
  }
  private parse(text: string, repositoryId: string, repositoryRoot: string): string[] {
    const parsed = JSON.parse(text) as Partial<StoredMarkers>;
    if (parsed.schemaVersion !== 1 || parsed.repositoryId !== repositoryId || parsed.repositoryRoot !== repositoryRoot || !Array.isArray(parsed.stoppedFolders) || !parsed.stoppedFolders.every((value) => typeof value === "string")) throw new FolderUnderstandingStoppedStoreError("load");
    return [...new Set(parsed.stoppedFolders)].sort();
  }
}

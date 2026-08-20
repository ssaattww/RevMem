import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { NodeNonGitSnapshotStorage } from "./non-git-snapshots/index";
import {
  NodeAtomicTextFileStore,
  InProcessStorageRootLockCoordinator,
  withStorageRootLockCoordinator,
  type AtomicTextFileStore,
  type StorageRootLease,
  type StorageRootLockCoordinator,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "./state-repository/index";
import { migratePersistedReviewHistoryFile } from "./state-repository/jsonl-review-history-store";
import {
  createTrustedPersistencePathGuard,
  preparePersistedReviewState,
  quarantinePersistedText
} from "./state-repository/persistence-schema-recovery";

interface StartupMigrationOptions {
  readonly storageUris: ReviewStateStorageUris;
  readonly atomicFileStore?: AtomicTextFileStore;
  /** Coordinator shared with an alternate AtomicTextFileStore namespace. */
  readonly storageLockCoordinator?: StorageRootLockCoordinator;
  readonly notifyStorageLockDiagnostic?: (diagnostic: import("./state-repository/index").StorageRootLockDiagnostic) => void | Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readDirectoryNames = async (directory: string): Promise<string[]> => {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const hashIdentifier = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const readIdentity = (raw: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const migrateWorkspaceState = async (
  storageUris: ReviewStateStorageUris,
  store: AtomicTextFileStore
): Promise<string | undefined> => {
  const workspaceRoot = storageUris.storageUri?.fsPath;
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) return undefined;
  const statePath = path.join(path.resolve(workspaceRoot), "workspace-state.json");
  const guard = createTrustedPersistencePathGuard(path.resolve(workspaceRoot), store);
  try {
    await guard(statePath);
  } catch {
    return undefined;
  }
  const raw = await store.readText(statePath);
  if (raw === undefined) return undefined;
  const value = readIdentity(raw);
  const contextState = value === undefined || !isRecord(value.contextState)
    ? undefined
    : value.contextState;
  const repositoryId = contextState?.repositoryId;
  const contextId = contextState?.contextId;
  if (
    typeof repositoryId !== "string" || repositoryId.trim().length === 0 ||
    typeof contextId !== "string" || contextId.trim().length === 0
  ) {
    await quarantinePersistedText(store, statePath, raw, true, guard);
    return undefined;
  }
  const preparation = await preparePersistedReviewState(
    { storageUris, atomicFileStore: store },
    { kind: "workspace", repositoryId, contextId }
  );
  return preparation === "ready" ? repositoryId : undefined;
};

const migrateRepositoryStateRoot = async (
  storageUris: ReviewStateStorageUris,
  store: AtomicTextFileStore,
  collection: "repositories" | "external-files",
  rootName: string
): Promise<string | undefined> => {
  const globalRoot = path.resolve(storageUris.globalStorageUri.fsPath);
  const rootPath = path.join(globalRoot, collection, rootName);
  const manifestPath = path.join(rootPath, "manifest.json");
  const guard = createTrustedPersistencePathGuard(rootPath, store);
  try {
    await guard(manifestPath);
  } catch {
    return undefined;
  }
  const raw = await store.readText(manifestPath);
  if (raw === undefined) return undefined;
  const manifest = readIdentity(raw);
  const repositoryId = manifest?.repositoryId;
  if (
    typeof repositoryId !== "string" || repositoryId.trim().length === 0 ||
    hashIdentifier(repositoryId) !== rootName
  ) {
    await quarantinePersistedText(store, manifestPath, raw, true, guard);
    return undefined;
  }
  const contexts = Array.isArray(manifest?.contexts) ? manifest.contexts : [];
  const firstContext = contexts.find((entry) =>
    isRecord(entry) && typeof entry.contextId === "string" && entry.contextId.trim().length > 0
  );
  const contextId = isRecord(firstContext) && typeof firstContext.contextId === "string"
    ? firstContext.contextId
    : "startup:unreferenced";
  const target: ReviewStateRepositoryTarget = {
    kind: collection === "external-files" ? "external-file" : "git",
    repositoryId,
    contextId
  };
  await preparePersistedReviewState({ storageUris, atomicFileStore: store }, target);
  return repositoryId;
};

const migrateHistoryRoot = async (
  rootPath: string,
  store: AtomicTextFileStore,
  expectedRepositoryId?: string
): Promise<void> => {
  const historyDirectory = path.join(rootPath, "history");
  const guard = createTrustedPersistencePathGuard(rootPath, store);
  await guard(historyDirectory);
  for (const name of await readDirectoryNames(historyDirectory)) {
    if (/^events-\d{4}-\d{2}\.jsonl$/u.test(name)) {
      const filePath = path.join(historyDirectory, name);
      await guard(filePath);
      await migratePersistedReviewHistoryFile(
        store,
        filePath,
        expectedRepositoryId
      );
    }
  }
};

/**
 * Runs the accepted startup migration boundary before runtime persistence is used.
 * State manifests/workspace state, every historical JSONL month, snapshot entries, and
 * hashed latest pointers are migrated eagerly. Corrupt records are quarantined/fail-closed.
 */
export const runPersistenceStartupMigration = async (
  options: StartupMigrationOptions
): Promise<void> => {
  const store = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  const storageLockCoordinator = options.storageLockCoordinator ?? (
    options.atomicFileStore !== undefined && !(options.atomicFileStore instanceof NodeAtomicTextFileStore)
      ? new InProcessStorageRootLockCoordinator()
      : undefined
  );
  const migrateRoot = async (
    rootPath: string,
    stateMigration: (fencedStore: AtomicTextFileStore) => Promise<string | undefined>
  ): Promise<void> => {
    await withStorageRootLockCoordinator(storageLockCoordinator, { rootPath, notifyDiagnostic: options.notifyStorageLockDiagnostic }, async (lease) => {
      // State, history and snapshot recovery deliberately share one lease. A second
      // Extension Host therefore cannot read an old migration plan between phases.
      const fencedStore = fenceStore(store, lease);
      const expectedRepositoryId = await stateMigration(fencedStore);
      await lease.assertOwned();
      await migrateHistoryRoot(rootPath, fencedStore, expectedRepositoryId);
      await createTrustedPersistencePathGuard(rootPath, fencedStore)(path.join(rootPath, "snapshots"));
      await lease.assertOwned();
      await new NodeNonGitSnapshotStorage({
        snapshotDirectory: path.join(rootPath, "snapshots"),
        atomicFileStore: fencedStore,
        storageLockCoordinator,
        notifyStorageLockDiagnostic: options.notifyStorageLockDiagnostic
      }).migratePersistedMetadata(lease);
    });
  };
  const workspaceRoot = options.storageUris.storageUri?.fsPath;
  if (workspaceRoot !== undefined && workspaceRoot.trim().length > 0) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    await migrateRoot(resolvedWorkspaceRoot, (fencedStore) => migrateWorkspaceState(options.storageUris, fencedStore));
  }

  const globalRoot = path.resolve(options.storageUris.globalStorageUri.fsPath);
  for (const collection of ["repositories", "external-files"] as const) {
    const collectionRoot = path.join(globalRoot, collection);
    for (const name of await readDirectoryNames(collectionRoot)) {
      if (!/^[0-9a-f]{64}$/u.test(name)) continue;
      const rootPath = path.join(collectionRoot, name);
      await migrateRoot(rootPath, (fencedStore) =>
        migrateRepositoryStateRoot(options.storageUris, fencedStore, collection, name));
    }
  }
};

const fenceStore = (store: AtomicTextFileStore, lease: StorageRootLease): AtomicTextFileStore => ({
  readText: (filePath) => store.readText(filePath),
  writeTextAtomically: async (filePath, content) => { await lease.assertOwned(); await store.writeTextAtomically(filePath, content); },
  ...(store.deleteText === undefined ? {} : { deleteText: async (filePath: string) => { await lease.assertOwned(); await store.deleteText!(filePath); } })
});

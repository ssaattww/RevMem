import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { NodeNonGitSnapshotStorage } from "./non-git-snapshots/index";
import {
  NodeAtomicTextFileStore,
  type AtomicTextFileStore,
  type ReviewStateRepositoryTarget,
  type ReviewStateStorageUris
} from "./state-repository/index";
import { migratePersistedReviewHistoryFile } from "./state-repository/jsonl-review-history-store";
import {
  preparePersistedReviewState,
  quarantinePersistedText
} from "./state-repository/persistence-schema-recovery";

interface StartupMigrationOptions {
  readonly storageUris: ReviewStateStorageUris;
  readonly atomicFileStore?: AtomicTextFileStore;
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
): Promise<void> => {
  const workspaceRoot = storageUris.storageUri?.fsPath;
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) return;
  const statePath = path.join(path.resolve(workspaceRoot), "workspace-state.json");
  const raw = await store.readText(statePath);
  if (raw === undefined) return;
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
    await quarantinePersistedText(store, statePath, raw);
    return;
  }
  await preparePersistedReviewState(
    { storageUris, atomicFileStore: store },
    { kind: "workspace", repositoryId, contextId }
  );
};

const migrateRepositoryStateRoot = async (
  storageUris: ReviewStateStorageUris,
  store: AtomicTextFileStore,
  collection: "repositories" | "external-files",
  rootName: string
): Promise<void> => {
  const globalRoot = path.resolve(storageUris.globalStorageUri.fsPath);
  const rootPath = path.join(globalRoot, collection, rootName);
  const manifestPath = path.join(rootPath, "manifest.json");
  const raw = await store.readText(manifestPath);
  if (raw === undefined) return;
  const manifest = readIdentity(raw);
  const repositoryId = manifest?.repositoryId;
  if (
    typeof repositoryId !== "string" || repositoryId.trim().length === 0 ||
    hashIdentifier(repositoryId) !== rootName
  ) {
    await quarantinePersistedText(store, manifestPath, raw);
    return;
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
};

const persistenceRoots = async (storageUris: ReviewStateStorageUris): Promise<string[]> => {
  const roots: string[] = [];
  if (storageUris.storageUri?.fsPath !== undefined && storageUris.storageUri.fsPath.trim().length > 0) {
    roots.push(path.resolve(storageUris.storageUri.fsPath));
  }
  const globalRoot = path.resolve(storageUris.globalStorageUri.fsPath);
  for (const collection of ["repositories", "external-files"] as const) {
    const collectionRoot = path.join(globalRoot, collection);
    for (const name of await readDirectoryNames(collectionRoot)) {
      if (/^[0-9a-f]{64}$/u.test(name)) {
        roots.push(path.join(collectionRoot, name));
      }
    }
  }
  return roots;
};

const migrateHistoryRoot = async (
  rootPath: string,
  store: AtomicTextFileStore
): Promise<void> => {
  const historyDirectory = path.join(rootPath, "history");
  for (const name of await readDirectoryNames(historyDirectory)) {
    if (/^events-\d{4}-\d{2}\.jsonl$/u.test(name)) {
      await migratePersistedReviewHistoryFile(store, path.join(historyDirectory, name));
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
  await migrateWorkspaceState(options.storageUris, store);

  const globalRoot = path.resolve(options.storageUris.globalStorageUri.fsPath);
  for (const collection of ["repositories", "external-files"] as const) {
    const collectionRoot = path.join(globalRoot, collection);
    for (const name of await readDirectoryNames(collectionRoot)) {
      if (!/^[0-9a-f]{64}$/u.test(name)) continue;
      await migrateRepositoryStateRoot(options.storageUris, store, collection, name);
    }
  }

  for (const rootPath of await persistenceRoots(options.storageUris)) {
    await migrateHistoryRoot(rootPath, store);
    await new NodeNonGitSnapshotStorage({
      snapshotDirectory: path.join(rootPath, "snapshots"),
      atomicFileStore: store
    }).migratePersistedMetadata();
  }
};

import { createHash } from "node:crypto";
import path from "node:path";

import type {
  ReviewStateRepositoryTarget,
  ReviewStateStorageRoute,
  ReviewStateStorageUris
} from "./contracts";

const requireNonEmpty = (value: string, name: string): string => {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }

  return value;
};

const repositoryIdHash = (repositoryId: string): string =>
  createHash("sha256").update(repositoryId, "utf8").digest("hex");

/**
 * Resolves the common persistence root without importing VS Code APIs.
 * Git and pull-request state share globalStorageUri by repository identity;
 * external-file state uses a separate globalStorageUri subtree; non-Git
 * workspace state stays inside storageUri.
 *
 * @returns Absolute paths for the target's state pointer and future persistence subdirectories.
 * @throws Throws when target IDs are empty or the required configured storage URI is unavailable.
 */
export const resolveReviewStateStorageRoute = (
  storageUris: ReviewStateStorageUris,
  target: ReviewStateRepositoryTarget
): ReviewStateStorageRoute => {
  const repositoryId = requireNonEmpty(target.repositoryId, "repositoryId");
  requireNonEmpty(target.contextId, "contextId");

  if (target.kind === "workspace") {
    const workspaceStoragePath = storageUris.storageUri?.fsPath;
    if (workspaceStoragePath === undefined || workspaceStoragePath.trim().length === 0) {
      throw new Error(
        "ExtensionContext.storageUri is required for non-Git workspace persistence"
      );
    }

    const rootPath = path.resolve(workspaceStoragePath);
    return {
      storageKind: "workspace",
      rootPath,
      statePointerPath: path.join(rootPath, "workspace-state.json"),
      historyDirectory: path.join(rootPath, "history"),
      snapshotDirectory: path.join(rootPath, "snapshots"),
      lockPath: path.join(rootPath, "lock")
    };
  }

  const globalStoragePath = requireNonEmpty(
    storageUris.globalStorageUri.fsPath,
    "globalStorageUri.fsPath"
  );
  const collection = target.kind === "external-file"
    ? "external-files"
    : "repositories";
  const rootPath = path.join(
    path.resolve(globalStoragePath),
    collection,
    repositoryIdHash(repositoryId)
  );

  return {
    storageKind: "repository",
    rootPath,
    statePointerPath: path.join(rootPath, "manifest.json"),
    historyDirectory: path.join(rootPath, "history"),
    snapshotDirectory: path.join(rootPath, "snapshots"),
    cacheDirectory: path.join(rootPath, "cache"),
    lockPath: path.join(rootPath, "lock")
  };
};

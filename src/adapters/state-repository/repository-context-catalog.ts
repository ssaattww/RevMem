import path from "node:path";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewContextState,
} from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  FileSystemReviewStateRepositoryOptions,
  RepositoryStateManifestContextReference,
  ReviewStateRepositoryTarget,
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const requireCurrentSchema = (value: unknown, name: string): void => {
  if (value !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new Error(`${name} schema version is not supported`);
  }
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const validateReference = (value: unknown): RepositoryStateManifestContextReference => {
  if (!isRecord(value)) throw new TypeError("manifest context reference must be an object");
  requireCurrentSchema(value.schemaVersion, "manifest context reference");
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: requireString(value.contextId, "manifest.contexts[].contextId"),
    file: requireString(value.file, "manifest.contexts[].file"),
    updatedAt: requireString(value.updatedAt, "manifest.contexts[].updatedAt"),
  };
};

const resolveContextFile = (rootPath: string, relativeFile: string): string => {
  const normalized = relativeFile.replaceAll("\\", "/");
  if (!normalized.startsWith("contexts/") || path.isAbsolute(normalized)) {
    throw new Error(`Manifest context reference must remain inside contexts/: ${relativeFile}`);
  }
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Manifest context reference escapes storage root: ${relativeFile}`);
  }
  return resolved;
};

const validateContext = (
  value: unknown,
  repositoryId: string,
  contextId: string,
): ReviewContextState => {
  if (!isRecord(value)) throw new TypeError("persisted context must be an object");
  requireCurrentSchema(value.schemaVersion, "persisted context");
  if (requireString(value.repositoryId, "context.repositoryId") !== repositoryId) {
    throw new Error("persisted context repositoryId does not match catalog repositoryId");
  }
  if (requireString(value.contextId, "context.contextId") !== contextId) {
    throw new Error("persisted contextId does not match manifest reference");
  }
  const kind = requireString(value.kind, "context.kind");
  if (kind !== "branch" && kind !== "pull-request") {
    throw new Error(`repository context catalog cannot expose ${kind} context`);
  }
  requireString(value.displayName, "context.displayName");
  requireString(value.createdAt, "context.createdAt");
  requireString(value.updatedAt, "context.updatedAt");
  if (!isRecord(value.files)) throw new TypeError("context.files must be an object");
  if (kind === "branch" && !isRecord(value.branch)) {
    throw new TypeError("branch context must contain branch metadata");
  }
  if (kind === "pull-request" && !isRecord(value.pullRequest)) {
    throw new TypeError("pull-request context must contain pullRequest metadata");
  }
  return clone(value as unknown as ReviewContextState);
};

/** Reads the manifest-selected branch/PR contexts for one repository without mutating Review State or history. */
export const listPersistedRepositoryContexts = async (
  options: FileSystemReviewStateRepositoryOptions,
  repositoryId: string,
): Promise<ReviewContextState[]> => {
  const normalizedRepositoryId = requireString(repositoryId, "repositoryId");
  const target: ReviewStateRepositoryTarget = {
    kind: "git",
    repositoryId: normalizedRepositoryId,
    contextId: "review-context-catalog",
  };
  const route = resolveReviewStateStorageRoute(options.storageUris, target);
  const store = options.atomicFileStore ?? new NodeAtomicTextFileStore();

  try {
    const manifestText = await store.readText(route.statePointerPath);
    if (manifestText === undefined) return [];
    const manifestValue = JSON.parse(manifestText) as unknown;
    if (!isRecord(manifestValue)) throw new TypeError("repository manifest must be an object");
    requireCurrentSchema(manifestValue.schemaVersion, "repository manifest");
    if (manifestValue.storageKind !== "repository") {
      throw new Error("repository manifest storageKind must be repository");
    }
    if (requireString(manifestValue.repositoryId, "manifest.repositoryId") !== normalizedRepositoryId) {
      throw new Error("repository manifest repositoryId does not match requested repositoryId");
    }
    if (!Array.isArray(manifestValue.contexts)) {
      throw new TypeError("manifest.contexts must be an array");
    }

    const references = manifestValue.contexts.map(validateReference);
    if (new Set(references.map((reference) => reference.contextId)).size !== references.length) {
      throw new Error("repository manifest contains duplicate context IDs");
    }

    const contexts: ReviewContextState[] = [];
    for (const reference of references) {
      const contextPath = resolveContextFile(route.rootPath, reference.file);
      const text = await store.readText(contextPath);
      if (text === undefined) throw new Error(`persisted context file is missing: ${contextPath}`);
      contexts.push(validateContext(JSON.parse(text) as unknown, normalizedRepositoryId, reference.contextId));
    }
    return contexts.sort((left, right) => left.contextId.localeCompare(right.contextId));
  } catch (error) {
    await Promise.resolve(options.notifyPersistenceFailure?.({
      operation: "load",
      target,
      route,
      filePath: route.statePointerPath,
      error,
    })).catch(() => undefined);
    throw error;
  }
};

import path from "node:path";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState
} from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  FileSystemReviewStateRepositoryOptions,
  ReviewStateRepositoryTarget,
  ReviewStateStorageRoute
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const requireSchema = (value: unknown, name: string): void => {
  if (value !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new Error(
      `${name} schema version ${String(value)} is not supported; expected ${REVIEW_RANGE_SCHEMA_VERSION}`
    );
  }
};

const parseJson = (text: string, name: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${name} is not valid JSON`, { cause: error });
  }
};

const resolveGlobalFile = (
  route: ReviewStateStorageRoute,
  relativeFile: string
): string => {
  const normalized = relativeFile.replaceAll("\\", "/");
  if (!normalized.startsWith("global-state/")) {
    throw new Error(`Manifest Global reference must be inside global-state: ${relativeFile}`);
  }
  const root = path.resolve(route.rootPath);
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Manifest Global reference escapes storage root: ${relativeFile}`);
  }
  return resolved;
};

const validateGlobalState = (
  value: unknown,
  target: ReviewStateRepositoryTarget
): RepositoryGlobalState => {
  if (!isRecord(value)) {
    throw new TypeError("Global state must be an object");
  }
  requireSchema(value.schemaVersion, "Global state");
  const repositoryId = requireString(value.repositoryId, "globalState.repositoryId");
  if (repositoryId !== target.repositoryId) {
    throw new Error(
      `globalState.repositoryId ${repositoryId} does not match target repositoryId ${target.repositoryId}`
    );
  }
  requireString(value.currentRevisionId, "globalState.currentRevisionId");
  requireString(value.updatedAt, "globalState.updatedAt");
  if (!isRecord(value.files)) {
    throw new TypeError("globalState.files must be an object");
  }
  return JSON.parse(JSON.stringify(value)) as RepositoryGlobalState;
};

/** Reads the owner-wide Global document without requiring the selected context to exist. */
export const loadPersistedOwnerGlobal = async (
  options: FileSystemReviewStateRepositoryOptions,
  target: ReviewStateRepositoryTarget
): Promise<RepositoryGlobalState | undefined> => {
  const route = resolveReviewStateStorageRoute(options.storageUris, target);
  const store = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  const pointerText = await store.readText(route.statePointerPath);
  if (pointerText === undefined) {
    return undefined;
  }

  const pointer = parseJson(pointerText, route.statePointerPath);
  if (route.storageKind === "workspace") {
    if (!isRecord(pointer)) {
      throw new TypeError("Workspace review state must be an object");
    }
    return validateGlobalState(pointer.globalState, target);
  }

  if (!isRecord(pointer)) {
    throw new TypeError("Repository manifest must be an object");
  }
  requireSchema(pointer.schemaVersion, "Repository manifest");
  if (pointer.storageKind !== "repository") {
    throw new Error("Repository manifest storageKind must be repository");
  }
  const repositoryId = requireString(pointer.repositoryId, "manifest.repositoryId");
  if (repositoryId !== target.repositoryId) {
    throw new Error(
      `Manifest repositoryId ${repositoryId} does not match target repositoryId ${target.repositoryId}`
    );
  }
  if (!isRecord(pointer.globalState)) {
    throw new TypeError("manifest.globalState must be an object");
  }
  requireSchema(pointer.globalState.schemaVersion, "Manifest Global reference");
  const globalPath = resolveGlobalFile(
    route,
    requireString(pointer.globalState.file, "manifest.globalState.file")
  );
  const globalText = await store.readText(globalPath);
  if (globalText === undefined) {
    throw new Error(`Persisted Global state file is missing: ${globalPath}`);
  }
  return validateGlobalState(parseJson(globalText, globalPath), target);
};

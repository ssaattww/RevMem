import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { REVIEW_RANGE_SCHEMA_VERSION } from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  AtomicTextFileStore,
  FileSystemReviewStateRepositoryOptions,
  ReviewStateRepositoryTarget,
  ReviewStateStorageRoute
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

type JsonRecord = Record<string, unknown>;

type SchemaMigrationStep = {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (value: JsonRecord) => JsonRecord;
};

interface MigratedDocument {
  readonly value: JsonRecord;
  readonly migrated: boolean;
  readonly sourceVersion: number;
  readonly serialized: string;
}

interface MigrationWrite {
  readonly filePath: string;
  readonly original: string;
  readonly migrated: string;
}

export type PersistedReviewStatePreparation = "absent" | "ready" | "uncertain";

/** Raised for persisted data written by a newer or unsupported migration lineage. */
export class UnsupportedPersistedSchemaVersionError extends Error {
  public constructor(documentName: string, version: unknown) {
    super(`${documentName} schema version ${String(version)} is not supported.`);
    this.name = "UnsupportedPersistedSchemaVersionError";
  }
}

const requireRecord = (value: unknown, name: string): JsonRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as JsonRecord;
};

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const requireCurrentSchema = (value: unknown, name: string): void => {
  if (value !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new UnsupportedPersistedSchemaVersionError(name, value);
  }
};

const cloneRecord = (value: JsonRecord): JsonRecord =>
  JSON.parse(JSON.stringify(value)) as JsonRecord;

/**
 * Applies one-version-at-a-time schema steps and rejects gaps, cycles, and future versions.
 * The function is intentionally runtime-neutral so later schema revisions can append steps
 * without replacing older decoders.
 */
export const runSchemaMigrationChain = (
  value: JsonRecord,
  documentName: string,
  steps: readonly SchemaMigrationStep[],
  absentSchemaVersion?: number
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } => {
  const rawVersion = value.schemaVersion ?? absentSchemaVersion;
  if (
    typeof rawVersion !== "number" ||
    !Number.isSafeInteger(rawVersion) ||
    rawVersion < 0
  ) {
    throw new UnsupportedPersistedSchemaVersionError(documentName, rawVersion);
  }
  if (rawVersion > REVIEW_RANGE_SCHEMA_VERSION) {
    throw new UnsupportedPersistedSchemaVersionError(documentName, rawVersion);
  }

  let currentVersion = rawVersion;
  let current = cloneRecord(value);
  const sourceVersion = rawVersion;
  while (currentVersion < REVIEW_RANGE_SCHEMA_VERSION) {
    const candidates = steps.filter((step) => step.fromVersion === currentVersion);
    if (candidates.length !== 1) {
      throw new UnsupportedPersistedSchemaVersionError(documentName, currentVersion);
    }
    const step = candidates[0]!;
    if (step.toVersion !== currentVersion + 1) {
      throw new Error(
        `${documentName} migration must advance exactly one schema version from ${currentVersion}.`
      );
    }
    current = requireRecord(step.migrate(cloneRecord(current)), documentName);
    if (current.schemaVersion !== step.toVersion) {
      throw new Error(
        `${documentName} migration ${step.fromVersion}->${step.toVersion} did not publish its target schemaVersion.`
      );
    }
    currentVersion = step.toVersion;
  }

  return {
    value: current,
    migrated: sourceVersion !== REVIEW_RANGE_SCHEMA_VERSION,
    sourceVersion
  };
};

const migrateContextV0ToV1 = (value: JsonRecord): JsonRecord => {
  const files = requireRecord(value.files, "Context state files");
  const migratedFiles = Object.fromEntries(
    Object.entries(files).map(([fileId, fileValue]) => [
      fileId,
      {
        ...requireRecord(fileValue, `Context file ${fileId}`),
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
      }
    ])
  );
  return {
    ...value,
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    files: migratedFiles
  };
};

const CONTEXT_STEPS: readonly SchemaMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: migrateContextV0ToV1
  }
];

const GLOBAL_STEPS: readonly SchemaMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (value) => ({
      ...value,
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
    })
  }
];

const WORKSPACE_STEPS: readonly SchemaMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (value) => ({
      ...value,
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextState: migrateContextV0ToV1(
        requireRecord(value.contextState, "Workspace context state")
      ),
      globalState: {
        ...requireRecord(value.globalState, "Workspace Global state"),
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
      }
    })
  }
];

const MANIFEST_STEPS: readonly SchemaMigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (value) => {
      if (!Array.isArray(value.contexts)) {
        throw new TypeError("Repository manifest contexts must be an array");
      }
      return {
        ...value,
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contexts: value.contexts.map((entry, index) => ({
          ...requireRecord(entry, `Repository manifest context ${index}`),
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
        })),
        globalState: {
          ...requireRecord(value.globalState, "Repository manifest Global reference"),
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION
        }
      };
    }
  }
];

const parseAndMigrate = (
  raw: string,
  documentName: string,
  steps: readonly SchemaMigrationStep[]
): MigratedDocument => {
  const parsed = requireRecord(JSON.parse(raw) as unknown, documentName);
  const result = runSchemaMigrationChain(parsed, documentName, steps);
  return {
    ...result,
    serialized: `${JSON.stringify(result.value, null, 2)}\n`
  };
};

const validateContextDocument = (
  value: JsonRecord,
  repositoryId: string,
  expectedContextId?: string
): void => {
  requireCurrentSchema(value.schemaVersion, "Context state");
  if (requireString(value.repositoryId, "contextState.repositoryId") !== repositoryId) {
    throw new Error("Context state repositoryId does not match its repository manifest.");
  }
  const contextId = requireString(value.contextId, "contextState.contextId");
  if (expectedContextId !== undefined && contextId !== expectedContextId) {
    throw new Error("Context state contextId does not match its repository manifest reference.");
  }
  const files = requireRecord(value.files, "contextState.files");
  for (const [fileId, fileValue] of Object.entries(files)) {
    const file = requireRecord(fileValue, `contextState.files.${fileId}`);
    requireCurrentSchema(file.schemaVersion, `contextState.files.${fileId}`);
  }
};

const validateGlobalDocument = (value: JsonRecord, repositoryId: string): void => {
  requireCurrentSchema(value.schemaVersion, "Global state");
  if (requireString(value.repositoryId, "globalState.repositoryId") !== repositoryId) {
    throw new Error("Global state repositoryId does not match its storage owner.");
  }
  requireRecord(value.files, "globalState.files");
};

const validateWorkspaceDocument = (
  value: JsonRecord,
  target: ReviewStateRepositoryTarget
): void => {
  requireCurrentSchema(value.schemaVersion, "Workspace review state");
  const context = requireRecord(value.contextState, "Workspace context state");
  const global = requireRecord(value.globalState, "Workspace Global state");
  validateContextDocument(context, target.repositoryId, target.contextId);
  validateGlobalDocument(global, target.repositoryId);
};

interface ManifestReference {
  readonly contextId: string;
  readonly file: string;
}

const validateManifestDocument = (
  value: JsonRecord,
  target: ReviewStateRepositoryTarget
): { readonly contexts: ManifestReference[]; readonly globalFile: string } => {
  requireCurrentSchema(value.schemaVersion, "Repository manifest");
  if (value.storageKind !== "repository") {
    throw new Error("Repository manifest storageKind must be repository.");
  }
  if (requireString(value.repositoryId, "manifest.repositoryId") !== target.repositoryId) {
    throw new Error("Repository manifest repositoryId does not match the storage target.");
  }
  if (!Array.isArray(value.contexts)) {
    throw new TypeError("manifest.contexts must be an array");
  }
  const contexts = value.contexts.map((entry, index) => {
    const reference = requireRecord(entry, `manifest.contexts[${index}]`);
    requireCurrentSchema(reference.schemaVersion, `manifest.contexts[${index}]`);
    return {
      contextId: requireString(reference.contextId, `manifest.contexts[${index}].contextId`),
      file: requireString(reference.file, `manifest.contexts[${index}].file`)
    };
  });
  const globalReference = requireRecord(value.globalState, "manifest.globalState");
  requireCurrentSchema(globalReference.schemaVersion, "manifest.globalState");
  return {
    contexts,
    globalFile: requireString(globalReference.file, "manifest.globalState.file")
  };
};

const resolveReferencedFile = (
  route: ReviewStateStorageRoute,
  relativeFile: string,
  expectedDirectory: "contexts" | "global-state"
): string => {
  const normalized = relativeFile.replaceAll("\\", "/");
  if (!normalized.startsWith(`${expectedDirectory}/`)) {
    throw new Error(`Persisted reference must stay inside ${expectedDirectory}.`);
  }
  const root = path.resolve(route.rootPath);
  const resolved = path.resolve(root, normalized);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Persisted reference escapes its storage root.");
  }
  return resolved;
};

export const preMigrationBackupPath = (filePath: string): string =>
  `${filePath}.pre-migration.bak`;

const quarantinePath = (filePath: string, raw: string): string => {
  const digest = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
  return `${filePath}.corrupt-${digest}.quarantine`;
};

/** Preserves corrupt bytes before removing the active file from normal reads. */
export const quarantinePersistedText = async (
  store: AtomicTextFileStore,
  filePath: string,
  raw: string,
  removeOriginal = true
): Promise<string> => {
  const destination = quarantinePath(filePath, raw);
  await store.writeTextAtomically(destination, raw);
  if (removeOriginal) {
    await rm(filePath, { force: true });
  }
  return destination;
};

/** Writes every migration backup before any migrated document and rolls all documents back on publish failure. */
export const publishSchemaMigration = async (
  store: AtomicTextFileStore,
  writes: readonly MigrationWrite[]
): Promise<void> => {
  if (writes.length === 0) {
    return;
  }
  for (const write of writes) {
    await store.writeTextAtomically(preMigrationBackupPath(write.filePath), write.original);
  }
  try {
    for (const write of writes) {
      await store.writeTextAtomically(write.filePath, write.migrated);
    }
  } catch (error) {
    const restorationErrors: unknown[] = [];
    for (const write of [...writes].reverse()) {
      try {
        await store.writeTextAtomically(write.filePath, write.original);
      } catch (restoreError) {
        restorationErrors.push(restoreError);
      }
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(
        [error, ...restorationErrors],
        `Schema migration failed and backup restoration also failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    throw error;
  }
};

const decodeOrQuarantine = async (
  store: AtomicTextFileStore,
  filePath: string,
  raw: string,
  documentName: string,
  steps: readonly SchemaMigrationStep[]
): Promise<MigratedDocument | undefined> => {
  try {
    return parseAndMigrate(raw, documentName, steps);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, filePath, raw);
    return undefined;
  }
};

/**
 * Prepares current state before any public repository load/CAS operation.
 * Legacy data is migrated with manifest-last publication. Corrupt or missing evidence
 * returns `uncertain`, allowing callers to expose no reviewed ranges from that state.
 */
export const preparePersistedReviewState = async (
  options: FileSystemReviewStateRepositoryOptions,
  target: ReviewStateRepositoryTarget
): Promise<PersistedReviewStatePreparation> => {
  const route = resolveReviewStateStorageRoute(options.storageUris, target);
  const store = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  const pointerRaw = await store.readText(route.statePointerPath);
  if (pointerRaw === undefined) {
    return "absent";
  }

  if (route.storageKind === "workspace") {
    const decoded = await decodeOrQuarantine(
      store,
      route.statePointerPath,
      pointerRaw,
      "Workspace review state",
      WORKSPACE_STEPS
    );
    if (decoded === undefined) {
      return "uncertain";
    }
    try {
      validateWorkspaceDocument(decoded.value, target);
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) {
        throw error;
      }
      await quarantinePersistedText(store, route.statePointerPath, pointerRaw);
      return "uncertain";
    }
    if (decoded.migrated) {
      await publishSchemaMigration(store, [{
        filePath: route.statePointerPath,
        original: pointerRaw,
        migrated: decoded.serialized
      }]);
    }
    return "ready";
  }

  const manifest = await decodeOrQuarantine(
    store,
    route.statePointerPath,
    pointerRaw,
    "Repository manifest",
    MANIFEST_STEPS
  );
  if (manifest === undefined) {
    return "uncertain";
  }

  let references: ReturnType<typeof validateManifestDocument>;
  try {
    references = validateManifestDocument(manifest.value, target);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, route.statePointerPath, pointerRaw);
    return "uncertain";
  }

  const globalPath = resolveReferencedFile(route, references.globalFile, "global-state");
  const globalRaw = await store.readText(globalPath);
  if (globalRaw === undefined) {
    return "uncertain";
  }
  const global = await decodeOrQuarantine(
    store,
    globalPath,
    globalRaw,
    "Global state",
    GLOBAL_STEPS
  );
  if (global === undefined) {
    return "uncertain";
  }
  try {
    validateGlobalDocument(global.value, target.repositoryId);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, globalPath, globalRaw);
    return "uncertain";
  }

  const targetReference = references.contexts.find(
    (reference) => reference.contextId === target.contextId
  );
  if (targetReference === undefined) {
    const writes: MigrationWrite[] = [];
    if (global.migrated) {
      writes.push({ filePath: globalPath, original: globalRaw, migrated: global.serialized });
    }
    if (manifest.migrated) {
      writes.push({
        filePath: route.statePointerPath,
        original: pointerRaw,
        migrated: manifest.serialized
      });
    }
    await publishSchemaMigration(store, writes);
    return "absent";
  }

  const contextPath = resolveReferencedFile(route, targetReference.file, "contexts");
  const contextRaw = await store.readText(contextPath);
  if (contextRaw === undefined) {
    return "uncertain";
  }
  const context = await decodeOrQuarantine(
    store,
    contextPath,
    contextRaw,
    "Context state",
    CONTEXT_STEPS
  );
  if (context === undefined) {
    return "uncertain";
  }
  try {
    validateContextDocument(context.value, target.repositoryId, target.contextId);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, contextPath, contextRaw);
    return "uncertain";
  }

  const writes: MigrationWrite[] = [];
  if (context.migrated) {
    writes.push({ filePath: contextPath, original: contextRaw, migrated: context.serialized });
  }
  if (global.migrated) {
    writes.push({ filePath: globalPath, original: globalRaw, migrated: global.serialized });
  }
  if (manifest.migrated) {
    writes.push({
      filePath: route.statePointerPath,
      original: pointerRaw,
      migrated: manifest.serialized
    });
  }
  await publishSchemaMigration(store, writes);
  return "ready";
};

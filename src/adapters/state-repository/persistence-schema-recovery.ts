import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
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
import { validateOwnerReconciliation } from "./owner-reconciliation-validation";

type JsonRecord = Record<string, unknown>;

export type SchemaMigrationStep = {
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

type PersistencePathGuard = (filePath: string) => Promise<void>;

export type PersistedReviewStatePreparation = "absent" | "ready" | "uncertain";

/** Raised only when a syntactically valid schema version is newer than, or disconnected from, this reader. */
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

const requireArray = (value: unknown, name: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
};

const requireNonNegativeSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requireIsoTimestamp = (value: unknown, name: string): string => {
  const timestamp = requireString(value, name);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`${name} must be an ISO 8601 timestamp`);
  }
  return timestamp;
};

const requireCurrentSchema = (value: unknown, name: string): void => {
  if (value !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new UnsupportedPersistedSchemaVersionError(name, value);
  }
};

const cloneRecord = (value: JsonRecord): JsonRecord =>
  JSON.parse(JSON.stringify(value)) as JsonRecord;

const schemaVersionOf = (
  value: JsonRecord,
  documentName: string,
  absentSchemaVersion: number | undefined,
  targetSchemaVersion: number
): number => {
  const rawVersion = value.schemaVersion === undefined
    ? absentSchemaVersion
    : value.schemaVersion;
  if (
    typeof rawVersion !== "number" ||
    !Number.isSafeInteger(rawVersion) ||
    rawVersion < 0
  ) {
    throw new TypeError(`${documentName} schemaVersion must be a non-negative safe integer.`);
  }
  if (rawVersion > targetSchemaVersion) {
    throw new UnsupportedPersistedSchemaVersionError(documentName, rawVersion);
  }
  return rawVersion;
};

/**
 * Applies one-version-at-a-time schema steps and rejects gaps, cycles, malformed versions,
 * and future versions. `targetSchemaVersion` exists so historical migration steps can be
 * regression-tested independently of the process-wide current schema constant.
 */
export const runSchemaMigrationChain = (
  value: JsonRecord,
  documentName: string,
  steps: readonly SchemaMigrationStep[],
  absentSchemaVersion?: number,
  targetSchemaVersion = REVIEW_RANGE_SCHEMA_VERSION
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } => {
  if (!Number.isSafeInteger(targetSchemaVersion) || targetSchemaVersion < 0) {
    throw new TypeError("targetSchemaVersion must be a non-negative safe integer.");
  }
  const sourceVersion = schemaVersionOf(
    value,
    documentName,
    absentSchemaVersion,
    targetSchemaVersion
  );
  let currentVersion = sourceVersion;
  let current = cloneRecord(value);
  while (currentVersion < targetSchemaVersion) {
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
    migrated: sourceVersion !== targetSchemaVersion,
    sourceVersion
  };
};

const ROOT_V0_TO_V1: SchemaMigrationStep = {
  fromVersion: 0,
  toVersion: 1,
  migrate: (value) => ({ ...value, schemaVersion: 1 })
};

const ROOT_STEPS: readonly SchemaMigrationStep[] = [ROOT_V0_TO_V1];
const FILE_STEPS: readonly SchemaMigrationStep[] = [ROOT_V0_TO_V1];
const REFERENCE_STEPS: readonly SchemaMigrationStep[] = [ROOT_V0_TO_V1];

const migrateContextRecord = (
  input: JsonRecord,
  documentName: string,
  absentNestedVersion?: number
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } => {
  const root = runSchemaMigrationChain(input, documentName, ROOT_STEPS);
  const files = requireRecord(root.value.files, `${documentName} files`);
  let nestedMigrated = false;
  const migratedFiles = Object.fromEntries(
    Object.entries(files).map(([fileId, fileValue]) => {
      const migration = runSchemaMigrationChain(
        requireRecord(fileValue, `${documentName} file ${fileId}`),
        `${documentName} file ${fileId}`,
        FILE_STEPS,
        absentNestedVersion
      );
      nestedMigrated ||= migration.migrated;
      return [fileId, migration.value];
    })
  );
  return {
    value: { ...root.value, files: migratedFiles },
    migrated: root.migrated || nestedMigrated,
    sourceVersion: root.sourceVersion
  };
};

const migrateGlobalRecord = (
  input: JsonRecord,
  documentName: string
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } =>
  runSchemaMigrationChain(input, documentName, ROOT_STEPS);

const migrateWorkspaceRecord = (
  input: JsonRecord
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } => {
  const root = runSchemaMigrationChain(input, "Workspace review state", ROOT_STEPS);
  const legacyNestedVersion = root.sourceVersion === 0 ? 0 : undefined;
  const context = migrateContextRecord(
    requireRecord(root.value.contextState, "Workspace context state"),
    "Workspace context state",
    legacyNestedVersion
  );
  const global = runSchemaMigrationChain(
    requireRecord(root.value.globalState, "Workspace Global state"),
    "Workspace Global state",
    ROOT_STEPS,
    legacyNestedVersion
  );
  return {
    value: {
      ...root.value,
      contextState: context.value,
      globalState: global.value
    },
    migrated: root.migrated || context.migrated || global.migrated,
    sourceVersion: root.sourceVersion
  };
};

const migrateManifestRecord = (
  input: JsonRecord
): { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number } => {
  const root = runSchemaMigrationChain(input, "Repository manifest", ROOT_STEPS);
  const contexts = requireArray(root.value.contexts, "Repository manifest contexts");
  const nestedAbsentVersion = root.sourceVersion === 0 ? 0 : undefined;
  let nestedMigrated = false;
  const migratedContexts = contexts.map((entry, index) => {
    const migration = runSchemaMigrationChain(
      requireRecord(entry, `Repository manifest context ${index}`),
      `Repository manifest context ${index}`,
      REFERENCE_STEPS,
      nestedAbsentVersion
    );
    nestedMigrated ||= migration.migrated;
    return migration.value;
  });
  const globalMigration = runSchemaMigrationChain(
    requireRecord(root.value.globalState, "Repository manifest Global reference"),
    "Repository manifest Global reference",
    REFERENCE_STEPS,
    nestedAbsentVersion
  );
  return {
    value: {
      ...root.value,
      contexts: migratedContexts,
      globalState: globalMigration.value
    },
    migrated: root.migrated || nestedMigrated || globalMigration.migrated,
    sourceVersion: root.sourceVersion
  };
};

const serializeMigrated = (
  result: { readonly value: JsonRecord; readonly migrated: boolean; readonly sourceVersion: number }
): MigratedDocument => ({
  ...result,
  serialized: `${JSON.stringify(result.value, null, 2)}\n`
});

const parseAndMigrate = (
  raw: string,
  documentName: "Workspace review state" | "Repository manifest" | "Global state" | "Context state",
  absentNestedVersion?: number
): MigratedDocument => {
  const parsed = requireRecord(JSON.parse(raw) as unknown, documentName);
  if (documentName === "Workspace review state") {
    return serializeMigrated(migrateWorkspaceRecord(parsed));
  }
  if (documentName === "Repository manifest") {
    return serializeMigrated(migrateManifestRecord(parsed));
  }
  if (documentName === "Context state") {
    return serializeMigrated(migrateContextRecord(parsed, documentName, absentNestedVersion));
  }
  return serializeMigrated(migrateGlobalRecord(parsed, documentName));
};

const validateIntervals = (
  value: unknown,
  name: string,
  lineCount?: number
): void => {
  const intervals = requireArray(value, name);
  let previousEnd = 0;
  for (const [index, intervalValue] of intervals.entries()) {
    const interval = requireRecord(intervalValue, `${name}[${index}]`);
    const startLine = requireNonNegativeSafeInteger(
      interval.startLine,
      `${name}[${index}].startLine`
    );
    const endLineExclusive = requireNonNegativeSafeInteger(
      interval.endLineExclusive,
      `${name}[${index}].endLineExclusive`
    );
    if (endLineExclusive <= startLine || (index > 0 && startLine < previousEnd)) {
      throw new RangeError(`${name} must contain ordered, non-overlapping half-open intervals`);
    }
    if (lineCount !== undefined && endLineExclusive > lineCount) {
      throw new RangeError(`${name}[${index}] exceeds lineCount`);
    }
    previousEnd = endLineExclusive;
  }
};

const validateFileDocument = (
  value: JsonRecord,
  mapKey: string,
  name: string
): void => {
  requireCurrentSchema(value.schemaVersion, name);
  if (requireString(value.fileId, `${name}.fileId`) !== mapKey) {
    throw new Error(`${name}.fileId does not match its map key`);
  }
  const currentPath = requireCanonicalReviewPath(value.currentPath, `${name}.currentPath`);
  const previousPaths = requireArray(value.previousPaths, `${name}.previousPaths`);
  const seenPreviousPaths = new Set<string>();
  for (const [index, previousPath] of previousPaths.entries()) {
    const normalized = requireCanonicalReviewPath(
      previousPath,
      `${name}.previousPaths[${index}]`
    );
    if (normalized === currentPath || seenPreviousPaths.has(normalized)) {
      throw new Error(`${name}.previousPaths must be unique and exclude currentPath`);
    }
    seenPreviousPaths.add(normalized);
  }
  requireString(value.revisionId, `${name}.revisionId`);
  const lineCount = requireNonNegativeSafeInteger(value.lineCount, `${name}.lineCount`);
  validateIntervals(value.modifiedReviewed, `${name}.modifiedReviewed`, lineCount);
  const originalReviewedByDiff = requireRecord(
    value.originalReviewedByDiff,
    `${name}.originalReviewedByDiff`
  );
  for (const [diffId, intervals] of Object.entries(originalReviewedByDiff)) {
    requireString(diffId, `${name}.originalReviewedByDiff key`);
    validateIntervals(intervals, `${name}.originalReviewedByDiff.${diffId}`);
  }
  if (value.contentHash !== undefined) {
    requireString(value.contentHash, `${name}.contentHash`);
  }
  requireIsoTimestamp(value.updatedAt, `${name}.updatedAt`);
};

const requireCanonicalReviewPath = (value: unknown, name: string): string => {
  const candidate = requireString(value, name);
  if (
    candidate.includes("\\") ||
    path.posix.isAbsolute(candidate) ||
    path.posix.normalize(candidate) !== candidate ||
    candidate === "." ||
    candidate.split("/").includes("..")
  ) {
    throw new TypeError(`${name} must be a canonical repository-relative POSIX path`);
  }
  return candidate;
};

const validateContextDescriptor = (value: JsonRecord, name: string): void => {
  const kind = requireString(value.kind, `${name}.kind`);
  if (kind === "pull-request") {
    const descriptor = requireRecord(value.pullRequest, `${name}.pullRequest`);
    requireString(descriptor.host, `${name}.pullRequest.host`);
    requireString(descriptor.owner, `${name}.pullRequest.owner`);
    requireNonNegativeSafeInteger(descriptor.number, `${name}.pullRequest.number`);
    if (descriptor.state !== "open" && descriptor.state !== "closed" && descriptor.state !== "merged") {
      throw new TypeError(`${name}.pullRequest.state is invalid`);
    }
    requireString(descriptor.baseSha, `${name}.pullRequest.baseSha`);
    requireString(descriptor.headSha, `${name}.pullRequest.headSha`);
    return;
  }
  if (kind === "branch") {
    const descriptor = requireRecord(value.branch, `${name}.branch`);
    requireString(descriptor.refName, `${name}.branch.refName`);
    if (descriptor.baseRevision !== undefined) {
      requireString(descriptor.baseRevision, `${name}.branch.baseRevision`);
    }
    requireString(descriptor.headRevision, `${name}.branch.headRevision`);
    return;
  }
  if (kind === "workspace") {
    const descriptor = requireRecord(value.workspace, `${name}.workspace`);
    requireString(descriptor.workspaceId, `${name}.workspace.workspaceId`);
    requireString(descriptor.snapshotRevision, `${name}.workspace.snapshotRevision`);
    return;
  }
  if (kind === "external-file") {
    const descriptor = requireRecord(value.externalFile, `${name}.externalFile`);
    requireString(descriptor.canonicalUri, `${name}.externalFile.canonicalUri`);
    requireString(descriptor.snapshotRevision, `${name}.externalFile.snapshotRevision`);
    return;
  }
  throw new TypeError(`${name}.kind is unsupported`);
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
  requireString(value.displayName, "contextState.displayName");
  validateContextDescriptor(value, "contextState");
  validateOwnerReconciliation(value);
  const files = requireRecord(value.files, "contextState.files");
  const currentPaths = new Set<string>();
  for (const [fileId, fileValue] of Object.entries(files)) {
    const file = requireRecord(fileValue, `contextState.files.${fileId}`);
    validateFileDocument(
      file,
      fileId,
      `contextState.files.${fileId}`
    );
    const currentPath = requireString(file.currentPath, `contextState.files.${fileId}.currentPath`);
    if (currentPaths.has(currentPath)) {
      throw new Error("contextState.files must not contain duplicate currentPath values");
    }
    currentPaths.add(currentPath);
  }
  requireIsoTimestamp(value.createdAt, "contextState.createdAt");
  requireIsoTimestamp(value.updatedAt, "contextState.updatedAt");
};

const validateGlobalDocument = (value: JsonRecord, repositoryId: string): void => {
  requireCurrentSchema(value.schemaVersion, "Global state");
  if (requireString(value.repositoryId, "globalState.repositoryId") !== repositoryId) {
    throw new Error("Global state repositoryId does not match its storage owner.");
  }
  requireString(value.currentRevisionId, "globalState.currentRevisionId");
  const files = requireRecord(value.files, "globalState.files");
  const currentPaths = new Set<string>();
  for (const [fileId, fileValue] of Object.entries(files)) {
    const file = requireRecord(fileValue, `globalState.files.${fileId}`);
    if (requireString(file.fileId, `globalState.files.${fileId}.fileId`) !== fileId) {
      throw new Error(`globalState.files.${fileId}.fileId does not match its map key`);
    }
    const currentPath = requireCanonicalReviewPath(
      file.currentPath,
      `globalState.files.${fileId}.currentPath`
    );
    if (currentPaths.has(currentPath)) {
      throw new Error("globalState.files must not contain duplicate currentPath values");
    }
    currentPaths.add(currentPath);
    requireString(file.revisionId, `globalState.files.${fileId}.revisionId`);
    validateIntervals(file.reviewed, `globalState.files.${fileId}.reviewed`);
    if (file.contentHash !== undefined) {
      requireString(file.contentHash, `globalState.files.${fileId}.contentHash`);
    }
    requireIsoTimestamp(file.updatedAt, `globalState.files.${fileId}.updatedAt`);
  }
  requireIsoTimestamp(value.updatedAt, "globalState.updatedAt");
};

const validateWorkspaceDocument = (
  value: JsonRecord,
  target: ReviewStateRepositoryTarget
): void => {
  requireCurrentSchema(value.schemaVersion, "Workspace review state");
  const context = requireRecord(value.contextState, "Workspace context state");
  const global = requireRecord(value.globalState, "Workspace Global state");
  validateContextDocument(context, target.repositoryId, target.contextId);
  if (context.kind !== "workspace") {
    throw new Error("Workspace persistence requires a workspace review context.");
  }
  validateGlobalDocument(global, target.repositoryId);
};

interface ManifestReference {
  readonly contextId: string;
  readonly file: string;
  readonly updatedAt: string;
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
  const contextsValue = requireArray(value.contexts, "manifest.contexts");
  const contexts = contextsValue.map((entry, index) => {
    const reference = requireRecord(entry, `manifest.contexts[${index}]`);
    requireCurrentSchema(reference.schemaVersion, `manifest.contexts[${index}]`);
    return {
      contextId: requireString(reference.contextId, `manifest.contexts[${index}].contextId`),
      file: requireString(reference.file, `manifest.contexts[${index}].file`),
      updatedAt: requireIsoTimestamp(reference.updatedAt, `manifest.contexts[${index}].updatedAt`)
    };
  });
  if (new Set(contexts.map((reference) => reference.contextId)).size !== contexts.length) {
    throw new Error("Repository manifest contains duplicate context IDs.");
  }
  const globalReference = requireRecord(value.globalState, "manifest.globalState");
  requireCurrentSchema(globalReference.schemaVersion, "manifest.globalState");
  requireIsoTimestamp(globalReference.updatedAt, "manifest.globalState.updatedAt");
  requireIsoTimestamp(value.updatedAt, "manifest.updatedAt");
  return {
    contexts,
    globalFile: requireString(globalReference.file, "manifest.globalState.file")
  };
};

const hashIdentifier = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const resolveReferencedFile = (
  route: ReviewStateStorageRoute,
  relativeFile: string,
  expectedDirectory: "contexts" | "global-state",
  contextId?: string
): string => {
  if (relativeFile.includes("\\") || path.posix.isAbsolute(relativeFile)) {
    throw new Error("Persisted reference must use a canonical relative POSIX path.");
  }
  if (path.posix.normalize(relativeFile) !== relativeFile || relativeFile.split("/").includes("..")) {
    throw new Error("Persisted reference contains non-canonical path segments.");
  }
  const expectedPattern = expectedDirectory === "contexts"
    ? new RegExp(`^contexts/${hashIdentifier(requireString(contextId, "manifest contextId"))}/[0-9a-f]{64}\\.json$`, "u")
    : /^global-state\/[0-9a-f]{64}\.json$/u;
  if (!expectedPattern.test(relativeFile)) {
    throw new Error(`Persisted reference must stay inside its canonical ${expectedDirectory} location.`);
  }
  const root = path.resolve(route.rootPath);
  const resolved = path.resolve(root, relativeFile);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Persisted reference escapes its storage root.");
  }
  return resolved;
};

export const preMigrationBackupPath = (filePath: string): string =>
  `${filePath}.pre-migration.bak`;

const isWithin = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const existingPathIsLink = async (candidate: string): Promise<boolean> => {
  try {
    return (await lstat(candidate)).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

/** Rejects a path that leaves, or traverses links below, the configured storage route. */
export const createTrustedPersistencePathGuard = (
  rootPath: string,
  store: AtomicTextFileStore
): PersistencePathGuard => {
  if (!(store instanceof NodeAtomicTextFileStore)) {
    return async () => undefined;
  }
  const root = path.resolve(rootPath);
  return async (filePath: string): Promise<void> => {
    const candidate = path.resolve(filePath);
    if (!isWithin(root, candidate)) {
      throw new Error("Persistence path escapes its configured storage root.");
    }
    const relative = path.relative(root, candidate);
    let current = root;
    if (await existingPathIsLink(current)) {
      throw new Error("Persistence storage root must not be a symbolic link or junction.");
    }
    for (const segment of relative.split(path.sep).filter((value) => value.length > 0)) {
      current = path.join(current, segment);
      if (await existingPathIsLink(current)) {
        throw new Error("Persistence storage must not traverse a symbolic link or junction.");
      }
    }
  };
};

export const createTrustedStoragePathGuard = (
  route: ReviewStateStorageRoute,
  store: AtomicTextFileStore
): PersistencePathGuard => createTrustedPersistencePathGuard(route.rootPath, store);

const quarantinePath = (filePath: string, raw: string): string => {
  const digest = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
  return `${filePath}.corrupt-${digest}.quarantine`;
};

/** Preserves corrupt bytes before removing the active file from normal reads. */
export const quarantinePersistedText = async (
  store: AtomicTextFileStore,
  filePath: string,
  raw: string,
  removeOriginal = true,
  guard?: PersistencePathGuard
): Promise<string> => {
  const destination = quarantinePath(filePath, raw);
  await guard?.(destination);
  await store.writeTextAtomically(destination, raw);
  if (removeOriginal) {
    if (store.deleteText === undefined) {
      throw new Error("AtomicTextFileStore.deleteText is required to quarantine active persistence.");
    }
    await guard?.(filePath);
    await store.deleteText(filePath);
  }
  return destination;
};

/** Writes every migration backup before any migrated document and rolls all documents back on publish failure. */
export const publishSchemaMigration = async (
  store: AtomicTextFileStore,
  writes: readonly MigrationWrite[],
  guard?: PersistencePathGuard
): Promise<void> => {
  if (writes.length === 0) {
    return;
  }
  for (const write of writes) {
    await guard?.(preMigrationBackupPath(write.filePath));
    await store.writeTextAtomically(preMigrationBackupPath(write.filePath), write.original);
  }
  try {
    for (const write of writes) {
      await guard?.(write.filePath);
      await store.writeTextAtomically(write.filePath, write.migrated);
    }
  } catch (error) {
    const restorationErrors: unknown[] = [];
    for (const write of [...writes].reverse()) {
      try {
        await guard?.(write.filePath);
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
  documentName: "Workspace review state" | "Repository manifest" | "Global state" | "Context state",
  absentNestedVersion?: number,
  guard?: PersistencePathGuard
): Promise<MigratedDocument | undefined> => {
  try {
    return parseAndMigrate(raw, documentName, absentNestedVersion);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, filePath, raw, true, guard);
    return undefined;
  }
};

const quarantineManifest = async (
  store: AtomicTextFileStore,
  route: ReviewStateStorageRoute,
  raw: string,
  guard?: PersistencePathGuard
): Promise<PersistedReviewStatePreparation> => {
  await quarantinePersistedText(store, route.statePointerPath, raw, true, guard);
  return "uncertain";
};

const hasMatchingIdentity = (
  value: JsonRecord,
  repositoryId: string,
  contextId?: string
): boolean =>
  typeof value.repositoryId === "string" &&
  value.repositoryId.trim().length > 0 &&
  value.repositoryId === repositoryId &&
  (contextId === undefined || (
    typeof value.contextId === "string" &&
    value.contextId.trim().length > 0 &&
    value.contextId === contextId
  ));

/**
 * Prepares current state before any public repository load/CAS operation.
 * Repository-style storage validates and migrates every manifest-referenced document
 * before publishing a migrated manifest. Corrupt evidence returns `uncertain` so no
 * reviewed ranges are exposed from it.
 */
export const preparePersistedReviewState = async (
  options: FileSystemReviewStateRepositoryOptions,
  target: ReviewStateRepositoryTarget
): Promise<PersistedReviewStatePreparation> => {
  const route = resolveReviewStateStorageRoute(options.storageUris, target);
  const store = options.atomicFileStore ?? new NodeAtomicTextFileStore();
  const guard = createTrustedStoragePathGuard(route, store);
  await guard(route.statePointerPath);
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
      undefined,
      guard
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
      await quarantinePersistedText(store, route.statePointerPath, pointerRaw, true, guard);
      return "uncertain";
    }
    if (decoded.migrated) {
      await publishSchemaMigration(store, [{
        filePath: route.statePointerPath,
        original: pointerRaw,
        migrated: decoded.serialized
      }], guard);
    }
    return "ready";
  }

  const manifest = await decodeOrQuarantine(
    store,
    route.statePointerPath,
    pointerRaw,
    "Repository manifest",
    undefined,
    guard
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
    return quarantineManifest(store, route, pointerRaw, guard);
  }

  let globalPath: string;
  const contextPaths = new Map<string, string>();
  try {
    globalPath = resolveReferencedFile(route, references.globalFile, "global-state");
    for (const reference of references.contexts) {
      contextPaths.set(
        reference.contextId,
        resolveReferencedFile(route, reference.file, "contexts", reference.contextId)
      );
    }
  } catch {
    return quarantineManifest(store, route, pointerRaw, guard);
  }

  await guard(globalPath);
  const globalRaw = await store.readText(globalPath);
  if (globalRaw === undefined) {
    return "uncertain";
  }
  const global = await decodeOrQuarantine(store, globalPath, globalRaw, "Global state", undefined, guard);
  if (global === undefined) {
    return "uncertain";
  }
  if (!hasMatchingIdentity(global.value, target.repositoryId)) {
    return quarantineManifest(store, route, pointerRaw, guard);
  }
  try {
    validateGlobalDocument(global.value, target.repositoryId);
  } catch (error) {
    if (error instanceof UnsupportedPersistedSchemaVersionError) {
      throw error;
    }
    await quarantinePersistedText(store, globalPath, globalRaw, true, guard);
    return "uncertain";
  }

  const writes: MigrationWrite[] = [];
  for (const reference of references.contexts) {
    const contextPath = contextPaths.get(reference.contextId)!;
    await guard(contextPath);
    const contextRaw = await store.readText(contextPath);
    if (contextRaw === undefined) {
      return "uncertain";
    }
    const context = await decodeOrQuarantine(
      store,
      contextPath,
      contextRaw,
      "Context state",
      manifest.sourceVersion === 0 ? 0 : undefined,
      guard
    );
    if (context === undefined) {
      return "uncertain";
    }
    if (!hasMatchingIdentity(context.value, target.repositoryId, reference.contextId)) {
      return quarantineManifest(store, route, pointerRaw, guard);
    }
    try {
      validateContextDocument(context.value, target.repositoryId, reference.contextId);
    } catch (error) {
      if (error instanceof UnsupportedPersistedSchemaVersionError) {
        throw error;
      }
      await quarantinePersistedText(store, contextPath, contextRaw, true, guard);
      return "uncertain";
    }
    if (context.migrated) {
      writes.push({
        filePath: contextPath,
        original: contextRaw,
        migrated: context.serialized
      });
    }
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
  await publishSchemaMigration(store, writes, guard);
  return references.contexts.some((reference) => reference.contextId === target.contextId)
    ? "ready"
    : "absent";
};

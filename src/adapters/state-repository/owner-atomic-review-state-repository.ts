import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState,
  type SchemaVersion,
} from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  FileSystemReviewStateRepositoryOptions,
  PersistenceDeepReadonly,
  RepositoryStateManifest,
  RepositoryStateManifestContextReference,
  ReviewStateRepositoryTarget,
} from "./contracts";
import { validateOwnerReconciliation } from "./owner-reconciliation-validation";
import { preparePersistedReviewState } from "./persistence-schema-recovery";
import { resolveReviewStateStorageRoute } from "./storage-router";
import {
  FileSystemReviewStateRepository as ValidatedFileSystemReviewStateRepository,
  StaleReviewStateError,
} from "./validated-file-system-review-state-repository";
import {
  InProcessStorageRootLockCoordinator,
  withStorageRootLockCoordinator,
  type StorageRootLease,
} from "./storage-root-lock";

export interface ReviewStateRepositorySnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly repositoryId: string;
  readonly contextStates: readonly ReviewContextState[];
  readonly globalState: RepositoryGlobalState;
}

export interface ReviewStateRepositoryTransactionLike {
  readonly repositoryId: string;
  readonly expected: PersistenceDeepReadonly<ReviewStateRepositorySnapshot>;
  readonly next: PersistenceDeepReadonly<ReviewStateRepositorySnapshot>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const targetForOwner = (repositoryId: string): ReviewStateRepositoryTarget => ({
  kind: "git",
  repositoryId,
  contextId: "review-context-owner-snapshot",
});

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const resolveReferencedFile = (
  rootPath: string,
  relativeFile: string,
  directory: "contexts" | "global-state",
): string => {
  const normalized = relativeFile.replaceAll("\\", "/");
  if (path.isAbsolute(normalized) || !normalized.startsWith(`${directory}/`)) {
    throw new Error(`Manifest reference must remain inside ${directory}: ${relativeFile}`);
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Manifest reference escapes storage root: ${relativeFile}`);
  }
  return resolved;
};

const validateSnapshot = (
  value: Readonly<ReviewStateRepositorySnapshot>,
  repositoryId: string,
): ReviewStateRepositorySnapshot => {
  if (value.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new Error("Repository owner snapshot uses an unsupported schema version");
  }
  if (value.repositoryId !== repositoryId || value.globalState.repositoryId !== repositoryId) {
    throw new Error("Repository owner snapshot identity does not match repositoryId");
  }
  if (value.globalState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new Error("Repository owner Global state uses an unsupported schema version");
  }
  const contexts = value.contextStates.map((context) => {
    if (context.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
      throw new Error("Repository owner Context uses an unsupported schema version");
    }
    if (context.repositoryId !== repositoryId) {
      throw new Error("Repository owner Context does not match repositoryId");
    }
    if (context.kind !== "branch" && context.kind !== "pull-request") {
      throw new Error(`Repository owner transaction cannot publish ${context.kind} Context`);
    }
    validateOwnerReconciliation(context);
    return clone(context);
  }).sort((left, right) => left.contextId.localeCompare(right.contextId));
  if (new Set(contexts.map((context) => context.contextId)).size !== contexts.length) {
    throw new Error("Repository owner snapshot contains duplicate Context IDs");
  }
  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    contextStates: contexts,
    globalState: clone(value.globalState),
  };
};

const requireSameContextSet = (
  expected: Readonly<ReviewStateRepositorySnapshot>,
  next: Readonly<ReviewStateRepositorySnapshot>,
): void => {
  const expectedIds = expected.contextStates.map((context) => context.contextId).sort();
  const nextIds = next.contextStates.map((context) => context.contextId).sort();
  if (!isDeepStrictEqual(expectedIds, nextIds)) {
    throw new Error("Repository owner synchronization cannot add or remove Contexts");
  }
};

/**
 * Public repository wrapper adding one manifest-level CAS over all persisted
 * branch/PR Contexts and the single owner-wide Global state.
 */
export class FileSystemReviewStateRepository extends ValidatedFileSystemReviewStateRepository {
  private readonly ownerOptions: FileSystemReviewStateRepositoryOptions;
  private readonly ownerFileStore;

  public constructor(options: FileSystemReviewStateRepositoryOptions) {
    const normalized = options.atomicFileStore !== undefined &&
      !(options.atomicFileStore instanceof NodeAtomicTextFileStore) &&
      options.storageLockCoordinator === undefined
      ? { ...options, storageLockCoordinator: new InProcessStorageRootLockCoordinator() }
      : options;
    super(normalized);
    this.ownerOptions = normalized;
    this.ownerFileStore = normalized.atomicFileStore ?? new NodeAtomicTextFileStore();
  }

  public async loadRepositorySnapshot(repositoryId: string): Promise<ReviewStateRepositorySnapshot | undefined> {
    const target = targetForOwner(repositoryId);
    const route = resolveReviewStateStorageRoute(this.ownerOptions.storageUris, target);
    try {
      return await this.withOwnerLock(route.rootPath, async () => {
        const preparation = await preparePersistedReviewState(this.ownerOptions, target);
        if (preparation === "uncertain") return undefined;
        return this.readOwnerSnapshot(repositoryId, route.rootPath, route.statePointerPath);
      });
    } catch (error) {
      await this.notifyOwnerFailure("load", target, route, error);
      throw error;
    }
  }

  public async commitRepository(transaction: Readonly<ReviewStateRepositoryTransactionLike>): Promise<void> {
    const expected = validateSnapshot(transaction.expected as ReviewStateRepositorySnapshot, transaction.repositoryId);
    const next = validateSnapshot(transaction.next as ReviewStateRepositorySnapshot, transaction.repositoryId);
    requireSameContextSet(expected, next);
    const target = targetForOwner(transaction.repositoryId);
    const route = resolveReviewStateStorageRoute(this.ownerOptions.storageUris, target);
    try {
      await this.withOwnerLock(route.rootPath, async (lease) => {
        const preparation = await preparePersistedReviewState(this.ownerOptions, target);
        if (preparation === "uncertain") throw new StaleReviewStateError(target);
        const current = await this.readOwnerSnapshot(transaction.repositoryId, route.rootPath, route.statePointerPath);
        if (current === undefined || !isDeepStrictEqual(current, expected)) {
          throw new StaleReviewStateError(target);
        }
        await this.publishOwnerSnapshot(next, route.rootPath, route.statePointerPath, lease);
      });
    } catch (error) {
      await this.notifyOwnerFailure("commit", target, route, error);
      throw error;
    }
  }

  private async readOwnerSnapshot(
    repositoryId: string,
    rootPath: string,
    pointerPath: string,
  ): Promise<ReviewStateRepositorySnapshot | undefined> {
    const pointerText = await this.ownerFileStore.readText(pointerPath);
    if (pointerText === undefined) return undefined;
    const manifestValue = JSON.parse(pointerText) as unknown;
    if (!isRecord(manifestValue) || manifestValue.storageKind !== "repository") {
      throw new Error("Repository owner manifest is invalid");
    }
    if (manifestValue.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
      throw new Error("Repository owner manifest uses an unsupported schema version");
    }
    if (requireString(manifestValue.repositoryId, "manifest.repositoryId") !== repositoryId) {
      throw new Error("Repository owner manifest repositoryId does not match requested repositoryId");
    }
    if (!Array.isArray(manifestValue.contexts) || !isRecord(manifestValue.globalState)) {
      throw new Error("Repository owner manifest references are invalid");
    }
    const references = manifestValue.contexts.map((candidate) => {
      if (!isRecord(candidate) || candidate.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
        throw new Error("Repository owner manifest Context reference is invalid");
      }
      return {
        contextId: requireString(candidate.contextId, "manifest.contexts[].contextId"),
        file: requireString(candidate.file, "manifest.contexts[].file"),
      };
    });
    if (new Set(references.map((reference) => reference.contextId)).size !== references.length) {
      throw new Error("Repository owner manifest contains duplicate Context IDs");
    }
    if (manifestValue.globalState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION) {
      throw new Error("Repository owner manifest Global reference is invalid");
    }
    const globalPath = resolveReferencedFile(
      rootPath,
      requireString(manifestValue.globalState.file, "manifest.globalState.file"),
      "global-state",
    );
    const globalText = await this.ownerFileStore.readText(globalPath);
    if (globalText === undefined) throw new Error("Repository owner Global document is missing");
    const globalState = JSON.parse(globalText) as RepositoryGlobalState;
    const contextStates: ReviewContextState[] = [];
    for (const reference of references) {
      const contextPath = resolveReferencedFile(rootPath, reference.file, "contexts");
      const contextText = await this.ownerFileStore.readText(contextPath);
      if (contextText === undefined) throw new Error(`Repository owner Context document is missing: ${reference.contextId}`);
      const context = JSON.parse(contextText) as ReviewContextState;
      if (context.contextId !== reference.contextId) {
        throw new Error("Repository owner Context document does not match manifest reference");
      }
      contextStates.push(context);
    }
    return validateSnapshot({
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId,
      contextStates,
      globalState,
    }, repositoryId);
  }

  private async publishOwnerSnapshot(
    snapshot: ReviewStateRepositorySnapshot,
    rootPath: string,
    pointerPath: string,
    lease: StorageRootLease,
  ): Promise<void> {
    const entries = snapshot.contextStates.map((contextState) => ({
      contextState,
      text: serialize(contextState),
    }));
    const globalText = serialize(snapshot.globalState);
    const commitId = this.ownerOptions.createCommitId?.() ?? randomUUID();
    const commitToken = hash(`${commitId}\0${entries.map((entry) => entry.text).join("\0")}\0${globalText}`);
    const references: RepositoryStateManifestContextReference[] = [];
    for (const entry of entries) {
      const relativeFile = path.posix.join("contexts", hash(entry.contextState.contextId), `${commitToken}.json`);
      const filePath = resolveReferencedFile(rootPath, relativeFile, "contexts");
      await this.writeOwnerText(filePath, entry.text, lease);
      references.push({
        contextId: entry.contextState.contextId,
        file: relativeFile,
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        updatedAt: entry.contextState.updatedAt,
      });
    }
    const globalRelativeFile = path.posix.join("global-state", `${commitToken}.json`);
    await this.writeOwnerText(resolveReferencedFile(rootPath, globalRelativeFile, "global-state"), globalText, lease);
    const manifest: RepositoryStateManifest = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      storageKind: "repository",
      repositoryId: snapshot.repositoryId,
      contexts: references.sort((left, right) => left.contextId.localeCompare(right.contextId)),
      globalState: {
        file: globalRelativeFile,
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        updatedAt: snapshot.globalState.updatedAt,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.writeOwnerText(pointerPath, serialize(manifest), lease);
  }

  private async writeOwnerText(filePath: string, content: string, lease: StorageRootLease): Promise<void> {
    await this.ownerOptions.beforeAtomicPublication?.(filePath);
    await lease.assertOwned();
    await this.ownerFileStore.writeTextAtomically(filePath, content);
  }


  private async notifyOwnerFailure(
    operation: "load" | "commit",
    target: ReviewStateRepositoryTarget,
    route: ReturnType<typeof resolveReviewStateStorageRoute>,
    error: unknown,
  ): Promise<void> {
    await Promise.resolve(this.ownerOptions.notifyPersistenceFailure?.({
      operation,
      target: { ...target },
      route: { ...route },
      filePath: route.statePointerPath,
      error,
    })).catch(() => undefined);
  }

  private async withOwnerLock<T>(
    rootPath: string,
    operation: (lease: StorageRootLease) => Promise<T>,
  ): Promise<T> {
    return withStorageRootLockCoordinator(this.ownerOptions.storageLockCoordinator, {
      rootPath,
      timeoutMs: this.ownerOptions.storageLock?.timeoutMs,
      leaseMs: this.ownerOptions.storageLock?.leaseMs,
      retryDelayMs: this.ownerOptions.storageLock?.retryDelayMs,
      notifyDiagnostic: this.ownerOptions.notifyStorageLockDiagnostic,
    }, operation);
  }
}

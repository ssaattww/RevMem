import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type ReviewContextState
} from "../../core/contracts/index";
import { NodeAtomicTextFileStore } from "./atomic-text-file-store";
import type {
  FileSystemReviewStateRepositoryOptions,
  PersistenceFailureNotification,
  PersistenceOperation,
  RepositoryStateManifest,
  RepositoryStateManifestContextReference,
  RepositoryStateManifestGlobalReference,
  ReviewStateCommit,
  ReviewStateRepositoryTarget,
  ReviewStateStorageRoute
} from "./contracts";
import { resolveReviewStateStorageRoute } from "./storage-router";

class PersistencePathError extends Error {
  public constructor(
    public readonly filePath: string,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "PersistencePathError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value;
};

const requireCurrentSchemaVersion = (value: unknown, name: string): void => {
  if (value !== REVIEW_RANGE_SCHEMA_VERSION) {
    throw new Error(
      `${name} schema version ${String(value)} is not supported; expected ${REVIEW_RANGE_SCHEMA_VERSION}`
    );
  }
};

const hashIdentifier = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const serializeJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const cloneCommit = (commit: ReviewStateCommit): ReviewStateCommit =>
  JSON.parse(JSON.stringify(commit)) as ReviewStateCommit;

const asPersistencePathError = (
  filePath: string,
  error: unknown
): PersistencePathError =>
  error instanceof PersistencePathError
    ? error
    : new PersistencePathError(filePath, error);

const resolveManifestFile = (rootPath: string, relativeFile: string): string => {
  if (path.isAbsolute(relativeFile)) {
    throw new Error(`Manifest file must be relative: ${relativeFile}`);
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(resolvedRoot, relativeFile);
  if (
    resolvedFile === resolvedRoot ||
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Manifest file escapes storage root: ${relativeFile}`);
  }

  return resolvedFile;
};

const parseJson = (text: string, filePath: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw asPersistencePathError(filePath, error);
  }
};

const validateReviewStateCommit = (
  value: unknown,
  target: ReviewStateRepositoryTarget
): ReviewStateCommit => {
  if (!isRecord(value)) {
    throw new TypeError("Review state commit must be an object");
  }

  requireCurrentSchemaVersion(value.schemaVersion, "Review state commit");

  if (!isRecord(value.contextState)) {
    throw new TypeError("Review state commit contextState must be an object");
  }
  if (!isRecord(value.globalState)) {
    throw new TypeError("Review state commit globalState must be an object");
  }

  requireCurrentSchemaVersion(value.contextState.schemaVersion, "Context state");
  requireCurrentSchemaVersion(value.globalState.schemaVersion, "Global state");

  const contextRepositoryId = requireString(
    value.contextState.repositoryId,
    "contextState.repositoryId"
  );
  const globalRepositoryId = requireString(
    value.globalState.repositoryId,
    "globalState.repositoryId"
  );
  const contextId = requireString(value.contextState.contextId, "contextState.contextId");
  const contextKind = requireString(value.contextState.kind, "contextState.kind");

  if (contextRepositoryId !== target.repositoryId) {
    throw new Error(
      `contextState.repositoryId ${contextRepositoryId} does not match target repositoryId ${target.repositoryId}`
    );
  }
  if (globalRepositoryId !== target.repositoryId) {
    throw new Error(
      `globalState.repositoryId ${globalRepositoryId} does not match target repositoryId ${target.repositoryId}`
    );
  }
  if (contextId !== target.contextId) {
    throw new Error(
      `contextState.contextId ${contextId} does not match target contextId ${target.contextId}`
    );
  }
  if (target.kind === "workspace" && contextKind !== "workspace") {
    throw new Error("Workspace persistence requires a workspace review context");
  }
  if (target.kind !== "workspace" && contextKind === "workspace") {
    throw new Error("Git/PR persistence cannot store a workspace review context");
  }
  if (target.kind === "pull-request" && contextKind !== "pull-request") {
    throw new Error("Pull-request persistence requires a pull-request review context");
  }

  return value as unknown as ReviewStateCommit;
};

const validateManifestContextReference = (
  value: unknown
): RepositoryStateManifestContextReference => {
  if (!isRecord(value)) {
    throw new TypeError("Manifest context reference must be an object");
  }

  requireCurrentSchemaVersion(value.schemaVersion, "Manifest context reference");
  return {
    contextId: requireString(value.contextId, "manifest.contexts[].contextId"),
    file: requireString(value.file, "manifest.contexts[].file"),
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    updatedAt: requireString(value.updatedAt, "manifest.contexts[].updatedAt")
  };
};

const validateManifestGlobalReference = (
  value: unknown
): RepositoryStateManifestGlobalReference => {
  if (!isRecord(value)) {
    throw new TypeError("Manifest Global reference must be an object");
  }

  requireCurrentSchemaVersion(value.schemaVersion, "Manifest Global reference");
  return {
    file: requireString(value.file, "manifest.globalState.file"),
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    updatedAt: requireString(value.updatedAt, "manifest.globalState.updatedAt")
  };
};

const validateRepositoryManifest = (
  value: unknown,
  target: ReviewStateRepositoryTarget
): RepositoryStateManifest => {
  if (!isRecord(value)) {
    throw new TypeError("Repository manifest must be an object");
  }

  requireCurrentSchemaVersion(value.schemaVersion, "Repository manifest");
  if (value.storageKind !== "repository") {
    throw new Error("Repository manifest storageKind must be repository");
  }

  const repositoryId = requireString(value.repositoryId, "manifest.repositoryId");
  if (repositoryId !== target.repositoryId) {
    throw new Error(
      `Manifest repositoryId ${repositoryId} does not match target repositoryId ${target.repositoryId}`
    );
  }
  if (!Array.isArray(value.contexts)) {
    throw new TypeError("manifest.contexts must be an array");
  }

  const contexts = value.contexts.map(validateManifestContextReference);
  const uniqueContextIds = new Set(contexts.map((context) => context.contextId));
  if (uniqueContextIds.size !== contexts.length) {
    throw new Error("Repository manifest contains duplicate context IDs");
  }

  return {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    storageKind: "repository",
    repositoryId,
    contexts,
    globalState: validateManifestGlobalReference(value.globalState),
    updatedAt: requireString(value.updatedAt, "manifest.updatedAt")
  };
};

/** Filesystem-backed state repository with manifest-last transaction commits. */
export class FileSystemReviewStateRepository {
  private readonly fileStore;
  private readonly notifyPersistenceFailure;
  private readonly now;
  private readonly createCommitId;
  private readonly currentByTarget = new Map<string, ReviewStateCommit>();

  public constructor(
    private readonly options: FileSystemReviewStateRepositoryOptions
  ) {
    this.fileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore();
    this.notifyPersistenceFailure = options.notifyPersistenceFailure;
    this.now = options.now ?? (() => new Date());
    this.createCommitId = options.createCommitId ?? randomUUID;
  }

  public getCurrent(
    target: ReviewStateRepositoryTarget
  ): ReviewStateCommit | undefined {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);
    const current = this.currentByTarget.get(this.cacheKey(route, target));
    return current === undefined ? undefined : cloneCommit(current);
  }

  public async load(
    target: ReviewStateRepositoryTarget
  ): Promise<ReviewStateCommit | undefined> {
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    return this.executeWithNotification(
      "load",
      target,
      route,
      route.statePointerPath,
      async () => {
        const loaded =
          route.storageKind === "repository"
            ? await this.loadRepositoryCommit(target, route)
            : await this.loadWorkspaceCommit(target, route);
        const key = this.cacheKey(route, target);

        if (loaded === undefined) {
          this.currentByTarget.delete(key);
          return undefined;
        }

        const current = cloneCommit(loaded);
        this.currentByTarget.set(key, current);
        return cloneCommit(current);
      }
    );
  }

  public async save(
    target: ReviewStateRepositoryTarget,
    commit: ReviewStateCommit
  ): Promise<void> {
    const validatedCommit = cloneCommit(validateReviewStateCommit(commit, target));
    const route = resolveReviewStateStorageRoute(this.options.storageUris, target);

    await this.executeWithNotification(
      "save",
      target,
      route,
      route.statePointerPath,
      async () => {
        if (route.storageKind === "repository") {
          await this.saveRepositoryCommit(target, route, validatedCommit);
        } else {
          await this.writeText(
            route.statePointerPath,
            serializeJson(validatedCommit)
          );
        }

        this.currentByTarget.set(
          this.cacheKey(route, target),
          cloneCommit(validatedCommit)
        );
      }
    );
  }

  private async loadRepositoryCommit(
    target: ReviewStateRepositoryTarget,
    route: ReviewStateStorageRoute
  ): Promise<ReviewStateCommit | undefined> {
    const manifestText = await this.readText(route.statePointerPath);
    if (manifestText === undefined) {
      return undefined;
    }

    let manifest: RepositoryStateManifest;
    try {
      manifest = validateRepositoryManifest(
        parseJson(manifestText, route.statePointerPath),
        target
      );
    } catch (error) {
      throw asPersistencePathError(route.statePointerPath, error);
    }

    const contextReference = manifest.contexts.find(
      (context) => context.contextId === target.contextId
    );
    if (contextReference === undefined) {
      return undefined;
    }

    const contextPath = this.resolveReferencedFile(
      route,
      contextReference.file,
      "contexts"
    );
    const globalPath = this.resolveReferencedFile(
      route,
      manifest.globalState.file,
      "global-state"
    );
    const contextText = await this.readRequiredText(contextPath);
    const globalText = await this.readRequiredText(globalPath);
    const contextState = parseJson(contextText, contextPath) as ReviewContextState;
    const globalState = parseJson(globalText, globalPath) as RepositoryGlobalState;

    try {
      return validateReviewStateCommit(
        {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          contextState,
          globalState
        },
        target
      );
    } catch (error) {
      const failedPath =
        isRecord(contextState) &&
        contextState.schemaVersion !== REVIEW_RANGE_SCHEMA_VERSION
          ? contextPath
          : globalPath;
      throw asPersistencePathError(failedPath, error);
    }
  }

  private async loadWorkspaceCommit(
    target: ReviewStateRepositoryTarget,
    route: ReviewStateStorageRoute
  ): Promise<ReviewStateCommit | undefined> {
    const stateText = await this.readText(route.statePointerPath);
    if (stateText === undefined) {
      return undefined;
    }

    try {
      return validateReviewStateCommit(
        parseJson(stateText, route.statePointerPath),
        target
      );
    } catch (error) {
      throw asPersistencePathError(route.statePointerPath, error);
    }
  }

  private async saveRepositoryCommit(
    target: ReviewStateRepositoryTarget,
    route: ReviewStateStorageRoute,
    commit: ReviewStateCommit
  ): Promise<void> {
    const existingManifestText = await this.readText(route.statePointerPath);
    let existingManifest: RepositoryStateManifest | undefined;

    if (existingManifestText !== undefined) {
      try {
        existingManifest = validateRepositoryManifest(
          parseJson(existingManifestText, route.statePointerPath),
          target
        );
      } catch (error) {
        throw asPersistencePathError(route.statePointerPath, error);
      }
    }

    const contextText = serializeJson(commit.contextState);
    const globalText = serializeJson(commit.globalState);
    const commitToken = hashIdentifier(
      `${this.createCommitId()}\u0000${contextText}\u0000${globalText}`
    );
    const contextRelativePath = path.posix.join(
      "contexts",
      hashIdentifier(target.contextId),
      `${commitToken}.json`
    );
    const globalRelativePath = path.posix.join(
      "global-state",
      `${commitToken}.json`
    );
    const contextPath = resolveManifestFile(route.rootPath, contextRelativePath);
    const globalPath = resolveManifestFile(route.rootPath, globalRelativePath);

    await this.writeText(contextPath, contextText);
    await this.writeText(globalPath, globalText);

    const contextReference: RepositoryStateManifestContextReference = {
      contextId: target.contextId,
      file: contextRelativePath,
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      updatedAt: commit.contextState.updatedAt
    };
    const contexts = [
      ...(existingManifest?.contexts.filter(
        (context) => context.contextId !== target.contextId
      ) ?? []),
      contextReference
    ].sort((left, right) => left.contextId.localeCompare(right.contextId));
    const manifest: RepositoryStateManifest = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      storageKind: "repository",
      repositoryId: target.repositoryId,
      contexts,
      globalState: {
        file: globalRelativePath,
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        updatedAt: commit.globalState.updatedAt
      },
      updatedAt: this.now().toISOString()
    };

    await this.writeText(route.statePointerPath, serializeJson(manifest));
  }

  private resolveReferencedFile(
    route: ReviewStateStorageRoute,
    relativeFile: string,
    expectedDirectory: "contexts" | "global-state"
  ): string {
    const normalizedRelativeFile = relativeFile.replaceAll("\\", "/");
    if (!normalizedRelativeFile.startsWith(`${expectedDirectory}/`)) {
      throw asPersistencePathError(
        route.statePointerPath,
        new Error(
          `Manifest reference must be inside ${expectedDirectory}: ${relativeFile}`
        )
      );
    }

    try {
      return resolveManifestFile(route.rootPath, normalizedRelativeFile);
    } catch (error) {
      throw asPersistencePathError(route.statePointerPath, error);
    }
  }

  private async readText(filePath: string): Promise<string | undefined> {
    try {
      return await this.fileStore.readText(filePath);
    } catch (error) {
      throw asPersistencePathError(filePath, error);
    }
  }

  private async readRequiredText(filePath: string): Promise<string> {
    const content = await this.readText(filePath);
    if (content === undefined) {
      throw asPersistencePathError(
        filePath,
        new Error(`Persisted state file is missing: ${filePath}`)
      );
    }

    return content;
  }

  private async writeText(filePath: string, content: string): Promise<void> {
    try {
      await this.fileStore.writeTextAtomically(filePath, content);
    } catch (error) {
      throw asPersistencePathError(filePath, error);
    }
  }

  private cacheKey(
    route: ReviewStateStorageRoute,
    target: ReviewStateRepositoryTarget
  ): string {
    return `${route.rootPath}\u0000${target.contextId}`;
  }

  private async executeWithNotification<T>(
    operation: PersistenceOperation,
    target: ReviewStateRepositoryTarget,
    route: ReviewStateStorageRoute,
    fallbackPath: string,
    operationBody: () => Promise<T>
  ): Promise<T> {
    try {
      return await operationBody();
    } catch (error) {
      const filePath =
        error instanceof PersistencePathError ? error.filePath : fallbackPath;
      const notification: PersistenceFailureNotification = {
        operation,
        target: { ...target },
        route: { ...route },
        filePath,
        error
      };

      await Promise.resolve(this.notifyPersistenceFailure?.(notification)).catch(
        () => undefined
      );
      throw error;
    }
  }
}

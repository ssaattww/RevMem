import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  parseGitHubPullRequestCacheEntry,
  serializeGitHubPullRequestCacheIdentity,
  type GitHubPullRequestCacheEntry,
  type GitHubPullRequestCacheStorage
} from "../../application/github-pr-cache/index";
import type { PullRequestDiffAcquisitionRequest } from "../../application/github-pr-diff/index";
import {
  InProcessStorageRootLockCoordinator,
  NodeAtomicTextFileStore,
  type AtomicTextFileStore,
  withStorageRootLockCoordinator
} from "../state-repository/index";
import { createTrustedPersistencePathGuard } from "../state-repository/persistence-schema-recovery";

/** Constructor options for repository-local GitHub metadata and diff cache persistence. */
export interface NodeGitHubPullRequestCacheStorageOptions {
  /** Repository route's cache directory. */
  readonly cacheDirectory: string;
  /** Optional atomic store used by tests and alternate Extension Host filesystems. */
  readonly atomicFileStore?: AtomicTextFileStore;
  /** Coordinator shared with an alternate AtomicTextFileStore namespace. */
  readonly storageLockCoordinator?: import("../state-repository/index").StorageRootLockCoordinator;
  /** Optional immutable generation identifier source. */
  readonly createGenerationId?: () => string;
  /** Privacy-safe observation of storage lock timeout, failure, or stale recovery. */
  readonly notifyStorageLockDiagnostic?: (diagnostic: import("../state-repository/index").StorageRootLockDiagnostic) => void | Promise<void>;
}

interface PersistedGitHubCachePointer {
  readonly schemaVersion: 1;
  readonly identityKey: string;
  readonly generation: string;
  readonly metadataFile: string;
  readonly diffFile: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

interface PersistedGitHubMetadataDocument {
  readonly schemaVersion: 1;
  readonly identityKey: string;
  readonly generation: string;
  readonly request: GitHubPullRequestCacheEntry["request"];
  readonly metadata: GitHubPullRequestCacheEntry["metadata"];
  readonly updatedAt: string;
  readonly expiresAt: string;
}

interface PersistedGitHubDiffDocument {
  readonly schemaVersion: 1;
  readonly identityKey: string;
  readonly generation: string;
  readonly request: GitHubPullRequestCacheEntry["request"];
  readonly snapshot: GitHubPullRequestCacheEntry["snapshot"];
  readonly updatedAt: string;
  readonly expiresAt: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireNonEmptyPath = (value: string): string => {
  if (value.trim().length === 0) throw new TypeError("cacheDirectory must not be empty");
  return path.resolve(value);
};

const requireGeneration = (value: string): string => {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ||
    value === "." ||
    value === ".."
  ) throw new TypeError("generation must be a safe cache filename component");
  return value;
};

const identityKey = (request: PullRequestDiffAcquisitionRequest): string =>
  createHash("sha256")
    .update(serializeGitHubPullRequestCacheIdentity(request), "utf8")
    .digest("hex");

const relativeMetadataFile = (key: string, generation: string): string =>
  `github/${key}/metadata-${generation}.json`;

const relativeDiffFile = (key: string, generation: string): string =>
  `diffs/${key}/diff-${generation}.json`;

const relativePointerFile = (key: string): string => `github/${key}/latest.json`;

const absoluteCacheFile = (root: string, relativeFile: string): string =>
  path.join(root, ...relativeFile.split("/"));

const parseJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const parsePointer = (
  value: unknown,
  key: string
): PersistedGitHubCachePointer | undefined => {
  if (!isObject(value) || value.schemaVersion !== 1 || value.identityKey !== key) return undefined;
  if (
    typeof value.generation !== "string" ||
    typeof value.metadataFile !== "string" ||
    typeof value.diffFile !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.expiresAt !== "string"
  ) return undefined;
  let generation: string;
  try {
    generation = requireGeneration(value.generation);
  } catch {
    return undefined;
  }
  if (
    value.metadataFile !== relativeMetadataFile(key, generation) ||
    value.diffFile !== relativeDiffFile(key, generation)
  ) return undefined;
  return {
    schemaVersion: 1,
    identityKey: key,
    generation,
    metadataFile: value.metadataFile,
    diffFile: value.diffFile,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt
  };
};

const documentIdentityMatches = (
  value: Record<string, unknown>,
  request: PullRequestDiffAcquisitionRequest,
  key: string,
  generation: string,
  updatedAt: string,
  expiresAt: string
): boolean => {
  if (
    value.schemaVersion !== 1 ||
    value.identityKey !== key ||
    value.generation !== generation ||
    value.updatedAt !== updatedAt ||
    value.expiresAt !== expiresAt
  ) return false;
  try {
    return serializeGitHubPullRequestCacheIdentity(
      value.request as PullRequestDiffAcquisitionRequest
    ) === serializeGitHubPullRequestCacheIdentity(request);
  } catch {
    return false;
  }
};

/**
 * Filesystem cache with immutable metadata/diff generations and one atomic latest pointer.
 * The application contract rejects every diff line whose text is not redacted.
 */
export class NodeGitHubPullRequestCacheStorage implements GitHubPullRequestCacheStorage {
  private readonly cacheDirectory: string;
  private readonly atomicFileStore: AtomicTextFileStore;
  private readonly createGenerationId: () => string;
  private readonly notifyStorageLockDiagnostic: NodeGitHubPullRequestCacheStorageOptions["notifyStorageLockDiagnostic"];
  private readonly storageLockCoordinator: NodeGitHubPullRequestCacheStorageOptions["storageLockCoordinator"];

  public constructor(options: NodeGitHubPullRequestCacheStorageOptions) {
    this.cacheDirectory = requireNonEmptyPath(options.cacheDirectory);
    this.atomicFileStore = options.atomicFileStore ?? new NodeAtomicTextFileStore(path.dirname(this.cacheDirectory));
    this.createGenerationId = options.createGenerationId ?? randomUUID;
    this.notifyStorageLockDiagnostic = options.notifyStorageLockDiagnostic;
    this.storageLockCoordinator = options.storageLockCoordinator ?? (
      options.atomicFileStore !== undefined && !(options.atomicFileStore instanceof NodeAtomicTextFileStore)
        ? new InProcessStorageRootLockCoordinator()
        : undefined
    );
  }

  public async read(
    request: PullRequestDiffAcquisitionRequest,
    _feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestCacheEntry | undefined> {
    if (signal?.aborted) throw new DOMException("PR cache read was superseded.", "AbortError");
    const key = identityKey(request);
    const pointer = parsePointer(
      parseJson(await this.atomicFileStore.readText(
        absoluteCacheFile(this.cacheDirectory, relativePointerFile(key))
      )),
      key
    );
    if (pointer === undefined) return undefined;

    const [metadataValue, diffValue] = await Promise.all([
      this.atomicFileStore.readText(
        absoluteCacheFile(this.cacheDirectory, pointer.metadataFile)
      ),
      this.atomicFileStore.readText(
        absoluteCacheFile(this.cacheDirectory, pointer.diffFile)
      )
    ]);
    const metadataDocument = parseJson(metadataValue);
    const diffDocument = parseJson(diffValue);
    if (!isObject(metadataDocument) || !isObject(diffDocument)) return undefined;
    if (
      !documentIdentityMatches(
        metadataDocument,
        request,
        key,
        pointer.generation,
        pointer.updatedAt,
        pointer.expiresAt
      ) ||
      !documentIdentityMatches(
        diffDocument,
        request,
        key,
        pointer.generation,
        pointer.updatedAt,
        pointer.expiresAt
      )
    ) return undefined;

    return parseGitHubPullRequestCacheEntry({
      schemaVersion: 1,
      request: metadataDocument.request,
      metadata: metadataDocument.metadata,
      snapshot: diffDocument.snapshot,
      updatedAt: pointer.updatedAt,
      expiresAt: pointer.expiresAt
    }, request);
  }

  public async write(
    entry: GitHubPullRequestCacheEntry,
    _feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new DOMException("PR cache write was superseded.", "AbortError");
    const validated = parseGitHubPullRequestCacheEntry(entry, entry.request);
    if (validated === undefined) {
      throw new TypeError("GitHub cache persistence requires an exact source-redacted entry");
    }
    const key = identityKey(validated.request);
    const generation = requireGeneration(this.createGenerationId());
    const metadataFile = relativeMetadataFile(key, generation);
    const diffFile = relativeDiffFile(key, generation);
    const pointerFile = relativePointerFile(key);
    const metadataDocument: PersistedGitHubMetadataDocument = {
      schemaVersion: 1,
      identityKey: key,
      generation,
      request: validated.request,
      metadata: validated.metadata,
      updatedAt: validated.updatedAt,
      expiresAt: validated.expiresAt
    };
    const diffDocument: PersistedGitHubDiffDocument = {
      schemaVersion: 1,
      identityKey: key,
      generation,
      request: validated.request,
      snapshot: validated.snapshot,
      updatedAt: validated.updatedAt,
      expiresAt: validated.expiresAt
    };
    const pointer: PersistedGitHubCachePointer = {
      schemaVersion: 1,
      identityKey: key,
      generation,
      metadataFile,
      diffFile,
      updatedAt: validated.updatedAt,
      expiresAt: validated.expiresAt
    };

    await withStorageRootLockCoordinator(this.storageLockCoordinator, { rootPath: path.dirname(this.cacheDirectory), notifyDiagnostic: this.notifyStorageLockDiagnostic }, async (lease) => {
      const guard = createTrustedPersistencePathGuard(path.dirname(this.cacheDirectory), this.atomicFileStore);
      await guard(this.cacheDirectory);
      await guard(absoluteCacheFile(this.cacheDirectory, metadataFile));
      await guard(absoluteCacheFile(this.cacheDirectory, diffFile));
      await guard(absoluteCacheFile(this.cacheDirectory, pointerFile));
      await lease.assertOwned();
      await this.atomicFileStore.writeTextAtomically(
        absoluteCacheFile(this.cacheDirectory, metadataFile),
        JSON.stringify(metadataDocument)
      );
      await lease.assertOwned();
      await this.atomicFileStore.writeTextAtomically(
        absoluteCacheFile(this.cacheDirectory, diffFile),
        JSON.stringify(diffDocument)
      );
      await lease.assertOwned();
      await this.atomicFileStore.writeTextAtomically(
        absoluteCacheFile(this.cacheDirectory, pointerFile),
        JSON.stringify(pointer)
      );
      await this.removeSupersededGenerations(key, generation, guard, lease);
    });
  }

  /** Retains the published immutable pair and removes only older generations for the same exact cache identity. */
  private async removeSupersededGenerations(
    key: string,
    publishedGeneration: string,
    guard: (filePath: string) => Promise<void>,
    lease: import("../state-repository/index").StorageRootLease
  ): Promise<void> {
    if (this.atomicFileStore.deleteText === undefined) return;
    for (const [directory, prefix] of [[path.join(this.cacheDirectory, "github", key), "metadata-"], [path.join(this.cacheDirectory, "diffs", key), "diff-"]] as const) {
      const names = await readdir(directory).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      for (const name of names) {
        if (name.startsWith(prefix) && name !== `${prefix}${publishedGeneration}.json` && /^[-A-Za-z0-9._]+\.json$/u.test(name)) {
          const filePath = path.join(directory, name);
          await guard(filePath);
          await lease.assertOwned();
          await this.atomicFileStore.deleteText(filePath);
        }
      }
    }
  }
}

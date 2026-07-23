import type {
  RepositoryGlobalState,
  ReviewContextState,
  SchemaVersion
} from "../../core/contracts/index";

/** Recursive readonly view used to accept Review State Service transactions structurally. */
export type PersistenceDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly PersistenceDeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: PersistenceDeepReadonly<T[Key]> }
      : T;

/** Minimal structural shape accepted from a VS Code Uri without importing vscode. */
export interface StorageUriLike {
  /** Filesystem path resolved by the workspace-side Extension Host. */
  readonly fsPath: string;
}

/** ExtensionContext storage locations used by the persistence adapter. */
export interface ReviewStateStorageUris {
  /** Shared extension storage used for Git repositories and pull requests. */
  readonly globalStorageUri: StorageUriLike;
  /** Workspace-local extension storage used when no Git repository exists. */
  readonly storageUri?: StorageUriLike;
}

/** Logical owner of one context/global state transaction. */
export type ReviewStateRepositoryTargetKind = "git" | "pull-request" | "workspace";

/** Identity needed to route and load one review context. */
export interface ReviewStateRepositoryTarget {
  readonly kind: ReviewStateRepositoryTargetKind;
  readonly repositoryId: string;
  readonly contextId: string;
}

/** Shared filesystem route reused by state, history, snapshot, cache, and lock stores. */
export interface ReviewStateStorageRoute {
  readonly storageKind: "repository" | "workspace";
  readonly rootPath: string;
  readonly statePointerPath: string;
  readonly historyDirectory: string;
  readonly snapshotDirectory: string;
  readonly cacheDirectory?: string;
  readonly lockPath: string;
}

/** Complete context/global state advanced by one successful persistence operation. */
export interface ReviewStateCommit {
  readonly schemaVersion: SchemaVersion;
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
}

/** Expected and next snapshots accepted from Review State Service without importing it. */
export interface ReviewStateTransactionSnapshotPair {
  readonly contextState: PersistenceDeepReadonly<ReviewContextState>;
  readonly globalState: PersistenceDeepReadonly<RepositoryGlobalState>;
}

/**
 * Structural subset of the T102 ReviewStateTransaction contract.
 *
 * The T102 transaction contains additional operation and file metadata. The
 * repository only needs repository/context identity and complete expected/next
 * snapshots, so a T102 transaction is assignable to this contract.
 */
export interface ReviewStateTransactionLike {
  readonly repositoryId: string;
  readonly contextId: string;
  readonly expected: ReviewStateTransactionSnapshotPair;
  readonly next: ReviewStateTransactionSnapshotPair;
}

/** Immutable context document selected by a repository manifest. */
export interface RepositoryStateManifestContextReference {
  readonly contextId: string;
  readonly file: string;
  readonly schemaVersion: SchemaVersion;
  readonly updatedAt: string;
}

/** Immutable Global document selected by a repository manifest. */
export interface RepositoryStateManifestGlobalReference {
  readonly file: string;
  readonly schemaVersion: SchemaVersion;
  readonly updatedAt: string;
}

/** Atomic commit pointer for all Git/PR context and Global state documents. */
export interface RepositoryStateManifest {
  readonly schemaVersion: SchemaVersion;
  readonly storageKind: "repository";
  readonly repositoryId: string;
  readonly contexts: RepositoryStateManifestContextReference[];
  readonly globalState: RepositoryStateManifestGlobalReference;
  readonly updatedAt: string;
}

/** Low-level text persistence used to test and implement atomic file replacement. */
export interface AtomicTextFileStore {
  readText(filePath: string): Promise<string | undefined>;
  writeTextAtomically(filePath: string, content: string): Promise<void>;
}

/** Persistence phase surfaced to the UI/application notification adapter. */
export type PersistenceOperation = "load" | "save" | "commit";

/** Failure information without a direct dependency on VS Code notification APIs. */
export interface PersistenceFailureNotification {
  readonly operation: PersistenceOperation;
  readonly target: ReviewStateRepositoryTarget;
  readonly route: ReviewStateStorageRoute;
  readonly filePath: string;
  readonly error: unknown;
}

/** Adapter callback that can display, log, or aggregate a persistence failure. */
export type PersistenceFailureNotifier = (
  failure: PersistenceFailureNotification
) => void | Promise<void>;

/** Constructor dependencies for the filesystem-backed state repository. */
export interface FileSystemReviewStateRepositoryOptions {
  readonly storageUris: ReviewStateStorageUris;
  readonly atomicFileStore?: AtomicTextFileStore;
  readonly notifyPersistenceFailure?: PersistenceFailureNotifier;
  readonly now?: () => Date;
  readonly createCommitId?: () => string;
}

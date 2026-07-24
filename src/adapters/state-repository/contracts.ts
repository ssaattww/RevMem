import type {
  RepositoryGlobalState,
  ReviewContextState,
  SchemaVersion
} from "../../core/contracts/index";

/**
 * Recursive readonly view used to accept Review State Service transactions structurally.
 *
 * It prevents this adapter contract from promising that caller-owned transaction snapshots are mutable.
 */
export type PersistenceDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly PersistenceDeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: PersistenceDeepReadonly<T[Key]> }
      : T;

/** Minimal structural shape accepted from a VS Code Uri without importing vscode. */
export interface StorageUriLike {
  /** Filesystem path resolved by the workspace-side Extension Host; it must be non-empty when selected for persistence. */
  readonly fsPath: string;
}

/** ExtensionContext storage locations used by the persistence adapter. */
export interface ReviewStateStorageUris {
  /** Shared extension storage used for Git repositories and pull requests; its path is required for those targets. */
  readonly globalStorageUri: StorageUriLike;
  /** Workspace-local extension storage used when no Git repository exists; absence makes workspace routing fail before I/O. */
  readonly storageUri?: StorageUriLike;
}

/** Logical owner of one context/global state transaction. `git` maps to a branch context, while the other values map to identically named context kinds. */
export type ReviewStateRepositoryTargetKind = "git" | "pull-request" | "workspace";

/** Identity needed to route, validate, and load one review context. */
export interface ReviewStateRepositoryTarget {
  /** Storage and context-kind mapping: `git`/`branch`, `pull-request`/`pull-request`, or `workspace`/`workspace`. */
  readonly kind: ReviewStateRepositoryTargetKind;
  /** Stable repository identity used to select the repository storage root and validate both context and Global state. */
  readonly repositoryId: string;
  /** Stable identity of the context selected from the repository manifest or workspace document. */
  readonly contextId: string;
}

/** Shared filesystem route reused by state, history, snapshot, cache, and lock stores. */
export interface ReviewStateStorageRoute {
  /** Whether this route stores a repository manifest or the single workspace state document. */
  readonly storageKind: "repository" | "workspace";
  /** Absolute storage root; repository roots are derived from a SHA-256 repository ID hash. */
  readonly rootPath: string;
  /** Absolute path of the manifest pointer or workspace-state document used to make a state commit visible. */
  readonly statePointerPath: string;
  /** Absolute directory reserved for future history entries; this adapter does not create or read history entries. */
  readonly historyDirectory: string;
  /** Absolute directory reserved for future snapshots; this adapter does not create or read snapshot entries. */
  readonly snapshotDirectory: string;
  /** Absolute repository cache directory, omitted for a non-Git workspace route. */
  readonly cacheDirectory?: string;
  /** Absolute future lock location; T104 does not acquire a cross-window or cross-process lock. */
  readonly lockPath: string;
}

/** Complete context/global state advanced by one successful persistence operation. Callers retain ownership of inputs and returned values; the repository persists and exposes deep clones. */
export interface ReviewStateCommit {
  /** Schema version shared by the context and Global documents; unsupported versions are rejected before a write. */
  readonly schemaVersion: SchemaVersion;
  /** Complete state for the selected context, whose repository ID, context ID, and kind must match the target. */
  readonly contextState: ReviewContextState;
  /** Complete repository-wide Global state, whose repository ID must match the target. */
  readonly globalState: RepositoryGlobalState;
}

/** Expected and next snapshots accepted from Review State Service without importing it. */
export interface ReviewStateTransactionSnapshotPair {
  /** Immutable expected or next context snapshot used by the full-snapshot CAS comparison. */
  readonly contextState: PersistenceDeepReadonly<ReviewContextState>;
  /** Immutable expected or next Global snapshot used by the full-snapshot CAS comparison. */
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
  /** Repository identity that must equal the identities in both expected and next snapshots. */
  readonly repositoryId: string;
  /** Context identity that must equal the identities in both expected and next context snapshots. */
  readonly contextId: string;
  /** Complete snapshots that must equal current persisted state or the commit rejects as stale. */
  readonly expected: ReviewStateTransactionSnapshotPair;
  /** Complete snapshots written only after `expected` matches current state; context kind cannot change from `expected`. */
  readonly next: ReviewStateTransactionSnapshotPair;
}

/** Immutable context document selected by a repository manifest. */
export interface RepositoryStateManifestContextReference {
  /** Context identity used as the manifest lookup key; duplicate IDs make a manifest invalid. */
  readonly contextId: string;
  /** Relative path below the repository root, required to remain in its `contexts/` subtree. */
  readonly file: string;
  /** Schema version of the referenced immutable document. */
  readonly schemaVersion: SchemaVersion;
  /** Context document update timestamp copied from the committed context state. */
  readonly updatedAt: string;
}

/** Immutable Global document selected by a repository manifest. */
export interface RepositoryStateManifestGlobalReference {
  /** Relative path below the repository root, required to remain in its `global-state/` subtree. */
  readonly file: string;
  /** Schema version of the referenced immutable document. */
  readonly schemaVersion: SchemaVersion;
  /** Global document update timestamp copied from the committed Global state. */
  readonly updatedAt: string;
}

/** Atomic commit pointer for all Git/PR context and Global state documents. */
export interface RepositoryStateManifest {
  /** Schema version of the manifest and every reference it contains. */
  readonly schemaVersion: SchemaVersion;
  /** Constant discriminator that prevents interpreting a workspace document as a repository manifest. */
  readonly storageKind: "repository";
  /** Repository identity that must match the target before referenced documents are loaded. */
  readonly repositoryId: string;
  /** One reference per saved context; replacing the manifest atomically publishes all referenced state. */
  readonly contexts: RepositoryStateManifestContextReference[];
  /** Reference to the repository-wide Global state paired with the context references. */
  readonly globalState: RepositoryStateManifestGlobalReference;
  /** Timestamp at which this manifest pointer was written. */
  readonly updatedAt: string;
}

/** Low-level text persistence used to test and implement atomic file replacement. */
export interface AtomicTextFileStore {
  /**
   * Reads UTF-8 text from a path.
   *
   * @returns The file content, or `undefined` only when the path does not exist.
   * @throws Propagates filesystem failures other than a missing file.
   */
  readText(filePath: string): Promise<string | undefined>;
  /**
   * Replaces a path with complete UTF-8 content through the implementation's atomic-write boundary.
   *
   * @throws Rejects when directory creation, temporary writing, flushing, replacement, or cleanup cannot complete.
   */
  writeTextAtomically(filePath: string, content: string): Promise<void>;
}

/** Persistence phase surfaced to the UI/application notification adapter. */
export type PersistenceOperation = "load" | "save" | "commit";

/** Failure information without a direct dependency on VS Code notification APIs. */
export interface PersistenceFailureNotification {
  /** Persistence operation that failed. */
  readonly operation: PersistenceOperation;
  /** Copy of the target being processed; mutating it cannot change repository state. */
  readonly target: ReviewStateRepositoryTarget;
  /** Copy of the resolved route; it identifies the storage location without exposing mutable repository internals. */
  readonly route: ReviewStateStorageRoute;
  /** Most specific persisted path known for the failure, or the operation's state-pointer fallback. */
  readonly filePath: string;
  /** Original operation error; notifier failures never replace this error. */
  readonly error: unknown;
}

/** Adapter callback that can display, log, or aggregate a persistence failure. Its own failure is ignored so the persistence operation still rejects with the original error. */
export type PersistenceFailureNotifier = (
  failure: PersistenceFailureNotification
) => void | Promise<void>;

/** Constructor dependencies for the filesystem-backed state repository. */
export interface FileSystemReviewStateRepositoryOptions {
  /** VS Code-compatible storage locations used to resolve every target before I/O. */
  readonly storageUris: ReviewStateStorageUris;
  /** Optional persistence implementation; defaults to `NodeAtomicTextFileStore` when omitted. */
  readonly atomicFileStore?: AtomicTextFileStore;
  /** Optional failure observer invoked after a load, save, or commit failure without changing the original rejection. */
  readonly notifyPersistenceFailure?: PersistenceFailureNotifier;
  /** Optional clock used for manifest timestamps; defaults to the current wall-clock time. */
  readonly now?: () => Date;
  /** Optional commit-ID source used to make immutable document filenames unique; defaults to a random UUID. */
  readonly createCommitId?: () => string;
}

import type {
  RepositoryGlobalState,
  ReviewContextState
} from "../../core/contracts/index";
import type { GitDiffMappingOptions } from "../../core/git-diff/index";
import type {
  FileSystemPathSemantics,
  StableHash
} from "../workspace-identity/index";

/** Attached local branch identity returned by a Git inspection boundary. */
export interface GitReviewContextBranchRef {
  /** Snapshot discriminator. */
  readonly kind: "branch";
  /** Complete local branch ref, for example `refs/heads/main`. */
  readonly fullRef: string;
}

/** Detached HEAD classification returned by a Git inspection boundary. */
export interface GitReviewContextDetachedHead {
  /** Snapshot discriminator. */
  readonly kind: "detached";
}

/** Branch attachment state required by the context resolver and monitor. */
export type GitReviewContextBranchState =
  | GitReviewContextBranchRef
  | GitReviewContextDetachedHead;

/** Stable repository identity plus the moving branch/HEAD observation. */
export interface GitReviewContextRepositorySnapshot {
  /** Stable repository identity derived from remote or repository root. */
  readonly repositoryId: string;
  /** Absolute repository root used by local Git commands. */
  readonly rootPath: string;
  /** Attached full ref or detached state. */
  readonly branch: GitReviewContextBranchState;
  /** Current immutable commit object ID; absent only for an unborn branch. */
  readonly head?: string;
}

/** Logical Git context kind without changing the persisted branch-state schema. */
export type ResolvedGitReviewContextKind = "branch" | "detached-commit";

/** Resolved context identity and current revision used by document routing. */
export interface ResolvedGitReviewContext {
  /** Branch or detached-commit classification. */
  readonly kind: ResolvedGitReviewContextKind;
  /** Stable repository owner. */
  readonly repositoryId: string;
  /** Absolute root used for revision mapping. */
  readonly repositoryRoot: string;
  /** Stable context identity. Branch IDs exclude moving HEAD; detached IDs include the commit. */
  readonly contextId: string;
  /** Current immutable commit ID or deterministic unborn branch revision. */
  readonly revisionId: string;
  /** Complete initial/current persisted context descriptor. */
  readonly contextState: ReviewContextState;
}

/** Constructor dependencies for deterministic Git context resolution. */
export interface GitReviewContextResolverOptions {
  /** Domain-separated SHA-256 implementation used for context IDs. */
  readonly stableHash: StableHash;
  /** Optional clock for initial state timestamps. */
  readonly now?: () => Date;
}

/** Stable outcomes returned by immutable Git text lookup. */
export type GitRevisionMappingTextReadResult =
  | { readonly kind: "found"; readonly content: string }
  | { readonly kind: "missing-revision" }
  | { readonly kind: "missing-file" }
  | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" };

/** Local Git operations required by conservative context revision mapping. */
export interface GitRevisionMappingSource {
  /** Determines whether an old immutable object remains available. */
  objectExists(repositoryRoot: string, objectName: string): Promise<boolean>;
  /** Returns a complete repository diff between two immutable revisions. */
  diffRevisions(
    repositoryRoot: string,
    leftRevision: string,
    rightRevision: string
  ): Promise<string>;
  /** Reads one exact UTF-8 text path from an immutable revision. */
  readTextFileAtRevision(
    repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string,
    fileSystemPathSemantics: FileSystemPathSemantics
  ): Promise<GitRevisionMappingTextReadResult>;
}

/** Input for advancing one persisted Git context and owner-wide Global snapshot. */
export interface GitContextRevisionMappingInput {
  /** Current resolved branch or detached context. */
  readonly current: ResolvedGitReviewContext;
  /** Complete persisted context state selected by `current.contextId`. */
  readonly contextState: ReviewContextState;
  /** Complete owner-wide Global state paired with the context. */
  readonly globalState: RepositoryGlobalState;
  /** Repository path rules used for immutable file reads. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Conservative whitespace/EOL equivalence policy. */
  readonly options: Readonly<GitDiffMappingOptions>;
}

/** Complete next snapshots after revision mapping. */
export interface GitContextRevisionMappingResult {
  /** Context state advanced to the current resolved revision. */
  readonly contextState: ReviewContextState;
  /** Global state advanced to the current resolved revision. */
  readonly globalState: RepositoryGlobalState;
}

/** Constructor dependencies for the revision mapper. */
export interface GitContextRevisionMapperOptions {
  /** Immutable content and complete diff source. */
  readonly source: GitRevisionMappingSource;
  /** Stable hash used for new file IDs and content identities. */
  readonly stableHash: StableHash;
  /** Optional clock for mapped state timestamps. */
  readonly now?: () => Date;
}

/** Repository inspection outcomes accepted by the state monitor. */
export type GitStateInspectionResult =
  | {
      readonly kind: "repository";
      readonly repository: GitReviewContextRepositorySnapshot;
    }
  | { readonly kind: "not-repository"; readonly gitVersion?: string }
  | { readonly kind: "git-unavailable"; readonly executable?: string };

/** Inspection port used by polling without depending on a concrete Git adapter. */
export interface GitStateInspectionPort {
  /** Inspects a repository root or descendant. */
  inspectRepository(startPath: string): Promise<GitStateInspectionResult>;
}

/** Disposable repeating timer returned by an injected scheduler. */
export interface GitStateMonitorSchedule {
  /** Stops future timer callbacks. */
  dispose(): void;
}

/** Scheduler boundary used to test monitor polling deterministically. */
export interface GitStateMonitorScheduler {
  /** Schedules a callback repeatedly; implementations may ignore the interval argument only in tests. */
  scheduleRepeating(
    callback: () => void,
    intervalMs: number
  ): GitStateMonitorSchedule;
}

/** One observed repository state transition. */
export interface GitStateChange {
  /** Inspected root used as the observation key. */
  readonly rootPath: string;
  /** Previous repository snapshot, absent when ownership disappeared and later returned. */
  readonly previous?: GitReviewContextRepositorySnapshot;
  /** Current repository snapshot, absent when Git ownership disappeared. */
  readonly current?: GitReviewContextRepositorySnapshot;
}

/** Constructor dependencies for polling Git state. */
export interface PollingGitStateMonitorOptions {
  /** Local Git inspection boundary. */
  readonly inspector: GitStateInspectionPort;
  /** Observer called once per distinct repository state transition. */
  readonly onDidChange: (change: GitStateChange) => void | Promise<void>;
  /** Poll interval in milliseconds. */
  readonly intervalMs?: number;
  /** Optional timer scheduler; the default uses an unreferenced JavaScript interval when supported. */
  readonly scheduler?: GitStateMonitorScheduler;
}

/** Observation sink used by document routing to register known repository state. */
export interface GitStateObserver {
  /** Registers or refreshes the baseline snapshot for a repository root. */
  observe(
    rootPath: string,
    snapshot: GitReviewContextRepositorySnapshot
  ): void;
}

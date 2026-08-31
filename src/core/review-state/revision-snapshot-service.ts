import type {
  FileReviewState,
  GlobalFileReviewState,
  RepositoryGlobalRevisionSnapshot,
  RepositoryGlobalState,
  ReviewContextRevisionSnapshot,
  ReviewContextState
} from "../contracts/index";
import { normalizeLineIntervals } from "../intervals/index";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIFF_PAIR = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\.\.(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

/** Immutable identity evidence required before an exact revision snapshot can be restored. */
export interface ImmutableRevisionSnapshotFileEvidence {
  /** Stable file identity that must match the snapshot map key and payload. */
  readonly fileId: string;
  /** Exact canonical path or URI that must match the snapshot payload. */
  readonly currentPath: string;
  /** Authoritative target line count required before either Context or Global ranges are restored. */
  readonly lineCount: number;
  /** Exact content hash when immutable content evidence provides one. */
  readonly contentHash?: string;
}

/** Per-layer immutable evidence for an exact Context/Global revision restore. */
export interface ImmutableRevisionSnapshotEvidence {
  /** Full lowercase immutable commit object ID requested for restoration. */
  readonly revisionId: string;
  /** Expected Context files at this revision. */
  readonly contextFiles: Readonly<Record<string, ImmutableRevisionSnapshotFileEvidence>>;
  /** Expected Global files at this revision. */
  readonly globalFiles: Readonly<Record<string, ImmutableRevisionSnapshotFileEvidence>>;
}

/** Independent hit or miss result for one immutable revision snapshot layer. */
export type ImmutableRevisionSnapshotLayerResult<File> =
  | { readonly kind: "hit"; readonly files: Record<string, File> }
  | { readonly kind: "miss" };

/** Independent exact restore results for Context and Global layers. */
export interface ImmutableRevisionSnapshotRestoreResult {
  /** Context exact snapshot result. */
  readonly context: ImmutableRevisionSnapshotLayerResult<FileReviewState>;
  /** Global exact snapshot result. */
  readonly global: ImmutableRevisionSnapshotLayerResult<GlobalFileReviewState>;
}

/** Input for copying current Context/Global state into a revision-keyed immutable snapshot. */
export interface CaptureImmutableRevisionSnapshotsInput {
  /** Current Context state to copy without mutation. */
  readonly contextState: Readonly<ReviewContextState>;
  /** Current Global state to copy without mutation. */
  readonly globalState: Readonly<RepositoryGlobalState>;
  /** Full immutable revision represented by both current state layers. */
  readonly revisionId: string;
  /** Timestamp to record on replacement snapshot entries. */
  readonly updatedAt: string;
}

/** Input for validating every stored snapshot without treating an absent legacy field as corruption. */
export interface ValidateImmutableRevisionSnapshotsInput {
  /** Context document containing optional revision snapshots. */
  readonly contextState: Readonly<ReviewContextState>;
  /** Global document containing optional revision snapshots. */
  readonly globalState: Readonly<RepositoryGlobalState>;
}

/** Input for independently restoring Context and Global exact snapshot layers. */
export interface RestoreImmutableRevisionSnapshotsInput extends ValidateImmutableRevisionSnapshotsInput {
  /** Target revision and immutable file evidence. */
  readonly evidence: ImmutableRevisionSnapshotEvidence;
}

const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

const requireRevision = (value: string, name: string): void => {
  if (!FULL_OBJECT_ID.test(value)) throw new Error(`${name} must be a lowercase full immutable Git object ID.`);
};

const requireTimestamp = (value: string, name: string): void => {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO 8601 timestamp.`);
  }
};

const requirePath = (value: string, name: string): void => {
  if (value.trim().length === 0 || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`${name} must be a non-empty canonical path or URI.`);
  }
};

const requireIntervals = (
  intervals: readonly { readonly startLine: number; readonly endLineExclusive: number }[],
  name: string,
  lineCount?: number
): void => {
  const normalized = normalizeLineIntervals(intervals);
  if (JSON.stringify(normalized) !== JSON.stringify(intervals)) {
    throw new Error(`${name} must contain canonical intervals.`);
  }
  if (lineCount !== undefined && normalized.some((range) => range.endLineExclusive > lineCount)) {
    throw new Error(`${name} must stay within its line count.`);
  }
};

const requireContextFiles = (
  files: Readonly<Record<string, Readonly<FileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId || file.revisionId !== revisionId) {
      throw new Error(`${name} file identity or revision does not match its snapshot.`);
    }
    requirePath(file.currentPath, `${name}.${fileId}.currentPath`);
    if (paths.has(file.currentPath)) throw new Error(`${name} file paths must be unique.`);
    paths.add(file.currentPath);
    if (!Number.isSafeInteger(file.lineCount) || file.lineCount < 0) {
      throw new Error(`${name}.${fileId}.lineCount must be a non-negative safe integer.`);
    }
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name}.${fileId}.contentHash must not be empty.`);
    }
    requireIntervals(file.modifiedReviewed, `${name}.${fileId}.modifiedReviewed`, file.lineCount);
    for (const [pair, intervals] of Object.entries(file.originalReviewedByDiff)) {
      if (!DIFF_PAIR.test(pair)) throw new Error(`${name}.${fileId}.originalReviewedByDiff key must be a full revision pair.`);
      requireIntervals(intervals, `${name}.${fileId}.originalReviewedByDiff.${pair}`);
    }
    requireTimestamp(file.updatedAt, `${name}.${fileId}.updatedAt`);
  }
};

const requireGlobalFiles = (
  files: Readonly<Record<string, Readonly<GlobalFileReviewState>>>,
  revisionId: string,
  name: string
): void => {
  const paths = new Set<string>();
  for (const [fileId, file] of Object.entries(files)) {
    if (file.fileId !== fileId || file.revisionId !== revisionId) {
      throw new Error(`${name} file identity or revision does not match its snapshot.`);
    }
    requirePath(file.currentPath, `${name}.${fileId}.currentPath`);
    if (paths.has(file.currentPath)) throw new Error(`${name} file paths must be unique.`);
    paths.add(file.currentPath);
    if (file.contentHash !== undefined && file.contentHash.trim().length === 0) {
      throw new Error(`${name}.${fileId}.contentHash must not be empty.`);
    }
    requireIntervals(file.reviewed, `${name}.${fileId}.reviewed`);
    requireTimestamp(file.updatedAt, `${name}.${fileId}.updatedAt`);
  }
};

const requireContextSnapshot = (
  key: string,
  snapshot: Readonly<ReviewContextRevisionSnapshot>,
  schemaVersion: number
): void => {
  requireRevision(key, "Context revision snapshot key");
  if (snapshot.schemaVersion !== schemaVersion || snapshot.revisionId !== key) {
    throw new Error("Context revision snapshot schema or revision does not match its key.");
  }
  requireTimestamp(snapshot.updatedAt, "Context revision snapshot updatedAt");
  requireContextFiles(snapshot.files, key, "Context revision snapshot");
};

const requireGlobalSnapshot = (
  key: string,
  snapshot: Readonly<RepositoryGlobalRevisionSnapshot>,
  schemaVersion: number
): void => {
  requireRevision(key, "Global revision snapshot key");
  if (snapshot.schemaVersion !== schemaVersion || snapshot.revisionId !== key) {
    throw new Error("Global revision snapshot schema or revision does not match its key.");
  }
  requireTimestamp(snapshot.updatedAt, "Global revision snapshot updatedAt");
  requireGlobalFiles(snapshot.files, key, "Global revision snapshot");
};

const requireEvidence = (
  files: Readonly<Record<string, { readonly fileId: string; readonly currentPath: string; readonly contentHash?: string }>>,
  evidence: Readonly<Record<string, ImmutableRevisionSnapshotFileEvidence>>,
  name: string,
  context: boolean
): void => {
  const keys = Object.keys(files).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(evidence).sort())) {
    throw new Error(`${name} files do not match immutable evidence.`);
  }
  for (const fileId of keys) {
    const file = files[fileId]!;
    const expected = evidence[fileId]!;
    if (!Number.isSafeInteger(expected.lineCount) || expected.lineCount < 0) {
      throw new Error(`${name}.${fileId} immutable evidence lineCount must be a non-negative safe integer.`);
    }
    if (file.fileId !== expected.fileId || file.currentPath !== expected.currentPath ||
      file.contentHash !== expected.contentHash ||
      (context && (file as FileReviewState).lineCount !== expected.lineCount)) {
      throw new Error(`${name}.${fileId} does not match immutable evidence.`);
    }
    requireIntervals(
      context
        ? (file as FileReviewState).modifiedReviewed
        : (file as GlobalFileReviewState).reviewed,
      `${name}.${fileId} reviewed ranges`,
      expected.lineCount
    );
  }
};

/** Validates present snapshots and accepts omitted `revisionSnapshots` as a legacy-state miss. */
export function validateImmutableRevisionSnapshots(input: ValidateImmutableRevisionSnapshotsInput): void {
  validateContextRevisionSnapshots(input.contextState);
  validateGlobalRevisionSnapshots(input.globalState);
}

/** Validates Context revision snapshots while accepting their absence in a legacy document. */
export function validateContextRevisionSnapshots(state: Readonly<ReviewContextState>): void {
  for (const [key, snapshot] of Object.entries(state.revisionSnapshots ?? {})) {
    requireContextSnapshot(key, snapshot, state.schemaVersion);
  }
}

/** Validates Global revision snapshots while accepting their absence in a legacy document. */
export function validateGlobalRevisionSnapshots(state: Readonly<RepositoryGlobalState>): void {
  for (const [key, snapshot] of Object.entries(state.revisionSnapshots ?? {})) {
    requireGlobalSnapshot(key, snapshot, state.schemaVersion);
  }
}

/** Captures both current layers under one exact revision key without mutating or aliasing caller-owned state. */
export function captureImmutableRevisionSnapshots(
  input: CaptureImmutableRevisionSnapshotsInput
): { readonly contextState: ReviewContextState; readonly globalState: RepositoryGlobalState } {
  requireRevision(input.revisionId, "revisionId");
  requireTimestamp(input.updatedAt, "updatedAt");
  validateImmutableRevisionSnapshots(input);
  requireContextFiles(input.contextState.files, input.revisionId, "Current Context files");
  if (input.globalState.currentRevisionId !== input.revisionId) {
    throw new Error("Current Global revision must match the snapshot revision.");
  }
  requireGlobalFiles(input.globalState.files, input.revisionId, "Current Global files");
  const contextState = clone(input.contextState) as Mutable<ReviewContextState>;
  const globalState = clone(input.globalState) as Mutable<RepositoryGlobalState>;
  contextState.revisionSnapshots = {
    ...contextState.revisionSnapshots,
    [input.revisionId]: {
      schemaVersion: contextState.schemaVersion,
      revisionId: input.revisionId,
      files: clone(contextState.files),
      updatedAt: input.updatedAt
    }
  };
  globalState.revisionSnapshots = {
    ...globalState.revisionSnapshots,
    [input.revisionId]: {
      schemaVersion: globalState.schemaVersion,
      revisionId: input.revisionId,
      files: clone(globalState.files),
      updatedAt: input.updatedAt
    }
  };
  return { contextState, globalState };
}

/** Restores each exact layer independently, returning misses without inferring reviewed ranges. */
export function restoreImmutableRevisionSnapshots(
  input: RestoreImmutableRevisionSnapshotsInput
): ImmutableRevisionSnapshotRestoreResult {
  requireRevision(input.evidence.revisionId, "immutable evidence revisionId");
  validateImmutableRevisionSnapshots(input);
  const contextSnapshot = input.contextState.revisionSnapshots?.[input.evidence.revisionId];
  const globalSnapshot = input.globalState.revisionSnapshots?.[input.evidence.revisionId];
  if (contextSnapshot !== undefined) requireEvidence(contextSnapshot.files, input.evidence.contextFiles, "Context revision snapshot", true);
  if (globalSnapshot !== undefined) requireEvidence(globalSnapshot.files, input.evidence.globalFiles, "Global revision snapshot", false);
  return {
    context: contextSnapshot === undefined ? { kind: "miss" } : { kind: "hit", files: clone(contextSnapshot.files) },
    global: globalSnapshot === undefined ? { kind: "miss" } : { kind: "hit", files: clone(globalSnapshot.files) }
  };
}

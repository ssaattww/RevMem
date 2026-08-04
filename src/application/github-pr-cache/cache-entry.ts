import type { PullRequestDiffSnapshot } from "../../core/pr-progress/index";
import {
  requirePullRequestDiffAcquisitionRequest,
  type PullRequestDiffAcquisitionRequest,
  type PullRequestRemoteMetadata
} from "../github-pr-diff/index";
import {
  statusMatrixValid,
  statusStatisticsValid
} from "../github-pr-diff/snapshot-builder-shared";
import { requireCanonicalRepositoryRelativePath } from "../repository-path/index";
import type { GitHubPullRequestCacheEntry } from "./contracts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const gitHubPullRequestCacheRequestMatches = (
  left: PullRequestDiffAcquisitionRequest,
  right: PullRequestDiffAcquisitionRequest
): boolean =>
  left.contextId === right.contextId &&
  left.repository.host === right.repository.host &&
  left.repository.owner === right.repository.owner &&
  left.repository.repository === right.repository.repository &&
  left.number === right.number &&
  left.baseSha === right.baseSha &&
  left.headSha === right.headSha;

const requestFromUnknown = (value: unknown): PullRequestDiffAcquisitionRequest | undefined => {
  if (!isObject(value) || !isObject(value.repository)) return undefined;
  const candidate: PullRequestDiffAcquisitionRequest = {
    contextId: value.contextId as string,
    repository: {
      host: value.repository.host as string,
      owner: value.repository.owner as string,
      repository: value.repository.repository as string
    },
    number: value.number as number,
    baseSha: value.baseSha as string,
    headSha: value.headSha as string
  };
  try {
    requirePullRequestDiffAcquisitionRequest(candidate);
    return candidate;
  } catch {
    return undefined;
  }
};

const metadataFromUnknown = (
  value: unknown,
  request: PullRequestDiffAcquisitionRequest
): PullRequestRemoteMetadata | undefined => {
  if (!isObject(value)) return undefined;
  if (
    !isPositiveSafeInteger(value.number) ||
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    (value.state !== "open" && value.state !== "closed" && value.state !== "merged") ||
    typeof value.baseSha !== "string" ||
    typeof value.headSha !== "string"
  ) return undefined;
  if (
    value.number !== request.number ||
    value.baseSha !== request.baseSha ||
    value.headSha !== request.headSha
  ) return undefined;
  return {
    number: value.number,
    title: value.title,
    url: value.url,
    state: value.state,
    baseSha: value.baseSha,
    headSha: value.headSha
  };
};

const canonicalPath = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    return requireCanonicalRepositoryRelativePath(
      value,
      "posix",
      "githubPullRequestCachePath"
    );
  } catch {
    return undefined;
  }
};

const snapshotFromUnknown = (
  value: unknown,
  request: PullRequestDiffAcquisitionRequest,
  requireRedactedText: boolean
): PullRequestDiffSnapshot | undefined => {
  if (!isObject(value) || !Array.isArray(value.files)) return undefined;
  if (
    value.contextId !== request.contextId ||
    value.baseSha !== request.baseSha ||
    value.headSha !== request.headSha ||
    value.originalDiffId !== `${request.baseSha}..${request.headSha}`
  ) return undefined;

  const fileIds = new Set<string>();
  const displayPaths = new Set<string>();
  const files: PullRequestDiffSnapshot["files"][number][] = [];
  for (const unknownFile of value.files) {
    if (!isObject(unknownFile) || !Array.isArray(unknownFile.hunks)) return undefined;
    if (
      !isNonEmptyString(unknownFile.fileId) ||
      (unknownFile.status !== "added" &&
        unknownFile.status !== "modified" &&
        unknownFile.status !== "deleted" &&
        unknownFile.status !== "renamed" &&
        unknownFile.status !== "copied" &&
        unknownFile.status !== "binary") ||
      !isNonNegativeSafeInteger(unknownFile.additions) ||
      !isNonNegativeSafeInteger(unknownFile.deletions)
    ) return undefined;
    const oldPath = canonicalPath(
      typeof unknownFile.oldPath === "string" ? unknownFile.oldPath : undefined
    );
    const newPath = canonicalPath(
      typeof unknownFile.newPath === "string" ? unknownFile.newPath : undefined
    );
    if (
      (unknownFile.oldPath !== undefined && oldPath === undefined) ||
      (unknownFile.newPath !== undefined && newPath === undefined) ||
      !statusMatrixValid(unknownFile.status, oldPath, newPath) ||
      !statusStatisticsValid(
        unknownFile.status,
        unknownFile.additions,
        unknownFile.deletions
      ) ||
      unknownFile.fileId !== (newPath ?? oldPath)
    ) return undefined;
    const displayPath = newPath ?? oldPath;
    if (
      displayPath === undefined ||
      fileIds.has(unknownFile.fileId) ||
      displayPaths.has(displayPath)
    ) return undefined;
    fileIds.add(unknownFile.fileId);
    displayPaths.add(displayPath);

    const hunks: PullRequestDiffSnapshot["files"][number]["hunks"][number][] = [];
    let observedAdditions = 0;
    let observedDeletions = 0;
    let previousOldEnd = -1;
    let previousNewEnd = -1;
    for (const unknownHunk of unknownFile.hunks) {
      if (!isObject(unknownHunk) || !Array.isArray(unknownHunk.lines)) return undefined;
      if (
        !isNonNegativeSafeInteger(unknownHunk.oldStart) ||
        !isNonNegativeSafeInteger(unknownHunk.oldCount) ||
        !isNonNegativeSafeInteger(unknownHunk.newStart) ||
        !isNonNegativeSafeInteger(unknownHunk.newCount) ||
        (unknownHunk.oldCount === 0 && unknownHunk.newCount === 0) ||
        (unknownHunk.oldCount > 0 && unknownHunk.oldStart === 0) ||
        (unknownHunk.newCount > 0 && unknownHunk.newStart === 0)
      ) return undefined;
      const oldEnd = unknownHunk.oldStart + unknownHunk.oldCount;
      const newEnd = unknownHunk.newStart + unknownHunk.newCount;
      if (
        !Number.isSafeInteger(oldEnd) ||
        !Number.isSafeInteger(newEnd) ||
        unknownHunk.oldStart < previousOldEnd ||
        unknownHunk.newStart < previousNewEnd
      ) return undefined;
      previousOldEnd = oldEnd;
      previousNewEnd = newEnd;

      let oldCursor = unknownHunk.oldStart;
      let newCursor = unknownHunk.newStart;
      let oldObserved = 0;
      let newObserved = 0;
      const lines: PullRequestDiffSnapshot["files"][number]["hunks"][number]["lines"][number][] = [];
      for (const unknownLine of unknownHunk.lines) {
        if (!isObject(unknownLine)) return undefined;
        if (
          (unknownLine.kind !== "context" &&
            unknownLine.kind !== "addition" &&
            unknownLine.kind !== "deletion") ||
          (unknownLine.oldLine !== undefined && !isPositiveSafeInteger(unknownLine.oldLine)) ||
          (unknownLine.newLine !== undefined && !isPositiveSafeInteger(unknownLine.newLine)) ||
          typeof unknownLine.text !== "string" ||
          (requireRedactedText && unknownLine.text !== "")
        ) return undefined;
        if (unknownLine.kind === "context") {
          if (unknownLine.oldLine !== oldCursor || unknownLine.newLine !== newCursor) {
            return undefined;
          }
          oldCursor += 1;
          newCursor += 1;
          oldObserved += 1;
          newObserved += 1;
        } else if (unknownLine.kind === "addition") {
          if (unknownLine.oldLine !== undefined || unknownLine.newLine !== newCursor) {
            return undefined;
          }
          newCursor += 1;
          newObserved += 1;
          observedAdditions += 1;
        } else {
          if (unknownLine.oldLine !== oldCursor || unknownLine.newLine !== undefined) {
            return undefined;
          }
          oldCursor += 1;
          oldObserved += 1;
          observedDeletions += 1;
        }
        lines.push({
          kind: unknownLine.kind,
          ...(unknownLine.oldLine === undefined ? {} : { oldLine: unknownLine.oldLine }),
          ...(unknownLine.newLine === undefined ? {} : { newLine: unknownLine.newLine }),
          text: unknownLine.text
        });
      }
      if (oldObserved !== unknownHunk.oldCount || newObserved !== unknownHunk.newCount) {
        return undefined;
      }
      hunks.push({
        oldStart: unknownHunk.oldStart,
        oldCount: unknownHunk.oldCount,
        newStart: unknownHunk.newStart,
        newCount: unknownHunk.newCount,
        lines
      });
    }
    if (
      observedAdditions !== unknownFile.additions ||
      observedDeletions !== unknownFile.deletions ||
      (unknownFile.status === "binary" && hunks.length !== 0)
    ) return undefined;
    files.push({
      fileId: unknownFile.fileId,
      ...(oldPath === undefined ? {} : { oldPath }),
      ...(newPath === undefined ? {} : { newPath }),
      status: unknownFile.status,
      additions: unknownFile.additions,
      deletions: unknownFile.deletions,
      hunks
    });
  }
  return {
    contextId: request.contextId,
    baseSha: request.baseSha,
    headSha: request.headSha,
    originalDiffId: `${request.baseSha}..${request.headSha}`,
    files
  };
};

const canonicalTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString() === value ? value : undefined;
};

/** Parses a cache entry and rejects incomplete, identity-mismatched, or source-bearing data. */
export const parseGitHubPullRequestCacheEntry = (
  value: unknown,
  expectedRequest?: PullRequestDiffAcquisitionRequest
): GitHubPullRequestCacheEntry | undefined => {
  if (!isObject(value) || value.schemaVersion !== 1) return undefined;
  const request = requestFromUnknown(value.request);
  if (
    request === undefined ||
    (expectedRequest !== undefined &&
      !gitHubPullRequestCacheRequestMatches(request, expectedRequest))
  ) return undefined;
  const metadata = metadataFromUnknown(value.metadata, request);
  const snapshot = snapshotFromUnknown(value.snapshot, request, true);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  const expiresAt = canonicalTimestamp(value.expiresAt);
  if (
    metadata === undefined ||
    snapshot === undefined ||
    updatedAt === undefined ||
    expiresAt === undefined ||
    Date.parse(expiresAt) < Date.parse(updatedAt)
  ) return undefined;
  return {
    schemaVersion: 1,
    request: cloneGitHubPullRequestCacheRequest(request),
    metadata: cloneGitHubPullRequestMetadata(metadata),
    snapshot: cloneGitHubPullRequestDiffSnapshot(snapshot, false),
    updatedAt,
    expiresAt
  };
};

/** Stable unambiguous identity serialization used by cache adapters. */
export const serializeGitHubPullRequestCacheIdentity = (
  request: PullRequestDiffAcquisitionRequest
): string => {
  requirePullRequestDiffAcquisitionRequest(request);
  return JSON.stringify([
    request.contextId,
    request.repository.host,
    request.repository.owner,
    request.repository.repository,
    request.number,
    request.baseSha,
    request.headSha
  ]);
};

export const cloneGitHubPullRequestCacheRequest = (
  request: PullRequestDiffAcquisitionRequest
): PullRequestDiffAcquisitionRequest => ({
  contextId: request.contextId,
  repository: {
    host: request.repository.host,
    owner: request.repository.owner,
    repository: request.repository.repository
  },
  number: request.number,
  baseSha: request.baseSha,
  headSha: request.headSha
});

export const cloneGitHubPullRequestMetadata = (
  metadata: PullRequestRemoteMetadata
): PullRequestRemoteMetadata => ({
  number: metadata.number,
  title: metadata.title,
  url: metadata.url,
  state: metadata.state,
  baseSha: metadata.baseSha,
  headSha: metadata.headSha
});

export const cloneGitHubPullRequestDiffSnapshot = (
  snapshot: PullRequestDiffSnapshot,
  redactText: boolean
): PullRequestDiffSnapshot => ({
  contextId: snapshot.contextId,
  baseSha: snapshot.baseSha,
  headSha: snapshot.headSha,
  originalDiffId: snapshot.originalDiffId,
  files: snapshot.files.map(file => ({
    fileId: file.fileId,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    ...(file.newPath === undefined ? {} : { newPath: file.newPath }),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks.map(hunk => ({
      oldStart: hunk.oldStart,
      oldCount: hunk.oldCount,
      newStart: hunk.newStart,
      newCount: hunk.newCount,
      lines: hunk.lines.map(line => ({
        kind: line.kind,
        ...(line.oldLine === undefined ? {} : { oldLine: line.oldLine }),
        ...(line.newLine === undefined ? {} : { newLine: line.newLine }),
        text: redactText ? "" : line.text
      }))
    }))
  }))
});

export const cloneGitHubPullRequestCacheEntry = (
  entry: GitHubPullRequestCacheEntry
): GitHubPullRequestCacheEntry => ({
  schemaVersion: 1,
  request: cloneGitHubPullRequestCacheRequest(entry.request),
  metadata: cloneGitHubPullRequestMetadata(entry.metadata),
  snapshot: cloneGitHubPullRequestDiffSnapshot(entry.snapshot, false),
  updatedAt: entry.updatedAt,
  expiresAt: entry.expiresAt
});

export const gitHubPullRequestCacheMetadataMatches = (
  metadata: PullRequestRemoteMetadata,
  request: PullRequestDiffAcquisitionRequest
): boolean => metadataFromUnknown(metadata, request) !== undefined;

export const gitHubPullRequestCacheSnapshotMatches = (
  snapshot: PullRequestDiffSnapshot,
  request: PullRequestDiffAcquisitionRequest
): boolean => snapshotFromUnknown(snapshot, request, false) !== undefined;

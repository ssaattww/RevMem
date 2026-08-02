import type {
  PullRequestFileChange,
  PullRequestFileChangeStatus
} from "../../core/contracts/index";
import type { PullRequestDiffSnapshot } from "../../core/pr-progress/index";
import { requireCanonicalRepositoryRelativePath } from "../repository-path/index";
import type {
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffUnavailableReason,
  PullRequestRemoteFile
} from "./contracts";
import { requirePullRequestDiffAcquisitionRequest } from "./request-validation";

export interface BuildSuccess {
  readonly kind: "success";
  readonly snapshot: PullRequestDiffSnapshot;
}

export interface BuildFailure {
  readonly kind: "failure";
  readonly reason: PullRequestDiffUnavailableReason;
}

export type PullRequestDiffBuildResult = BuildSuccess | BuildFailure;

export const safeCount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const canonicalPath = (value: string): string =>
  requireCanonicalRepositoryRelativePath(value, "posix", "pullRequestFilePath");

export const normalizedPaths = (
  file: PullRequestRemoteFile
): { readonly oldPath?: string; readonly newPath?: string; readonly fileId: string } => {
  const oldPath = file.oldPath === undefined ? undefined : canonicalPath(file.oldPath);
  const newPath = file.newPath === undefined ? undefined : canonicalPath(file.newPath);
  const fileId = newPath ?? oldPath;
  if (fileId === undefined) {
    throw new RangeError("A pull-request file must have an old or new path.");
  }
  return { oldPath, newPath, fileId };
};

export const statusMatrixValid = (
  status: PullRequestFileChangeStatus,
  oldPath: string | undefined,
  newPath: string | undefined
): boolean => {
  switch (status) {
    case "added": return oldPath === undefined && newPath !== undefined;
    case "deleted": return oldPath !== undefined && newPath === undefined;
    case "modified": return oldPath !== undefined && newPath === oldPath;
    case "renamed":
    case "copied": return oldPath !== undefined && newPath !== undefined && newPath !== oldPath;
    case "binary": return oldPath !== undefined || newPath !== undefined;
  }
};

export const statusStatisticsValid = (
  status: PullRequestFileChangeStatus,
  additions: number,
  deletions: number
): boolean => {
  if (!safeCount(additions) || !safeCount(deletions)) return false;
  if (status === "added") return deletions === 0;
  if (status === "deleted") return additions === 0;
  if (status === "binary") return additions === 0 && deletions === 0;
  return true;
};

export const createSnapshot = (
  request: PullRequestDiffAcquisitionRequest,
  files: readonly PullRequestFileChange[]
): PullRequestDiffSnapshot => {
  requirePullRequestDiffAcquisitionRequest(request);
  const identities = new Set<string>();
  const paths = new Set<string>();
  for (const file of files) {
    if (identities.has(file.fileId)) {
      throw new RangeError(`Duplicate pull-request fileId: ${file.fileId}`);
    }
    identities.add(file.fileId);
    const displayPath = file.newPath ?? file.oldPath;
    if (displayPath === undefined || paths.has(displayPath)) {
      throw new RangeError(
        `Duplicate or missing pull-request display path: ${displayPath ?? "<missing>"}`
      );
    }
    paths.add(displayPath);
  }
  return {
    contextId: request.contextId,
    baseSha: request.baseSha,
    headSha: request.headSha,
    originalDiffId: `${request.baseSha}..${request.headSha}`,
    files
  };
};

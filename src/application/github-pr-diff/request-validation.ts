import type { PullRequestDiffAcquisitionRequest } from "./contracts";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const requireIdentityComponent = (value: string, name: string): string => {
  if (value.length === 0 || value.includes("\0") || value.includes("/") || /[\r\n]/u.test(value)) {
    throw new TypeError(`${name} must be a non-empty canonical identity component.`);
  }
  return value;
};

/** Validates the immutable and canonical boundary shared by every T402 route. */
export const requirePullRequestDiffAcquisitionRequest = (
  request: PullRequestDiffAcquisitionRequest
): PullRequestDiffAcquisitionRequest => {
  if (request.contextId.length === 0 || request.contextId.includes("\0") || /[\r\n]/u.test(request.contextId)) {
    throw new TypeError("contextId must be a non-empty single-line string without NUL characters.");
  }
  if (!Number.isSafeInteger(request.number) || request.number <= 0) {
    throw new RangeError("pull-request number must be a positive safe integer.");
  }
  requireIdentityComponent(request.repository.host, "repository.host");
  requireIdentityComponent(request.repository.owner, "repository.owner");
  requireIdentityComponent(request.repository.repository, "repository.repository");
  if (!FULL_OBJECT_ID.test(request.baseSha) || !FULL_OBJECT_ID.test(request.headSha)) {
    throw new TypeError("baseSha and headSha must be lowercase full SHA-1 or SHA-256 object IDs.");
  }
  return request;
};

/** Validates an immutable commit ID used by the raw-content route. */
export const requirePullRequestCommitObjectId = (revision: string): string => {
  if (!FULL_OBJECT_ID.test(revision)) {
    throw new TypeError("revision must be a lowercase full SHA-1 or SHA-256 commit object ID.");
  }
  return revision;
};

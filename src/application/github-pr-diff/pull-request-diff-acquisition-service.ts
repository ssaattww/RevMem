import {
  buildSnapshotFromFileContents,
  buildSnapshotFromGitHubPatches,
  buildSnapshotFromLocalGitDiff,
  type PullRequestFileContents
} from "./pull-request-diff-builders";
import type {
  LocalPullRequestDiffPort,
  PullRequestDiffAcquisitionAttempt,
  PullRequestDiffAcquisitionRequest,
  PullRequestDiffAcquisitionResult,
  PullRequestDiffUnavailableReason,
  PullRequestRemoteDataPort,
  PullRequestRemoteFile,
  PullRequestRemoteMetadata
} from "./contracts";
import { requirePullRequestDiffAcquisitionRequest } from "./request-validation";

/** Dependencies for the ordered T402 diff-acquisition workflow. */
export interface PullRequestDiffAcquisitionServiceOptions {
  readonly local: LocalPullRequestDiffPort;
  readonly remote: PullRequestRemoteDataPort;
}

const metadataMatches = (
  request: PullRequestDiffAcquisitionRequest,
  metadata: PullRequestRemoteMetadata
): boolean => metadata.number === request.number && metadata.baseSha === request.baseSha && metadata.headSha === request.headSha;

interface ContentLoadSuccess {
  readonly kind: "success";
  readonly contents: readonly PullRequestFileContents[];
}

interface ContentLoadFailure {
  readonly kind: "failure";
  readonly reason: PullRequestDiffUnavailableReason;
}

const localFailureReason = (error: unknown): PullRequestDiffUnavailableReason =>
  typeof error === "object" && error !== null &&
  (error as { readonly name?: unknown }).name === "GitCommandFailedError" &&
  (error as { readonly result?: { readonly exitCode?: unknown } }).result?.exitCode === -1
    ? "git-timeout"
    : "git-failure";

/**
 * Acquires one exact PR diff through local Git, GitHub patches, then immutable contents.
 * Partial or ambiguous evidence is retained only as diagnostic attempts and never exposed
 * as a snapshot.
 */
export class PullRequestDiffAcquisitionService {
  private readonly local: LocalPullRequestDiffPort;
  private readonly remote: PullRequestRemoteDataPort;

  public constructor(options: PullRequestDiffAcquisitionServiceOptions) {
    this.local = options.local;
    this.remote = options.remote;
  }

  public async acquire(
    request: PullRequestDiffAcquisitionRequest
  ): Promise<PullRequestDiffAcquisitionResult> {
    requirePullRequestDiffAcquisitionRequest(request);
    const attempts: PullRequestDiffAcquisitionAttempt[] = [];
    let local: Awaited<ReturnType<LocalPullRequestDiffPort["loadDiff"]>>;
    try {
      local = await this.local.loadDiff(request);
    } catch (error) {
      local = { kind: "unavailable", reason: localFailureReason(error) };
    }
    if (local.kind === "available") {
      const built = buildSnapshotFromLocalGitDiff(request, local.diff);
      if (built.kind === "success") {
        return { kind: "acquired", source: "local-git", snapshot: built.snapshot };
      }
      attempts.push({ source: "local-git", reason: built.reason });
    } else {
      attempts.push({ source: "local-git", reason: local.reason });
    }

    let remote: Awaited<ReturnType<PullRequestRemoteDataPort["fetch"]>>;
    try {
      remote = await this.remote.fetch(request);
    } catch {
      remote = { kind: "unavailable", reason: "api" };
    }
    if (remote.kind === "unavailable") {
      attempts.push({ source: "github-patch", reason: remote.reason });
      attempts.push({ source: "github-content", reason: remote.reason });
      return { kind: "unavailable", attempts };
    }
    if (!metadataMatches(request, remote.metadata)) {
      attempts.push({ source: "github-patch", reason: "identity-mismatch" });
      attempts.push({ source: "github-content", reason: "identity-mismatch" });
      return { kind: "unavailable", attempts };
    }

    const patched = buildSnapshotFromGitHubPatches(request, remote.files);
    if (patched.kind === "success") {
      return {
        kind: "acquired",
        source: "github-patch",
        snapshot: patched.snapshot,
        metadata: remote.metadata
      };
    }
    attempts.push({ source: "github-patch", reason: patched.reason });
    if (patched.reason === "invalid-data") {
      attempts.push({ source: "github-content", reason: "invalid-data" });
      return { kind: "unavailable", attempts };
    }

    const loaded = await this.loadContents(request, remote.files);
    if (loaded.kind === "failure") {
      attempts.push({ source: "github-content", reason: loaded.reason });
      return { kind: "unavailable", attempts };
    }
    const contentBuilt = buildSnapshotFromFileContents(request, remote.files, loaded.contents);
    if (contentBuilt.kind === "failure") {
      attempts.push({ source: "github-content", reason: contentBuilt.reason });
      return { kind: "unavailable", attempts };
    }
    return {
      kind: "acquired",
      source: "github-content",
      snapshot: contentBuilt.snapshot,
      metadata: remote.metadata
    };
  }

  private async loadContents(
    request: PullRequestDiffAcquisitionRequest,
    files: readonly PullRequestRemoteFile[]
  ): Promise<ContentLoadSuccess | ContentLoadFailure> {
    const contents: PullRequestFileContents[] = [];
    for (const file of files) {
      if (file.status === "binary") {
        contents.push({});
        continue;
      }
      let oldContent: PullRequestFileContents["oldContent"];
      let newContent: PullRequestFileContents["newContent"];
      if (file.oldPath !== undefined) {
        let oldResult: Awaited<ReturnType<PullRequestRemoteDataPort["readFile"]>>;
        try {
          oldResult = await this.remote.readFile(request.repository, request.baseSha, file.oldPath);
        } catch {
          return { kind: "failure", reason: "invalid-data" };
        }
        if (oldResult.kind === "unavailable") return { kind: "failure", reason: oldResult.reason };
        oldContent = oldResult.kind === "binary"
          ? { kind: "binary" }
          : { kind: "text", content: oldResult.content };
      }
      if (file.newPath !== undefined) {
        let newResult: Awaited<ReturnType<PullRequestRemoteDataPort["readFile"]>>;
        try {
          newResult = await this.remote.readFile(request.repository, request.headSha, file.newPath);
        } catch {
          return { kind: "failure", reason: "invalid-data" };
        }
        if (newResult.kind === "unavailable") return { kind: "failure", reason: newResult.reason };
        newContent = newResult.kind === "binary"
          ? { kind: "binary" }
          : { kind: "text", content: newResult.content };
      }
      contents.push({
        ...(oldContent === undefined ? {} : { oldContent }),
        ...(newContent === undefined ? {} : { newContent })
      });
    }
    return { kind: "success", contents };
  }
}

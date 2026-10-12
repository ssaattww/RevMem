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
import type { OperationFeedbackContext } from "../operation-feedback/index";
import { reportActiveOperationAcquisitionAttempt } from "../operation-feedback/index";

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
  readonly error?: unknown;
}

const safeField = (value: unknown, key: string): unknown => {
  try { return (typeof value === "object" && value !== null) || typeof value === "function" ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
};

const isAbortError = (error: unknown): boolean => safeField(error, "name") === "AbortError";

const localFailureReason = (error: unknown): PullRequestDiffUnavailableReason =>
  safeField(error, "name") === "GitCommandFailedError" &&
  safeField(safeField(error, "result"), "exitCode") === -1
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
    request: PullRequestDiffAcquisitionRequest,
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<PullRequestDiffAcquisitionResult> {
    requirePullRequestDiffAcquisitionRequest(request);
    const assertCurrent = (): void => {
      if (signal?.aborted) throw new DOMException("PR diff acquisition was superseded.", "AbortError");
    };
    assertCurrent();
    const attempts: PullRequestDiffAcquisitionAttempt[] = [];
    let local: Awaited<ReturnType<LocalPullRequestDiffPort["loadDiff"]>>;
    let localThrown: unknown;
    reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "started" }, feedbackContext);
    try {
      local = await this.local.loadDiff(request, feedbackContext, signal);
      assertCurrent();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "cancelled", error }, feedbackContext);
        assertCurrent();
        throw error;
      }
      local = { kind: "unavailable", reason: localFailureReason(error) };
      localThrown = error;
    }
    if (local.kind === "available") {
      let built: ReturnType<typeof buildSnapshotFromLocalGitDiff>;
      try {
        built = buildSnapshotFromLocalGitDiff(request, local.diff);
      } catch (error) {
        reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "failed", error }, feedbackContext);
        throw error;
      }
      if (built.kind === "success") {
        reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "succeeded" }, feedbackContext);
        return { kind: "acquired", source: "local-git", snapshot: built.snapshot };
      }
      attempts.push({ source: "local-git", reason: built.reason });
      reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "failed", reason: built.reason }, feedbackContext);
    } else {
      attempts.push({ source: "local-git", reason: local.reason });
      if (local.kind === "unavailable") reportActiveOperationAcquisitionAttempt({ source: "local-git", status: "failed", reason: local.reason, ...(localThrown === undefined ? {} : { error: localThrown }) }, feedbackContext);
    }

    let remote: Awaited<ReturnType<PullRequestRemoteDataPort["fetch"]>>;
    let remoteThrown: unknown;
    reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "started" }, feedbackContext);
    try {
      remote = await this.remote.fetch(request, feedbackContext, signal);
      assertCurrent();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "cancelled", error }, feedbackContext);
        assertCurrent();
        throw error;
      }
      remote = { kind: "unavailable", reason: "api" };
      remoteThrown = error;
    }
    if (remote.kind === "unavailable") {
      attempts.push({ source: "github-patch", reason: remote.reason });
      attempts.push({ source: "github-content", reason: remote.reason });
      if (remoteThrown === undefined) reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "failed", reason: remote.reason }, feedbackContext);
      else reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "failed", reason: remote.reason, error: remoteThrown }, feedbackContext);
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "skipped", reason: remote.reason }, feedbackContext);
      return { kind: "unavailable", attempts };
    }
    if (!metadataMatches(request, remote.metadata)) {
      attempts.push({ source: "github-patch", reason: "identity-mismatch" });
      attempts.push({ source: "github-content", reason: "identity-mismatch" });
      reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "failed", reason: "identity-mismatch" }, feedbackContext);
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "skipped", reason: "identity-mismatch" }, feedbackContext);
      return { kind: "unavailable", attempts };
    }

    let patched: ReturnType<typeof buildSnapshotFromGitHubPatches>;
    try {
      patched = buildSnapshotFromGitHubPatches(request, remote.files);
    } catch (error) {
      reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "failed", error }, feedbackContext);
      throw error;
    }
    if (patched.kind === "success") {
      reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "succeeded" }, feedbackContext);
      return {
        kind: "acquired",
        source: "github-patch",
        snapshot: patched.snapshot,
        metadata: remote.metadata
      };
    }
    attempts.push({ source: "github-patch", reason: patched.reason });
    reportActiveOperationAcquisitionAttempt({ source: "github-patch", status: "failed", reason: patched.reason }, feedbackContext);
    if (patched.reason === "invalid-data") {
      attempts.push({ source: "github-content", reason: "invalid-data" });
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "skipped", reason: "invalid-data" }, feedbackContext);
      return { kind: "unavailable", attempts };
    }

    reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "started" }, feedbackContext);
    let loaded: ContentLoadSuccess | ContentLoadFailure;
    try {
      loaded = await this.loadContents(request, remote.files, feedbackContext, signal);
      assertCurrent();
    } catch (error) {
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "cancelled", error }, feedbackContext);
      throw error;
    }
    if (loaded.kind === "failure") {
      attempts.push({ source: "github-content", reason: loaded.reason });
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "failed", reason: loaded.reason, ...(loaded.error === undefined ? {} : { error: loaded.error }) }, feedbackContext);
      return { kind: "unavailable", attempts };
    }
    let contentBuilt: ReturnType<typeof buildSnapshotFromFileContents>;
    try {
      contentBuilt = buildSnapshotFromFileContents(request, remote.files, loaded.contents);
    } catch (error) {
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "failed", error }, feedbackContext);
      throw error;
    }
    if (contentBuilt.kind === "failure") {
      attempts.push({ source: "github-content", reason: contentBuilt.reason });
      reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "failed", reason: contentBuilt.reason }, feedbackContext);
      return { kind: "unavailable", attempts };
    }
    reportActiveOperationAcquisitionAttempt({ source: "github-content", status: "succeeded" }, feedbackContext);
    return {
      kind: "acquired",
      source: "github-content",
      snapshot: contentBuilt.snapshot,
      metadata: remote.metadata
    };
  }

  private async loadContents(
    request: PullRequestDiffAcquisitionRequest,
    files: readonly PullRequestRemoteFile[],
    feedbackContext?: OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<ContentLoadSuccess | ContentLoadFailure> {
    const contents: PullRequestFileContents[] = [];
    for (const file of files) {
      if (signal?.aborted) throw new DOMException("PR diff acquisition was superseded.", "AbortError");
      if (file.status === "binary") {
        contents.push({});
        continue;
      }
      let oldContent: PullRequestFileContents["oldContent"];
      let newContent: PullRequestFileContents["newContent"];
      if (file.oldPath !== undefined) {
        let oldResult: Awaited<ReturnType<PullRequestRemoteDataPort["readFile"]>>;
        try {
          oldResult = await this.remote.readFile(request.repository, request.baseSha, file.oldPath, feedbackContext, signal);
          if (signal?.aborted) throw new DOMException("PR diff acquisition was superseded.", "AbortError");
        } catch (error) {
          if (signal?.aborted === true || isAbortError(error)) throw error;
          return { kind: "failure", reason: "invalid-data", error };
        }
        if (oldResult.kind === "unavailable") return { kind: "failure", reason: oldResult.reason };
        oldContent = oldResult.kind === "binary"
          ? { kind: "binary" }
          : { kind: "text", content: oldResult.content };
      }
      if (file.newPath !== undefined) {
        let newResult: Awaited<ReturnType<PullRequestRemoteDataPort["readFile"]>>;
        try {
          newResult = await this.remote.readFile(request.repository, request.headSha, file.newPath, feedbackContext, signal);
          if (signal?.aborted) throw new DOMException("PR diff acquisition was superseded.", "AbortError");
        } catch (error) {
          if (signal?.aborted === true || isAbortError(error)) throw error;
          return { kind: "failure", reason: "invalid-data", error };
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

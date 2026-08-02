import type { ReviewDiffSide } from "../../core/contracts/index";
import type { FileSystemPathSemantics } from "../workspace-identity/index";

/** Source kind encoded into a virtual diff document revision identity. */
export type ReviewDiffRevisionSource = "git-commit" | "empty";

/** Fields shared by every immutable review-diff document descriptor. */
export interface ReviewDiffDocumentDescriptorBase {
  /** Stable review-context identity used to isolate parallel PR and branch state. */
  readonly contextId: string;
  /** Canonical repository-relative logical path represented by the virtual document. */
  readonly filePath: string;
  /** Filesystem semantics used to validate repository path characters. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Original/base or modified/head side shown by the diff editor. */
  readonly side: ReviewDiffSide;
  /** Lowercase full SHA-1 or SHA-256 comparison revision used in immutable URI identity. */
  readonly revision: string;
}

/** Descriptor whose text must be restored from an exact Git commit and repository path. */
export interface GitCommitReviewDiffDocumentDescriptor
  extends ReviewDiffDocumentDescriptorBase {
  readonly revisionSource: "git-commit";
}

/**
 * Synthetic immutable empty document for a file side that is absent at the comparison revision.
 * External Git/GitHub/snapshot text sources never receive this descriptor.
 */
export interface EmptyReviewDiffDocumentDescriptor
  extends ReviewDiffDocumentDescriptorBase {
  readonly revisionSource: "empty";
}

/** Complete identity required to reopen one immutable side of a review diff. */
export type ReviewDiffDocumentDescriptor =
  | GitCommitReviewDiffDocumentDescriptor
  | EmptyReviewDiffDocumentDescriptor;

/** Successful immutable text lookup. */
export interface RevisionTextContentFound {
  readonly kind: "found";
  readonly content: string;
}

/** The review context encoded in the URI is not available in the current host. */
export interface RevisionTextContentMissingContext {
  readonly kind: "missing-context";
}

/** The requested immutable revision object is no longer available. */
export interface RevisionTextContentMissingRevision {
  readonly kind: "missing-revision";
}

/** The file does not exist at the otherwise available revision. */
export interface RevisionTextContentMissingFile {
  readonly kind: "missing-file";
}

/** Blob bytes are not valid UTF-8 and cannot be represented as a line document. */
export interface RevisionTextContentInvalidEncoding {
  readonly kind: "invalid-encoding";
  readonly encoding: "utf-8";
}

/** Complete deterministic outcome of an immutable revision text lookup. */
export type RevisionTextContentReadResult =
  | RevisionTextContentFound
  | RevisionTextContentMissingContext
  | RevisionTextContentMissingRevision
  | RevisionTextContentMissingFile
  | RevisionTextContentInvalidEncoding;

/** Injectable external content boundary used by local Git, GitHub, and snapshot implementations. */
export interface RevisionTextContentSource {
  /** Reads exact text only for a Git-commit descriptor without substituting another source or revision. */
  readTextContent(
    descriptor: GitCommitReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult>;
}

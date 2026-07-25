import type { ReviewDiffSide } from "../../core/contracts/index";
import type { FileSystemPathSemantics } from "../workspace-identity/index";

/** Source kind encoded into a virtual diff document revision identity. */
export type ReviewDiffRevisionSource = "git-commit";

/** Complete identity required to reopen one immutable side of a review diff. */
export interface ReviewDiffDocumentDescriptor {
  /** Stable review-context identity used to isolate parallel PR and branch state. */
  readonly contextId: string;
  /** Canonical repository-relative file path represented by the virtual document. */
  readonly filePath: string;
  /** Filesystem semantics used to validate repository path characters. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Original/base or modified/head side shown by the diff editor. */
  readonly side: ReviewDiffSide;
  /** Immutable source kind. T601 may add a separately versioned snapshot source. */
  readonly revisionSource: ReviewDiffRevisionSource;
  /** Lowercase full SHA-1 or SHA-256 commit object ID. Moving refs are forbidden. */
  readonly revision: string;
}

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

/** Injectable content boundary used by local Git, GitHub, and snapshot implementations. */
export interface RevisionTextContentSource {
  /** Reads exact text for the descriptor without substituting another revision. */
  readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult>;
}

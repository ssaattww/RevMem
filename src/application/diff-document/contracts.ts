import type { ReviewDiffSide } from "../../core/contracts/index";
import type { FileSystemPathSemantics } from "../workspace-identity/index";

/** Source kind encoded into a virtual diff document revision identity. */
export type ReviewDiffRevisionSource = "git-commit" | "empty";

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
  /** Immutable source kind. `empty` represents a file side that does not exist at this revision. */
  readonly revisionSource: ReviewDiffRevisionSource;
  /** Lowercase full SHA-1 or SHA-256 commit object ID used to isolate this immutable comparison side. */
  readonly revision: string;
}

/** Successful immutable text lookup. */
export interface RevisionTextContentFound {
  /** Discriminant proving that the exact descriptor content was restored. */
  readonly kind: "found";
  /** Exact UTF-8 text read from the descriptor's immutable revision and path. */
  readonly content: string;
}

/** The review context encoded in the URI is not available in the current host. */
export interface RevisionTextContentMissingContext {
  /** Discriminant meaning that no current-host context matched the encoded identity. */
  readonly kind: "missing-context";
}

/** The requested immutable revision object is no longer available. */
export interface RevisionTextContentMissingRevision {
  /** Discriminant meaning that the exact immutable revision object cannot be read. */
  readonly kind: "missing-revision";
}

/** The file does not exist at the otherwise available revision. */
export interface RevisionTextContentMissingFile {
  /** Discriminant meaning that the descriptor path is absent from its available revision. */
  readonly kind: "missing-file";
}

/** Blob bytes are not valid UTF-8 and cannot be represented as a line document. */
export interface RevisionTextContentInvalidEncoding {
  /** Discriminant meaning that exact blob bytes failed fatal UTF-8 decoding. */
  readonly kind: "invalid-encoding";
  /** Fixed encoding label for the fatal decoder that rejected the blob bytes. */
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
  /** Reads exact text for a `git-commit` descriptor without substituting another revision. */
  readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult>;
}

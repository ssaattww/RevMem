import type { ReviewDiffSide } from "../../core/contracts/index";

/** Complete identity required to reopen one immutable side of a review diff. */
export interface ReviewDiffDocumentDescriptor {
  /** Stable review-context identity used to isolate parallel PR and branch state. */
  readonly contextId: string;
  /** Repository-relative file path represented by the virtual document. */
  readonly filePath: string;
  /** Original/base or modified/head side shown by the diff editor. */
  readonly side: ReviewDiffSide;
  /** Exact Git object or snapshot revision used to obtain the document content. */
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

/** The requested revision object is no longer available. */
export interface RevisionTextContentMissingRevision {
  readonly kind: "missing-revision";
}

/** The file does not exist at the otherwise available revision. */
export interface RevisionTextContentMissingFile {
  readonly kind: "missing-file";
}

/** Complete deterministic outcome of an immutable revision text lookup. */
export type RevisionTextContentReadResult =
  | RevisionTextContentFound
  | RevisionTextContentMissingContext
  | RevisionTextContentMissingRevision
  | RevisionTextContentMissingFile;

/** Injectable content boundary used by local Git, GitHub, and snapshot implementations. */
export interface RevisionTextContentSource {
  /** Reads exact text for the descriptor without substituting another revision. */
  readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult>;
}

/** Exact UTF-8 text read from a file blob at one immutable Git commit. */
export interface LocalGitRevisionTextFound {
  /** Discriminant proving that the requested immutable commit and path resolved. */
  readonly kind: "found";
  /** Exact UTF-8 text decoded from the requested immutable Git blob. */
  readonly content: string;
}

/** The requested full object ID does not resolve to that commit object. */
export interface LocalGitRevisionTextMissingRevision {
  /** Discriminant meaning that the requested full commit object ID is unavailable. */
  readonly kind: "missing-revision";
}

/** The requested path is absent or is not a blob at the available commit. */
export interface LocalGitRevisionTextMissingFile {
  /** Discriminant meaning that the exact repository path has no readable blob. */
  readonly kind: "missing-file";
}

/** Blob bytes are not valid UTF-8 and therefore cannot be line-reviewed safely. */
export interface LocalGitRevisionTextInvalidEncoding {
  /** Discriminant meaning that raw blob bytes failed fatal UTF-8 decoding. */
  readonly kind: "invalid-encoding";
  /** Fixed label for the required UTF-8 decoding contract. */
  readonly encoding: "utf-8";
}

/** Deterministic outcome of an immutable Git commit text lookup. */
export type LocalGitRevisionTextReadResult =
  | LocalGitRevisionTextFound
  | LocalGitRevisionTextMissingRevision
  | LocalGitRevisionTextMissingFile
  | LocalGitRevisionTextInvalidEncoding;

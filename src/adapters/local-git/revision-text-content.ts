/** Exact UTF-8 text read from a file blob at one immutable Git commit. */
export interface LocalGitRevisionTextFound {
  readonly kind: "found";
  readonly content: string;
}

/** The requested full object ID does not resolve to that commit object. */
export interface LocalGitRevisionTextMissingRevision {
  readonly kind: "missing-revision";
}

/** The requested path is absent or is not a blob at the available commit. */
export interface LocalGitRevisionTextMissingFile {
  readonly kind: "missing-file";
}

/** Blob bytes are not valid UTF-8 and therefore cannot be line-reviewed safely. */
export interface LocalGitRevisionTextInvalidEncoding {
  readonly kind: "invalid-encoding";
  readonly encoding: "utf-8";
}

/** Deterministic outcome of an immutable Git commit text lookup. */
export type LocalGitRevisionTextReadResult =
  | LocalGitRevisionTextFound
  | LocalGitRevisionTextMissingRevision
  | LocalGitRevisionTextMissingFile
  | LocalGitRevisionTextInvalidEncoding;

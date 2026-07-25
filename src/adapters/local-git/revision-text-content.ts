/** Exact UTF-8 text read from a file blob at one Git revision. */
export interface LocalGitRevisionTextFound {
  readonly kind: "found";
  readonly content: string;
}

/** The requested revision does not resolve to a commit object. */
export interface LocalGitRevisionTextMissingRevision {
  readonly kind: "missing-revision";
}

/** The requested path is absent or is not a blob at the available revision. */
export interface LocalGitRevisionTextMissingFile {
  readonly kind: "missing-file";
}

/** Deterministic outcome of an immutable Git revision text lookup. */
export type LocalGitRevisionTextReadResult =
  | LocalGitRevisionTextFound
  | LocalGitRevisionTextMissingRevision
  | LocalGitRevisionTextMissingFile;

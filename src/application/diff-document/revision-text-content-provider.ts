import type {
  ReviewDiffDocumentDescriptor,
  RevisionTextContentSource
} from "./contracts";
import { ReviewDiffUriCodec } from "./review-diff-uri-codec";

/** Stable failure codes surfaced when an immutable diff document cannot be restored. */
export type RevisionTextContentProviderErrorCode =
  | "missing-context"
  | "missing-revision"
  | "missing-file"
  | "invalid-encoding";

const ERROR_MESSAGES: Readonly<Record<RevisionTextContentProviderErrorCode, string>> = {
  "missing-context": "Review context is unavailable",
  "missing-revision": "Revision object is unavailable",
  "missing-file": "File is unavailable at the requested revision",
  "invalid-encoding": "File content is not valid UTF-8"
};

/** Deterministic failure returned for known unavailable diff-document inputs. */
export class RevisionTextContentProviderError extends Error {
  public constructor(
    /** Stable unavailable-content reason for callers that must not infer a substitute. */
    public readonly code: RevisionTextContentProviderErrorCode,
    /** Immutable descriptor copy that identifies the exact context, side, path, and revision that failed. */
    public readonly descriptor: ReviewDiffDocumentDescriptor
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "RevisionTextContentProviderError";
    this.descriptor = { ...descriptor };
  }
}

/** Restores immutable original or modified text from a T302 virtual URI. */
export class RevisionTextContentProvider {
  public constructor(
    private readonly uriCodec: ReviewDiffUriCodec,
    private readonly contentSource: RevisionTextContentSource
  ) {}

  /**
   * Decodes one virtual URI and returns exact revision content.
   * `empty` descriptors are authoritative immutable empty documents and never reach the external source.
   */
  public async provideTextDocumentContent(uri: string): Promise<string> {
    const descriptor = this.uriCodec.decode(uri);
    if (descriptor.revisionSource === "empty") return "";

    const result = await this.contentSource.readTextContent(descriptor);
    if (result.kind === "found") return result.content;
    throw new RevisionTextContentProviderError(result.kind, descriptor);
  }
}

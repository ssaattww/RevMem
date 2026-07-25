import type {
  ReviewDiffDocumentDescriptor,
  RevisionTextContentSource
} from "./contracts";
import { ReviewDiffUriCodec } from "./review-diff-uri-codec";

/** Stable failure codes surfaced when an immutable diff document cannot be restored. */
export type RevisionTextContentProviderErrorCode =
  | "missing-context"
  | "missing-revision"
  | "missing-file";

const ERROR_MESSAGES: Readonly<
  Record<RevisionTextContentProviderErrorCode, string>
> = {
  "missing-context": "Review context is unavailable",
  "missing-revision": "Revision object is unavailable",
  "missing-file": "File is unavailable at the requested revision"
};

/** Deterministic failure returned for known unavailable diff-document inputs. */
export class RevisionTextContentProviderError extends Error {
  public constructor(
    public readonly code: RevisionTextContentProviderErrorCode,
    public readonly descriptor: ReviewDiffDocumentDescriptor
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "RevisionTextContentProviderError";
    this.descriptor = { ...descriptor };
  }
}

/**
 * Restores immutable original or modified text from a T302 virtual URI.
 *
 * The provider never substitutes another context, side, revision, or file. Known
 * absence is represented by stable error codes; unexpected adapter failures are
 * preserved for diagnostic handling by the caller.
 */
export class RevisionTextContentProvider {
  public constructor(
    private readonly uriCodec: ReviewDiffUriCodec,
    private readonly contentSource: RevisionTextContentSource
  ) {}

  /** Decodes one virtual URI and returns the exact requested revision content. */
  public async provideTextDocumentContent(uri: string): Promise<string> {
    const descriptor = this.uriCodec.decode(uri);
    const result = await this.contentSource.readTextContent(descriptor);

    if (result.kind === "found") {
      return result.content;
    }

    throw new RevisionTextContentProviderError(result.kind, descriptor);
  }
}

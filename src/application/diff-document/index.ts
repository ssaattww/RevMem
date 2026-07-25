/** Public immutable diff-document contracts and services. */
export type {
  ReviewDiffDocumentDescriptor,
  ReviewDiffRevisionSource,
  RevisionTextContentFound,
  RevisionTextContentInvalidEncoding,
  RevisionTextContentMissingContext,
  RevisionTextContentMissingFile,
  RevisionTextContentMissingRevision,
  RevisionTextContentReadResult,
  RevisionTextContentSource
} from "./contracts";
export {
  ReviewDiffUriCodec,
  ReviewDiffUriCodecError,
  type ReviewDiffUriCodecErrorCode
} from "./review-diff-uri-codec";
export {
  RevisionTextContentProvider,
  RevisionTextContentProviderError,
  type RevisionTextContentProviderErrorCode
} from "./revision-text-content-provider";

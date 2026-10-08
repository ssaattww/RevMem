/** Reads raw blob bytes without applying a text encoding or fixed stdout buffer. */
export interface GitBlobReader {
  /** Reads one immutable blob object from the selected local repository. */
  readBlob(
    repositoryRoot: string,
    blobObjectId: string,
    feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;

  /** Optionally reads a sequential batch; older or test readers retain the per-blob fallback. */
  readBlobs?(
    repositoryRoot: string,
    blobObjectIds: readonly string[],
    onBlob: (blobObjectId: string, bytes: Uint8Array) => void | Promise<void>,
    feedbackContext?: import("../../application/operation-feedback/index").OperationFeedbackContext,
    signal?: AbortSignal,
  ): Promise<void>;
}

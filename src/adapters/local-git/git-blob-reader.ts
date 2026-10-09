export const MAX_GIT_BLOB_BATCH_OBJECTS = 128;

/** Identifies the one transport outcome eligible for a later single-object fallback. */
export class GitBlobBatchObjectTooLargeError extends Error {
  public constructor(
    public readonly objectId: string,
    public readonly objectSize: number,
    public readonly limitBytes: number,
  ) {
    super(`Git cat-file batch object ${objectId} is ${objectSize} bytes; batch limit is ${limitBytes} bytes`);
    this.name = "GitBlobBatchObjectTooLargeError";
  }
}

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

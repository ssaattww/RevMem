import {
  DocumentReviewStateSessionProvider as ReconciledDocumentReviewStateSessionProvider
} from "./reconciled-document-review-state-session-provider";
import type {
  DocumentEditorReviewDescriptor,
  DocumentNormalEditorDecorationState,
  DocumentNormalEditorReviewStateSession,
  DocumentReviewStateSessionProviderOptions
} from "./document-review-state-session-provider";

/**
 * Public document session provider backed by the reconciled active-owner snapshot.
 *
 * The reconciliation provider returns the complete snapshot that was either loaded or
 * committed for the selected owner. Reusing it avoids a second owner resolution and Git
 * inspection while preserving the same durable CAS result for command execution.
 */
export class DocumentReviewStateSessionProvider {
  private readonly delegate: ReconciledDocumentReviewStateSessionProvider;

  public constructor(options: DocumentReviewStateSessionProviderOptions) {
    this.delegate = new ReconciledDocumentReviewStateSessionProvider(options);
  }

  /** Opens and reconciles the active owner exactly once. */
  public open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    return this.delegate.open(descriptor);
  }

  /** Delegates non-mutating decoration reads. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.delegate.loadForDecoration(descriptor);
  }
}

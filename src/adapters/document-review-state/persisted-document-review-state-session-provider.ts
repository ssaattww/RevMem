import {
  GitContextDocumentReviewStateSessionProvider
} from "./git-context-document-review-state-session-provider";
import type {
  DocumentReviewStateSessionProviderOptions
} from "./git-context-document-review-state-session-provider";
import type {
  DocumentEditorReviewDescriptor,
  DocumentNormalEditorDecorationState,
  DocumentNormalEditorReviewStateSession
} from "./document-review-state-session-provider";
import type { SelectedReviewContext } from "../../application/review-context/index";

/**
 * Public document session provider backed by Git context preparation and the
 * existing reconciled active-owner snapshot.
 */
export class DocumentReviewStateSessionProvider {
  private readonly delegate: GitContextDocumentReviewStateSessionProvider;

  public constructor(options: DocumentReviewStateSessionProviderOptions) {
    this.delegate = new GitContextDocumentReviewStateSessionProvider(options);
  }

  /** Resolves and maps the active Git context before opening it exactly once. */
  public open(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorReviewStateSession> {
    return this.delegate.open(descriptor, selection);
  }

  /** Resolves and maps an existing Git context before non-mutating decoration reads. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor,
    selection?: SelectedReviewContext
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.delegate.loadForDecoration(descriptor, selection);
  }

  /** Stops Git state polling owned by this provider. */
  public dispose(): void {
    this.delegate.dispose();
  }
}

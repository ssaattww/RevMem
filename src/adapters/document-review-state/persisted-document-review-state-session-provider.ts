import {
  DocumentReviewStateSessionProvider as ReconciledDocumentReviewStateSessionProvider
} from "./reconciled-document-review-state-session-provider";
import type {
  DocumentEditorReviewDescriptor,
  DocumentNormalEditorDecorationState,
  DocumentNormalEditorReviewStateSession,
  DocumentReviewStateSessionProviderOptions
} from "./document-review-state-session-provider";

const cloneValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

/**
 * Public document session provider that returns the active owner exactly as persisted.
 *
 * Lower-owner reconciliation can write one atomic replacement after the initial owner
 * session has been opened. The final read-only load makes the returned command session
 * and the durable active-owner snapshot identical without reopening lower owners.
 */
export class DocumentReviewStateSessionProvider {
  private readonly delegate: ReconciledDocumentReviewStateSessionProvider;

  public constructor(options: DocumentReviewStateSessionProviderOptions) {
    this.delegate = new ReconciledDocumentReviewStateSessionProvider(options);
  }

  /** Opens, reconciles, then reloads only the selected active owner. */
  public async open(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorReviewStateSession> {
    const session = await this.delegate.open(descriptor);
    const persisted = await this.delegate.loadForDecoration(descriptor);
    if (persisted === undefined || persisted.owner !== session.owner) {
      return session;
    }

    return {
      owner: persisted.owner,
      contextState: cloneValue(persisted.contextState),
      globalState: cloneValue(persisted.globalState),
      target: { ...persisted.target },
      committer: session.committer
    };
  }

  /** Delegates non-mutating decoration reads. */
  public loadForDecoration(
    descriptor: DocumentEditorReviewDescriptor
  ): Promise<DocumentNormalEditorDecorationState | undefined> {
    return this.delegate.loadForDecoration(descriptor);
  }
}

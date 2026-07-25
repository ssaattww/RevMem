import type { TextDocumentContentProvider, Uri } from "vscode";

import { RevisionTextContentProvider } from "../../application/diff-document/index";

/**
 * VS Code `TextDocumentContentProvider` adapter for immutable original/modified URIs.
 *
 * Registration and diff-editor opening remain T303 responsibilities. This adapter is
 * deliberately UI-only and receives the application provider through composition.
 */
export class ReviewDiffTextDocumentContentProvider
  implements TextDocumentContentProvider
{
  public constructor(
    private readonly revisionTextContentProvider: RevisionTextContentProvider
  ) {}

  /** Preserves the canonical URI string and delegates exact content restoration. */
  public provideTextDocumentContent(uri: Uri): Promise<string> {
    return this.revisionTextContentProvider.provideTextDocumentContent(
      uri.toString(true)
    );
  }
}

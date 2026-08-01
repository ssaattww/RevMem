import {
  ReviewDiffUriCodec,
  type ReviewDiffDocumentDescriptor
} from "../../application/diff-document/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";

export interface ReviewDiffEditorHost<Uri> {
  parseUri(value: string): Uri;
  openDiff(original: Uri, modified: Uri, title: string): Promise<void>;
}
export interface ReviewDiffEditorSideInput {
  readonly filePath: string;
  readonly revision: string;
}
export interface OpenReviewDiffInput {
  readonly contextId: string;
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  readonly original: ReviewDiffEditorSideInput;
  readonly modified: ReviewDiffEditorSideInput;
  readonly title: string;
}
export class ReviewDiffEditorController<Uri> {
  public constructor(private readonly codec: ReviewDiffUriCodec, private readonly host: ReviewDiffEditorHost<Uri>) {}
  public async openReviewDiff(input: OpenReviewDiffInput): Promise<void> {
    if (input.title.trim().length === 0) throw new TypeError("Diff editor title must be a non-empty string.");
    const descriptor = (side: "original" | "modified", value: ReviewDiffEditorSideInput): ReviewDiffDocumentDescriptor => ({
      contextId: input.contextId,
      filePath: value.filePath,
      fileSystemPathSemantics: input.fileSystemPathSemantics,
      side,
      revisionSource: "git-commit",
      revision: value.revision
    });
    const original = this.host.parseUri(this.codec.encode(descriptor("original", input.original)));
    const modified = this.host.parseUri(this.codec.encode(descriptor("modified", input.modified)));
    await this.host.openDiff(original, modified, input.title);
  }
}

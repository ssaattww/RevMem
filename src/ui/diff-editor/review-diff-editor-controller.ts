import {
  ReviewDiffUriCodec,
  type ReviewDiffDocumentDescriptor
} from "../../application/diff-document/index";
import type { FileSystemPathSemantics } from "../../application/workspace-identity/index";

/** Minimal platform boundary needed to open a VS Code diff editor. */
export interface ReviewDiffEditorHost<Uri> {
  /** Parses one canonical virtual document URI without altering its identity. */
  parseUri(value: string): Uri;
  /** Opens the immutable original and modified documents in diff order. */
  openDiff(original: Uri, modified: Uri, title: string): Promise<void>;
}

/** One immutable side used to construct a review diff. */
export interface ReviewDiffEditorSideInput {
  /** Repository-relative path at this immutable revision. */
  readonly filePath: string;
  /** Full immutable revision identifier. */
  readonly revision: string;
}

/** Complete request for opening one context-isolated review diff. */
export interface OpenReviewDiffInput {
  /** Context identity that isolates virtual document URIs. */
  readonly contextId: string;
  /** Path semantics required to reconstruct each side correctly. */
  readonly fileSystemPathSemantics: FileSystemPathSemantics;
  /** Base/original side of the diff. */
  readonly original: ReviewDiffEditorSideInput;
  /** Head/modified side of the diff. */
  readonly modified: ReviewDiffEditorSideInput;
  /** Non-empty presentation title supplied to the host. */
  readonly title: string;
}

/** Encodes both immutable sides and delegates the actual editor opening to the host. */
export class ReviewDiffEditorController<Uri> {
  /** Creates a controller with the canonical URI codec and platform host boundary. */
  public constructor(private readonly codec: ReviewDiffUriCodec, private readonly host: ReviewDiffEditorHost<Uri>) {}

  /** Opens the original/base URI first and modified/head URI second. */
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

import type {
  GitCommitReviewDiffDocumentDescriptor,
  ReviewDiffDocumentDescriptor,
  RevisionTextContentReadResult,
  RevisionTextContentSource
} from "../../application/diff-document/index";
import { requireCanonicalRepositoryRelativePath } from "../../application/repository-path/index";
import { LocalGitAdapter } from "../local-git/index";

/** Resolves the local working-tree root that owns one persisted review context. */
export interface ReviewDiffRepositoryRootResolver {
  /** Returns the exact repository root for the context, or `undefined` when unavailable. */
  resolveRepositoryRoot(contextId: string): Promise<string | undefined>;
}

/**
 * Supplies immutable diff content from local Git while preserving context isolation.
 * Synthetic `empty` descriptors are rejected before repository resolution or Git access.
 */
export class LocalGitRevisionTextContentSource
  implements RevisionTextContentSource
{
  public constructor(
    private readonly repositoryRootResolver: ReviewDiffRepositoryRootResolver,
    private readonly localGitAdapter: LocalGitAdapter
  ) {}

  /** Resolves the context root and reads the descriptor's exact Git commit and path. */
  public async readTextContent(
    descriptor: GitCommitReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult> {
    const runtimeDescriptor = descriptor as ReviewDiffDocumentDescriptor;
    if (runtimeDescriptor.revisionSource !== "git-commit") {
      throw new TypeError(
        "Local Git revision content source accepts only git-commit descriptors."
      );
    }

    const repositoryRoot = await this.repositoryRootResolver.resolveRepositoryRoot(
      descriptor.contextId
    );
    if (repositoryRoot === undefined) {
      return { kind: "missing-context" };
    }

    const filePath = requireCanonicalRepositoryRelativePath(
      descriptor.filePath,
      descriptor.fileSystemPathSemantics,
      "descriptor.filePath"
    );
    return this.localGitAdapter.readTextFileAtRevision(
      repositoryRoot,
      descriptor.revision,
      filePath,
      descriptor.fileSystemPathSemantics
    );
  }
}

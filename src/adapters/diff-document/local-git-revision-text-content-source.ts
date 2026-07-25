import type {
  ReviewDiffDocumentDescriptor,
  RevisionTextContentReadResult,
  RevisionTextContentSource
} from "../../application/diff-document/index";
import { LocalGitAdapter } from "../local-git/index";

/** Resolves the local working-tree root that owns one persisted review context. */
export interface ReviewDiffRepositoryRootResolver {
  /** Returns the exact repository root for the context, or `undefined` when unavailable. */
  resolveRepositoryRoot(contextId: string): Promise<string | undefined>;
}

/**
 * Supplies immutable diff content from local Git while preserving context isolation.
 *
 * The source never falls back to another context or revision. GitHub and snapshot
 * fallbacks can implement the same application contract in their later tasks.
 */
export class LocalGitRevisionTextContentSource
  implements RevisionTextContentSource
{
  public constructor(
    private readonly repositoryRootResolver: ReviewDiffRepositoryRootResolver,
    private readonly localGitAdapter: LocalGitAdapter
  ) {}

  /** Resolves the context root and reads the descriptor's exact Git revision and path. */
  public async readTextContent(
    descriptor: ReviewDiffDocumentDescriptor
  ): Promise<RevisionTextContentReadResult> {
    const repositoryRoot = await this.repositoryRootResolver.resolveRepositoryRoot(
      descriptor.contextId
    );
    if (repositoryRoot === undefined) {
      return { kind: "missing-context" };
    }

    return this.localGitAdapter.readTextFileAtRevision(
      repositoryRoot,
      descriptor.revision,
      descriptor.filePath
    );
  }
}

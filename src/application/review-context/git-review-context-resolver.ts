import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type ReviewContextState
} from "../../core/contracts/index";
import type {
  GitReviewContextRepositorySnapshot,
  GitReviewContextResolverOptions,
  ResolvedGitReviewContext
} from "./contracts";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const assertNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty string without null characters.`);
  }
};

/** Resolves stable branch and detached-commit review context identities. */
export class GitReviewContextResolver {
  private readonly now: () => Date;

  /** Creates a deterministic resolver with an optional timestamp source. */
  public constructor(
    private readonly options: GitReviewContextResolverOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Resolves one inspected repository snapshot.
   *
   * Branch identity uses only repository ID and full ref, so moving HEAD keeps the
   * same context. Detached identity includes the immutable commit object ID.
   */
  public resolve(
    repository: GitReviewContextRepositorySnapshot
  ): ResolvedGitReviewContext {
    assertNonEmpty(repository.repositoryId, "repositoryId");
    assertNonEmpty(repository.rootPath, "rootPath");
    const timestamp = this.now().toISOString();

    if (repository.branch.kind === "branch") {
      assertNonEmpty(repository.branch.fullRef, "branch.fullRef");
      if (!repository.branch.fullRef.startsWith("refs/heads/")) {
        throw new TypeError("branch.fullRef must be a complete refs/heads/... ref.");
      }
      if (
        repository.head !== undefined &&
        !FULL_OBJECT_ID_PATTERN.test(repository.head)
      ) {
        throw new TypeError("branch HEAD must be a full lowercase Git object ID.");
      }
      const revisionId =
        repository.head ?? `unborn:${repository.branch.fullRef}`;
      const contextId = this.createId(
        "branch-context",
        repository.repositoryId,
        repository.branch.fullRef
      );
      const contextState: ReviewContextState = {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        contextId,
        kind: "branch",
        repositoryId: repository.repositoryId,
        displayName: repository.branch.fullRef,
        branch: {
          refName: repository.branch.fullRef,
          headRevision: revisionId
        },
        files: {},
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return {
        kind: "branch",
        repositoryId: repository.repositoryId,
        repositoryRoot: repository.rootPath,
        contextId,
        revisionId,
        contextState
      };
    }

    const head = repository.head;
    if (head === undefined || !FULL_OBJECT_ID_PATTERN.test(head)) {
      throw new TypeError(
        "detached HEAD requires a full commit object ID."
      );
    }
    const refName = `HEAD@${head}`;
    const contextId = this.createId(
      "detached-context",
      repository.repositoryId,
      refName
    );
    const contextState: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId,
      kind: "branch",
      repositoryId: repository.repositoryId,
      displayName: refName,
      branch: {
        refName,
        headRevision: head
      },
      files: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return {
      kind: "detached-commit",
      repositoryId: repository.repositoryId,
      repositoryRoot: repository.rootPath,
      contextId,
      revisionId: head,
      contextState
    };
  }

  private createId(domain: string, ...parts: readonly string[]): string {
    const digest = this.options.stableHash.digest([domain, ...parts].join("\0"));
    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error(
        "StableHash.digest must return a lowercase 64-character SHA-256 hexadecimal digest."
      );
    }
    return `${domain}:${digest}`;
  }
}

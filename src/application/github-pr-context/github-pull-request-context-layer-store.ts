import type {
  PullRequestReviewContext,
  RepositoryGlobalState,
  ReviewContextState,
} from "../../core/contracts/index";

export interface GitHubPullRequestContextIdentity {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
}

export interface PullRequestReviewStateCommit {
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
}

export interface GitHubPullRequestContextRepositoryPort {
  load(identity: {
    readonly kind: "pull-request";
    readonly repositoryId: string;
    readonly contextId: string;
  }): Promise<PullRequestReviewStateCommit | undefined>;
  create(transaction: {
    readonly repositoryId: string;
    readonly contextId: string;
    readonly expected: {
      readonly contextState: undefined;
      readonly globalState: RepositoryGlobalState | undefined;
    };
    readonly next: PullRequestReviewStateCommit;
  }): Promise<void>;
  commit(transaction: {
    readonly repositoryId: string;
    readonly contextId: string;
    readonly expected: PullRequestReviewStateCommit;
    readonly next: PullRequestReviewStateCommit;
  }): Promise<void>;
}

export interface PullRequestRevisionMappingInput {
  readonly current: ReviewContextState;
  readonly nextPullRequest: PullRequestReviewContext;
}

export type PullRequestRevisionMapper = (
  input: PullRequestRevisionMappingInput
) => Promise<ReviewContextState>;

export interface UpdatePullRequestContextInput {
  readonly repositoryId: string;
  readonly identity: GitHubPullRequestContextIdentity;
  readonly pullRequest: PullRequestReviewContext;
  readonly displayName?: string;
}

const GITHUB_HOST = "github.com";
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/u;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function canonicalizeGitHubPullRequestIdentity(
  identity: GitHubPullRequestContextIdentity
): GitHubPullRequestContextIdentity {
  let host = identity.host.trim().toLowerCase();
  if (host.endsWith(":443")) {
    host = host.slice(0, -4);
  }
  if (!HOST_PATTERN.test(host) || host.includes("..")) {
    throw new Error("Invalid canonical GitHub host");
  }
  const explicitPort = host.includes(":") ? Number(host.slice(host.lastIndexOf(":") + 1)) : undefined;
  if (explicitPort !== undefined && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)) {
    throw new Error("Invalid GitHub port");
  }

  let owner = identity.owner.trim();
  let repository = identity.repository.trim().replace(/\.git$/iu, "");
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repository)) {
    throw new Error("Invalid GitHub owner or repository");
  }
  if (host === GITHUB_HOST) {
    owner = owner.toLowerCase();
    repository = repository.toLowerCase();
  }
  if (!Number.isSafeInteger(identity.pullRequestNumber) || identity.pullRequestNumber <= 0) {
    throw new Error("Invalid pull request number");
  }
  return { host, owner, repository, pullRequestNumber: identity.pullRequestNumber };
}

export function createGitHubPullRequestContextId(
  identity: GitHubPullRequestContextIdentity
): string {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  return `github-pr:${canonical.host}/${canonical.owner}/${canonical.repository}#${canonical.pullRequestNumber}`;
}

export class GitHubPullRequestContextStateService {
  public constructor(
    private readonly repository: GitHubPullRequestContextRepositoryPort,
    private readonly mapRevision: PullRequestRevisionMapper
  ) {}

  public async create(
    commit: PullRequestReviewStateCommit,
    expectedGlobalState: RepositoryGlobalState | undefined
  ): Promise<void> {
    requirePullRequestContext(commit.contextState);
    await this.repository.create({
      repositoryId: commit.contextState.repositoryId,
      contextId: commit.contextState.contextId,
      expected: { contextState: undefined, globalState: expectedGlobalState },
      next: cloneCommit(commit),
    });
  }

  public async load(
    repositoryId: string,
    identity: GitHubPullRequestContextIdentity
  ): Promise<PullRequestReviewStateCommit | undefined> {
    return this.repository.load({
      kind: "pull-request",
      repositoryId,
      contextId: createGitHubPullRequestContextId(identity),
    });
  }

  public async update(input: UpdatePullRequestContextInput): Promise<PullRequestReviewStateCommit> {
    const contextId = createGitHubPullRequestContextId(input.identity);
    requirePullRequestDescriptor(input.pullRequest, input.identity);
    const target = { kind: "pull-request" as const, repositoryId: input.repositoryId, contextId };
    const current = await this.repository.load(target);
    if (current === undefined) {
      throw new Error("Pull-request review context does not exist");
    }
    requirePullRequestContext(current.contextState);

    const revisionChanged =
      current.contextState.pullRequest.baseSha !== input.pullRequest.baseSha ||
      current.contextState.pullRequest.headSha !== input.pullRequest.headSha;
    let nextContext: ReviewContextState;
    if (revisionChanged) {
      nextContext = await this.mapRevision({
        current: cloneValue(current.contextState),
        nextPullRequest: cloneValue(input.pullRequest),
      });
      requireMappedContext(nextContext, current.contextState, input.pullRequest);
    } else {
      nextContext = {
        ...cloneValue(current.contextState),
        displayName: input.displayName ?? current.contextState.displayName,
        pullRequest: cloneValue(input.pullRequest),
        updatedAt: new Date().toISOString(),
      };
    }

    const next = { contextState: nextContext, globalState: cloneValue(current.globalState) };
    await this.repository.commit({
      repositoryId: input.repositoryId,
      contextId,
      expected: cloneCommit(current),
      next: cloneCommit(next),
    });
    return cloneCommit(next);
  }
}

function requirePullRequestContext(context: ReviewContextState): asserts context is ReviewContextState & { pullRequest: PullRequestReviewContext } {
  if (context.kind !== "pull-request" || context.pullRequest === undefined) {
    throw new Error("T404 requires an authoritative pull-request ReviewContextState");
  }
  requireFullObjectId(context.pullRequest.baseSha);
  requireFullObjectId(context.pullRequest.headSha);
}

function requirePullRequestDescriptor(
  pullRequest: PullRequestReviewContext,
  identity: GitHubPullRequestContextIdentity
): void {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  const descriptor = canonicalizeGitHubPullRequestIdentity({
    host: pullRequest.host,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
    pullRequestNumber: pullRequest.number,
  });
  if (createGitHubPullRequestContextId(canonical) !== createGitHubPullRequestContextId(descriptor)) {
    throw new Error("Pull-request descriptor does not match context identity");
  }
  requireFullObjectId(pullRequest.baseSha);
  requireFullObjectId(pullRequest.headSha);
}

function requireMappedContext(
  mapped: ReviewContextState,
  current: ReviewContextState,
  pullRequest: PullRequestReviewContext
): void {
  requirePullRequestContext(mapped);
  if (
    mapped.contextId !== current.contextId ||
    mapped.repositoryId !== current.repositoryId ||
    mapped.pullRequest.baseSha !== pullRequest.baseSha ||
    mapped.pullRequest.headSha !== pullRequest.headSha
  ) {
    throw new Error("Revision mapper returned a mismatched pull-request context");
  }
}

function requireFullObjectId(value: string): void {
  if (!FULL_OBJECT_ID.test(value)) {
    throw new Error("Revision must be a lowercase full SHA-1 or SHA-256 object ID");
  }
}

function cloneCommit(commit: PullRequestReviewStateCommit): PullRequestReviewStateCommit {
  return cloneValue(commit);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

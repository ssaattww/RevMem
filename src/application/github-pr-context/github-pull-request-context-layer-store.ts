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

export interface PullRequestReviewContextVisibility extends PullRequestReviewContext {
  /** Explicit user override. Absence means open=enabled and closed/merged=disabled. */
  readonly decorationEnabled?: boolean;
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
  readonly current: PullRequestReviewStateCommit;
  readonly nextPullRequest: PullRequestReviewContextVisibility;
}

/** Maps Context and owner-wide Global as one revision transition. */
export type PullRequestRevisionMapper = (
  input: PullRequestRevisionMappingInput
) => Promise<PullRequestReviewStateCommit>;

export interface UpdatePullRequestContextInput {
  readonly repositoryId: string;
  readonly identity: GitHubPullRequestContextIdentity;
  readonly pullRequest: PullRequestReviewContextVisibility;
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
  if (host.endsWith(":443")) host = host.slice(0, -4);
  if (!HOST_PATTERN.test(host) || host.includes("..")) throw new Error("Invalid canonical GitHub host");
  const explicitPort = host.includes(":") ? Number(host.slice(host.lastIndexOf(":") + 1)) : undefined;
  if (explicitPort !== undefined && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)) {
    throw new Error("Invalid GitHub port");
  }
  let owner = identity.owner.trim();
  let repository = identity.repository.trim().replace(/\.git$/iu, "");
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repository)) throw new Error("Invalid GitHub owner or repository");
  if (host === GITHUB_HOST) {
    owner = owner.toLowerCase();
    repository = repository.toLowerCase();
  }
  if (!Number.isSafeInteger(identity.pullRequestNumber) || identity.pullRequestNumber <= 0) throw new Error("Invalid pull request number");
  return { host, owner, repository, pullRequestNumber: identity.pullRequestNumber };
}

/** Builds the PR context ID from the T202/T401 canonical repository identity. */
export function createGitHubPullRequestContextIdFromRepositoryId(
  repositoryId: string,
  pullRequestNumber: number
): string {
  if (repositoryId.trim() !== repositoryId || repositoryId.length === 0 || repositoryId.includes("#")) {
    throw new Error("repositoryId must be a canonical repository identity");
  }
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) throw new Error("Invalid pull request number");
  return `github-pr:${repositoryId}#${pullRequestNumber}`;
}

export function createGitHubPullRequestContextId(identity: GitHubPullRequestContextIdentity): string {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  return createGitHubPullRequestContextIdFromRepositoryId(
    `${canonical.host}/${canonical.owner}/${canonical.repository}`,
    canonical.pullRequestNumber
  );
}

export function isPullRequestDecorationEnabled(pullRequest: PullRequestReviewContextVisibility): boolean {
  return pullRequest.decorationEnabled ?? pullRequest.state === "open";
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
    const pullRequest = requirePullRequestContext(commit.contextState);
    const canonicalContextId = createGitHubPullRequestContextIdFromRepositoryId(
      commit.contextState.repositoryId,
      pullRequest.number
    );
    if (commit.contextState.contextId !== canonicalContextId) {
      throw new Error("Pull-request contextId does not match canonical repository identity");
    }
    requirePullRequestDescriptor(pullRequest, commit.contextState.repositoryId, pullRequest.number);
    await this.repository.create({
      repositoryId: commit.contextState.repositoryId,
      contextId: commit.contextState.contextId,
      expected: { contextState: undefined, globalState: expectedGlobalState },
      next: cloneCommit(commit),
    });
  }

  public async load(repositoryId: string, identity: GitHubPullRequestContextIdentity): Promise<PullRequestReviewStateCommit | undefined> {
    requireIdentityMatchesRepositoryId(identity, repositoryId);
    return this.repository.load({
      kind: "pull-request",
      repositoryId,
      contextId: createGitHubPullRequestContextIdFromRepositoryId(repositoryId, identity.pullRequestNumber),
    });
  }

  public async update(input: UpdatePullRequestContextInput): Promise<PullRequestReviewStateCommit> {
    requireIdentityMatchesRepositoryId(input.identity, input.repositoryId);
    const contextId = createGitHubPullRequestContextIdFromRepositoryId(input.repositoryId, input.identity.pullRequestNumber);
    requirePullRequestDescriptor(input.pullRequest, input.repositoryId, input.identity.pullRequestNumber);
    const target = { kind: "pull-request" as const, repositoryId: input.repositoryId, contextId };
    const current = await this.repository.load(target);
    if (current === undefined) throw new Error("Pull-request review context does not exist");
    requirePullRequestContext(current.contextState);

    const revisionChanged =
      current.contextState.pullRequest!.baseSha !== input.pullRequest.baseSha ||
      current.contextState.pullRequest!.headSha !== input.pullRequest.headSha;
    let next: PullRequestReviewStateCommit;
    if (revisionChanged) {
      next = await this.mapRevision({ current: cloneCommit(current), nextPullRequest: cloneValue(input.pullRequest) });
      requireMappedCommit(next, current, input.pullRequest);
    } else {
      next = {
        contextState: {
          ...cloneValue(current.contextState),
          displayName: input.displayName ?? current.contextState.displayName,
          pullRequest: cloneValue(input.pullRequest),
          updatedAt: new Date().toISOString(),
        },
        globalState: cloneValue(current.globalState),
      };
    }

    await this.repository.commit({
      repositoryId: input.repositoryId,
      contextId,
      expected: cloneCommit(current),
      next: cloneCommit(next),
    });
    return cloneCommit(next);
  }
}

function requireIdentityMatchesRepositoryId(identity: GitHubPullRequestContextIdentity, repositoryId: string): void {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  if (`${canonical.host}/${canonical.owner}/${canonical.repository}` !== repositoryId) {
    throw new Error("PR identity does not match canonical repositoryId");
  }
}

function requirePullRequestContext(context: ReviewContextState): PullRequestReviewContextVisibility {
  if (context.kind !== "pull-request" || context.pullRequest === undefined) {
    throw new Error("T404 requires an authoritative pull-request ReviewContextState");
  }
  requireFullObjectId(context.pullRequest.baseSha);
  requireFullObjectId(context.pullRequest.headSha);
  return context.pullRequest as PullRequestReviewContextVisibility;
}

function requirePullRequestDescriptor(
  pullRequest: PullRequestReviewContextVisibility,
  repositoryId: string,
  pullRequestNumber: number
): void {
  requireIdentityMatchesRepositoryId({
    host: pullRequest.host,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
    pullRequestNumber: pullRequest.number,
  }, repositoryId);
  if (pullRequest.number !== pullRequestNumber) throw new Error("Pull-request descriptor does not match context identity");
  requireFullObjectId(pullRequest.baseSha);
  requireFullObjectId(pullRequest.headSha);
  if (pullRequest.decorationEnabled !== undefined && typeof pullRequest.decorationEnabled !== "boolean") {
    throw new Error("Invalid pull-request decoration override");
  }
}

function requireMappedCommit(
  mapped: PullRequestReviewStateCommit,
  current: PullRequestReviewStateCommit,
  pullRequest: PullRequestReviewContextVisibility
): void {
  const mappedPullRequest = requirePullRequestContext(mapped.contextState);
  if (
    mapped.contextState.contextId !== current.contextState.contextId ||
    mapped.contextState.repositoryId !== current.contextState.repositoryId ||
    mapped.globalState.repositoryId !== current.globalState.repositoryId ||
    mappedPullRequest.baseSha !== pullRequest.baseSha ||
    mappedPullRequest.headSha !== pullRequest.headSha ||
    mapped.globalState.currentRevisionId !== pullRequest.headSha
  ) {
    throw new Error("Revision mapper returned a mismatched Context/Global commit");
  }
}

function requireFullObjectId(value: string): void {
  if (!FULL_OBJECT_ID.test(value)) throw new Error("Revision must be a lowercase full SHA-1 or SHA-256 object ID");
}

function cloneCommit(commit: PullRequestReviewStateCommit): PullRequestReviewStateCommit {
  return cloneValue(commit);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

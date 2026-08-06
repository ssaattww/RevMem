import type {
  PullRequestReviewContext,
  RepositoryGlobalState,
  ReviewContextState,
} from "../../core/contracts/index";
import {
  canonicalizeHostedGitAuthority,
  canonicalizeHostedGitRepositoryIdentity,
} from "../../core/repository-identity/index";

export interface GitHubPullRequestContextIdentity {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
}

export interface PullRequestReviewContextVisibility extends PullRequestReviewContext {
  readonly decorationEnabled?: boolean;
}

export interface PullRequestReviewStateCommit {
  readonly contextState: ReviewContextState;
  readonly globalState: RepositoryGlobalState;
}

export interface GitHubPullRequestContextRepositoryPort {
  load(identity: { readonly kind: "pull-request"; readonly repositoryId: string; readonly contextId: string }): Promise<PullRequestReviewStateCommit | undefined>;
  create(transaction: { readonly repositoryId: string; readonly contextId: string; readonly expected: { readonly contextState: undefined; readonly globalState: RepositoryGlobalState | undefined }; readonly next: PullRequestReviewStateCommit }): Promise<void>;
  commit(transaction: { readonly repositoryId: string; readonly contextId: string; readonly expected: PullRequestReviewStateCommit; readonly next: PullRequestReviewStateCommit }): Promise<void>;
}

export interface PullRequestRevisionMappingEvidence {
  readonly repositoryId: string;
  readonly contextId: string;
  readonly sourceBaseSha: string;
  readonly sourceHeadSha: string;
  readonly targetBaseSha: string;
  readonly targetHeadSha: string;
}

export interface PullRequestRevisionMappingInput {
  readonly current: PullRequestReviewStateCommit;
  readonly nextPullRequest: PullRequestReviewContextVisibility;
  readonly evidence: PullRequestRevisionMappingEvidence;
}

export type PullRequestRevisionMapper = (input: PullRequestRevisionMappingInput) => Promise<PullRequestReviewStateCommit>;

export interface UpdatePullRequestContextInput {
  readonly repositoryId: string;
  readonly identity: GitHubPullRequestContextIdentity;
  readonly pullRequest: PullRequestReviewContextVisibility;
  readonly displayName?: string;
}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function canonicalizeGitHubPullRequestIdentity(identity: GitHubPullRequestContextIdentity): GitHubPullRequestContextIdentity {
  if (!Number.isSafeInteger(identity.pullRequestNumber) || identity.pullRequestNumber <= 0) throw new Error("Invalid pull request number");
  const canonicalHost = canonicalizeHostedGitAuthority(identity.host, 443);
  const repositoryId = canonicalizeHostedGitRepositoryIdentity(canonicalHost, `${identity.owner}/${identity.repository}`);
  const [host, owner, repository] = repositoryId.split("/");
  if (host === undefined || owner === undefined || repository === undefined) throw new Error("Invalid canonical GitHub repository identity");
  return { host, owner, repository, pullRequestNumber: identity.pullRequestNumber };
}

export function createGitHubPullRequestContextIdFromRepositoryId(repositoryId: string, pullRequestNumber: number): string {
  const canonicalRepositoryId = requireCanonicalRepositoryId(repositoryId);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) throw new Error("Invalid pull request number");
  return `github-pr:${canonicalRepositoryId}#${pullRequestNumber}`;
}

export function createGitHubPullRequestContextId(identity: GitHubPullRequestContextIdentity): string {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  return createGitHubPullRequestContextIdFromRepositoryId(canonicalizeHostedGitRepositoryIdentity(canonical.host, `${canonical.owner}/${canonical.repository}`), canonical.pullRequestNumber);
}

export function isPullRequestDecorationEnabled(pullRequest: PullRequestReviewContextVisibility): boolean {
  return pullRequest.decorationEnabled ?? pullRequest.state === "open";
}

export class GitHubPullRequestContextStateService {
  public constructor(private readonly repository: GitHubPullRequestContextRepositoryPort, private readonly mapRevision: PullRequestRevisionMapper) {}

  public async create(commit: PullRequestReviewStateCommit, expectedGlobalState: RepositoryGlobalState | undefined): Promise<void> {
    const pullRequest = requirePullRequestContext(commit.contextState);
    const canonicalRepositoryId = requireCanonicalRepositoryId(commit.contextState.repositoryId);
    if (commit.globalState.repositoryId !== canonicalRepositoryId) throw new Error("Global state does not match canonical repository identity");
    const canonicalContextId = createGitHubPullRequestContextIdFromRepositoryId(canonicalRepositoryId, pullRequest.number);
    if (commit.contextState.contextId !== canonicalContextId) throw new Error("Pull-request contextId does not match canonical repository identity");
    requirePullRequestDescriptor(pullRequest, canonicalRepositoryId, pullRequest.number);
    requireSnapshotFileRevisions(commit, pullRequest.headSha);
    await this.repository.create({ repositoryId: canonicalRepositoryId, contextId: commit.contextState.contextId, expected: { contextState: undefined, globalState: expectedGlobalState }, next: cloneCommit(commit) });
  }

  public async load(repositoryId: string, identity: GitHubPullRequestContextIdentity): Promise<PullRequestReviewStateCommit | undefined> {
    const canonicalRepositoryId = requireCanonicalRepositoryId(repositoryId);
    requireIdentityMatchesRepositoryId(identity, canonicalRepositoryId);
    return this.repository.load({ kind: "pull-request", repositoryId: canonicalRepositoryId, contextId: createGitHubPullRequestContextIdFromRepositoryId(canonicalRepositoryId, identity.pullRequestNumber) });
  }

  public async update(input: UpdatePullRequestContextInput): Promise<PullRequestReviewStateCommit> {
    const canonicalRepositoryId = requireCanonicalRepositoryId(input.repositoryId);
    requireIdentityMatchesRepositoryId(input.identity, canonicalRepositoryId);
    const contextId = createGitHubPullRequestContextIdFromRepositoryId(canonicalRepositoryId, input.identity.pullRequestNumber);
    requirePullRequestDescriptor(input.pullRequest, canonicalRepositoryId, input.identity.pullRequestNumber);
    const current = await this.repository.load({ kind: "pull-request", repositoryId: canonicalRepositoryId, contextId });
    if (current === undefined) throw new Error("Pull-request review context does not exist");
    const currentPullRequest = requirePullRequestContext(current.contextState);
    const nextPullRequest = preserveVisibilityOverride(currentPullRequest, input.pullRequest);
    const revisionChanged = currentPullRequest.baseSha !== nextPullRequest.baseSha || currentPullRequest.headSha !== nextPullRequest.headSha;
    let next: PullRequestReviewStateCommit;
    if (revisionChanged) {
      const evidence = Object.freeze<PullRequestRevisionMappingEvidence>({ repositoryId: canonicalRepositoryId, contextId, sourceBaseSha: currentPullRequest.baseSha, sourceHeadSha: currentPullRequest.headSha, targetBaseSha: nextPullRequest.baseSha, targetHeadSha: nextPullRequest.headSha });
      next = await this.mapRevision({ current: cloneCommit(current), nextPullRequest: cloneValue(nextPullRequest), evidence });
      requireMappedCommit(next, current, nextPullRequest, evidence);
    } else {
      next = { contextState: { ...cloneValue(current.contextState), displayName: input.displayName ?? current.contextState.displayName, pullRequest: cloneValue(nextPullRequest), updatedAt: new Date().toISOString() }, globalState: cloneValue(current.globalState) };
    }
    await this.repository.commit({ repositoryId: canonicalRepositoryId, contextId, expected: cloneCommit(current), next: cloneCommit(next) });
    return cloneCommit(next);
  }
}

function preserveVisibilityOverride(current: PullRequestReviewContextVisibility, next: PullRequestReviewContextVisibility): PullRequestReviewContextVisibility {
  if (next.decorationEnabled !== undefined || current.decorationEnabled === undefined) return cloneValue(next);
  return { ...cloneValue(next), decorationEnabled: current.decorationEnabled };
}

function requireCanonicalRepositoryId(repositoryId: string): string {
  if (repositoryId.trim() !== repositoryId || repositoryId.length === 0) throw new Error("repositoryId must be canonical");
  const pieces = repositoryId.split("/");
  if (pieces.length !== 3) throw new Error("repositoryId must contain host/owner/repository");
  const canonical = canonicalizeHostedGitRepositoryIdentity(pieces[0]!, `${pieces[1]!}/${pieces[2]!}`);
  if (canonical !== repositoryId) throw new Error("repositoryId must be canonical");
  return canonical;
}

function requireIdentityMatchesRepositoryId(identity: GitHubPullRequestContextIdentity, repositoryId: string): void {
  const canonical = canonicalizeGitHubPullRequestIdentity(identity);
  const canonicalIdentityRepository = canonicalizeHostedGitRepositoryIdentity(canonical.host, `${canonical.owner}/${canonical.repository}`);
  if (canonicalIdentityRepository !== repositoryId) throw new Error("PR identity does not match canonical repositoryId");
}

function requirePullRequestContext(context: ReviewContextState): PullRequestReviewContextVisibility {
  if (context.kind !== "pull-request" || context.pullRequest === undefined) throw new Error("T404 requires an authoritative pull-request ReviewContextState");
  requireFullObjectId(context.pullRequest.baseSha);
  requireFullObjectId(context.pullRequest.headSha);
  return context.pullRequest as PullRequestReviewContextVisibility;
}

function requirePullRequestDescriptor(pullRequest: PullRequestReviewContextVisibility, repositoryId: string, pullRequestNumber: number): void {
  requireIdentityMatchesRepositoryId({ host: pullRequest.host, owner: pullRequest.owner, repository: pullRequest.repository, pullRequestNumber: pullRequest.number }, repositoryId);
  if (pullRequest.number !== pullRequestNumber) throw new Error("Pull-request descriptor does not match context identity");
  requireFullObjectId(pullRequest.baseSha);
  requireFullObjectId(pullRequest.headSha);
  if (pullRequest.decorationEnabled !== undefined && typeof pullRequest.decorationEnabled !== "boolean") throw new Error("Invalid pull-request decoration override");
}

function requireMappedCommit(mapped: PullRequestReviewStateCommit, current: PullRequestReviewStateCommit, pullRequest: PullRequestReviewContextVisibility, evidence: PullRequestRevisionMappingEvidence): void {
  const mappedPullRequest = requirePullRequestContext(mapped.contextState);
  requirePullRequestDescriptor(mappedPullRequest, evidence.repositoryId, pullRequest.number);
  if (mapped.contextState.contextId !== evidence.contextId || mapped.contextState.contextId !== current.contextState.contextId || mapped.contextState.repositoryId !== evidence.repositoryId || mapped.globalState.repositoryId !== evidence.repositoryId || mappedPullRequest.baseSha !== evidence.targetBaseSha || mappedPullRequest.headSha !== evidence.targetHeadSha || mapped.globalState.currentRevisionId !== evidence.targetHeadSha) throw new Error("Revision mapper returned a mismatched Context/Global commit");
  requireSnapshotFileRevisions(mapped, evidence.targetHeadSha);
}

function requireSnapshotFileRevisions(commit: PullRequestReviewStateCommit, revisionId: string): void {
  for (const file of Object.values(commit.contextState.files)) if (file.revisionId !== revisionId) throw new Error("Mapped Context file revision does not match target head");
  for (const file of Object.values(commit.globalState.files)) if (file.revisionId !== revisionId) throw new Error("Mapped Global file revision does not match target head");
}

function requireFullObjectId(value: string): void { if (!FULL_OBJECT_ID.test(value)) throw new Error("Revision must be a lowercase full SHA-1 or SHA-256 object ID"); }
function cloneCommit(commit: PullRequestReviewStateCommit): PullRequestReviewStateCommit { return cloneValue(commit); }
function cloneValue<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
